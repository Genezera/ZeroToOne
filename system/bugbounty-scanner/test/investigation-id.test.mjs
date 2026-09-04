import { test } from 'node:test';
import assert from 'node:assert/strict';
import { investigationIdFor } from '../investigation-id.mjs';

test('correlationId é determinístico entre ambientes e muda por finding', () => {
  const first = investigationIdFor('program::repo/file::fn::type');
  assert.match(first, /^inv:v1:[a-f0-9]{64}$/);
  assert.equal(first, investigationIdFor('program::repo/file::fn::type'));
  assert.notEqual(first, investigationIdFor('program::repo/file::other::type'));
});

test('correlationId recusa identidade ausente', () => {
  assert.throws(() => investigationIdFor(''), /findingId é obrigatório/);
});
