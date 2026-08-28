// Orquestrador do digest de segurança — roda junto com a descoberta de
// alvo (mesma tarefa semanal), já que os dois são baixa frequência/baixa
// urgência por natureza.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { extractWatchedPackageNames, runCveDigest, renderDigestMarkdown } from './cve-digest.mjs';
import { appendEntry } from '../ledger/ledger.mjs';

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

  try {
    execSync('git add -A', { cwd: REPO_ROOT });
    const status = execSync('git status --porcelain', { cwd: REPO_ROOT }).toString().trim();
    if (status) {
      execSync(`git commit -m "Digest: ${watchedPackages.length} pacote(s) observado(s), ${totalAdvisories} advisory(s)"`, { cwd: REPO_ROOT });
      execSync('git push', { cwd: REPO_ROOT });
      log('Sincronizado com o GitHub.');
    }
  } catch (err) {
    log(`AVISO: falha ao sincronizar com o GitHub: ${err.message}`);
  }

  return { watchedPackages, totalAdvisories, fetchErrors };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runDigest().catch((err) => {
    console.error('Erro fatal no digest-runner:', err);
    process.exit(1);
  });
}
