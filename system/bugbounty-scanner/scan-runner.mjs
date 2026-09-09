// Orquestrador do scanner: busca código atualizado, roda as heurísticas,
// só grava na fila o que for GENUINAMENTE NOVO (evita spam a cada rodada),
// e sincroniza com o GitHub para o agente da nuvem conseguir ver.
//
// Isso é a parte BARATA (sem IA) do pipeline de bug bounty. A fila que
// este script produz é lida por um agente de nuvem separado, que só aí
// gasta uso de verdade analisando cada item.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TARGETS } from './targets.mjs';
import { fetchContractSource } from './fetch.mjs';
import { scanSource } from './heuristics.mjs';
import { JS_TARGETS } from './targets-js.mjs';
import { GO_TARGETS } from './targets-go.mjs';
import { JVM_TARGETS } from './targets-jvm.mjs';
import { SWIFT_TARGETS } from './targets-swift.mjs';
import { SOLIDITY_TARGETS } from './targets-solidity.mjs';
import { listRepoFiles, fetchRawFile, isScannableFile, isScannableGoFile, isScannableJvmFile, isScannableSwiftFile, isScannableSolidityFile, prioritizeFilesForScan, listRecentlyChangedFiles } from './fetch-repo.mjs';
import { scanJsSource } from './heuristics-js.mjs';
import { scanGoSource } from './heuristics-go.mjs';
import { scanJvmSource } from './heuristics-jvm.mjs';
import { scanSwiftSource } from './heuristics-swift.mjs';
import { scanSoliditySource } from './heuristics-solidity.mjs';
import { deriveLanguage, historicalConfidenceFor, loadStats, runVerdictStats } from './verdict-stats.mjs';
import { isQuarantined, computeQuarantinedRules, renderQuarantineMarkdown } from './quarantine.mjs';
import { generateStatusDashboard } from './status-dashboard.mjs';
import { generateDashboard } from './generate-dashboard.mjs';
import { runDependencyScan } from './dep-scanner.mjs';
import { filterFilesToChangedPaths, immutableRefForScan } from './delta-file-selection.mjs';
import { appendEntry, readLedger } from '../ledger/ledger.mjs';
import { openDb, upsertFinding, closeDb, stateCounts, listFindings, listSubmissions } from './db.mjs';
import { sendTelegramMessage } from './telegram.mjs';
import { pullLatest, commitAndPush } from './git-sync.mjs';
import { runTelegramDigest } from './telegram-digest.mjs';
import { migrateAll } from './migrate-to-v2.mjs';
import { computeStatsFromSubmissions, enrichSubmissionsWithFindings, isDuplicateSaturatedProgram, repositoryFromFinding } from './outcome-intelligence.mjs';
import { filterBannedTargets, loadProgramPolicyStrict } from './program-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const QUEUE_PATH = path.join(BUGBOUNTY_DIR, 'queue.jsonl');
const SEEN_PATH = path.join(BUGBOUNTY_DIR, 'scanner-seen.json');
const REPO_SHAS_PATH = path.join(BUGBOUNTY_DIR, 'scanner-seen-repo-shas.json');
const STATS_JSON_PATH = path.join(BUGBOUNTY_DIR, 'heuristic-stats.json');
const STATS_MD_PATH = path.join(BUGBOUNTY_DIR, 'heuristic-stats.md');
const VERDICTS_SNAPSHOT_PATH = path.join(BUGBOUNTY_DIR, 'scanner-seen-verdicts.json');
const STATUS_PATH = path.join(BUGBOUNTY_DIR, 'STATUS.md');
const DASHBOARD_PATH = path.join(BUGBOUNTY_DIR, 'dashboard', 'index.html');
const QUARANTINE_OVERRIDES_PATH = path.join(BUGBOUNTY_DIR, 'quarantine-overrides.json');
const QUARANTINE_STATUS_PATH = path.join(BUGBOUNTY_DIR, 'quarantine-status.md');
const DB_PATH = path.join(BUGBOUNTY_DIR, 'zerotoone.db');
const PROMOTION_LOG_PATH = path.join(BUGBOUNTY_DIR, 'targets-auto-promoted-log.json');
const MAX_FILES_PER_TARGET = 450;

