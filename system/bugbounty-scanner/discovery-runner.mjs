// Orquestrador da descoberta de alvo — roda numa tarefa agendada PRÓPRIA,
// semanal, separada do scan diário, pra isolar o orçamento de 60 req/hora
// da API anônima do GitHub (a listagem de metadado de dezenas de
// candidatos não cabe dividido com a tarefa diária).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runTargetDiscovery } from './discover-targets.mjs';
import { promoteTargets, renderAutoPromotedModule, DEFAULT_MAX_PROMOTIONS_PER_RUN, DEFAULT_MAX_TOTAL_PROMOTED } from './promote-targets.mjs';
import { filterBannedTargets, loadProgramPolicyStrict } from './program-policy.mjs';
import { JS_TARGETS, JS_TARGETS_MANUAL } from './targets-js.mjs';
import { GO_TARGETS, _PAUSED_GO_TARGETS_MANUAL } from './targets-go.mjs';
import { JVM_TARGETS, JVM_TARGETS_MANUAL, _PAUSED_JVM_TARGETS_MANUAL } from './targets-jvm.mjs';
import { SWIFT_TARGETS, _PAUSED_SWIFT_TARGETS_MANUAL } from './targets-swift.mjs';
import { SOLIDITY_TARGETS, SOLIDITY_TARGETS_MANUAL } from './targets-solidity.mjs';
import { AUTO_PROMOTED_TARGETS } from './targets-auto-promoted.mjs';
import { getProgram } from './h1-api.mjs';
import { appendEntry } from '../ledger/ledger.mjs';
import { sendTelegramMessage } from './telegram.mjs';
import { pullLatest, commitAndPush } from './git-sync.mjs';
import { runSlitherAgainstTarget, toQueueFindings as slitherToQueueFindings } from './slither-runner.mjs';
import { runOsvScannerAgainstTarget, toQueueFindings as osvToQueueFindings } from './osv-scanner-runner.mjs';
import { runSemgrepAgainstTarget, toQueueFindings as semgrepToQueueFindings } from './semgrep-runner.mjs';
import { runCodeqlAgainstTarget, toQueueFindings as codeqlToQueueFindings } from './codeql-runner.mjs';
import { recordRotationResult, selectTargetsForRotation } from './analysis-rotation.mjs';
import { openDb, upsertFinding, closeDb, listSubmissions, listFindings, exportFindingsToQueueJsonl } from './db.mjs';
import { computeStatsFromSubmissions, enrichSubmissionsWithFindings } from './outcome-intelligence.mjs';
import { migrateAll } from './migrate-to-v2.mjs';

