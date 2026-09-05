import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priorArtCoverageGate } from '../prior-art-coverage.mjs';
import { advisoryMatchesQueries, listAllRepositoryAdvisories, searchAllGithubResults, searchPublicPriorArt, searchRecentHacktivity, validatePriorArtConfig } from '../prior-art-search.mjs';

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
    if (String(url).includes('/search/issues')) return { ok: true, json: async () => ({ total_count: 1, incomplete_results: false, items: [{ number: 7, title: 'same root cause', state: 'open', html_url: 'https://github.com/acme/api/issues/7' }] }) };
    if (String(url).includes('/search/commits')) return { ok: true, json: async () => ({ total_count: 0, incomplete_results: false, items: [] }) };
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
  assert.equal(priorArtCoverageGate(result.duplicateCheckDraft, { repository: 'acme/api' }).ok, true);
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
    if (String(url).includes('/search/')) return { ok: true, json: async () => ({ total_count: 0, incomplete_results: false, items: [] }) };
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

const issue = (number) => ({ number, html_url: `https://github.com/acme/api/issues/${number}`, title: 'possible duplicate' });
const response = (data, next = null) => ({ ok: true, headers: { get: (name) => name === 'link' && next ? `<${next}>; rel="next"` : null }, json: async () => data });

test('busca inclui duplicata na página seguinte e registra cobertura de cada página', async () => {
  for (const endpoint of ['issues', 'commits']) {
    const items = Array.from({ length: 101 }, (_, i) => endpoint === 'issues' ? issue(i + 1)
      : { sha: String(i + 1).padStart(40, '0'), html_url: `https://github.com/acme/api/commit/${i + 1}` });
    const seen = [];
    const result = await searchAllGithubResults(endpoint, 'acme/api', 'missing ownership check', {
      fetchImpl: async (url, opts) => {
        assert.equal(opts.redirect, 'error');
        seen.push(url);
        const page = Number(new URL(url).searchParams.get('page'));
        return response({ total_count: 101, incomplete_results: false, items: items.slice((page - 1) * 100, page * 100) });
      },
    });
    assert.equal(result.items.length, 101);
    assert.deepEqual(result.items.at(-1), items[100]);
    assert.equal(result.evidence.pagesScanned, 2);
    assert.equal(result.evidence.complete, true);
    assert.deepEqual(result.evidence.apiUrls, seen);
    assert.equal(result.evidence.retrievedCount, result.evidence.totalCount);
  }
});

test('HTTP 200 parcial, total acima do teto e resposta inválida nunca viram busca limpa', async () => {
  for (const data of [
    { total_count: 0, incomplete_results: true, items: [] },
    { total_count: 1001, incomplete_results: false, items: [] },
    { total_count: 1, incomplete_results: false, items: [] },
    { total_count: 0, items: [] },
  ]) {
    await assert.rejects(() => searchAllGithubResults('issues', 'acme/api', 'query', {
      fetchImpl: async () => response(data),
    }), /incomplete_results|limite|cobertura|inválida/);
  }
});

test('página repetida, total mutável e falha na segunda página abortam a pesquisa', async () => {
  for (const mode of ['repeated', 'changed', 'error']) {
    await assert.rejects(() => searchAllGithubResults('issues', 'acme/api', 'query', {
      pageSize: 1,
      fetchImpl: async (url) => {
        if (new URL(url).searchParams.get('page') === '1') return response({ total_count: 2, incomplete_results: false, items: [issue(1)] });
        if (mode === 'error') return { ok: false, status: 429 };
        return response({ total_count: mode === 'changed' ? 3 : 2, incomplete_results: false, items: [issue(1)] });
      },
    }), /repetido|mudou|HTTP 429/);
  }
});

test('advisories seguem cursor Link e encontram correspondência além da primeira página', async () => {
  const next = 'https://api.github.com/repos/acme/api/security-advisories?state=published&per_page=100&after=cursor';
  const seen = [];
  const result = await listAllRepositoryAdvisories('acme/api', {
    fetchImpl: async (url) => {
      seen.push(url);
      return url === next
        ? response([{ ghsa_id: 'GHSA-second', state: 'published', summary: 'missing tenant ownership' }])
        : response([{ ghsa_id: 'GHSA-first', state: 'published', summary: 'unrelated' }], next);
    },
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.evidence.pagesScanned, 2);
  assert.deepEqual(result.evidence.apiUrls, seen);
  assert.equal(advisoryMatchesQueries(result.items[1], ['missing tenant ownership']), true);
});

test('advisories recusam cursor externo, loop, limite e falha na página seguinte', async () => {
  const first = 'https://api.github.com/repos/acme/api/security-advisories?state=published&per_page=100';
  for (const mode of ['foreign', 'loop', 'limit', 'error']) {
    let calls = 0;
    await assert.rejects(() => listAllRepositoryAdvisories('acme/api', {
      maxPages: mode === 'limit' ? 1 : 10,
      fetchImpl: async () => {
        calls += 1;
        if (calls > 1) return { ok: false, status: 503 };
        return response([], mode === 'foreign' ? 'https://example.invalid/steal' : mode === 'loop' ? first : `${first}&after=cursor`);
      },
    }), /fora do endpoint|repetida|limite|HTTP 503/);
    assert.equal(calls, mode === 'error' ? 2 : 1, 'não faz request externo nem segue loop');
  }
});
