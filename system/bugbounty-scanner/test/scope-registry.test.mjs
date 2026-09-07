import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScopeSnapshot,
  isSnapshotExpired,
  assetInScope,
  scopeGate,
  assetRefForFinding,
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

test('assetRefForFinding reduz caminho de arquivo a owner/repo e preserva ativo não-repositório', () => {
  assert.equal(assetRefForFinding({ file: 'acme/api/src/auth.ts' }), 'acme/api');
  assert.equal(assetRefForFinding({ repository: 'https://github.com/acme/api.git' }), 'acme/api');
  assert.equal(assetRefForFinding({ file: 'dao.clar', asset: 'dao' }), 'dao');
  assert.equal(assetRefForFinding({ file: 'packages/next/src/image.ts', asset: 'vercel/next.js' }), 'vercel/next.js');
});

test('scope exige identidade exata, nunca substring de outro repo, domínio ou contrato', () => {
  const snap = buildScopeSnapshot({ ...BASE, assets: [
    { assetIdentifier: 'https://github.com/acme/api-backend' },
    { assetIdentifier: 'console.example.com' },
    { assetIdentifier: 'stx-reserve-v2' },
  ] });
  for (const asset of ['acme/api', 'acme/api-backend-extra', 'api-backend',
    'https://github.com/acme/api', 'https://github.com/acme/api-backend/blob/main/x.ts',
    'https://github.com.evil/acme/api-backend', 'console.example.com.evil', 'example.com',
    'stx-reserve', 'prefix-stx-reserve-v2', 'stx-reserve-v20']) {
    assert.equal(assetInScope(snap, asset), null, asset);
  }
  assert.ok(assetInScope(snap, 'https://github.com/ACME/API-BACKEND.git/'));
  assert.ok(assetInScope(snap, 'https://CONSOLE.example.com/'));
});

test('wildcard DNS explícito respeita limite de hostname e exclusão específica', () => {
  const snap = buildScopeSnapshot({ ...BASE, assets: [
    { assetIdentifier: '*.example.com', eligibleForBounty: true },
    { assetIdentifier: 'admin.example.com', eligibleForSubmission: false },
  ] });
  assert.ok(assetInScope(snap, 'app.example.com'));
  assert.ok(assetInScope(snap, 'https://sub.app.example.com'));
  for (const value of ['example.com', 'notexample.com', 'app.example.com.evil', 'example.com/app']) {
    assert.equal(assetInScope(snap, value), null);
  }
  assert.equal(scopeGate(snap, 'admin.example.com', BASE.capturedAt).allowed, false);
});

test('snapshot com validade inválida ou flags não booleanas bloqueia autorização', () => {
  const snap = buildScopeSnapshot(BASE);
  for (const expiresAt of [undefined, null, '', 'invalid']) {
    assert.equal(scopeGate({ ...snap, expiresAt }, 'circlefin/malachite', BASE.capturedAt).allowed, false);
  }
  const malformed = buildScopeSnapshot({ ...BASE, assets: [{assetIdentifier:'acme/api', eligibleForBounty:'true'}] });
  assert.equal(scopeGate(malformed, 'acme/api', BASE.capturedAt).allowed, false);
});

test('identificadores opacos, app URLs e organizações preservam igualdade sem expandir escopo', () => {
  const snap = buildScopeSnapshot({...BASE,assets:[
    {assetIdentifier:'OKX Android APK'},
    {assetIdentifier:'https://play.google.com/store/apps/details?id=com.example.app'},
    {assetIdentifier:'https://github.com/acme'},
  ]});
  for(const asset of snap.assets) assert.ok(assetInScope(snap,asset.assetIdentifier));
  for(const value of ['Android APK','https://play.google.com/store/apps/details?id=com.example.other','acme/api','https://github.com/acme/api']) {
    assert.equal(assetInScope(snap,value),null,value);
  }
});

test('snapshot oficial resolve somente repositórios GitHub explicitamente ligados nas instruções', () => {
  const snap = buildScopeSnapshot({...BASE, sourceType:'hackerone_api_live', assets:[
    {
      assetIdentifier:'Mattermost Plugins', eligibleForSubmission:true, eligibleForBounty:true,
      instruction:'- [Zoom](https://github.com/mattermost/mattermost-plugin-zoom)\n- Organização: https://github.com/mattermost',
    },
    {
      assetIdentifier:'Other publicly-released plugins', eligibleForSubmission:true, eligibleForBounty:false,
      instruction:'Plugins not officially supported are informational only.',
    },
  ]});
  const zoom = scopeGate(snap, 'mattermost/mattermost-plugin-zoom', snap.capturedAt);
  assert.equal(zoom.allowed, true);
  assert.equal(zoom.bountyEligible, true);
  for (const value of ['mattermost/mattermost-plugin-zoom-extra', 'mattermost/mattermost-plugin-confluence', 'mattermost/anything']) {
    assert.equal(assetInScope(snap, value), null, value);
  }
});

test('assetRefForFinding recupera owner/repo do ID quando asset e file são caminhos relativos', () => {
  const finding = {
    id: 'OKG::okx/go-wallet-sdk/coins/cardano/crypto/key.go::NewXPrvKeyFromEntropy::ai_deep_read_finding',
    asset: 'coins/cardano/crypto/key.go',
    file: 'coins/cardano/crypto/key.go',
  };
  assert.equal(assetRefForFinding(finding), 'okx/go-wallet-sdk');
});

test('assetRefForFinding não inventa repositório quando o ID contém apenas o caminho relativo', () => {
  assert.equal(assetRefForFinding({
    id: 'Circle BBP::src/Vault.sol::withdraw::static_finding',
    asset: 'vault',
    file: 'src/Vault.sol',
  }), 'vault');
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
  assert.equal(gate.snapshotSourceType, snap.sourceType);
  assert.equal(gate.snapshotContentHash, snap.contentHash);
});

test('scopeGate permite ativo em escopo e elegível para recompensa', () => {
  const snap = buildScopeSnapshot(BASE);
  const gate = scopeGate(snap, 'circlefin/evm-gateway-contracts', '2026-08-30T00:00:00.000Z');
  assert.equal(gate.allowed, true);
  assert.equal(gate.bountyEligible, true);
  assert.equal(gate.snapshotContentHash, snap.contentHash);
  assert.equal(gate.snapshotExpiresAt, snap.expiresAt);
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
