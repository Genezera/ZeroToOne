import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubHeaders } from '../github-auth.mjs';

test('githubHeaders sem GITHUB_TOKEN no ambiente devolve só User-Agent (comportamento anônimo, sem quebrar nada existente)', () => {
  const original = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    const headers = githubHeaders();
    assert.equal(headers['User-Agent'], 'ZeroToOne-bugbounty-scanner');
    assert.equal('Authorization' in headers, false);
  } finally {
    if (original !== undefined) process.env.GITHUB_TOKEN = original;
  }
});

test('githubHeaders com GITHUB_TOKEN no ambiente adiciona Authorization: Bearer', () => {
  const original = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_teste123';
  try {
    const headers = githubHeaders();
    assert.equal(headers.Authorization, 'Bearer ghp_teste123');
    assert.equal(headers['User-Agent'], 'ZeroToOne-bugbounty-scanner');
  } finally {
    if (original === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = original;
  }
});

test('githubHeaders preserva headers extras passados por quem chama', () => {
  const headers = githubHeaders({ Accept: 'application/vnd.github.v3+json' });
  assert.equal(headers.Accept, 'application/vnd.github.v3+json');
  assert.equal(headers['User-Agent'], 'ZeroToOne-bugbounty-scanner');
});
