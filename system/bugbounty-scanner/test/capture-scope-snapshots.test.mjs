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

// --- 02/09/2026: 12 alvos Go de Kubernetes (targets-go.mjs, auto-promovidos)
// nunca tinham snapshot formal -- achado real bloqueando check-scope de um
// achado genuíno em cluster-bootstrap/token/jws.

const FAKE_KUBERNETES_H1 = {
  handle: 'kubernetes',
  name: 'Kubernetes',
  offers_bounties: true,
  url: 'https://hackerone.com/kubernetes',
  targets: {
    in_scope: [
      { asset_identifier: 'https://github.com/kubernetes/cluster-bootstrap', asset_type: 'SOURCE_CODE', eligible_for_bounty: true, eligible_for_submission: true, max_severity: 'critical' },
      { asset_identifier: 'https://github.com/kubernetes/kubernetes', asset_type: 'SOURCE_CODE', eligible_for_bounty: true, eligible_for_submission: true, max_severity: 'critical' },
    ],
  },
};

test('captureAllSnapshots monta o snapshot do Kubernetes a partir do dataset HackerOne, com confidence "medium" (mesmo padrão de Circle BBP/Vercel)', async () => {
  const snapshots = await captureAllSnapshots({
    fetchJsonFn: async (url) => (url.includes('hackerone') ? [FAKE_KUBERNETES_H1] : EMPTY_BC),
  });
  const k8s = snapshots.find((s) => s.program === 'Kubernetes');
  assert.ok(k8s, 'snapshot do Kubernetes deveria existir');
  assert.equal(k8s.platform, 'HackerOne');
  assert.equal(k8s.confidence, 'medium');
  assert.ok(k8s.assets.some((a) => a.assetIdentifier === 'https://github.com/kubernetes/cluster-bootstrap'));
});

test('check-scope real do Kubernetes encontra cluster-bootstrap no snapshot, elegível pra bounty', async () => {
  const snapshots = await captureAllSnapshots({
    fetchJsonFn: async (url) => (url.includes('hackerone') ? [FAKE_KUBERNETES_H1] : EMPTY_BC),
  });
  const k8s = snapshots.find((s) => s.program === 'Kubernetes');
  const gate = scopeGate(k8s, 'https://github.com/kubernetes/cluster-bootstrap', k8s.capturedAt);
  assert.equal(gate.allowed, true);
  assert.equal(gate.bountyEligible, true);
});

const FAKE_KIWICOM_H1 = {
  handle: 'kiwicom',
  name: 'Kiwi.com',
  offers_bounties: true,
  url: 'https://hackerone.com/kiwicom',
  targets: {
    in_scope: [
      { asset_identifier: 'https://github.com/kiwicom/js-iam-middleware', asset_type: 'SOURCE_CODE', eligible_for_bounty: true, eligible_for_submission: true, max_severity: 'high' },
    ],
  },
};

test('captureAllSnapshots monta o snapshot do Kiwi.com a partir do dataset HackerOne, com confidence "medium" (mesmo padrão de Kubernetes/OKG)', async () => {
  const snapshots = await captureAllSnapshots({
    fetchJsonFn: async (url) => (url.includes('hackerone') ? [FAKE_KIWICOM_H1] : EMPTY_BC),
  });
  const kiwi = snapshots.find((s) => s.program === 'Kiwi.com');
  assert.ok(kiwi, 'snapshot do Kiwi.com deveria existir');
  assert.equal(kiwi.platform, 'HackerOne');
  assert.equal(kiwi.confidence, 'medium');
  assert.ok(kiwi.assets.some((a) => a.assetIdentifier === 'https://github.com/kiwicom/js-iam-middleware'));
});

test('check-scope real do Kiwi.com encontra js-iam-middleware no snapshot, elegível pra bounty', async () => {
  const snapshots = await captureAllSnapshots({
    fetchJsonFn: async (url) => (url.includes('hackerone') ? [FAKE_KIWICOM_H1] : EMPTY_BC),
  });
  const kiwi = snapshots.find((s) => s.program === 'Kiwi.com');
  const gate = scopeGate(kiwi, 'https://github.com/kiwicom/js-iam-middleware', kiwi.capturedAt);
  assert.equal(gate.allowed, true);
  assert.equal(gate.bountyEligible, true);
});