function fingerprint(f) {
  return `${f.program}::${f.file}::${f.function}::${f.type}`;
}

export function findingIdentity(finding, changeContext = null) {
  const base = fingerprint(finding);
  return changeContext?.introducedCommit
    ? `${base}::commit:${changeContext.introducedCommit}`
    : base;
}

export function buildQueuedFinding(finding, {
  changeContext = null,
  historicalConfidence = null,
  foundAt = new Date().toISOString(),
} = {}) {
  return {
    ...finding,
    id: findingIdentity(finding, changeContext),
    status: 'pending',
    foundAt,
    ...(changeContext ? { changeContext } : {}),
    ...(historicalConfidence ? { historicalConfidence } : {}),
  };
}

function loadSeen() {
  const seen = existsSync(SEEN_PATH)
    ? new Set(JSON.parse(readFileSync(SEEN_PATH, 'utf8')))
    : new Set();
  // A descoberta (Slither/OSV/Semgrep) também cria itens em queue.jsonl,
  // mas historicamente não atualizava scanner-seen.json. Sem esta união,
  // o scan barato podia anexar novamente o mesmo id já revisado e até
  // rebaixá-lo visualmente para pending. A fila é a fonte de identidade
  // mais ampla; todo id que já existe nela precisa ser considerado visto.
  if (existsSync(QUEUE_PATH)) {
    for (const line of readFileSync(QUEUE_PATH, 'utf8').split('\n').filter(Boolean)) {
      const id = JSON.parse(line)?.id;
      if (id) seen.add(id);
    }
  }
  return seen;
}

function saveSeen(seen) {
  writeFileSync(SEEN_PATH, JSON.stringify([...seen].sort(), null, 2), 'utf8');
}

function loadRepoShas() {
  if (!existsSync(REPO_SHAS_PATH)) return {};
  return JSON.parse(readFileSync(REPO_SHAS_PATH, 'utf8'));
}

