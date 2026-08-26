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
import { execSync } from 'node:child_process';
import { TARGETS } from './targets.mjs';
import { fetchContractSource } from './fetch.mjs';
import { scanSource } from './heuristics.mjs';
import { JS_TARGETS } from './targets-js.mjs';
import { GO_TARGETS } from './targets-go.mjs';
import { JVM_TARGETS } from './targets-jvm.mjs';
import { SWIFT_TARGETS } from './targets-swift.mjs';
import { listRepoFiles, fetchRawFile, isScannableFile, isScannableGoFile, isScannableJvmFile, isScannableSwiftFile } from './fetch-repo.mjs';
import { scanJsSource } from './heuristics-js.mjs';
import { scanGoSource } from './heuristics-go.mjs';
import { scanJvmSource } from './heuristics-jvm.mjs';
import { scanSwiftSource } from './heuristics-swift.mjs';
import { appendEntry } from '../ledger/ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const QUEUE_PATH = path.join(BUGBOUNTY_DIR, 'queue.jsonl');
const SEEN_PATH = path.join(BUGBOUNTY_DIR, 'scanner-seen.json');
const REPO_SHAS_PATH = path.join(BUGBOUNTY_DIR, 'scanner-seen-repo-shas.json');
const MAX_FILES_PER_TARGET = 450;

function fingerprint(f) {
  return `${f.program}::${f.file}::${f.function}::${f.type}`;
}

function loadSeen() {
  if (!existsSync(SEEN_PATH)) return new Set();
  return new Set(JSON.parse(readFileSync(SEEN_PATH, 'utf8')));
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
async function runLanguageScan(targets, isScannable, scanFn, seen, newFindings, repoShas) {
  let filesChecked = 0;
  let fetchErrors = 0;

  for (const target of targets) {
    let files;
    try {
      files = await listRepoFiles(target.owner, target.repo, target.branch, target.pathPrefixes);
    } catch (err) {
      log(`ERRO listando árvore de ${target.owner}/${target.repo}: ${err.message}`);
      fetchErrors++;
      continue;
    }
    files = files.filter((f) => isScannable(f.path));
    if (files.length > MAX_FILES_PER_TARGET) {
      log(`AVISO: ${target.owner}/${target.repo} tem ${files.length} arquivos rastreáveis, cortando para os primeiros ${MAX_FILES_PER_TARGET} (não silencioso — registrado aqui).`);
      files = files.slice(0, MAX_FILES_PER_TARGET);
    }

    const repoKey = `${target.owner}/${target.repo}`;
    repoShas[repoKey] = repoShas[repoKey] || {};

    for (const file of files) {
      if (repoShas[repoKey][file.path] === file.sha) continue; // sem mudança desde a última rodada
      let source;
      try {
        source = await fetchRawFile(target.owner, target.repo, target.branch, file.path);
      } catch (err) {
        log(`ERRO buscando ${repoKey}/${file.path}: ${err.message}`);
        fetchErrors++;
        continue;
      }
      filesChecked++;
      repoShas[repoKey][file.path] = file.sha;

      const findings = scanFn(source, `${repoKey}/${file.path}`).map((f) => ({ ...f, program: target.program, platform: target.platform, maxBountyUsd: target.maxBountyUsd }));
      for (const f of findings) {
        const fp = fingerprint(f);
        if (seen.has(fp)) continue;
        seen.add(fp);
        newFindings.push({ ...f, status: 'pending', foundAt: new Date().toISOString() });
      }
    }
  }

  return { filesChecked, fetchErrors };
}

export async function runScan() {
  if (!existsSync(BUGBOUNTY_DIR)) mkdirSync(BUGBOUNTY_DIR, { recursive: true });
  const seen = loadSeen();
  const newFindings = [];
  let contractsChecked = 0;
  let fetchErrors = 0;

  for (const target of TARGETS) {
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

      const findings = scanSource(source, `${contractName}.clar`).map((f) => ({ ...f, program: target.program, platform: target.platform, maxBountyUsd: target.maxBountyUsd }));
      for (const f of findings) {
        const fp = fingerprint(f);
        if (seen.has(fp)) continue;
        seen.add(fp);
        newFindings.push({ ...f, status: 'pending', foundAt: new Date().toISOString() });
      }
    }
  }

  const repoShas = loadRepoShas();
  const jsResult = await runLanguageScan(JS_TARGETS, isScannableFile, scanJsSource, seen, newFindings, repoShas);
  const goResult = await runLanguageScan(GO_TARGETS, isScannableGoFile, scanGoSource, seen, newFindings, repoShas);
  const jvmResult = await runLanguageScan(JVM_TARGETS, isScannableJvmFile, scanJvmSource, seen, newFindings, repoShas);
  const swiftResult = await runLanguageScan(SWIFT_TARGETS, isScannableSwiftFile, scanSwiftSource, seen, newFindings, repoShas);
  saveRepoShas(repoShas);

  const repoFilesChecked = jsResult.filesChecked + goResult.filesChecked + jvmResult.filesChecked + swiftResult.filesChecked;
  fetchErrors += jsResult.fetchErrors + goResult.fetchErrors + jvmResult.fetchErrors + swiftResult.fetchErrors;

  if (newFindings.length > 0) {
    for (const f of newFindings) {
      appendFileSync(QUEUE_PATH, JSON.stringify(f) + '\n', 'utf8');
    }
  }
  saveSeen(seen);

  appendEntry('research', {
    type: 'bugbounty_scan',
    contractsChecked,
    repoFilesChecked,
    byLanguage: { js: jsResult.filesChecked, go: goResult.filesChecked, jvm: jvmResult.filesChecked, swift: swiftResult.filesChecked },
    fetchErrors,
    newFindingsCount: newFindings.length,
    programs: [...new Set([...TARGETS, ...JS_TARGETS, ...GO_TARGETS, ...JVM_TARGETS, ...SWIFT_TARGETS].map((t) => t.program))],
  });

  log(`Varredura completa: ${contractsChecked} contratos Clarity + ${repoFilesChecked} arquivos (JS/TS+Go+JVM+Swift) checados, ${fetchErrors} erros de busca, ${newFindings.length} achados NOVOS na fila.`);

  if (newFindings.length > 0) {
    try {
      execSync('git add -A', { cwd: REPO_ROOT });
      execSync(`git commit -m "Scanner: ${newFindings.length} novo(s) candidato(s) na fila de bug bounty"`, { cwd: REPO_ROOT });
      execSync('git push', { cwd: REPO_ROOT });
      log('Sincronizado com o GitHub — agente de nuvem vai ver na próxima checagem.');
    } catch (err) {
      log(`AVISO: falha ao sincronizar com o GitHub: ${err.message}`);
    }
  } else {
    // Mesmo sem achados novos, sincroniza o estado do "seen"/arquivos .clar
    // atualizados, silenciosamente, só se algo mudou.
    try {
      execSync('git add -A', { cwd: REPO_ROOT });
      const status = execSync('git status --porcelain', { cwd: REPO_ROOT }).toString().trim();
      if (status) {
        execSync('git commit -m "Scanner: atualização de código-fonte rastreado, sem achados novos"', { cwd: REPO_ROOT });
        execSync('git push', { cwd: REPO_ROOT });
      }
    } catch (err) {
      log(`AVISO: falha ao sincronizar estado sem achados: ${err.message}`);
    }
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
