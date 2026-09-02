import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadDeepReadLog, buildRepoProgramIndex, selectDeepReadCandidates,
  loadRepoPopularityCache, refreshRepoPopularity, countKnownDuplicatesByRepo,
  POPULAR_REPO_STAR_THRESHOLD,
} from '../list-deep-read-candidates.mjs';
import { openDb, closeDb, upsertFinding, recordPlatformOutcome } from '../db.mjs';

function withTempEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-deep-read-test-'));
  try {
    return fn(dir);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* limpeza best-effort, mesmo padrão de test/db.test.mjs */ }
  }
}

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

// --- 02/09/2026: camadas de popularidade/duplicata conhecida ---

test('selectDeepReadCandidates manda repo mega-popular pro fim mesmo com MENOS arquivos lidos que um não-popular', () => {
  const log = { 'vercel/next.js': ['a.ts'], 'pequena/lib': ['a.ts', 'b.ts', 'c.ts'] };
  const index = new Map([
    ['vercel/next.js', ['Vercel Open Source']],
    ['pequena/lib', ['Programa X']],
  ]);
  const popularity = { 'vercel/next.js': { stars: 130000 } };
  const { safe } = selectDeepReadCandidates(log, index, {}, popularity);
  assert.deepEqual(safe.map((s) => s.repo), ['pequena/lib', 'vercel/next.js']);
  assert.equal(safe[1].stars, 130000);
});

test('selectDeepReadCandidates trata estrelas abaixo do limiar como camada "clean" normal', () => {
  const log = { 'a/repo': ['x.ts'], 'b/repo': ['x.ts', 'y.ts'] };
  const index = new Map([
    ['a/repo', ['Programa X']],
    ['b/repo', ['Programa X']],
  ]);
  const popularity = { 'a/repo': { stars: POPULAR_REPO_STAR_THRESHOLD - 1 } };
  const { safe } = selectDeepReadCandidates(log, index, {}, popularity);
  // Nenhum dos dois é "popular" (um está abaixo do limiar, o outro sem
  // dado) -- ordena só por filesRead, como sempre.
  assert.deepEqual(safe.map((s) => s.repo), ['a/repo', 'b/repo']);
});

test('selectDeepReadCandidates manda repo com duplicata conhecida pro fim, mesmo sendo o menos lido de todos', () => {
  const log = { 'ja/duplicou': [], 'nunca/lido': ['a.ts'], 'muito/lido': new Array(5).fill('x') };
  const index = new Map([
    ['ja/duplicou', ['Programa X']],
    ['nunca/lido', ['Programa X']],
    ['muito/lido', ['Programa X']],
  ]);
  const knownDuplicates = { 'ja/duplicou': 1 };
  const { safe } = selectDeepReadCandidates(log, index, {}, {}, knownDuplicates);
  assert.deepEqual(safe.map((s) => s.repo), ['nunca/lido', 'muito/lido', 'ja/duplicou']);
});

test('selectDeepReadCandidates ordena a camada "flagged" pelo pior ofensor primeiro', () => {
  const log = { 'duas/duplicatas': [], 'uma/duplicata': [] };
  const index = new Map([
    ['duas/duplicatas', ['Programa X']],
    ['uma/duplicata', ['Programa X']],
  ]);
  const knownDuplicates = { 'duas/duplicatas': 2, 'uma/duplicata': 1 };
  const { safe } = selectDeepReadCandidates(log, index, {}, {}, knownDuplicates);
  assert.deepEqual(safe.map((s) => s.repo), ['duas/duplicatas', 'uma/duplicata']);
});

test('selectDeepReadCandidates: duplicata conhecida vence popularidade -- flagged sempre atrás de popular', () => {
  const log = { 'popular/limpo': [], 'pequeno/duplicado': [] };
  const index = new Map([
    ['popular/limpo', ['Programa X']],
    ['pequeno/duplicado', ['Programa X']],
  ]);
  const popularity = { 'popular/limpo': { stars: 999999 } };
  const knownDuplicates = { 'pequeno/duplicado': 1 };
  const { safe } = selectDeepReadCandidates(log, index, {}, popularity, knownDuplicates);
  assert.deepEqual(safe.map((s) => s.repo), ['popular/limpo', 'pequeno/duplicado']);
});

test('loadRepoPopularityCache devolve {} quando o arquivo não existe, nunca lança', () => {
  const missing = path.join(tmpdir(), 'nao-existe-popularity-' + Date.now() + '.json');
  assert.deepEqual(loadRepoPopularityCache(missing), {});
});

test('loadRepoPopularityCache devolve {} pra JSON inválido, nunca lança', () => {
  withTempEnv((dir) => {
    const p = path.join(dir, 'cache.json');
    writeFileSync(p, '{ nao e json', 'utf8');
    assert.deepEqual(loadRepoPopularityCache(p), {});
  });
});

