// Orquestrador do digest de segurança — roda junto com a descoberta de
// alvo (mesma tarefa semanal), já que os dois são baixa frequência/baixa
// urgência por natureza.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractWatchedPackageNames, runCveDigest, renderDigestMarkdown } from './cve-digest.mjs';
import { appendEntry } from '../ledger/ledger.mjs';
import { pullLatest, commitAndPush } from './git-sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const QUEUE_PATH = path.join(BUGBOUNTY_DIR, 'queue.jsonl');
const DIGEST_PATH = path.join(BUGBOUNTY_DIR, 'security-digest.md');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadQueue(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export async function runDigest() {
  const preflightSync = pullLatest(REPO_ROOT, log);
  if (!preflightSync.ok) throw new Error(`preflight de sincronização bloqueou o digest: ${preflightSync.reason}`);
  if (!existsSync(BUGBOUNTY_DIR)) mkdirSync(BUGBOUNTY_DIR, { recursive: true });

  const queueEntries = loadQueue(QUEUE_PATH);
  const watchedPackages = extractWatchedPackageNames(queueEntries);
  const { advisoriesByPackage, fetchErrors } = await runCveDigest(watchedPackages);
  const generatedAt = new Date().toISOString();

  const md = renderDigestMarkdown({ watchedPackages, advisoriesByPackage, generatedAt });
  writeFileSync(DIGEST_PATH, md, 'utf8');

  const totalAdvisories = Object.values(advisoriesByPackage).reduce((sum, list) => sum + list.length, 0);

  appendEntry('research', {
    type: 'bugbounty_digest',
    watchedPackagesCount: watchedPackages.length,
    totalAdvisories,
    fetchErrors,
  });

  log(`Digest completo: ${watchedPackages.length} pacote(s) observado(s), ${totalAdvisories} advisory(s) encontrado(s), ${fetchErrors} erro(s) de busca.`);

  const syncResult = commitAndPush(REPO_ROOT, `Digest: ${watchedPackages.length} pacote(s) observado(s), ${totalAdvisories} advisory(s)`, log);
  if (!syncResult.ok) throw new Error(`digest concluído localmente, mas publicação falhou: ${syncResult.reason}`);
  if (syncResult.committed) log('Sincronizado com o GitHub.');

  return { watchedPackages, totalAdvisories, fetchErrors };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runDigest().catch((err) => {
    console.error('Erro fatal no digest-runner:', err);
    process.exit(1);
  });
}
