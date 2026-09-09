import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitAndPush, pullLatest } from './git-sync.mjs';
import { computeOperationsMetrics, loadOperationsInputs, metricAlertTransition, metricsMaterialSignature } from './operations-metrics.mjs';
import { escapeHtml, sendTelegramMessage } from './telegram.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY = path.join(REPO_ROOT, 'research', 'bugbounty');
export const DEFAULT_METRICS_PATH = path.join(BUGBOUNTY, 'operations-metrics.json');

function previousMetrics(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function formatMetricTransition(transition, metrics) {
  if (!transition.activated.length && !transition.recovered.length) return null;
  return [
    transition.activated.length ? '⚠️ <b>ZeroToOne — OPERATIONAL ATTENTION</b>' : '✅ <b>ZeroToOne — operational recovery</b>',
    transition.activated.length ? `New: ${escapeHtml(transition.activated.join(', '))}` : null,
    transition.recovered.length ? `Recovered: ${escapeHtml(transition.recovered.join(', '))}` : null,
    `Monitor lag: ${metrics.latency.monitorLagMinutes ?? 'unknown'} min · coverage: ${(metrics.coverage.ratio * 100).toFixed(1)}%`,
    'This is an infrastructure alert, not a vulnerability report.',
  ].filter(Boolean).join('\n');
}

export async function runMetrics({
  repoRoot = REPO_ROOT, metricsPath = DEFAULT_METRICS_PATH,
  pull = pullLatest, publish = commitAndPush, notify = sendTelegramMessage,
  now = () => new Date(), log = console.log,
} = {}) {
  const synced = pull(repoRoot, log);
  if (!synced.ok) throw new Error(`metrics preflight failed: ${synced.reason}`);
  const previous = previousMetrics(metricsPath);
  const metrics = computeOperationsMetrics(loadOperationsInputs({
    registry: path.join(BUGBOUNTY, 'authorized-monitor-targets.json'),
    monitorState: path.join(BUGBOUNTY, 'change-monitor-state.json'),
    events: path.join(BUGBOUNTY, 'change-events.jsonl'),
    evidenceState: path.join(BUGBOUNTY, 'evidence-worker-state.json'),
    queue: path.join(BUGBOUNTY, 'queue.jsonl'),
  }), now().getTime());
  const transition = metricAlertTransition(previous, metrics);
  const message = formatMetricTransition(transition, metrics);
  let notification = { attempted: false, ok: true };
  if (message) notification = { attempted: true, ...(await notify(message)) };
  // Keep operational truth separate from delivery acknowledgement. Failed
  // delivery preserves the prior baseline so the next run retries the same
  // transition without falsifying activeAlerts.
  metrics.notificationBaselineAlerts = notification.ok
    ? [...metrics.activeAlerts]
    : [...(previous?.notificationBaselineAlerts || previous?.activeAlerts || [])];
  const changed = metricsMaterialSignature(previous) !== metricsMaterialSignature(metrics);
  let publication = { ok: true, committed: false };
  if (changed) {
    mkdirSync(path.dirname(metricsPath), { recursive: true });
    writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
    publication = publish(repoRoot, `Bug bounty metrics: ${metrics.coverage.monitoredRepositories} monitored, ${metrics.activeAlerts.length} alert(s)`, log);
    if (!publication.ok) throw new Error(`metrics publication failed: ${publication.reason}`);
  }
  return { ok: true, changed, metrics, transition, notification, publication };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMetrics().then((result) => console.log(JSON.stringify({
    ok: result.ok, coverage: result.metrics.coverage.ratio,
    monitorLagMinutes: result.metrics.latency.monitorLagMinutes,
    alerts: result.metrics.activeAlerts,
  }))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
