import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionControlSnapshot } from '../mission-control.mjs';

test('Mission Control só declara operação completa com local, cloud e auditoria saudáveis', () => {
  const result = buildMissionControlSnapshot({
    readiness: { fullyOperational: true, checks: [] },
    cloud: { ok: true, checks: [] },
    runtimeHealth: { healthy: true, reasons: [] },
    counts: { candidate: 10, reproduced_local: 2, scope_verified: 1, human_ready: 1 },
    outcomeStats: { totalSubmissions: 6, duplicateSubmissions: 6, duplicateRate: 1 },
  });
  assert.equal(result.operational, true);
  assert.equal(result.pipeline.activeInvestigations, 4);
  assert.equal(result.pipeline.readyForHumanReview, 1);
  assert.equal(result.outcomes.duplicateRate, 1);
  assert.deepEqual(result.attention, []);
});

test('Mission Control agrega falhas de módulos numa lista única de atenção', () => {
  const result = buildMissionControlSnapshot({
    readiness: { fullyOperational: false, checks: [{ name: 'policy', ok: false, severity: 'critical', detail: 'expirada' }] },
    cloud: { ok: false, checks: [{ label: 'scan', ok: false, reasons: ['failure'] }] },
    runtimeHealth: { healthy: false, reasons: ['heartbeat atrasado'] },
  });
  assert.equal(result.operational, false);
  assert.equal(result.attention.length, 3);
  assert.match(result.attention.join('\n'), /audit:policy/);
  assert.match(result.attention.join('\n'), /cloud:scan/);
  assert.match(result.attention.join('\n'), /local:heartbeat/);
});
