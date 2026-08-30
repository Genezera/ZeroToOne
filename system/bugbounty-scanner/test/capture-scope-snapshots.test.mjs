import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAllSnapshots } from '../capture-scope-snapshots.mjs';
import { scopeGate } from '../scope-registry.mjs';
import { TARGETS } from '../targets.mjs';

// Fixture mínima — só precisa satisfazer o formato que captureAllSnapshots
// espera dos dois datasets (find() por handle/name); os testes focam no
// snapshot do StackingDAO, que não depende do conteúdo desses datasets.
const EMPTY_H1 = [];
const EMPTY_BC = [];

test('captureAllSnapshots preenche assets do StackingDAO a partir de targets.mjs — bug real corrigido (30/08/2026)', async () => {
  const snapshots = await captureAllSnapshots({
    fetchJsonFn: async (url) => (url.includes('hackerone') ? EMPTY_H1 : EMPTY_BC),
  });
  const stacking = snapshots.find((s) => s.program === 'StackingDAO');
  assert.ok(stacking, 'snapshot do StackingDAO deveria existir mesmo sem dataset HackerOne');
  const expectedContracts = TARGETS.find((t) => t.program === 'StackingDAO').contracts;
  assert.equal(stacking.assets.length, expectedContracts.length);
  for (const name of expectedContracts) {
    assert.ok(stacking.assets.some((a) => a.assetIdentifier === name), `contrato "${name}" deveria estar no snapshot`);
  }
});

test('check-scope real do StackingDAO passa a encontrar os contratos rastreados (antes desta correção, "assets:[]" recusava tudo)', async () => {
  const snapshots = await captureAllSnapshots({
    fetchJsonFn: async (url) => (url.includes('hackerone') ? EMPTY_H1 : EMPTY_BC),
  });
  const stacking = snapshots.find((s) => s.program === 'StackingDAO');
  const gate = scopeGate(stacking, 'stbtc-token', stacking.capturedAt);
  assert.equal(gate.allowed, true, 'stbtc-token está em targets.mjs, deveria ser encontrado no snapshot');
  assert.equal(gate.bountyEligible, true);
});
