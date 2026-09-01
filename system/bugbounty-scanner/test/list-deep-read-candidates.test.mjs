import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDeepReadLog, buildRepoProgramIndex, selectDeepReadCandidates } from '../list-deep-read-candidates.mjs';

function h1(name, repos) {
  return {
    name,
    offers_bounties: true,
    url: `https://hackerone.com/${name}`,
    targets: { in_scope: repos.map((r) => ({ asset_identifier: `https://github.com/${r}` })) },
  };
}

test('loadDeepReadLog devolve {} quando o arquivo não existe, nunca lança', () => {
  const missing = path.join(tmpdir(), 'nao-existe-' + Date.now() + '.json');
  assert.deepEqual(loadDeepReadLog(missing), {});
});

test('loadDeepReadLog devolve {} pra JSON inválido, nunca lança', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'deep-read-log-test-'));
  const p = path.join(dir, 'log.json');
  writeFileSync(p, '{ nao e json', 'utf8');
  assert.deepEqual(loadDeepReadLog(p), {});
});

test('loadDeepReadLog lê um arquivo real corretamente', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'deep-read-log-test-'));
  const p = path.join(dir, 'log.json');
  const data = { 'vercel/vercel': ['a.ts', 'b.ts'] };
  writeFileSync(p, JSON.stringify(data), 'utf8');
  assert.deepEqual(loadDeepReadLog(p), data);
});

test('buildRepoProgramIndex indexa owner/repo em minúsculo -> lista de programas', () => {
  const hackerOneData = [h1('vercel-open-source', ['vercel/vercel']), h1('block-open-source', ['cashapp/misk'])];
  const index = buildRepoProgramIndex(hackerOneData, []);
  assert.deepEqual(index.get('vercel/vercel'), ['vercel-open-source']);
  assert.deepEqual(index.get('cashapp/misk'), ['block-open-source']);
});

test('buildRepoProgramIndex acumula os dois programas quando o mesmo repo aparece em ambos', () => {
  const hackerOneData = [h1('programa-a', ['x/y']), h1('programa-b', ['x/y'])];
  const index = buildRepoProgramIndex(hackerOneData, []);
  assert.deepEqual(index.get('x/y'), ['programa-a', 'programa-b']);
});

test('buildRepoProgramIndex tolera datasets vazios/ausentes, nunca lança', () => {
  assert.equal(buildRepoProgramIndex(null, null).size, 0);
  assert.equal(buildRepoProgramIndex([], []).size, 0);
});

const POLICY = { 'Block Open Source': { aiResearchBanned: true, reason: 'RoE proíbe IA' } };

test('selectDeepReadCandidates exclui repo de programa banido, mesmo sendo o menos lido', () => {
  const log = { 'cashapp/misk': ['a.kt'], 'vercel/vercel': ['a.ts', 'b.ts', 'c.ts'] };
  const index = new Map([
    ['cashapp/misk', ['Block Open Source']],
    ['vercel/vercel', ['Vercel Open Source']],
  ]);
  const { safe, blocked } = selectDeepReadCandidates(log, index, POLICY);
  assert.equal(safe.length, 1);
  assert.equal(safe[0].repo, 'vercel/vercel');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].repo, 'cashapp/misk');
  assert.equal(blocked[0].program, 'Block Open Source');
});

test('selectDeepReadCandidates exclui repo se QUALQUER programa associado está banido, não só se todos estão', () => {
  const log = { 'shared/repo': ['a.ts'] };
  const index = new Map([['shared/repo', ['Vercel Open Source', 'Block Open Source']]]);
  const { safe, blocked } = selectDeepReadCandidates(log, index, POLICY);
  assert.equal(safe.length, 0);
  assert.equal(blocked.length, 1);
});

test('selectDeepReadCandidates manda repo sem programa reconhecido pra unresolved, nunca pra safe', () => {
  const log = { 'algum/repo-privado': ['a.ts'] };
  const index = new Map();
  const { safe, blocked, unresolved } = selectDeepReadCandidates(log, index, POLICY);
  assert.equal(safe.length, 0);
  assert.equal(blocked.length, 0);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].repo, 'algum/repo-privado');
});

test('selectDeepReadCandidates ordena safe do menos lido pro mais lido', () => {
  const log = {
    'a/muito-lido': new Array(10).fill('f.ts'),
    'b/pouco-lido': ['f.ts'],
    'c/meio-termo': ['f.ts', 'g.ts'],
  };
  const index = new Map([
    ['a/muito-lido', ['Programa X']],
    ['b/pouco-lido', ['Programa X']],
    ['c/meio-termo', ['Programa X']],
  ]);
  const { safe } = selectDeepReadCandidates(log, index, {});
  assert.deepEqual(safe.map((s) => s.repo), ['b/pouco-lido', 'c/meio-termo', 'a/muito-lido']);
});

test('selectDeepReadCandidates trata log vazio/ausente como zero candidatos, nunca lança', () => {
  assert.deepEqual(selectDeepReadCandidates({}, new Map(), {}), { safe: [], blocked: [], unresolved: [] });
  assert.deepEqual(selectDeepReadCandidates(null, new Map(), {}), { safe: [], blocked: [], unresolved: [] });
});

test('selectDeepReadCandidates com policy real do projeto bloqueia Block Open Source de verdade', () => {
  const log = { 'cashapp/misk': ['a.kt', 'b.kt'] };
  const index = new Map([['cashapp/misk', ['Block Open Source']]]);
  const { safe, blocked } = selectDeepReadCandidates(log, index, POLICY);
  assert.equal(safe.length, 0);
  assert.equal(blocked.length, 1);
});
