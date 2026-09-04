import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisoryMatchesQueries, searchPublicPriorArt, validatePriorArtConfig } from '../prior-art-search.mjs';

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
