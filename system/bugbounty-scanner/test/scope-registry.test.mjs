import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScopeSnapshot,
  isSnapshotExpired,
  assetInScope,
  scopeGate,
  TTL_DAYS_BY_SOURCE,
} from '../scope-registry.mjs';

const BASE = {
  program: 'Circle BBP',
  platform: 'HackerOne',
  officialUrl: 'https://hackerone.com/circle-bbp',
  sourceType: 'community_dataset_structured',
  sourceDetail: 'arkadiyt/bounty-targets-data',
  rawSourceContent: 'fixture',
  confidence: 'medium',
  capturedAt: '2026-08-29T00:00:00.000Z',
  assets: [
    { assetIdentifier: 'https://github.com/circlefin/evm-gateway-contracts', assetType: 'SMART_CONTRACT', eligibleForBounty: true, eligibleForSubmission: true, maxSeverity: 'critical' },
    { assetIdentifier: 'https://github.com/circlefin/malachite', assetType: 'SOURCE_CODE', eligibleForBounty: true, eligibleForSubmission: true, instruction: 'only code/crates' },
    { assetIdentifier: 'console.circle.com', assetType: 'URL', eligibleForBounty: false, eligibleForSubmission: true },
  ],
};

test('buildScopeSnapshot rejeita sourceType inválido', () => {
  assert.throws(() => buildScopeSnapshot({ ...BASE, sourceType: 'chute' }), /sourceType inválido/);
});

test('buildScopeSnapshot calcula expiresAt a partir do TTL da fonte', () => {
  const snap = buildScopeSnapshot(BASE);
  const days = (new Date(snap.expiresAt) - new Date(snap.capturedAt)) / (24 * 60 * 60 * 1000);
  assert.equal(Math.round(days), TTL_DAYS_BY_SOURCE.community_dataset_structured);
});

test('buildScopeSnapshot é determinístico no hash pro mesmo conteúdo bruto', () => {
  const a = buildScopeSnapshot(BASE);
  const b = buildScopeSnapshot(BASE);
  assert.equal(a.contentHash, b.contentHash);
});

test('isSnapshotExpired: falso antes do prazo, verdadeiro depois', () => {
  const snap = buildScopeSnapshot(BASE);
  assert.equal(isSnapshotExpired(snap, '2026-08-30T00:00:00.000Z'), false);
  assert.equal(isSnapshotExpired(snap, '2026-10-01T00:00:00.000Z'), true);
});

test('assetInScope acha por URL completa ou por owner/repo', () => {
  const snap = buildScopeSnapshot(BASE);
  assert.ok(assetInScope(snap, 'https://github.com/circlefin/evm-gateway-contracts'));
  assert.ok(assetInScope(snap, 'circlefin/evm-gateway-contracts'));
  assert.equal(assetInScope(snap, 'circlefin/nao-existe'), null);
});

test('scopeGate bloqueia quando não há snapshot', () => {
  const gate = scopeGate(null, 'circlefin/evm-gateway-contracts');
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /nenhum scope snapshot/);
});

test('scopeGate bloqueia snapshot expirado, mesmo com ativo em escopo', () => {
  const snap = buildScopeSnapshot(BASE);
  const gate = scopeGate(snap, 'circlefin/evm-gateway-contracts', '2026-10-01T00:00:00.000Z');
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /expirado/);
});

test('scopeGate bloqueia ativo fora do snapshot — nunca assume elegível por padrão', () => {
  const snap = buildScopeSnapshot(BASE);
  const gate = scopeGate(snap, 'circlefin/nao-rastreado', '2026-08-30T00:00:00.000Z');
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /não encontrado/);
});

test('scopeGate permite ativo em escopo e elegível para recompensa', () => {
  const snap = buildScopeSnapshot(BASE);
  const gate = scopeGate(snap, 'circlefin/evm-gateway-contracts', '2026-08-30T00:00:00.000Z');
  assert.equal(gate.allowed, true);
  assert.equal(gate.bountyEligible, true);
});

test('scopeGate permite submissão mas marca bountyEligible=false quando o dataset diz isso', () => {
  const snap = buildScopeSnapshot(BASE);
  const gate = scopeGate(snap, 'console.circle.com', '2026-08-30T00:00:00.000Z');
  assert.equal(gate.allowed, true);
  assert.equal(gate.bountyEligible, false);
});

test('scopeGate NUNCA trata elegibilidade desconhecida (null) como elegível — só como "precisa confirmar"', () => {
  const snap = buildScopeSnapshot({
    ...BASE,
    assets: [{ assetIdentifier: 'https://github.com/cashapp/hermit', assetType: 'other', eligibleForBounty: null, eligibleForSubmission: null }],
  });
  const gate = scopeGate(snap, 'cashapp/hermit', '2026-08-30T00:00:00.000Z');
  assert.equal(gate.allowed, true);
  assert.equal(gate.bountyEligible, null);
  assert.match(gate.reason, /não informa elegibilidade/);
});