function saveRepoShas(shas) {
  writeFileSync(REPO_SHAS_PATH, JSON.stringify(shas, null, 2), 'utf8');
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Varre uma lista de repositórios GitHub de UMA linguagem (targets já traz
// program/platform/maxBountyUsd/pathPrefixes). Reutilizado para JS/TS, Go,
// Kotlin/Java e Swift/ObjC — só muda o filtro de arquivo e a função de
// heurística. Não persiste o código-fonte no git (repos grandes demais) —
// só o texto do achado (com trecho de contexto) vai para a fila. Cache de
// SHA de blob por arquivo evita rebuscar/rescanear o que não mudou.
async function runLanguageScan(targets, isScannable, scanFn, seen, newFindings, repoShas, language, priorStats, quarantineOverrides = new Set(), changeContexts = null) {
  let filesChecked = 0;
  let fetchErrors = 0;
  let quarantinedCount = 0;

  for (const target of targets) {
    const repoKey = `${target.owner}/${target.repo}`;
    const changeContext = changeContexts?.get(repoKey.toLowerCase()) || null;
    const scanRef = immutableRefForScan(target, changeContext);
    let files;
    try {
      files = await listRepoFiles(target.owner, target.repo, scanRef, target.pathPrefixes);
    } catch (err) {
      log(`ERRO listando árvore de ${target.owner}/${target.repo}: ${err.message}`);
      fetchErrors++;
      continue;
    }
    files = files.filter((f) => isScannable(f.path));

    if (changeContext) {
      files = filterFilesToChangedPaths(files, changeContext.changedFiles);
    }
    repoShas[repoKey] = repoShas[repoKey] || {};

    if (files.length > MAX_FILES_PER_TARGET) {
      // Prioriza quem nunca foi visto (bug real encontrado em 31/08/2026:
      // a ordem da git tree é estável entre rodadas, então sem isso o
      // corte pega SEMPRE os mesmos primeiros arquivos, pra sempre --
      // ver prioritizeFilesForScan em fetch-repo.mjs). A ordem da git
      // tree é o desempate dentro de cada grupo (nunca-visto primeiro,
      // já-visto depois), não descartada, só deixa de decidir sozinha.
      //
      // 02/09/2026: dentro do grupo "nunca visto", arquivo tocado nos
      // últimos 90 dias vem primeiro (ver listRecentlyChangedFiles em
      // fetch-repo.mjs) -- fama do repo inteiro não protege um arquivo
      // específico de já ter sido lido por muita gente de fora; código
      // novo teve muito menos tempo de escrutínio, mesmo em repo famoso.
      // Melhor esforço sempre: erro de rede aqui (repo raramente
      // atualizado, API fora do ar) não trava a rodada, só some com o
      // sinal extra pra este alvo desta vez.
      let recentlyChanged = null;
      try {
        recentlyChanged = await listRecentlyChangedFiles(target.owner, target.repo, scanRef);
      } catch (err) {
        log(`AVISO: não consegui buscar arquivos recentes de ${repoKey} (${err.message}) -- priorizando só por nunca-visto desta vez.`);
      }
      files = prioritizeFilesForScan(files, new Set(Object.keys(repoShas[repoKey])), recentlyChanged);
      log(`AVISO: ${target.owner}/${target.repo} tem ${files.length} arquivos rastreáveis, cortando para os primeiros ${MAX_FILES_PER_TARGET} priorizando quem nunca foi escaneado (não silencioso — registrado aqui).`);
      files = files.slice(0, MAX_FILES_PER_TARGET);
    }

    for (const file of files) {
      if (repoShas[repoKey][file.path] === file.sha) continue; // sem mudança desde a última rodada
      let source;
      try {
        source = await fetchRawFile(target.owner, target.repo, scanRef, file.path);
      } catch (err) {
        log(`ERRO buscando ${repoKey}/${file.path}: ${err.message}`);
        fetchErrors++;
        continue;
      }
      filesChecked++;
      repoShas[repoKey][file.path] = file.sha;

      const scanned = await scanFn(source, `${repoKey}/${file.path}`); // await funciona pra scanFn síncrona ou assíncrona (ex.: scanJsSource usa AST)
      const findings = scanned.map((f) => ({ ...f, program: target.program, platform: target.platform, maxBountyUsd: target.maxBountyUsd, language }));
      for (const f of findings) {
        const queued = buildQueuedFinding(f, { changeContext });
        const fp = queued.id;
        if (seen.has(fp)) continue;
        seen.add(fp);
        if (isQuarantined(priorStats, f.type, language, { overrides: quarantineOverrides })) {
          quarantinedCount++;
          continue;
        }
        const historicalConfidence = historicalConfidenceFor(priorStats, f.type, language);
        newFindings.push(buildQueuedFinding(f, { changeContext, historicalConfidence }));
      }
    }
  }

  return { filesChecked, fetchErrors, quarantinedCount };
}

function loadQuarantineOverrides() {
  if (!existsSync(QUARANTINE_OVERRIDES_PATH)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(QUARANTINE_OVERRIDES_PATH, 'utf8'));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function targetRepositoryKey(target = {}) {
  return target.owner && target.repo ? `${target.owner}/${target.repo}`.toLowerCase() : null;
}

export function parseChangedRepositories(value) {
  if (value == null || value === '') return null;
  let parsed;
  try { parsed = JSON.parse(value); } catch (error) {
    throw new Error(`ZERO2ONE_CHANGED_REPOSITORIES inválido: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('ZERO2ONE_CHANGED_REPOSITORIES precisa ser array JSON não-vazio');
  }
  const keys = parsed.map((item) => String(item || '').toLowerCase());
  if (keys.some((item) => !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(item))) {
    throw new Error('ZERO2ONE_CHANGED_REPOSITORIES contém owner/repo inválido');
  }
  return new Set(keys);
}

export function parseChangeContexts(value) {
  if (value == null || value === '') return null;
  let parsed;
  try { parsed = JSON.parse(value); } catch (error) {
    throw new Error(`ZERO2ONE_CHANGE_CONTEXT inválido: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('ZERO2ONE_CHANGE_CONTEXT precisa ser array JSON não-vazio');
  }
  const contexts = new Map();
  for (const item of parsed) {
    const repository = String(item?.repository || '').toLowerCase();
    const previousSha = String(item?.previousSha || '').toLowerCase();
    const introducedCommit = String(item?.introducedCommit || '').toLowerCase();
    const parentCommit = item?.parentCommit == null ? null : String(item.parentCommit).toLowerCase();
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repository)) throw new Error('ZERO2ONE_CHANGE_CONTEXT contém owner/repo inválido');
    if (!/^[0-9a-f]{40}$/.test(previousSha) || !/^[0-9a-f]{40}$/.test(introducedCommit)) {
      throw new Error('ZERO2ONE_CHANGE_CONTEXT exige previousSha e introducedCommit completos');
    }
    if (parentCommit !== null && !/^[0-9a-f]{40}$/.test(parentCommit)) throw new Error('ZERO2ONE_CHANGE_CONTEXT contém parentCommit inválido');
    if (!Array.isArray(item.changedFiles)) throw new Error('ZERO2ONE_CHANGE_CONTEXT exige changedFiles do compare GitHub');
    const changedFiles = item.changedFiles.map((file) => String(file || '').replaceAll('\\', '/'));
    if (changedFiles.some((file) => !file || file.startsWith('/') || file.split('/').includes('..') || /[\u0000\r\n]/.test(file))) {
      throw new Error('ZERO2ONE_CHANGE_CONTEXT contém caminho inválido em changedFiles');
    }
    if (contexts.has(repository)) throw new Error(`ZERO2ONE_CHANGE_CONTEXT repete o repositório ${repository}`);
    contexts.set(repository, {
      repository, previousSha, introducedCommit, parentCommit,
      changedFiles: [...new Set(changedFiles)],
      introducedAt: item.introducedAt || null,
      detectedAt: item.detectedAt || null,
      branch: item.branch || null,
      directSingleCommit: item.directSingleCommit === true,
      commitUrl: item.commitUrl || null,
      title: item.title || null,
    });
  }
  return contexts;
}

/** Routine scans skip duplicate-saturated programs; a change-triggered scan
 * selects exactly the changed repositories and intentionally bypasses that
 * efficiency filter so a fresh regression can still be found. */
export function selectTargetsForRun(configuredTargetLists, programPolicy, duplicateHistoryByProgram, changedRepositories = null) {
  const policyAllowed = Object.fromEntries(Object.entries(configuredTargetLists)
    .map(([language, targets]) => [language, filterBannedTargets(targets, programPolicy)]));
  const policyBlocked = Object.values(configuredTargetLists).reduce((sum, targets) => sum + targets.length, 0)
    - Object.values(policyAllowed).reduce((sum, targets) => sum + targets.length, 0);
  let duplicateRiskSkipped = 0;
  let deltaFiltered = 0;
  const targetLists = Object.fromEntries(Object.entries(policyAllowed).map(([language, targets]) => {
    const selected = targets.filter((target) => {
      if (changedRepositories) {
        const key = targetRepositoryKey(target);
        const keep = !!key && changedRepositories.has(key);
        if (!keep) deltaFiltered += 1;
        return keep;
      }
      const keep = !isDuplicateSaturatedProgram(target.program, duplicateHistoryByProgram);
      if (!keep) duplicateRiskSkipped += 1;
      return keep;
    });
    return [language, selected];
  }));
  return { targetLists, policyBlocked, duplicateRiskSkipped, deltaFiltered };
}

export async function runScan() {
  // Puxa o trabalho da sessão de nuvem ANTES de escanear -- sem isso,
  // a tarefa agendada podia escanear em cima de estado desatualizado
  // e, pior, perder o próprio commit se uma corrida de push acontecesse
  // (achado real em logs/bugbounty-scanner.log, 30/08/2026).
  const preflightSync = pullLatest(REPO_ROOT, log);
  if (!preflightSync.ok) throw new Error(`preflight de sincronização bloqueou o scan: ${preflightSync.reason}`);
  if (!existsSync(BUGBOUNTY_DIR)) mkdirSync(BUGBOUNTY_DIR, { recursive: true });
  // O SQLite é materialized view local e não é versionado. Todo ambiente
  // (inclusive checkout efêmero do GitHub Actions) o reconstrói antes de
  // calcular histórico/dashboards. Hidratação nunca reapensa o ledger.
  migrateAll({ queuePath: QUEUE_PATH, dbPath: DB_PATH, writeLog: false, emitLedger: false });
  const programPolicy = loadProgramPolicyStrict();
  const configuredTargetLists = {
    clarity: TARGETS, js: JS_TARGETS, go: GO_TARGETS,
    jvm: JVM_TARGETS, swift: SWIFT_TARGETS, solidity: SOLIDITY_TARGETS,
  };
  let duplicateHistoryByProgram = {};
  {
    const historyDb = openDb(DB_PATH);
    try {
      const submissions = enrichSubmissionsWithFindings(listSubmissions(historyDb), listFindings(historyDb));
      duplicateHistoryByProgram = computeStatsFromSubmissions(submissions).byProgram;
    } finally { closeDb(historyDb); }
  }
  const changeContexts = parseChangeContexts(process.env.ZERO2ONE_CHANGE_CONTEXT);
  const legacyChangedRepositories = parseChangedRepositories(process.env.ZERO2ONE_CHANGED_REPOSITORIES);
  const changedRepositories = changeContexts ? new Set(changeContexts.keys()) : legacyChangedRepositories;
  if (changeContexts && legacyChangedRepositories
    && (changeContexts.size !== legacyChangedRepositories.size
      || [...changeContexts.keys()].some((key) => !legacyChangedRepositories.has(key)))) {
    throw new Error('ZERO2ONE_CHANGE_CONTEXT e ZERO2ONE_CHANGED_REPOSITORIES divergem');
  }
  const selection = selectTargetsForRun(configuredTargetLists, programPolicy, duplicateHistoryByProgram, changedRepositories);
  const { targetLists } = selection;
  const blockedTargetCount = selection.policyBlocked;
  if (blockedTargetCount > 0) {
    log(`Política fail-closed: ${blockedTargetCount} alvo(s) não serão lidos nesta rodada (programa bloqueado, RoE pendente ou sem decisão explícita).`);
  }
  if (changedRepositories) {
    log(`Modo delta: ${changedRepositories.size} repositório(s) alterado(s); ${selection.deltaFiltered} alvo(s) estável(is) excluído(s) desta rodada.`);
  } else if (selection.duplicateRiskSkipped > 0) {
    log(`Modo anti-duplicate: ${selection.duplicateRiskSkipped} alvo(s) de programa com histórico saturado ficaram monitor-only; só serão escaneados após commit novo.`);
  }
  const seen = loadSeen();
  const newFindings = [];
  const priorStats = loadStats(STATS_JSON_PATH);
  const quarantineOverrides = loadQuarantineOverrides();
  let quarantinedTotal = 0;
  let contractsChecked = 0;
  let fetchErrors = 0;

  for (const target of targetLists.clarity) {
    const dir = path.join(BUGBOUNTY_DIR, target.program.toLowerCase().replace(/\s+/g, '-'));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    for (const contractName of target.contracts) {
      let source;
      try {
        source = await fetchContractSource(target.deployer, contractName);
      } catch (err) {
        log(`ERRO buscando ${target.program}/${contractName}: ${err.message}`);
        fetchErrors++;
        continue;
      }
      contractsChecked++;
      writeFileSync(path.join(dir, `${contractName}.clar`), source, 'utf8');

      const findings = scanSource(source, `${contractName}.clar`).map((f) => ({ ...f, program: target.program, platform: target.platform, maxBountyUsd: target.maxBountyUsd, language: 'clarity' }));
      for (const f of findings) {
        const fp = findingIdentity(f);
        if (seen.has(fp)) continue;
        seen.add(fp);
        if (isQuarantined(priorStats, f.type, 'clarity', { overrides: quarantineOverrides })) {
          quarantinedTotal++;
          continue;
        }
        const historicalConfidence = historicalConfidenceFor(priorStats, f.type, 'clarity');
        newFindings.push(buildQueuedFinding(f, { historicalConfidence }));
      }
    }
  }

  const repoShas = loadRepoShas();
  const jsResult = await runLanguageScan(targetLists.js, isScannableFile, scanJsSource, seen, newFindings, repoShas, 'js', priorStats, quarantineOverrides, changeContexts);
  const goResult = await runLanguageScan(targetLists.go, isScannableGoFile, scanGoSource, seen, newFindings, repoShas, 'go', priorStats, quarantineOverrides, changeContexts);
  const jvmResult = await runLanguageScan(targetLists.jvm, isScannableJvmFile, scanJvmSource, seen, newFindings, repoShas, 'jvm', priorStats, quarantineOverrides, changeContexts);
  const swiftResult = await runLanguageScan(targetLists.swift, isScannableSwiftFile, scanSwiftSource, seen, newFindings, repoShas, 'swift', priorStats, quarantineOverrides, changeContexts);
  const solidityResult = await runLanguageScan(targetLists.solidity, isScannableSolidityFile, scanSoliditySource, seen, newFindings, repoShas, 'solidity', priorStats, quarantineOverrides, changeContexts);
  quarantinedTotal += jsResult.quarantinedCount + goResult.quarantinedCount + jvmResult.quarantinedCount + swiftResult.quarantinedCount + solidityResult.quarantinedCount;

  // Cross-referência de dependência conhecida vulnerável (OSV.dev) — roda
  // nos mesmos alvos JS/Go/JVM já rastreados (reusa pathPrefixes e
  // repoShas, sem alvo/cache novo). Swift fica de fora: CocoaPods/SwiftPM
  // não são ecossistemas suportados pelo OSV.dev (confirmado ao vivo).
  const changedFilesByRepo = changeContexts
    ? new Map([...changeContexts].map(([repository, context]) => [repository, new Set(context.changedFiles)]))
    : null;
  const immutableRefsByRepo = changeContexts
    ? new Map([...changeContexts].map(([repository, context]) => [repository, context.introducedCommit]))
    : null;
  const depResult = await runDependencyScan(
    [...targetLists.js, ...targetLists.go, ...targetLists.jvm], repoShas,
    { changedFilesByRepo, immutableRefsByRepo },
  );
  for (const f of depResult.findings) {
    const changeContext = changeContexts?.get(repositoryFromFinding(f)) || null;
    const fp = findingIdentity(f, changeContext);
    if (seen.has(fp)) continue;
    seen.add(fp);
    if (isQuarantined(priorStats, f.type, f.language, { overrides: quarantineOverrides })) {
      quarantinedTotal++;
      continue;
    }
    const historicalConfidence = historicalConfidenceFor(priorStats, f.type, f.language);
    newFindings.push(buildQueuedFinding(f, { changeContext, historicalConfidence }));
  }

  saveRepoShas(repoShas);

  const repoFilesChecked = jsResult.filesChecked + goResult.filesChecked + jvmResult.filesChecked + swiftResult.filesChecked + solidityResult.filesChecked;
  fetchErrors += jsResult.fetchErrors + goResult.fetchErrors + jvmResult.fetchErrors + swiftResult.fetchErrors + solidityResult.fetchErrors + depResult.fetchErrors;

  if (newFindings.length > 0) {
    for (const f of newFindings) {
      appendFileSync(QUEUE_PATH, JSON.stringify(f) + '\n', 'utf8');
    }
    // Grava também no banco v2 (estado operacional novo, ver
    // docs/zerotoone-v2/) como state='candidate' — dual-write aditivo,
    // nunca substitui a escrita em queue.jsonl acima. Isolado em
    // try/catch: uma falha aqui nunca pode derrubar a varredura diária
    // real, que já funciona e não depende do banco novo ainda.
    try {
      const db = openDb(DB_PATH);
      for (const f of newFindings) {
        upsertFinding(db, { ...f, state: 'candidate' });
      }
      closeDb(db);
    } catch (err) {
      log(`Aviso: dual-write no banco v2 falhou (não afeta a fila principal): ${err.message}`);
    }
  }
  saveSeen(seen);

  // Retroalimentação de veredito: recalcula estatística de falso-positivo
  // (agora já refletindo tanto os achados novos de hoje quanto qualquer
  // revisão feita pelo agente de nuvem desde a última rodada), grava uma
  // entrada no ledger por item recém-revisado/com veredito mudado (fonte
  // de verdade histórica, já que queue.jsonl reescreve a linha em vez de
  // só adicionar), e regenera o painel do centro de operações.
  const verdictResult = runVerdictStats({
    queuePath: QUEUE_PATH,
    statsJsonPath: STATS_JSON_PATH,
    statsMdPath: STATS_MD_PATH,
    snapshotPath: VERDICTS_SNAPSHOT_PATH,
  });
  for (const entry of verdictResult.newlyReviewed) {
    appendEntry('research', {
      type: 'bugbounty_verdict',
      id: entry.id,
      findingType: entry.type,
      language: deriveLanguage(entry),
      program: entry.program,
      platform: entry.platform,
      verdict: entry.verdict,
      confidence: entry.confidence,
      reasoning: entry.reasoning,
    });
  }

  const scanTimestamp = new Date().toISOString();

  appendEntry('research', {
    type: 'bugbounty_scan',
    contractsChecked,
    repoFilesChecked,
    byLanguage: { js: jsResult.filesChecked, go: goResult.filesChecked, jvm: jvmResult.filesChecked, swift: swiftResult.filesChecked, solidity: solidityResult.filesChecked },
    manifestsChecked: depResult.filesChecked,
    knownVulnDependenciesFound: depResult.findings.length,
    fetchErrors,
    newFindingsCount: newFindings.length,
    newlyReviewedCount: verdictResult.newlyReviewed.length,
    quarantinedCount: quarantinedTotal,
    programs: [...new Set(Object.values(targetLists).flat().map((t) => t.program))],
    blockedTargetCount,
  });

  // Regra com 100% de FP em amostra suficiente (ex.: ssrf_risk, 13/13)
  // para de gerar candidato novo -- ver quarantine.mjs. Recalculado a
  // partir das MESMAS stats que acabaram de ser salvas por
  // runVerdictStats acima (incluem o veredito desta rodada), então o
  // relatório reflete o estado mais atual, não o de antes desta rodada.
  const currentStats = loadStats(STATS_JSON_PATH);
  const quarantinedRules = computeQuarantinedRules(currentStats, { overrides: quarantineOverrides });
  writeFileSync(QUARANTINE_STATUS_PATH, renderQuarantineMarkdown(quarantinedRules, quarantinedTotal), 'utf8');

  generateStatusDashboard({
    queuePath: QUEUE_PATH,
    targetLists,
    statusPath: STATUS_PATH,
    lastScanAt: scanTimestamp,
  });

  // Lê o ledger DEPOIS de gravar o resumo desta rodada, pra a atividade
  // já aparecer no próprio painel gerado agora (não só na próxima rodada).
  generateDashboard({
    queuePath: QUEUE_PATH,
    statsJsonPath: STATS_JSON_PATH,
    ledgerEntries: readLedger('research'),
    targetLists,
    outputPath: DASHBOARD_PATH,
    lastScanSummary: { contractsChecked, repoFilesChecked, manifestsChecked: depResult.filesChecked, fetchErrors },
    lastScanAt: scanTimestamp,
    dbPath: DB_PATH,
    quarantineOverridesPath: QUARANTINE_OVERRIDES_PATH,
    promotionLogPath: PROMOTION_LOG_PATH,
  });

  log(`Varredura completa: ${contractsChecked} contratos Clarity + ${repoFilesChecked} arquivos (JS/TS+Go+JVM+Swift) + ${depResult.filesChecked} manifesto(s) de dependência checados, ${fetchErrors} erros de busca, ${newFindings.length} achados NOVOS na fila (${depResult.findings.length} de dependência conhecida), ${verdictResult.newlyReviewed.length} veredito(s) novo(s)/mudado(s)${quarantinedTotal > 0 ? `, ${quarantinedTotal} suprimido(s) por regra em quarentena (ver quarantine-status.md)` : ''}.`);

  // Resumo diário no Telegram — best-effort, nunca derruba o scan real
  // se falhar. Manda todo dia (não só quando acha algo novo) porque essa
  // é a única forma real de saber "ainda está rodando" sem abrir nada.
  try {
    const digestDb = openDb(DB_PATH);
    const counts = stateCounts(digestDb);
    closeDb(digestDb);
    const countsLine = Object.entries(counts).map(([s, n]) => `${s}: ${n}`).join(' · ') || 'nenhum achado no banco ainda';
    const emoji = newFindings.length > 0 ? '🔎' : '✅';
    await sendTelegramMessage(
      [
        `${emoji} <b>ZeroToOne — scan diário</b>`,
        `${repoFilesChecked} arquivo(s) + ${contractsChecked} contrato(s) Clarity verificados, ${fetchErrors} erro(s) de busca.`,
        newFindings.length > 0 ? `<b>${newFindings.length} achado(s) NOVO(S)</b> na fila.` : 'Nenhum achado novo hoje.',
        quarantinedTotal > 0 ? `${quarantinedTotal} suprimido(s) por regra em quarentena.` : null,
        `Situação atual: ${countsLine}`,
      ].filter(Boolean).join('\n')
    );
  } catch (err) {
    log(`Aviso: resumo diário do Telegram falhou (não afeta o scan): ${err.message}`);
  }

  // Digest de transições notáveis do LEDGER compartilhado (não do banco
  // local) -- pega trabalho que a sessão de nuvem fez sozinha também,
  // já que aquele ambiente não tem credencial de Telegram pra notificar
  // por conta própria. Ver telegram-digest.mjs pro motivo completo.
  // Roda ANTES do commit+push de propósito (bug real corrigido
  // 01/09/2026: rodava depois, então a atualização do checkpoint nunca
  // entrava no commit do dia -- ficava sempre "um dia atrasada",
  // arrastada pro commit seguinte em vez do commit certo).
  try {
    const digestResult = await runTelegramDigest();
    if (digestResult.notable > 0) log(`Digest do Telegram: ${digestResult.notable} transição(ões) notável(is), ${digestResult.sent} mensagem(ns) enviada(s).`);
  } catch (err) {
    log(`Aviso: digest do Telegram falhou (não afeta o scan): ${err.message}`);
  }

  const commitMessage = newFindings.length > 0
    ? `Scanner: ${newFindings.length} novo(s) candidato(s) na fila de bug bounty`
    : 'Scanner: atualização de código-fonte rastreado, sem achados novos';
  const syncResult = commitAndPush(REPO_ROOT, commitMessage, log);
  if (syncResult.ok) {
    if (syncResult.committed) log(`Sincronizado com o GitHub${syncResult.recovered ? ' (depois de recuperar de uma divergência)' : ''} — agente de nuvem vai ver na próxima checagem.`);
  } else {
    throw new Error(`scan concluído localmente, mas publicação falhou: ${syncResult.reason}`);
  }

  return { contractsChecked, fetchErrors, newFindings };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runScan().catch((err) => {
    console.error('Erro fatal no scan-runner:', err);
    process.exit(1);
  });
}
