import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, sendTelegramMessage } from './telegram.mjs';
import { loadRuntimeState, replaceFileAtomic, summarizeRuntimeHealth } from './runtime-state.mjs';
import { DEFAULT_RUNTIME_STATE_PATH } from './service-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const DEFAULT_WATCHDOG_STATE_PATH = path.join(REPO_ROOT, 'logs', 'bugbounty-watchdog-state.json');

function loadWatchdogState(statePath) {
  if (!existsSync(statePath)) return { lastHealthy: null, lastCheckedAt: null };
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return { lastHealthy: null, lastCheckedAt: null }; }
}

function saveWatchdogState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const temp = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  replaceFileAtomic(temp, statePath);
}

export async function runWatchdog({
  runtimeStatePath = DEFAULT_RUNTIME_STATE_PATH,
  watchdogStatePath = DEFAULT_WATCHDOG_STATE_PATH,
  now = Date.now(),
  notify = sendTelegramMessage,
} = {}) {
  const runtime = loadRuntimeState(runtimeStatePath, { now: new Date(now).toISOString() });
  const health = summarizeRuntimeHealth(runtime, { now });
  const previous = loadWatchdogState(watchdogStatePath);
  let notification = null;

  if (!health.healthy && previous.lastHealthy !== false) {
    notification = await notify([
      '🚨 <b>ZeroToOne — watchdog</b>',
      'Serviço está degradado ou parado:',
      ...health.reasons.map((reason) => `• ${escapeHtml(reason)}`),
    ].join('\n'));
  } else if (health.healthy && previous.lastHealthy === false) {
    notification = await notify('✅ <b>ZeroToOne — watchdog</b>\nHeartbeat e jobs voltaram ao estado saudável.');
  }

  saveWatchdogState(watchdogStatePath, {
    lastHealthy: health.healthy,
    lastCheckedAt: new Date(now).toISOString(),
    reasons: health.reasons,
  });
  return { ok: health.healthy, health, notification };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runWatchdog().then((result) => {
    console.log(JSON.stringify({ ok: result.ok, reasons: result.health.reasons }));
    if (!result.ok) process.exitCode = 1;
  });
}
