import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubHeaders, githubFetch } from '../github-auth.mjs';

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

test('githubFetch refaz sem Authorization quando a chamada autenticada devolve 404 (token escopado a outro repo)', async () => {
  const original = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_escopado_a_outro_repo';
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, hasAuth: 'Authorization' in opts.headers });
    if ('Authorization' in opts.headers) return { status: 404, ok: false };
    return { status: 200, ok: true, url };
  };
  try {
    const res = await githubFetch('https://raw.githubusercontent.com/terceiro/repo/main/f.json', { fetchImpl });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].hasAuth, true);
    assert.equal(calls[1].hasAuth, false);
  } finally {
    if (original === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = original;
  }
});

test('githubFetch refaz sem Authorization quando a chamada autenticada devolve 401 (API de busca com token escopado a outro repo)', async () => {
  const original = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_escopado_a_outro_repo';
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, hasAuth: 'Authorization' in opts.headers });
    if ('Authorization' in opts.headers) return { status: 401, ok: false };
    return { status: 200, ok: true, url };
  };
  try {
    const res = await githubFetch('https://api.github.com/search/issues?q=repo:terceiro/repo+foo', { fetchImpl });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].hasAuth, true);
    assert.equal(calls[1].hasAuth, false);
  } finally {
    if (original === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = original;
  }
});

test('githubFetch não refaz a chamada quando já não havia Authorization (sem GITHUB_TOKEN)', async () => {
  const original = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, hasAuth: 'Authorization' in opts.headers });
    return { status: 404, ok: false };
  };
  try {
    const res = await githubFetch('https://raw.githubusercontent.com/terceiro/repo/main/f.json', { fetchImpl });
    assert.equal(res.ok, false);
    assert.equal(calls.length, 1);
  } finally {
    if (original !== undefined) process.env.GITHUB_TOKEN = original;
  }
});

test('githubFetch não refaz quando a chamada autenticada já teve sucesso', async () => {
  const original = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_com_acesso_publico_amplo';
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, hasAuth: 'Authorization' in opts.headers });
    return { status: 200, ok: true };
  };
  try {
    const res = await githubFetch('https://api.github.com/repos/foo/bar', { fetchImpl });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
  } finally {
    if (original === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = original;
  }
});
