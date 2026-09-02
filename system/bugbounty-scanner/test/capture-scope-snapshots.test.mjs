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

// --- 02/09/2026: primeiro alvo JVM real desde a pausa do Block Open
// Source -- ver targets-jvm.mjs e README.md pra narrativa completa.

const FAKE_AUTH0_BUGCROWD = {
  name: 'Auth0 by Okta',
  url: 'https://bugcrowd.com/engagements/auth0-okta',
  targets: {
    in_scope: [
      { type: 'other', target: 'https://github.com/auth0/auth0-java', uri: 'https://github.com/auth0/auth0-java', name: 'Auth0 Java SDK (auth0-java)' },
      { type: 'website', target: 'https://auth0.com', uri: 'https://auth0.com', name: 'Site principal' },
    ],
  },
};

test('captureAllSnapshots monta o snapshot do Auth0 by Okta a partir do dataset Bugcrowd, com confidence "low" (mesma limitação do Block Open Source)', async () => {
  const snapshots = await captureAllSnapshots({
    fetchJsonFn: async (url) => (url.includes('hackerone') ? EMPTY_H1 : [FAKE_AUTH0_BUGCROWD]),
  });
  const auth0 = snapshots.find((s) => s.program === 'Auth0 by Okta');
  assert.ok(auth0, 'snapshot do Auth0 by Okta deveria existir');
  assert.equal(auth0.platform, 'Bugcrowd');
  assert.equal(auth0.confidence, 'low');
  assert.ok(auth0.assets.some((a) => a.assetIdentifier === 'https://github.com/auth0/auth0-java'));
});

test('check-scope real do Auth0 by Okta encontra auth0/auth0-java no snapshot, mas eligibleForBounty fica null (Bugcrowd não expõe isso por ativo)', async () => {
  const snapshots = await captureAllSnapshots({
    fetchJsonFn: async (url) => (url.includes('hackerone') ? EMPTY_H1 : [FAKE_AUTH0_BUGCROWD]),
  });
  const auth0 = snapshots.find((s) => s.program === 'Auth0 by Okta');
  const asset = auth0.assets.find((a) => a.assetIdentifier === 'https://github.com/auth0/auth0-java');
  assert.equal(asset.eligibleForBounty, null, 'sem confirmação manual, elegibilidade de bounty por ativo não pode ser assumida como true');
});
