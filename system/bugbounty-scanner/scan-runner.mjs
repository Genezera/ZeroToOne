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
import { listRepoFiles, fetchRawFile, isScannableFile } from './fetch-js.mjs';
import { scanJsSource } from './heuristics-js.mjs';
import { appendEntry } from '../ledger/ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const QUEUE_PATH = path.join(BUGBOUNTY_DIR, 'queue.jsonl');
const SEEN_PATH = path.join(BUGBOUNTY_DIR, 'scanner-seen.json');
const JS_SHAS_PATH = path.join(BUGBOUNTY_DIR, 'scanner-seen-js-shas.json');
const MAX_JS_FILES_PER_TARGET = 200;

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

function loadJsShas() {
  if (!existsSync(JS_SHAS_PATH)) return {};
  return JSON.parse(readFileSync(JS_SHAS_PATH, 'utf8'));
}

function saveJsShas(shas) {
  writeFileSync(JS_SHAS_PATH, JSON.stringify(shas, null, 2), 'utf8');
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Varre os repositórios JS/TS rastreados (targets-js.mjs). Não persiste o
// código-fonte no git (repos JS/TS são grandes demais para isso, diferente
// dos contratos Clarity) — só o texto dos achados (com trecho de contexto)
// vai para a fila. Usa cache de SHA de blob por arquivo para não rebuscar
// nem rescanear arquivo que não mudou desde a última rodada.
async function runJsScan(seen, newFindings) {
  const jsShas = loadJsShas();
  let filesChecked = 0;
  let fetchErrors = 0;

  for (const target of JS_TARGETS) {
    let files;
    try {
      files = await listRepoFiles(target.owner, target.repo, target.branch, target.pathPrefixes);
    } catch (err) {
      log(`ERRO listando árvore de ${target.owner}/${target.repo}: ${err.message}`);
      fetchErrors++;
      continue;
    }
    files = files.filter((f) => isScannableFile(f.path));
    if (files.length > MAX_JS_FILES_PER_TARGET) {
      log(`AVISO: ${target.owner}/${target.repo} tem ${files.length} arquivos rastreáveis, cortando para os primeiros ${MAX_JS_FILES_PER_TARGET} (não silencioso — registrado aqui).`);
      files = files.slice(0, MAX_JS_FILES_PER_TARGET);
    }

    const repoKey = `${target.owner}/${target.repo}`;
    jsShas[repoKey] = jsShas[repoKey] || {};

    for (const file of files) {
      if (jsShas[repoKey][file.path] === file.sha) continue; // sem mudança desde a última rodada
      let source;
      try {
        source = await fetchRawFile(target.owner, target.repo, target.branch, file.path);
      } catch (err) {
        log(`ERRO buscando ${repoKey}/${file.path}: ${err.message}`);
        fetchErrors++;
        continue;
      }
      filesChecked++;
      jsShas[repoKey][file.path] = file.sha;

      const findings = scanJsSource(source, `${repoKey}/${file.path}`).map((f) => ({ ...f, program: target.program, platform: target.platform, maxBountyUsd: target.maxBountyUsd }));
      for (const f of findings) {
        const fp = fingerprint(f);
        if (seen.has(fp)) continue;
        seen.add(fp);
        newFindings.push({ ...f, status: 'pending', foundAt: new Date().toISOString() });
      }
    }
  }

  saveJsShas(jsShas);
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

  const jsResult = await runJsScan(seen, newFindings);
  fetchErrors += jsResult.fetchErrors;

  if (newFindings.length > 0) {
    for (const f of newFindings) {
      appendFileSync(QUEUE_PATH, JSON.stringify(f) + '\n', 'utf8');
    }
  }
  saveSeen(seen);

  appendEntry('research', {
    type: 'bugbounty_scan',
    contractsChecked,
    jsFilesChecked: jsResult.filesChecked,
    fetchErrors,
    newFindingsCount: newFindings.length,
    programs: [...TARGETS.map((t) => t.program), ...JS_TARGETS.map((t) => t.program)],
  });

  log(`Varredura completa: ${contractsChecked} contratos Clarity + ${jsResult.filesChecked} arquivos JS/TS checados, ${fetchErrors} erros de busca, ${newFindings.length} achados NOVOS na fila.`);

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