// TARGETS (Clarity/StackingDAO, targets.mjs) fica de fora de propósito:
// usa `deployer` (endereço on-chain), não `owner`/`repo` do GitHub —
// diffAgainstKnownTargets não teria o que comparar, incluir seria
// inofensivo mas inútil. SOLIDITY_TARGETS, por outro lado, É
// owner/repo e faltava aqui até 31/08/2026 -- bug real: os repos
// Solidity já rastreados (evm-cctp-contracts etc.) apareciam como
// "candidato novo" toda semana, gastando orçamento de metadado à toa.
//
// _PAUSED_*_MANUAL (Block Open Source, pausado) entram só na checagem de
// "já conhecido" -- mesmo motivo do SOLIDITY_TARGETS acima, não porque
// vão ser escaneados (não vão).
//
// JS_TARGETS/GO_TARGETS/JVM_TARGETS/SOLIDITY_TARGETS importados acima
// são um SNAPSHOT capturado quando este módulo carregou -- import ES é
// resolvido uma vez só, no início do processo. Achado real (02/09/2026,
// sessão ao vivo): a promoção automática logo abaixo REESCREVE
// targets-auto-promoted.mjs em disco, mas o processo atual continua
// com o binding antigo em memória -- os alvos recém-promovidos nesta
// MESMA rodada nunca chegam a ser escaneados por Slither/OSV/Semgrep
// mais abaixo, só na próxima execução (semana que vem, já que esta
// tarefa é semanal). Corrigido reconstruindo listas frescas a partir de
// `mergedAutoPromoted` (já calculado em memória, pós-promoção) logo
// depois do bloco de promoção -- ver freshJsTargets/freshGoTargets/
// freshJvmTargets/freshSolidityTargets abaixo, usadas em vez dos
// imports estáticos em todo o resto do arquivo.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const DISCOVERED_PATH = path.join(BUGBOUNTY_DIR, 'discovered-targets.json');
const SEEN_METADATA_PATH = path.join(BUGBOUNTY_DIR, 'discovery-metadata-seen.json');
const AUTO_PROMOTED_MODULE_PATH = path.join(__dirname, 'targets-auto-promoted.mjs');
const PROMOTION_LOG_PATH = path.join(BUGBOUNTY_DIR, 'targets-auto-promoted-log.json');
const DB_PATH = path.join(BUGBOUNTY_DIR, 'zerotoone.db');
const QUEUE_PATH = path.join(BUGBOUNTY_DIR, 'queue.jsonl');
const CODEQL_ROTATION_PATH = path.join(BUGBOUNTY_DIR, 'codeql-rotation.json');

