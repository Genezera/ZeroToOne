import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JS_TARGETS } from './targets-js.mjs';
import { GO_TARGETS } from './targets-go.mjs';
import { JVM_TARGETS } from './targets-jvm.mjs';
import { SWIFT_TARGETS } from './targets-swift.mjs';
import { SOLIDITY_TARGETS } from './targets-solidity.mjs';
import { loadProgramPolicyStrict } from './program-policy.mjs';
import { collectMonitoredRepositories, pollRepositoryChanges } from './change-monitor.mjs';
import { pullLatest, commitAndPush } from './git-sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
export const DEFAULT_CHANGE_STATE_PATH = path.join(BUGBOUNTY_DIR, 'change-monitor-state.json');
export const DEFAULT_CHANGE_EVENTS_PATH = path.join(BUGBOUNTY_DIR, 'change-events.jsonl');

function loadJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

export function buildDeltaScanEnvironment(changes = [], baseEnv = process.env) {
  return {
    ...baseEnv,
    ZERO2ONE_CHANGED_REPOSITORIES: JSON.stringify(changes.map((change) => change.repository)),
    ZERO2ONE_CHANGE_CONTEXT: JSON.stringify(changes),
  };
}

function defaultScan(changes = []) {
  return spawnSync(process.execPath, [path.join(__dirname, 'scan-runner.mjs')], {
    cwd: REPO_ROOT,
    env: buildDeltaScanEnvironment(changes),
    encoding: 'utf8', windowsHide: true,
    timeout: 90 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
  });
}

/** A head is acknowledged only after the change-triggered scan succeeds.
 * Failed scans leave the old cursor intact, so the next poll retries. */
export async function runChangeMonitor({
  statePath = DEFAULT_CHANGE_STATE_PATH,
  eventsPath = DEFAULT_CHANGE_EVENTS_PATH,
  pull = pullLatest,
  publish = commitAndPush,
  scan = defaultScan,
  poll = pollRepositoryChanges,
  policy = loadProgramPolicyStrict(),
  targetLists = {
    js: JS_TARGETS.map((target) => ({ ...target, language: 'js' })),
    go: GO_TARGETS.map((target) => ({ ...target, language: 'go' })),
    jvm: JVM_TARGETS.map((target) => ({ ...target, language: 'jvm' })),
    swift: SWIFT_TARGETS.map((target) => ({ ...target, language: 'swift' })),
    solidity: SOLIDITY_TARGETS.map((target) => ({ ...target, language: 'solidity' })),
  },
  log = console.log,
} = {}) {
  const synced = pull(REPO_ROOT, log);
  if (!synced.ok) throw new Error(`preflight do change monitor falhou: ${synced.reason}`);
  const repositories = collectMonitoredRepositories(targetLists, policy);
  const previousState = loadJson(statePath, { schemaVersion: 1, repos: {} });
  const result = await poll(repositories, previousState);
  if (!result.ok) {
    throw new Error(`change monitor incompleto: ${result.failures.map((item) => `${item.repository}: ${item.reason}`).join('; ')}`);
  }

  if (result.changes.length > 0) {
    const scanResult = scan(result.changes);
    if (scanResult.status !== 0 || scanResult.error) {
      const output = [scanResult.stdout, scanResult.stderr, scanResult.error?.message].filter(Boolean).join('\n').slice(-4000);
      throw new Error(`scan orientado a mudança falhou; cursor não avançou: ${output}`);
    }
  }

  if (result.stateChanged) {
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(result.nextState, null, 2)}\n`, 'utf8');
  }
  if (result.changes.length > 0) {
    mkdirSync(path.dirname(eventsPath), { recursive: true });
    for (const change of result.changes) appendFileSync(eventsPath, `${JSON.stringify(change)}\n`, 'utf8');
  }
  const message = result.changes.length > 0
    ? `Change monitor: ${result.changes.length} mudança(s) rastreada(s) e escaneada(s)`
    : result.baseline
      ? `Change monitor: baseline de ${result.checked} repositório(s)`
      : result.stateChanged
        ? `Change monitor: baseline atualizado (+${result.addedRepositories.length}/-${result.removedRepositories.length} repositório(s))`
        : null;
  if (message) {
    const published = publish(REPO_ROOT, message, log);
    if (!published.ok) throw new Error(`change monitor não publicou estado: ${published.reason}`);
  }
  return { ...result, repositories: repositories.length, scanTriggered: result.changes.length > 0 };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runChangeMonitor().then((result) => {
    console.log(JSON.stringify({
      ok: result.ok, repositories: result.repositories, changes: result.changes.length,
      scanTriggered: result.scanTriggered, baseline: result.baseline,
    }));
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
