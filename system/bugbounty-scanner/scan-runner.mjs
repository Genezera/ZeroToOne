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
import { appendEntry } from '../ledger/ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const QUEUE_PATH = path.join(BUGBOUNTY_DIR, 'queue.jsonl');
const SEEN_PATH = path.join(BUGBOUNTY_DIR, 'scanner-seen.json');

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

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
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

  if (newFindings.length > 0) {
    for (const f of newFindings) {
      appendFileSync(QUEUE_PATH, JSON.stringify(f) + '\n', 'utf8');
    }
  }
  saveSeen(seen);

  appendEntry('research', {
    type: 'bugbounty_scan',
    contractsChecked,
    fetchErrors,
    newFindingsCount: newFindings.length,
    programs: TARGETS.map((t) => t.program),
  });

  log(`Varredura completa: ${contractsChecked} contratos checados, ${fetchErrors} erros de busca, ${newFindings.length} achados NOVOS na fila.`);

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
