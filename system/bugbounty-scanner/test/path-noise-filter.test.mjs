import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNonProductionPath } from '../path-noise-filter.mjs';

test('isNonProductionPath reconhece pasta de teste/demo/fixture/mock conhecida', () => {
  assert.equal(isNonProductionPath('examples/gatsby/yarn.lock'), true);
  assert.equal(isNonProductionPath('packages/build-utils/test/fixtures/05/yarn.lock'), true);
  assert.equal(isNonProductionPath('packages/cli/__tests__/foo.ts'), true);
  assert.equal(isNonProductionPath('src/__mocks__/db.ts'), true);
  assert.equal(isNonProductionPath('coins/bitcoin/testdata/wallet.go'), true);
});

test('isNonProductionPath NÃO reconhece código de produção real', () => {
  assert.equal(isNonProductionPath('packages/cli/src/commands/mcp/mcp.ts'), false);
  assert.equal(isNonProductionPath('pnpm-lock.yaml'), false);
  assert.equal(isNonProductionPath('coins/bitcoin/wallet.go'), false);
});

test('isNonProductionPath casa por SEGMENTO exato, não substring -- não pega "latest/" nem "contest/"', () => {
  assert.equal(isNonProductionPath('services/latest/handler.go'), false);
  assert.equal(isNonProductionPath('app/contest/results.ts'), false);
  assert.equal(isNonProductionPath('src/attestation/verify.go'), false);
});

test('isNonProductionPath é case-insensitive e tolera path vazio/nulo', () => {
  assert.equal(isNonProductionPath('Packages/Examples/foo.ts'), true);
  assert.equal(isNonProductionPath(''), false);
  assert.equal(isNonProductionPath(null), false);
});
