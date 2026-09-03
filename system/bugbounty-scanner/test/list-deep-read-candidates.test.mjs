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
  // Mesmo padrão de test/db.test.mjs, test/cli.test.mjs, test/migrate-to-v2.test.mjs
  // e test/generate-report.test.mjs -- faltava aqui (achado real, 02/09/2026):
  // sem isso, recordPlatformOutcome (via appendEntry em ../system/ledger/ledger.mjs)
  // cai no default de getLedgerDir() e grava no ledger REAL compartilhado
  // (versionado no git) em vez de um ledger isolado por teste. Foi exatamente
  // o que aconteceu com o teste "countKnownDuplicatesByRepo" abaixo, que
  // poluiu ledger/ledger.research.jsonl com 3 entradas de fixture
  // ("Programa X::owner/repo-a/...") -- ver ledger/ledger.mjs::getLedgerDir.
  const prevLedgerDir = process.env.ZERO2ONE_LEDGER_DIR;
  process.env.ZERO2ONE_LEDGER_DIR = path.join(dir, 'ledger');
  // Mesma classe de bug documentada acima, achado real 03/09/2026:
  // recordPlatformOutcome pra `duplicate` dispara sendTelegramMessage de
  // verdade se TELEGRAM_BOT_TOKEN/CHAT_ID estiverem configurados na
  // máquina -- usuário recebeu ~17 notificações reais com dado de
  // fixture ("Circle BBP"/"p::f::fn::type") disparadas exatamente por
  // testes como este. Ver comentário completo em test/db.test.mjs.
  const prevTelegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevTelegramChatId = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  try {
    return fn(dir);
  } finally {
    process.env.ZERO2ONE_LEDGER_DIR = prevLedgerDir;
    if (prevTelegramToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = prevTelegramToken;
    if (prevTelegramChatId === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = prevTelegramChatId;
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
  assert.deepEqual(selectDeepReadCandidates({}, new Map(), {}), { safe: [], blocked: [], unresolved: [], fullyCovered: [] });
  assert.deepEqual(selectDeepReadCandidates(null, new Map(), {}), { safe: [], blocked: [], unresolved: [], fullyCovered: [] });
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

// --- 02/09/2026: coverageRatio (filesRead / totalScannableFiles) em vez
// de filesRead cru -- achado real fazendo a lista corrigida funcionar de
// verdade: vercel/ms e vercel/async-sema (1 arquivo TOTAL cada, já 100%
// lido) apareciam no TOPO só por terem `filesRead` baixo, quando não
// sobrava nada pra ler. Ver NOTES.md do Vercel Open Source, rodada
// 2026-09-02.

test('selectDeepReadCandidates manda repo 100% coberto pra fullyCovered, nunca pra safe, mesmo com filesRead baixo', () => {
  const log = { 'pequeno/tudo-lido': ['a.ts'], 'grande/pouco-lido': ['a.ts', 'b.ts'] };
  const index = new Map([
    ['pequeno/tudo-lido', ['Programa X']],
    ['grande/pouco-lido', ['Programa X']],
  ]);
  const popularity = {
    'pequeno/tudo-lido': { totalScannableFiles: 1 }, // 1/1 = 100%
    'grande/pouco-lido': { totalScannableFiles: 500 }, // 2/500 = 0,4%
  };
  const { safe, fullyCovered } = selectDeepReadCandidates(log, index, {}, popularity);
  assert.equal(fullyCovered.length, 1);
  assert.equal(fullyCovered[0].repo, 'pequeno/tudo-lido');
  assert.equal(safe.length, 1);
  assert.equal(safe[0].repo, 'grande/pouco-lido');
});

test('selectDeepReadCandidates ordena por coverageRatio (menos coberto primeiro), não por filesRead cru, quando os dois lados têm o dado', () => {
  const log = { 'a/muitos-arquivos-lidos-mas-repo-enorme': new Array(20).fill('f.ts'), 'b/poucos-arquivos-lidos-repo-pequeno': ['f.ts', 'g.ts'] };
  const index = new Map([
    ['a/muitos-arquivos-lidos-mas-repo-enorme', ['Programa X']],
    ['b/poucos-arquivos-lidos-repo-pequeno', ['Programa X']],
  ]);
  const popularity = {
    'a/muitos-arquivos-lidos-mas-repo-enorme': { totalScannableFiles: 10000 }, // 20/10000 = 0,2%
    'b/poucos-arquivos-lidos-repo-pequeno': { totalScannableFiles: 10 }, // 2/10 = 20%
  };
  const { safe } = selectDeepReadCandidates(log, index, {}, popularity);
  // Pelo filesRead cru, "b" (2) viria antes de "a" (20) -- mas "a" tem
  // MUITO mais cobertura restante (99,8% vs 80%), então deveria vir
  // primeiro com o critério novo.
  assert.deepEqual(safe.map((s) => s.repo), ['a/muitos-arquivos-lidos-mas-repo-enorme', 'b/poucos-arquivos-lidos-repo-pequeno']);
});

test('selectDeepReadCandidates cai pro critério antigo (filesRead) quando falta coverageRatio de UM dos lados -- nunca desvantajar quem não tem o dado ainda', () => {
  const log = { 'com/dado': ['f.ts', 'g.ts', 'h.ts'], 'sem/dado': ['f.ts'] };
  const index = new Map([
    ['com/dado', ['Programa X']],
    ['sem/dado', ['Programa X']],
  ]);
  const popularity = { 'com/dado': { totalScannableFiles: 100 } }; // 'sem/dado' não tem entrada nenhuma
  const { safe } = selectDeepReadCandidates(log, index, {}, popularity);
  // Sem coverageRatio dos dois lados pra comparar, cai pro filesRead cru
  // -- 'sem/dado' (1) vem antes de 'com/dado' (3), como sempre foi.
  assert.deepEqual(safe.map((s) => s.repo), ['sem/dado', 'com/dado']);
});

test('selectDeepReadCandidates: totalScannableFiles ausente (null) nunca vira "0% coberto" nem "100% coberto" por engano', () => {
  const log = { 'sem/total-conhecido': ['a.ts'] };
  const index = new Map([['sem/total-conhecido', ['Programa X']]]);
  const { safe, fullyCovered } = selectDeepReadCandidates(log, index, {}, { 'sem/total-conhecido': { stars: 5 } });
  assert.equal(fullyCovered.length, 0);
  assert.equal(safe.length, 1);
  assert.equal(safe[0].coverageRatio, null);
});

test('refreshRepoPopularity calcula totalScannableFiles a partir da linguagem inferida do que já foi lido + fetchFiles injetado', async () => {
  const fetchMeta = async () => ({ stars: 10, defaultBranch: 'main' });
  const fetchFiles = async () => [{ path: 'a.sol' }, { path: 'b.sol' }, { path: 'README.md' }, { path: 'test/c.t.sol' }];
  const deepReadLog = { 'a/b': ['a.sol'] }; // extensão .sol -> infere Solidity
  const cache = await refreshRepoPopularity(['a/b'], {}, { fetchMeta, fetchFiles, deepReadLog });
  // README.md não é .sol (ignorado); test/c.t.sol é convenção Foundry de
  // teste (ignorado por isScannableSolidityFile) -- só a.sol e b.sol contam.
  assert.equal(cache['a/b'].totalScannableFiles, 2);
});

test('refreshRepoPopularity deixa totalScannableFiles null quando a linguagem não é reconhecida (sem heurística pra essa extensão)', async () => {
  const fetchMeta = async () => ({ stars: 10, defaultBranch: 'main' });
  const fetchFiles = async () => { throw new Error('não deveria ser chamado'); };
  const deepReadLog = { 'a/b': ['a.rs'] }; // Rust -- sem heurística/predicado neste projeto ainda
  const cache = await refreshRepoPopularity(['a/b'], {}, { fetchMeta, fetchFiles, deepReadLog });
  assert.equal(cache['a/b'].totalScannableFiles, null);
});

test('refreshRepoPopularity deixa totalScannableFiles null quando fetchFiles falha, mas mantém stars (melhor esforço parcial)', async () => {
  const fetchMeta = async () => ({ stars: 10, defaultBranch: 'main' });
  const fetchFiles = async () => { throw new Error('rede fora do ar'); };
  const deepReadLog = { 'a/b': ['a.sol'] };
  const cache = await refreshRepoPopularity(['a/b'], {}, { fetchMeta, fetchFiles, deepReadLog });
  assert.equal(cache['a/b'].stars, 10);
  assert.equal(cache['a/b'].totalScannableFiles, null);
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
