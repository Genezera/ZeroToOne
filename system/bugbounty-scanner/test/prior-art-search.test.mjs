import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisoryMatchesQueries, searchPublicPriorArt, searchRecentHacktivity, validatePriorArtConfig } from '../prior-art-search.mjs';

test('config exige owner/repo e três framings distintos', () => {
  assert.deepEqual(validatePriorArtConfig({ repository: 'acme/api', queries: ['um', 'dois', 'tres'] }), {
    repository: 'acme/api', queries: ['um', 'dois', 'tres'],
  });
  assert.throws(() => validatePriorArtConfig({ repository: 'acme', queries: ['a', 'b', 'c'] }), /owner\/repo/);
  assert.throws(() => validatePriorArtConfig({ repository: 'acme/api', queries: ['igual', 'igual', 'outro'] }), /3 queries/);
});

test('matching local de advisory exige frase ou maioria qualificada de termos', () => {
  const advisory = { summary: 'Authorization bypass caused by missing tenant check', description: '', cwe_ids: ['CWE-862'] };
  assert.equal(advisoryMatchesQueries(advisory, ['authorization bypass missing check']), true);
  assert.equal(advisoryMatchesQueries(advisory, ['zip extraction path traversal']), false);
});

test('busca consulta issues, commits e advisories e deixa hits como unreviewed', async () => {
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(String(url));
    if (String(url).includes('/search/issues')) return { ok: true, json: async () => ({ total_count: 1, items: [{ number: 7, title: 'same root cause', state: 'open', html_url: 'https://github.com/acme/api/issues/7' }] }) };
    if (String(url).includes('/search/commits')) return { ok: true, json: async () => ({ total_count: 0, items: [] }) };
    return { ok: true, json: async () => ([{ ghsa_id: 'GHSA-aaaa-bbbb-cccc', summary: 'unrelated advisory', description: '', state: 'published', html_url: 'https://github.com/advisories/x' }]) };
  };
  const result = await searchPublicPriorArt({ repository: 'acme/api', queries: ['root cause one', 'source sink two', 'missing control three'] }, {
    fetchImpl: fakeFetch, now: () => new Date('2026-09-04T00:00:00Z'),
  });
  assert.equal(seen.length, 7);
  assert.equal(result.candidateCount, 3, 'um mesmo issue aparece uma vez por framing e fica rastreável');
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.duplicateCheckDraft.foundExisting, true);
  assert.ok(result.duplicateCheckDraft.results.every((item) => item.disposition === 'unreviewed'));
  assert.deepEqual(result.manualSourcesStillRequired, ['hacktivity_or_independent_web_search']);
});

test('falha de qualquer fonte aborta a pesquisa em vez de declarar busca limpa parcial', async () => {
  await assert.rejects(() => searchPublicPriorArt({ repository: 'acme/api', queries: ['one a', 'two b', 'three c'] }, {
    fetchImpl: async () => ({ ok: false, status: 403, headers: { get: () => '0' } }),
  }), /rate limit esgotado/);
});

test('Hacktivity recente filtra programa e framing e prova cobertura só ao cruzar a janela', async () => {
  const pages = [
    [
      { id: '1', programHandle: 'acme', title: 'authorization bypass missing tenant check', latestActivityAt: '2026-09-04T00:00:00Z', url: 'https://hackerone.com/reports/1' },
      { id: '2', programHandle: 'other', title: 'authorization bypass missing tenant check', latestActivityAt: '2026-09-03T00:00:00Z' },
    ],
    [{ id: '3', programHandle: 'acme', title: 'unrelated', latestActivityAt: '2026-08-20T00:00:00Z' }],
  ];
  const result = await searchRecentHacktivity({
    programHandle: 'acme', queries: ['authorization bypass missing check', 'tenant isolation absent', 'cross account access'],
    since: '2026-09-01T00:00:00Z',
  }, { getPage: async (page) => pages[page - 1] || [], now: () => new Date('2026-09-04T12:00:00Z'), pageSize: 2 });
  assert.equal(result.complete, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].reportId, '1');
});

test('busca integrada só declara método hacktivity quando a janela foi coberta', async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes('/search/')) return { ok: true, json: async () => ({ total_count: 0, items: [] }) };
    return { ok: true, json: async () => [] };
  };
  const result = await searchPublicPriorArt({
    repository: 'acme/api', programHandle: 'acme', queries: ['root cause one', 'source sink two', 'missing control three'],
  }, {
    fetchImpl: fakeFetch, now: () => new Date('2026-09-04T00:00:00Z'),
    hacktivitySearch: async () => ({ complete: true, since: '2026-08-28T00:00:00Z', pagesScanned: 2, scanned: 60, oldestActivityAt: '2026-08-27T00:00:00Z', results: [] }),
  });
  assert.ok(result.duplicateCheckDraft.methods.includes('hacktivity'));
  assert.deepEqual(result.manualSourcesStillRequired, []);
});
