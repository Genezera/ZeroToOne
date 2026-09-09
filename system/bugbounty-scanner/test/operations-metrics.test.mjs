import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOperationsMetrics, metricAlertTransition, metricsMaterialSignature } from '../operations-metrics.mjs';
import { formatMetricTransition } from '../metrics-runner.mjs';

const NOW = Date.parse('2026-09-09T02:00:00Z');

test('metrics measure exact registry coverage and detection latency', () => {
  const metrics = computeOperationsMetrics({
    registry: { repositories: [{ owner: 'a', repo: 'one' }, { owner: 'a', repo: 'two' }] },
    monitorState: { checkedAt: '2026-09-09T01:50:00Z', repos: { 'a/one': {}, 'a/two': {} } },
    events: [
      { introducedAt: '2026-09-09T01:00:00Z', detectedAt: '2026-09-09T01:10:00Z', directSingleCommit: true },
      { introducedAt: '2026-09-09T00:00:00Z', detectedAt: '2026-09-09T01:00:00Z' },
    ], evidenceState: { workOrders: {} }, findings: [],
  }, NOW);
  assert.equal(metrics.coverage.ratio, 1);
  assert.equal(metrics.latency.monitorLagMinutes, 10);
  assert.equal(metrics.latency.detectionMinutesP50, 10);
  assert.equal(metrics.latency.detectionMinutesP95, 60);
  assert.deepEqual(metrics.activeAlerts, []);
  const later = structuredClone(metrics);
  later.generatedAt = '2026-09-09T02:30:00Z';
  later.latency.monitorLagMinutes = 40;
  assert.equal(metricsMaterialSignature(metrics), metricsMaterialSignature(later));
});

test('metrics fail visibly on stale monitor and registry mismatch', () => {
  const metrics = computeOperationsMetrics({
    registry: { repositories: [{ owner: 'a', repo: 'one' }, { owner: 'a', repo: 'missing' }] },
    monitorState: { checkedAt: '2026-09-09T00:00:00Z', repos: { 'a/one': {} } },
    events: [], evidenceState: { workOrders: {} }, findings: [],
  }, NOW);
  assert.deepEqual(metrics.coverage.missing, ['a/missing']);
  assert.ok(metrics.activeAlerts.includes('monitor_stale'));
  assert.ok(metrics.activeAlerts.includes('monitor_registry_mismatch'));
  const transition = metricAlertTransition(null, metrics);
  assert.equal(transition.activated.length, 2);
  assert.match(formatMetricTransition(transition, metrics), /OPERATIONAL ATTENTION/);
});