function loadSeenMap() {
  if (!existsSync(SEEN_METADATA_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SEEN_METADATA_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadJson(filePath, fallback = {}) {
  if (!existsSync(filePath)) return fallback;
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

export async function runDiscovery({ metadataOnly = false } = {}) {
  const preflightSync = pullLatest(REPO_ROOT, log);
  if (!preflightSync.ok) throw new Error(`preflight de sincronização bloqueou a descoberta: ${preflightSync.reason}`);
  migrateAll({ queuePath: QUEUE_PATH, dbPath: DB_PATH, writeLog: false, emitLedger: false });
  if (!existsSync(BUGBOUNTY_DIR)) mkdirSync(BUGBOUNTY_DIR, { recursive: true });

  const seenMap = loadSeenMap();
  const programPolicy = loadProgramPolicyStrict();
  const result = await runTargetDiscovery(
    [JS_TARGETS, GO_TARGETS, JVM_TARGETS, SWIFT_TARGETS, SOLIDITY_TARGETS, _PAUSED_GO_TARGETS_MANUAL, _PAUSED_JVM_TARGETS_MANUAL, _PAUSED_SWIFT_TARGETS_MANUAL],
    seenMap,
    getProgram,
    { programPolicy }
  );

  const checkedAt = new Date().toISOString();
  for (const key of result.checkedKeys) {
    seenMap[key] = checkedAt;
  }
  writeFileSync(SEEN_METADATA_PATH, JSON.stringify(seenMap, null, 2), 'utf8');

  writeFileSync(
    DISCOVERED_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalCandidatesInDatasets: result.totalCandidatesInDatasets,
        authorizedCandidatesInDatasets: result.authorizedCandidatesInDatasets,
        policyBlockedCandidates: result.policyBlockedCandidates,
        policyBlockedPrograms: result.policyBlockedPrograms,
        newCandidatesFound: result.newCandidatesFound,
        truncatedCount: result.truncatedCount,
        neverSeenRemaining: result.neverSeenRemaining,
        programsWithAgeFound: result.programsWithAgeFound,
        programAgeSkippedReason: result.programAgeSkippedReason,
        note:
          result.truncatedCount > 0
            ? `AVISO: ${result.truncatedCount} candidato(s) novo(s) não tiveram metadado buscado nesta rodada (orçamento de API) — priorizados por rotação (quem nunca foi checado vem primeiro, programa mais novo primeiro dentro desses, ver discovery-metadata-seen.json); ${result.neverSeenRemaining} desses ainda nunca foram checados nenhuma vez, aparecem primeiro na próxima rodada.`
            : 'Todo candidato novo encontrado teve metadado buscado nesta rodada.',
        discovered: result.discovered,
      },
      null,
      2
    ),
    'utf8'
  );

  // Promoção automática -- reusa result.discovered (já enriquecido com
  // linguagem/estrelas/payout/idade acima), nenhuma chamada de rede nova.
  // existingPromotedKeys vem do módulo JÁ importado no topo do arquivo
  // (estado de ANTES desta rodada) -- nunca promove o mesmo repo 2x.
  const existingPromotedKeys = new Set(AUTO_PROMOTED_TARGETS.map((t) => `${t.owner.toLowerCase()}/${t.repo.toLowerCase()}`));
  // Fecha a lacuna #6 da revisão de 03/09/2026 ("delta hunting"): sem isso,
  // promoteTargets pontuava um programa do jeito sempre igual, mesmo depois
  // de 6/6 envios reais voltarem duplicate nele. Abre/fecha o banco só pra
  // esta leitura -- mesmo padrão de escopo curto já usado nos blocos
  // Slither/OSV/Semgrep abaixo, nunca mantém conexão aberta ociosa.
  let duplicateHistoryByProgram = {};
  {
    const historyDb = openDb(DB_PATH);
    try {
      const submissions = enrichSubmissionsWithFindings(listSubmissions(historyDb), listFindings(historyDb));
      duplicateHistoryByProgram = computeStatsFromSubmissions(submissions).byProgram;
    } finally {
      closeDb(historyDb);
    }
  }
  const promotionResult = promoteTargets(result.discovered, {
    programPolicy,
    existingPromotedKeys,
    maxPromotionsPerRun: DEFAULT_MAX_PROMOTIONS_PER_RUN,
    maxTotalPromoted: DEFAULT_MAX_TOTAL_PROMOTED,
    currentTotalPromoted: AUTO_PROMOTED_TARGETS.length,
    duplicateHistoryByProgram,
  });
  const mergedAutoPromoted = [...AUTO_PROMOTED_TARGETS, ...promotionResult.promoted];
  if (promotionResult.promoted.length > 0) {
    writeFileSync(AUTO_PROMOTED_MODULE_PATH, renderAutoPromotedModule(mergedAutoPromoted), 'utf8');
  }

  // Ver comentário grande no topo do arquivo -- estas são as listas de
  // verdade usadas dali em diante (Slither/OSV/Semgrep + resumo), nunca
  // os imports estáticos JS_TARGETS/GO_TARGETS/JVM_TARGETS/SOLIDITY_TARGETS,
  // que ficam presos ao estado de ANTES da promoção desta mesma rodada.
  const freshGoTargets = filterBannedTargets(mergedAutoPromoted.filter((t) => t.language === 'go'), programPolicy);
  const freshJsTargets = filterBannedTargets([...JS_TARGETS_MANUAL, ...mergedAutoPromoted.filter((t) => t.language === 'js')], programPolicy);
  const freshJvmTargets = filterBannedTargets([...JVM_TARGETS_MANUAL, ...mergedAutoPromoted.filter((t) => t.language === 'jvm')], programPolicy);
  const freshSolidityTargets = filterBannedTargets([...SOLIDITY_TARGETS_MANUAL, ...mergedAutoPromoted.filter((t) => t.language === 'solidity')], programPolicy);
  writeFileSync(
    PROMOTION_LOG_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalActiveAutoPromoted: mergedAutoPromoted.length,
        promotedThisRound: promotionResult.promoted,
        skippedThisRound: promotionResult.skipped,
        note: 'skippedThisRound cobre TODO candidato considerado e recusado nesta rodada (linguagem não suportada, repo grande demais, programa bloqueado, erro de metadado, já promovido antes, ou elegível mas sem vaga nesta rodada) -- nunca um corte silencioso.',
      },
      null,
      2
    ),
    'utf8'
  );

  appendEntry('research', {
    type: 'bugbounty_discovery',
    totalCandidatesInDatasets: result.totalCandidatesInDatasets,
    authorizedCandidatesInDatasets: result.authorizedCandidatesInDatasets,
    policyBlockedCandidates: result.policyBlockedCandidates,
    newCandidatesFound: result.newCandidatesFound,
    truncatedCount: result.truncatedCount,
    neverSeenRemaining: result.neverSeenRemaining,
    metadataErrors: result.metadataErrors,
    programsWithAgeFound: result.programsWithAgeFound,
    programAgeErrors: result.programAgeErrors,
    programAgeSkippedReason: result.programAgeSkippedReason,
    promotedThisRound: promotionResult.promoted.length,
    totalActiveAutoPromoted: mergedAutoPromoted.length,
  });

  log(`Descoberta completa: ${result.totalCandidatesInDatasets} candidato(s) com bounty no dataset; ${result.authorizedCandidatesInDatasets} autorizados pela RoE local, ${result.policyBlockedCandidates} excluídos antes de qualquer consulta ao GitHub; ${result.newCandidatesFound} novo(s) autorizado(s), ${result.discovered.length} com metadado buscado nesta rodada${result.truncatedCount > 0 ? ` (${result.truncatedCount} ficou pra próxima rodada, ${result.neverSeenRemaining} deles nunca foram checados)` : ''}.`);
  if (result.programAgeSkippedReason) {
    log(`AVISO: idade de programa (sinal de concorrência) não pôde ser buscada nesta rodada: ${result.programAgeSkippedReason}`);
  } else {
    log(`Idade de programa buscada com sucesso pra ${result.programsWithAgeFound} programa(s) HackerOne distinto(s) — usada pra priorizar candidato de programa mais novo primeiro.`);
  }
  log(`Promoção automática: ${promotionResult.promoted.length} alvo(s) novo(s) promovido(s) pra varredura ativa (${mergedAutoPromoted.length} no total agora), ${promotionResult.skipped.blockedProgram.length} recusado(s) por política de programa, ${promotionResult.skipped.unsupportedLanguage.length} por linguagem não suportada, ${promotionResult.skipped.tooLarge.length} por repo grande demais (revisão manual sugerida), ${promotionResult.skipped.insufficientSignal.length} sem nenhum sinal positivo (score 0), ${promotionResult.skipped.deferredToNextRun.length} elegível(is) mas sem vaga nesta rodada.`);
  if (promotionResult.skipped.tooLarge.length > 0) {
    log(`Repos grandes demais pra promoção automática (curadoria de pathPrefix manual recomendada, ver ${PROMOTION_LOG_PATH}): ${promotionResult.skipped.tooLarge.map((r) => `${r.owner}/${r.repo}`).join(', ')}`);
  }
  if (metadataOnly) {
    log('Modo metadata-only: promoção/publicação continuam ativas; Slither, OSV, Semgrep e CodeQL ficam para a execução pesada local.');
  }

  // Slither (github.com/crytic/slither, Trail of Bits) contra os alvos
  // Solidity curados -- gratuito, 100% local (pip install slither-analyzer,
  // já presente neste ambiente), ~100 detectores reais contra o projeto
  // COMPILADO, não regex em texto. Roda na cadência SEMANAL (não na
  // diária) de propósito: clonar+instalar dependência+compilar é bem
  // mais lento que a heurística de texto (segundos a minutos por repo,
  // não milissegundos), e é aqui que o orçamento mais lento já vive
  // (descoberta de alvo). Cada alvo tem seu próprio try/catch -- um
  // repositório com fricção real (submódulo SSH, árvore funda demais
  // pro limite de caminho do Windows, package.json quebrado) nunca
  // derruba a análise dos outros. Ver slither-runner.mjs pro detalhe
  // completo da fricção real já encontrada e contornada.
  let slitherNewFindings = 0;
  let slitherReposOk = 0;
  let slitherReposFailed = 0;
  if (!metadataOnly) {
    const db = openDb(DB_PATH);
    try {
      for (const target of freshSolidityTargets) {
        try {
          const result = runSlitherAgainstTarget(target, { log });
          if (!result.ok) {
            slitherReposFailed++;
            log(`AVISO: Slither não rodou em ${target.owner}/${target.repo}: ${result.reason}`);
            continue;
          }
          slitherReposOk++;
          const findings = slitherToQueueFindings(target, result.findings);
          let newHere = 0;
          for (const f of findings) {
            // upsertFinding SEMPRE sobrescreve state (ON CONFLICT DO
            // UPDATE SET state=excluded.state) -- chamar de novo pra um
            // id já resolvido (false_positive/human_ready/o que for)
            // resetaria o achado pra candidate toda semana, apagando
            // investigação real já feita. Só insere quando é
            // GENUINAMENTE novo -- achado já existente nunca é tocado
            // aqui, mesmo padrão de segurança que o "seen" cache do
            // scanner de heurística já usa.
            const existing = db.prepare('SELECT id FROM findings WHERE id = ?').get(f.id);
            if (existing) continue;
            newHere++;
            slitherNewFindings++;
            upsertFinding(db, f);
          }
          log(`Slither: ${target.owner}/${target.repo} -- ${result.rawResultCount} achado(s) bruto(s), ${findings.length} em Medium+ impacto, ${newHere} realmente novo(s) desta vez.`);
        } catch (err) {
          slitherReposFailed++;
          log(`AVISO: Slither falhou de forma inesperada em ${target.owner}/${target.repo}: ${err.message.split('\n')[0]}`);
        }
      }
    } finally {
      closeDb(db);
    }
  }
  log(`Slither: ${slitherReposOk} repositório(s) analisado(s) com sucesso, ${slitherReposFailed} com falha, ${slitherNewFindings} achado(s) novo(s) (Medium+ impacto) na fila.`);

  // OSV-Scanner (Google, gratuito, `go install`) contra os alvos
  // JS/Go/JVM -- mesmo escopo de dep-scanner.mjs (que continua existindo,
  // os dois se complementam), nunca contra Solidity: testado ao vivo
  // que um clone com submódulo inicializado (necessário pro Slither)
  // expõe centenas de "vulnerabilidade" em dependência de dev/teste de
  // submódulo vendorizado de terceiro, nunca alcançável pelo contrato
  // em si. Ver osv-scanner-runner.mjs pro detalhe completo. Cache
  // próprio (nunca reaproveita o clone do Slither, que TEM submódulo).
  let osvNewFindings = 0;
  let osvReposOk = 0;
  let osvReposFailed = 0;
  if (!metadataOnly) {
    const db = openDb(DB_PATH);
    try {
      for (const target of [...freshJsTargets, ...freshGoTargets, ...freshJvmTargets]) {
        try {
          const result = runOsvScannerAgainstTarget(target, { log });
          if (!result.ok) {
            osvReposFailed++;
            log(`AVISO: OSV-Scanner não rodou em ${target.owner}/${target.repo}: ${result.reason}`);
            continue;
          }
          osvReposOk++;
          const findings = osvToQueueFindings(target, result.findings);
          let newHere = 0;
          for (const f of findings) {
            // Mesmo cuidado do bloco do Slither acima: upsertFinding
            // sempre sobrescreve state -- só insere quando o id é
            // genuinamente novo, nunca toca achado que já existe
            // (dep-scanner.mjs já triou boa parte destes mesmos
            // pacotes em rodadas anteriores; re-rodar isso toda semana
            // não pode reabrir o que já foi resolvido).
            const existing = db.prepare('SELECT id FROM findings WHERE id = ?').get(f.id);
            if (existing) continue;
            newHere++;
            osvNewFindings++;
            upsertFinding(db, f);
          }
          log(`OSV-Scanner: ${target.owner}/${target.repo} -- ${result.rawPackageCount} pacote(s) verificado(s), ${findings.length} vulnerabilidade(s) de severidade 7.0+, ${newHere} realmente novo(s) desta vez.`);
        } catch (err) {
          osvReposFailed++;
          log(`AVISO: OSV-Scanner falhou de forma inesperada em ${target.owner}/${target.repo}: ${err.message.split('\n')[0]}`);
        }
      }
    } finally {
      closeDb(db);
    }
  }
  log(`OSV-Scanner: ${osvReposOk} repositório(s) analisado(s) com sucesso, ${osvReposFailed} com falha, ${osvNewFindings} achado(s) novo(s) (severidade 7.0+) na fila.`);

  // Semgrep (r2c, gratuito, venv própria em E:) contra os mesmos alvos
  // JS/Go/JVM do OSV-Scanner -- ~100 regras reais de segurança
  // (`p/security-audit`) contra AST de verdade, não regex em texto.
  // Mesmo cuidado de escopo/cache/upsert dos dois runners acima. Ver
  // semgrep-runner.mjs.
  let semgrepNewFindings = 0;
  let semgrepReposOk = 0;
  let semgrepReposFailed = 0;
  if (!metadataOnly) {
    const db = openDb(DB_PATH);
    try {
      for (const target of [...freshJsTargets, ...freshGoTargets, ...freshJvmTargets]) {
        try {
          const semResult = runSemgrepAgainstTarget(target, { log });
          if (!semResult.ok) {
            semgrepReposFailed++;
            log(`AVISO: Semgrep não rodou em ${target.owner}/${target.repo}: ${semResult.reason}`);
            continue;
          }
          semgrepReposOk++;
          const findings = semgrepToQueueFindings(target, semResult.findings);
          let newHere = 0;
          for (const f of findings) {
            // Mesma proteção dos blocos acima: upsertFinding sempre
            // sobrescreve state, então só insere id genuinamente novo.
            const existing = db.prepare('SELECT id FROM findings WHERE id = ?').get(f.id);
            if (existing) continue;
            newHere++;
            semgrepNewFindings++;
            upsertFinding(db, f);
          }
          log(`Semgrep: ${target.owner}/${target.repo} -- ${semResult.rawResultCount} achado(s) bruto(s), ${findings.length} em Warning+ severidade, ${newHere} realmente novo(s) desta vez.`);
        } catch (err) {
          semgrepReposFailed++;
          log(`AVISO: Semgrep falhou de forma inesperada em ${target.owner}/${target.repo}: ${err.message.split('\n')[0]}`);
        }
      }
    } finally {
      closeDb(db);
    }
  }
  log(`Semgrep: ${semgrepReposOk} repositório(s) analisado(s) com sucesso, ${semgrepReposFailed} com falha, ${semgrepNewFindings} achado(s) novo(s) (Warning+ severidade) na fila.`);

  // CodeQL complementa o Semgrep com dataflow interprocedural/global. Só
  // JavaScript/TypeScript entra nesta rotação: a extração é buildless e não
  // executa scripts do repositório de terceiro. Go/JVM exigem build e ficam
  // bloqueados até existir container descartável equivalente.
  let codeqlNewFindings = 0;
  let codeqlReposOk = 0;
  let codeqlReposFailed = 0;
  let codeqlRotation = loadJson(CODEQL_ROTATION_PATH, {});
  const codeqlTargets = metadataOnly ? [] : selectTargetsForRotation(freshJsTargets, codeqlRotation, { limit: 1 });
  if (!metadataOnly) {
    const db = openDb(DB_PATH);
    try {
      for (const target of codeqlTargets) {
        let codeqlResult;
        try {
          codeqlResult = runCodeqlAgainstTarget(target, { log });
          codeqlRotation = recordRotationResult(codeqlRotation, target, codeqlResult);
          if (!codeqlResult.ok) {
            codeqlReposFailed += 1;
            log(`AVISO: CodeQL não rodou em ${target.owner}/${target.repo}: ${codeqlResult.reason}`);
            continue;
          }
          codeqlReposOk += 1;
          const findings = codeqlToQueueFindings(target, codeqlResult.findings);
          let newHere = 0;
          for (const finding of findings) {
            const existing = db.prepare('SELECT id FROM findings WHERE id = ?').get(finding.id);
            if (existing) continue;
            upsertFinding(db, finding);
            newHere += 1;
            codeqlNewFindings += 1;
          }
          log(`CodeQL: ${target.owner}/${target.repo} -- ${codeqlResult.rawResultCount} resultado(s) bruto(s), ${findings.length} com security-severity 7+, ${newHere} novo(s).`);
        } catch (error) {
          codeqlReposFailed += 1;
          codeqlRotation = recordRotationResult(codeqlRotation, target, { ok: false, reason: error.message });
          log(`AVISO: CodeQL falhou em ${target.owner}/${target.repo}: ${error.message.split('\n')[0]}`);
        }
      }
    } finally {
      closeDb(db);
    }
  }
  if (!metadataOnly) writeFileSync(CODEQL_ROTATION_PATH, `${JSON.stringify(codeqlRotation, null, 2)}\n`, 'utf8');
  log(`CodeQL: ${codeqlReposOk}/${codeqlTargets.length} repositório(s) JS/TS analisado(s), ${codeqlReposFailed} falha(s), ${codeqlNewFindings} achado(s) novo(s).`);

  // Ferramentas pesadas gravam primeiro no SQLite para preservar o estado
  // existente. Publica a visão completa de volta na fila compartilhada;
  // sem isso, findings novos existiam apenas no .db local ignorado pelo Git.
  if (!metadataOnly) {
    const exportDb = openDb(DB_PATH);
    try { exportFindingsToQueueJsonl(exportDb, QUEUE_PATH); }
    finally { closeDb(exportDb); }
  }

  {
    const promotionNote = promotionResult.promoted.length > 0 ? `, ${promotionResult.promoted.length} promovido(s) automaticamente pra varredura ativa` : '';
    const slitherNote = slitherNewFindings > 0 ? `, ${slitherNewFindings} achado(s) novo(s) do Slither` : '';
    const osvNote = osvNewFindings > 0 ? `, ${osvNewFindings} achado(s) novo(s) do OSV-Scanner` : '';
    const semgrepNote = semgrepNewFindings > 0 ? `, ${semgrepNewFindings} achado(s) novo(s) do Semgrep` : '';
    const codeqlNote = codeqlNewFindings > 0 ? `, ${codeqlNewFindings} achado(s) novo(s) do CodeQL` : '';
    const syncResult = commitAndPush(REPO_ROOT, `Descoberta: ${result.newCandidatesFound} candidato(s) novo(s) de alvo${promotionNote}${slitherNote}${osvNote}${semgrepNote}${codeqlNote}`, log);
    if (syncResult.ok) {
      if (syncResult.committed) log(`Sincronizado com o GitHub${syncResult.recovered ? ' (depois de recuperar de uma divergência)' : ''}.`);
    } else {
      throw new Error(`descoberta concluída localmente, mas publicação falhou: ${syncResult.reason}`);
    }
  }

  try {
    const newestProgram = result.discovered
      .filter((d) => d.newestProgramStartedAt)
      .sort((a, b) => new Date(b.newestProgramStartedAt) - new Date(a.newestProgramStartedAt))[0];
    await sendTelegramMessage(
      [
        `🗓️ <b>ZeroToOne — descoberta de alvos${metadataOnly ? ' (nuvem/metadata)' : ' + análise pesada'}</b>`,
        `${result.totalCandidatesInDatasets} candidato(s) com bounty no dataset; ${result.authorizedCandidatesInDatasets} autorizados e ${result.policyBlockedCandidates} excluídos pela política antes de consultar o GitHub.`,
        `${result.newCandidatesFound} candidato(s) autorizado(s) ainda não rastreado(s).`,
        `${result.discovered.length} receberam metadado nesta rodada${result.truncatedCount > 0 ? ` (${result.truncatedCount} ficaram pra semana que vem)` : ''}.`,
        newestProgram ? `Programa mais novo visto: ${newestProgram.programs?.[0]?.program || '?'} (${newestProgram.owner}/${newestProgram.repo}).` : null,
        promotionResult.promoted.length > 0
          ? `🚀 <b>${promotionResult.promoted.length} alvo(s) novo(s) promovido(s)</b> pra varredura ativa: ${promotionResult.promoted.map((p) => `${p.owner}/${p.repo} (${p.program})`).join(', ')}. Total agora: ${mergedAutoPromoted.length}.`
          : `Nenhum alvo novo promovido nesta rodada (${mergedAutoPromoted.length} ativo(s) no total).`,
        promotionResult.skipped.tooLarge.length > 0 ? `${promotionResult.skipped.tooLarge.length} repo(s) grande(s) demais pra promoção automática — revisão manual sugerida.` : null,
        metadataOnly ? 'Analisadores pesados delegados ao serviço local; nenhum código de terceiro foi executado neste job de nuvem.' : null,
        !metadataOnly ? `🔬 Slither: ${slitherReposOk}/${freshSolidityTargets.length} repositório(s) Solidity analisado(s)${slitherReposFailed > 0 ? ` (${slitherReposFailed} com fricção de ambiente, ver log)` : ''}, ${slitherNewFindings} achado(s) novo(s) de impacto Medium+.` : null,
        !metadataOnly ? `📦 OSV-Scanner: ${osvReposOk}/${freshJsTargets.length + freshGoTargets.length + freshJvmTargets.length} repositório(s) JS/Go/JVM analisado(s)${osvReposFailed > 0 ? ` (${osvReposFailed} com falha, ver log)` : ''}, ${osvNewFindings} dependência(s) vulnerável(is) nova(s) de severidade 7.0+.` : null,
        !metadataOnly ? `🕵️ Semgrep: ${semgrepReposOk}/${freshJsTargets.length + freshGoTargets.length + freshJvmTargets.length} repositório(s) JS/Go/JVM analisado(s)${semgrepReposFailed > 0 ? ` (${semgrepReposFailed} com falha, ver log)` : ''}, ${semgrepNewFindings} achado(s) novo(s) de severidade Warning+.` : null,
        !metadataOnly ? `🧬 CodeQL: ${codeqlReposOk}/${codeqlTargets.length} repositório(s) JS/TS da rotação analisado(s)${codeqlReposFailed > 0 ? ` (${codeqlReposFailed} com falha)` : ''}, ${codeqlNewFindings} achado(s) novo(s) de dataflow global com security-severity 7+.` : null,
      ].filter(Boolean).join('\n')
    );
  } catch (err) {
    log(`Aviso: resumo semanal do Telegram falhou (não afeta a descoberta): ${err.message}`);
  }

  return {
    ...result,
    metadataOnly,
    analysis: {
      slither: { reposOk: slitherReposOk, reposFailed: slitherReposFailed, newFindings: slitherNewFindings },
      osv: { reposOk: osvReposOk, reposFailed: osvReposFailed, newFindings: osvNewFindings },
      semgrep: { reposOk: semgrepReposOk, reposFailed: semgrepReposFailed, newFindings: semgrepNewFindings },
      codeql: { reposOk: codeqlReposOk, reposFailed: codeqlReposFailed, newFindings: codeqlNewFindings },
    },
  };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runDiscovery({ metadataOnly: process.argv.includes('--metadata-only') }).catch((err) => {
    console.error('Erro fatal no discovery-runner:', err);
    process.exit(1);
  });
}
