import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendLedgerEvents, ledgerSuffix, mergeJson, mergeQueueEntries,
} from '../reconcile-shared-state.mjs';

function ledgerEntry(payload, prevHash = '0'.repeat(64)) {
  const record = { ...payload, env: 'research', prevHash };
  return { ...record, hash: createHash('sha256').update(JSON.stringify(record)).digest('hex') };
}

test('mergeJson combina mudanças independentes e recusa colisão sem escolher vencedor', () => {
  const clean = mergeJson({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 2 });
  assert.deepEqual(clean.value, { a: 2, b: 2 });
  assert.deepEqual(clean.conflicts, []);
  const conflict = mergeJson({ a: 1 }, { a: 2 }, { a: 3 });
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(conflict.conflicts[0].path, 'a');
});

test('mergeQueueEntries preserva revisão da nuvem e importa candidato novo do scanner', () => {
  const base = [{ id: 'old', state: 'candidate', note: 'x' }];
  const current = [{ id: 'old', state: 'false_positive', note: 'x', reasoning: 'refutado' }];
  const source = [...base, { id: 'new', state: 'candidate' }];
  const result = mergeQueueEntries(base, current, source);
  assert.equal(result.imported, 1);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.entries.find((item) => item.id === 'old').state, 'false_positive');
  assert.equal(result.entries.find((item) => item.id === 'new').state, 'candidate');
});

test('ledgerSuffix exige ancestral comum e reencadeia eventos sem telemetria de runtime', () => {
  const base = [ledgerEntry({ type: 'seed', ts: '2026-09-04T00:00:00Z' })];
  const finding = ledgerEntry({ type: 'bugbounty_scan', ts: '2026-09-04T01:00:00Z' }, base[0].hash);
  const runtime = ledgerEntry({ type: 'bugbounty_runtime_job', ts: '2026-09-04T01:01:00Z' }, finding.hash);
  assert.deepEqual(ledgerSuffix(base, [...base, finding, runtime]), [finding, runtime]);

  const cloud = ledgerEntry({ type: 'bugbounty_transition', ts: '2026-09-04T00:30:00Z' }, base[0].hash);
  const result = appendLedgerEvents([...base, cloud], [finding, runtime]);
  assert.equal(result.imported, 1);
  assert.equal(result.skippedRuntime, 1);
  assert.equal(result.entries.at(-1).prevHash, cloud.hash);
  const { hash, ...record } = result.entries.at(-1);
  assert.equal(hash, createHash('sha256').update(JSON.stringify(record)).digest('hex'));
});
