import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHardcodedSecrets } from '../heuristics-shared.mjs';

test('findHardcodedSecrets acha valor literal atribuído a campo de segredo', () => {
  const src = `const apiKey = "sk_live_9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c";`;
  const findings = findHardcodedSecrets(src, 'x.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'hardcoded_secret');
});

test('findHardcodedSecrets ignora placeholders óbvios', () => {
  const src = `
    const apiKey = "your_api_key_here";
    val password = "changeme"
    private_key: "xxxxxxxxxxxxxxxx"
  `;
  assert.equal(findHardcodedSecrets(src, 'x.kt').length, 0);
});

test('findHardcodedSecrets ignora valores curtos demais', () => {
  const src = `const token = "abc123";`;
  assert.equal(findHardcodedSecrets(src, 'x.go').length, 0);
});
