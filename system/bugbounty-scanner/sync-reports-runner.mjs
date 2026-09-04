import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb } from './db.mjs';
import { cmdSyncMyReports } from './cli.mjs';
import { pullLatest, commitAndPush } from './git-sync.mjs';
import { migrateAll } from './migrate-to-v2.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = path.join(REPO_ROOT, 'research', 'bugbounty', 'zerotoone.db');

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export async function runSyncReports({
  repoRoot = REPO_ROOT,
  dbPath = DB_PATH,
  sync = cmdSyncMyReports,
  open = openDb,
  close = closeDb,
  hydrate = migrateAll,
  pull = pullLatest,
  publish = commitAndPush,
  logger = log,
} = {}) {
  const preflight = pull(repoRoot, logger);
  if (!preflight.ok) throw new Error(`preflight de sincronização bloqueou o sync de reports: ${preflight.reason}`);
  hydrate({
    queuePath: path.join(repoRoot, 'research', 'bugbounty', 'queue.jsonl'),
    dbPath, writeLog: false, emitLedger: false,
  });
  const db = open(dbPath);
  let result;
  try {
    result = await sync(db);
  } finally {
    close(db);
  }
  const published = publish(repoRoot, `HackerOne: sincroniza ${result.changed || 0} report(s) alterado(s)`, logger);
  if (!published.ok) throw new Error(`reports sincronizados localmente, mas publicação falhou: ${published.reason}`);
  return { ...result, published };
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  runSyncReports().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error('Erro fatal no sync-reports-runner:', error);
    process.exitCode = 1;
  });
}
