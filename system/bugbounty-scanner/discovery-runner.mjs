// Orquestrador da descoberta de alvo — roda numa tarefa agendada PRÓPRIA,
// semanal, separada do scan diário, pra isolar o orçamento de 60 req/hora
// da API anônima do GitHub (a listagem de metadado de dezenas de
// candidatos não cabe dividido com a tarefa diária).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { runTargetDiscovery } from './discover-targets.mjs';
import { JS_TARGETS } from './targets-js.mjs';
import { GO_TARGETS } from './targets-go.mjs';
import { JVM_TARGETS } from './targets-jvm.mjs';
import { SWIFT_TARGETS } from './targets-swift.mjs';
import { appendEntry } from '../ledger/ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const DISCOVERED_PATH = path.join(BUGBOUNTY_DIR, 'discovered-targets.json');
const SEEN_METADATA_PATH = path.join(BUGBOUNTY_DIR, 'discovery-metadata-seen.json');

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

export async function runDiscovery() {
  if (!existsSync(BUGBOUNTY_DIR)) mkdirSync(BUGBOUNTY_DIR, { recursive: true });

  const seenMap = loadSeenMap();
  const result = await runTargetDiscovery([JS_TARGETS, GO_TARGETS, JVM_TARGETS, SWIFT_TARGETS], seenMap);

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
        newCandidatesFound: result.newCandidatesFound,
        truncatedCount: result.truncatedCount,
        neverSeenRemaining: result.neverSeenRemaining,
        note:
          result.truncatedCount > 0
            ? `AVISO: ${result.truncatedCount} candidato(s) novo(s) não tiveram metadado buscado nesta rodada (orçamento de API) — priorizados por rotação (quem nunca foi checado vem primeiro, ver discovery-metadata-seen.json); ${result.neverSeenRemaining} desses ainda nunca foram checados nenhuma vez, aparecem primeiro na próxima rodada.`
            : 'Todo candidato novo encontrado teve metadado buscado nesta rodada.',
        discovered: result.discovered,
      },
      null,
      2
    ),
    'utf8'
  );

  appendEntry('research', {
    type: 'bugbounty_discovery',
    totalCandidatesInDatasets: result.totalCandidatesInDatasets,
    newCandidatesFound: result.newCandidatesFound,
    truncatedCount: result.truncatedCount,
    neverSeenRemaining: result.neverSeenRemaining,
    metadataErrors: result.metadataErrors,
  });

  log(`Descoberta completa: ${result.totalCandidatesInDatasets} candidato(s) com bounty em HackerOne+Bugcrowd, ${result.newCandidatesFound} novo(s) (não rastreado ainda), ${result.discovered.length} com metadado buscado nesta rodada${result.truncatedCount > 0 ? ` (${result.truncatedCount} ficou pra próxima rodada, ${result.neverSeenRemaining} deles nunca foram checados)` : ''}.`);

  try {
    execSync('git add -A', { cwd: REPO_ROOT });
    const status = execSync('git status --porcelain', { cwd: REPO_ROOT }).toString().trim();
    if (status) {
      execSync(`git commit -m "Descoberta: ${result.newCandidatesFound} candidato(s) novo(s) de alvo (revisão manual)"`, { cwd: REPO_ROOT });
      execSync('git push', { cwd: REPO_ROOT });
      log('Sincronizado com o GitHub.');
    }
  } catch (err) {
    log(`AVISO: falha ao sincronizar com o GitHub: ${err.message}`);
  }

  return result;
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runDiscovery().catch((err) => {
    console.error('Erro fatal no discovery-runner:', err);
    process.exit(1);
  });
}