test('loadRepoPopularityCache lê um cache real corretamente', () => {
  withTempEnv((dir) => {
    const p = path.join(dir, 'cache.json');
    const data = { 'vercel/next.js': { stars: 130000, fetchedAt: '2026-09-01T00:00:00.000Z' } };
    writeFileSync(p, JSON.stringify(data), 'utf8');
    assert.deepEqual(loadRepoPopularityCache(p), data);
  });
});

test('refreshRepoPopularity busca estrelas pra repo ausente do cache, via fetchMeta injetado (sem rede real)', async () => {
  const calls = [];
  const fetchMeta = async (owner, repo) => {
    calls.push(`${owner}/${repo}`);
    return { stars: 42 };
  };
  const cache = await refreshRepoPopularity(['a/b'], {}, { fetchMeta });
  assert.deepEqual(calls, ['a/b']);
  assert.equal(cache['a/b'].stars, 42);
  assert.ok(cache['a/b'].fetchedAt);
});

test('refreshRepoPopularity NÃO rebusca repo com cache ainda fresco (dentro de staleDays)', async () => {
  const calls = [];
  const fetchMeta = async (owner, repo) => {
    calls.push(`${owner}/${repo}`);
    return { stars: 999 };
  };
  const existingCache = { 'a/b': { stars: 10, fetchedAt: new Date().toISOString() } };
  const cache = await refreshRepoPopularity(['a/b'], existingCache, { fetchMeta, staleDays: 30 });
  assert.deepEqual(calls, []);
  assert.equal(cache['a/b'].stars, 10);
});

test('refreshRepoPopularity REBUSCA repo com cache mais velho que staleDays', async () => {
  const fetchMeta = async () => ({ stars: 999 });
  const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const existingCache = { 'a/b': { stars: 10, fetchedAt: oldDate } };
  const cache = await refreshRepoPopularity(['a/b'], existingCache, { fetchMeta, staleDays: 30 });
  assert.equal(cache['a/b'].stars, 999);
});

test('refreshRepoPopularity mantém o valor velho do cache se fetchMeta falhar pra repo já cacheado', async () => {
  const fetchMeta = async () => { throw new Error('rede fora do ar'); };
  const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const existingCache = { 'a/b': { stars: 10, fetchedAt: oldDate } };
  const cache = await refreshRepoPopularity(['a/b'], existingCache, { fetchMeta, staleDays: 30 });
  assert.deepEqual(cache['a/b'], existingCache['a/b']);
});

test('refreshRepoPopularity registra stars:null com erro se fetchMeta falhar pra repo NUNCA cacheado', async () => {
  const fetchMeta = async () => { throw new Error('rede fora do ar'); };
  const cache = await refreshRepoPopularity(['a/b'], {}, { fetchMeta });
  assert.equal(cache['a/b'].stars, null);
  assert.match(cache['a/b'].error, /rede fora do ar/);
});

test('countKnownDuplicatesByRepo conta achados com outcome "duplicate" de verdade, ignora outros estados', () => {
  withTempEnv((dir) => {
    const db = openDb(path.join(dir, 'test.db'));
    try {
      upsertFinding(db, {
        id: 'Programa X::owner/repo-a/file1.ts::fn1::ssrf_risk',
        program: 'Programa X', platform: 'HackerOne', type: 'ssrf_risk',
        language: 'javascript', file: 'owner/repo-a/file1.ts', state: 'submitted',
        reasoning: 'teste',
      });
      upsertFinding(db, {
        id: 'Programa X::owner/repo-a/file2.ts::fn2::command_injection_risk',
        program: 'Programa X', platform: 'HackerOne', type: 'command_injection_risk',
        language: 'javascript', file: 'owner/repo-a/file2.ts', state: 'submitted',
        reasoning: 'teste',
      });
      upsertFinding(db, {
        id: 'Programa X::owner/repo-b/file3.ts::fn3::ssrf_risk',
        program: 'Programa X', platform: 'HackerOne', type: 'ssrf_risk',
        language: 'javascript', file: 'owner/repo-b/file3.ts', state: 'submitted',
        reasoning: 'teste',
      });
      recordPlatformOutcome(db, 'Programa X::owner/repo-a/file1.ts::fn1::ssrf_risk', { platform: 'HackerOne', state: 'duplicate' });
      recordPlatformOutcome(db, 'Programa X::owner/repo-a/file2.ts::fn2::command_injection_risk', { platform: 'HackerOne', state: 'triaged' });
      recordPlatformOutcome(db, 'Programa X::owner/repo-b/file3.ts::fn3::ssrf_risk', { platform: 'HackerOne', state: 'duplicate' });

      const counts = countKnownDuplicatesByRepo(db, ['owner/repo-a', 'owner/repo-b', 'owner/repo-c']);
      assert.equal(counts['owner/repo-a'], 1);
      assert.equal(counts['owner/repo-b'], 1);
      assert.equal(counts['owner/repo-c'], 0);
    } finally {
      closeDb(db);
    }
  });
});
