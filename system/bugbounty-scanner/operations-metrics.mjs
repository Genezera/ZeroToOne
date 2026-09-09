import { existsSync, readFileSync } from 'node:fs';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function loadJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export function computeOperationsMetrics({ registry, monitorState, events, evidenceState, findings }, now = Date.now()) {
  const authorized = new Set((registry?.repositories || []).map((item) => `${item.owner}/${item.repo}`.toLowerCase()));
  const monitored = new Set(Object.keys(monitorState?.repos || {}).map((item) => item.toLowerCase()));
  const missing = [...authorized].filter((repo) => !monitored.has(repo)).sort();
  const extra = [...monitored].filter((repo) => !authorized.has(repo)).sort();
  const checkedMs = Date.parse(monitorState?.checkedAt);
  const monitorLagMinutes = Number.isFinite(checkedMs) ? Math.max(0, Math.floor((now - checkedMs) / MINUTE_MS)) : null;
  const recentEvents = (events || []).filter((item) => {
    const ts = Date.parse(item.detectedAt);
    return Number.isFinite(ts) && now - ts <= 7 * DAY_MS && ts <= now;
  });
  const latencies = recentEvents.flatMap((item) => {
    const introduced = Date.parse(item.introducedAt);
    const detected = Date.parse(item.detectedAt);
    return Number.isFinite(introduced) && Number.isFinite(detected) && detected >= introduced
      ? [Math.round((detected - introduced) / MINUTE_MS)] : [];
  });
  const last24h = recentEvents.filter((item) => now - Date.parse(item.detectedAt) <= DAY_MS);
  const orders = Object.values(evidenceState?.workOrders || {});
  const attentionLatencies = orders.flatMap((item) => {
    const created = Date.parse(item.createdAt);
    const notified = Date.parse(item.attentionNotifiedAt);
    return Number.isFinite(created) && Number.isFinite(notified) && notified >= created
      ? [Math.round((notified - created) / MINUTE_MS)] : [];
  });
  const findings24h = (findings || []).filter((item) => {
    const ts = Date.parse(item.foundAt || item.createdAt);
    return Number.isFinite(ts) && ts <= now && now - ts <= DAY_MS;
  });
  const activeAlerts = [];
  if (missing.length || extra.length) activeAlerts.push('monitor_registry_mismatch');
  if (monitorLagMinutes === null || monitorLagMinutes > 60) activeAlerts.push('monitor_stale');
  if (latencies.length >= 3 && percentile(latencies, 0.95) > 360) activeAlerts.push('detection_latency_high');
  if (orders.some((item) => item.status === 'retry' && Number(item.attempts || 0) >= 3)) activeAlerts.push('evidence_retries_exhausting');
  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    coverage: {
      authorizedRepositories: authorized.size,
      monitoredRepositories: monitored.size,
      ratio: authorized.size ? Number(((authorized.size - missing.length) / authorized.size).toFixed(4)) : 0,
      missing, extra,
    },
    latency: {
      monitorCheckedAt: Number.isFinite(checkedMs) ? new Date(checkedMs).toISOString() : null,
      monitorLagMinutes,
      observedDeltas7d: recentEvents.length,
      observedDeltas24h: last24h.length,
      directSingleCommit24h: last24h.filter((item) => item.directSingleCommit === true).length,
      detectionMinutesP50: percentile(latencies, 0.5),
      detectionMinutesP95: percentile(latencies, 0.95),
    },
    evidence: {
      pending: orders.filter((item) => item.status === 'pending').length,
      retry: orders.filter((item) => item.status === 'retry').length,
      needsHuman: orders.filter((item) => item.status === 'needs_human').length,
      attentionUndelivered: orders.filter((item) => item.status === 'needs_human'
        && !item.attentionNotifiedAt && (item.recentExactChange || item.action === 'human_review')).length,
      attentionMinutesP50: percentile(attentionLatencies, 0.5),
      attentionMinutesP95: percentile(attentionLatencies, 0.95),
    },
    findings: { total: (findings || []).length, created24h: findings24h.length },
    activeAlerts,
  };
}

export function loadOperationsInputs(paths) {
  return {
    registry: loadJson(paths.registry, { repositories: [] }),
    monitorState: loadJson(paths.monitorState, { repos: {} }),
    events: loadJsonl(paths.events),
    evidenceState: loadJson(paths.evidenceState, { workOrders: {} }),
    findings: loadJsonl(paths.queue),
  };
}

export function metricAlertTransition(previous, current) {
  const before = new Set(previous?.notificationBaselineAlerts || previous?.activeAlerts || []);
  const after = new Set(current?.activeAlerts || []);
  return {
    activated: [...after].filter((item) => !before.has(item)).sort(),
    recovered: [...before].filter((item) => !after.has(item)).sort(),
  };
}

export function metricsMaterialSignature(metrics) {
  if (!metrics) return null;
  const copy = structuredClone(metrics);
  delete copy.generatedAt;
  if (copy.latency) delete copy.latency.monitorLagMinutes;
  return JSON.stringify(copy);
}
