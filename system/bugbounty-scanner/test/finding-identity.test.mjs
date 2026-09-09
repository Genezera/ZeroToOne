import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingIdentityQuality, localRootCauseCollisions } from '../finding-identity.mjs';

const base = {
  id:'one', repository:'acme/api', file:'src/auth.js', weakness:'authorization_bypass',
  rootCause:'ownership result ignored', attackerInput:'request object id', securitySink:'record returned',
  missingControl:'owner equality check', expectedFix:'reject mismatched owner',
};

test('identidade mecânica não aceita prosa como substituto de campos estruturados', () => {
  const result = findingIdentityQuality({ ...base, rootCause: undefined, reasoning:'ownership result ignored' });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('rootCause'));
});

test('fingerprint de causa raiz ignora id/função/prosa e detecta colisão local', () => {
  const sibling = { ...base, id:'two', function:'helper', reasoning:'outra redação' };
  const result = localRootCauseCollisions(base, [base, sibling]);
  assert.match(result.rootCauseFingerprint, /^rcf:v1:[a-f0-9]{64}$/);
  assert.deepEqual(result.collisionIds, ['two']);
});

test('causa ou correção mecanicamente distinta não colide', () => {
  const distinct = { ...base, id:'two', expectedFix:'validate signature threshold' };
  assert.deepEqual(localRootCauseCollisions(base, [base, distinct]).collisionIds, []);
});
