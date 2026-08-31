import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubUrl, extractGithubCandidates, diffAgainstKnownTargets, prioritizeCandidates } from '../discover-targets.mjs';

test('parseGithubUrl extrai owner/repo de URL simples', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/vercel/flags'), { owner: 'vercel', repo: 'flags' });
});

test('parseGithubUrl aceita .git no final e barra final', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/cashapp/hermit.git'), { owner: 'cashapp', repo: 'hermit' });
  assert.deepEqual(parseGithubUrl('https://github.com/cashapp/hermit/'), { owner: 'cashapp', repo: 'hermit' });
});

test('parseGithubUrl retorna null pra URL que não é repo do GitHub', () => {
  assert.equal(parseGithubUrl('https://example.com/foo'), null);
  assert.equal(parseGithubUrl('https://github.com/vercel/flags/issues/1'), null);
  assert.equal(parseGithubUrl(''), null);
  assert.equal(parseGithubUrl(undefined), null);
});

test('extractGithubCandidates só inclui programa HackerOne com offers_bounties=true', () => {
  const h1 = [
    { name: 'Paga', offers_bounties: true, url: 'https://hackerone.com/paga', targets: { in_scope: [{ asset_identifier: 'https://github.com/a/b' }] } },
    { name: 'NaoPaga', offers_bounties: false, url: 'https://hackerone.com/naopaga', targets: { in_scope: [{ asset_identifier: 'https://github.com/c/d' }] } },
  ];
  const candidates = extractGithubCandidates(h1, []);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].owner, 'a');
});

test('extractGithubCandidates só inclui programa Bugcrowd com max_payout > 0', () => {
  const bc = [
    { name: 'Paga', max_payout: 5000, url: 'x', targets: { in_scope: [{ target: 'https://github.com/e/f' }] } },
    { name: 'SemPayout', max_payout: 0, url: 'y', targets: { in_scope: [{ target: 'https://github.com/g/h' }] } },
  ];
  const candidates = extractGithubCandidates([], bc);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].owner, 'e');
});

test('extractGithubCandidates deduplica repo que aparece em mais de um programa, mantendo os dois', () => {
  const h1 = [
    { name: 'P1', offers_bounties: true, url: 'x', targets: { in_scope: [{ asset_identifier: 'https://github.com/a/b' }] } },
    { name: 'P2', offers_bounties: true, url: 'y', targets: { in_scope: [{ asset_identifier: 'https://github.com/a/b' }] } },
  ];
  const candidates = extractGithubCandidates(h1, []);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].programs.length, 2);
});

test('diffAgainstKnownTargets remove repo já rastreado (case-insensitive)', () => {
  const candidates = [
    { owner: 'vercel', repo: 'flags', programs: [] },
    { owner: 'Vercel', repo: 'NEW-REPO', programs: [] },
  ];
  const known = [[{ owner: 'vercel', repo: 'flags' }]];
  const result = diffAgainstKnownTargets(candidates, known);
  assert.equal(result.length, 1);
  assert.equal(result[0].repo, 'NEW-REPO');
});

test('prioritizeCandidates coloca quem nunca foi visto antes de quem já foi', () => {
  const candidates = [
    { owner: 'a', repo: 'seen', programs: [] },
    { owner: 'b', repo: 'never', programs: [] },
  ];
  const seenMap = { 'a/seen': '2026-08-01T00:00:00.000Z' };
  const result = prioritizeCandidates(candidates, seenMap);
  assert.equal(result[0].repo, 'never');
  assert.equal(result[1].repo, 'seen');
});

test('prioritizeCandidates mantém a ordem original entre os nunca-vistos (não embaralha)', () => {
  const candidates = [
    { owner: 'x', repo: 'first', programs: [] },
    { owner: 'y', repo: 'second', programs: [] },
    { owner: 'z', repo: 'third', programs: [] },
  ];
  const result = prioritizeCandidates(candidates, {});
  assert.deepEqual(result.map((c) => c.repo), ['first', 'second', 'third']);
});

test('prioritizeCandidates ordena os já-vistos do mais antigo pro mais recente (rotação de refresh)', () => {
  const candidates = [
    { owner: 'a', repo: 'checked-recent', programs: [] },
    { owner: 'b', repo: 'checked-old', programs: [] },
  ];
  const seenMap = {
    'a/checked-recent': '2026-08-30T00:00:00.000Z',
    'b/checked-old': '2026-01-01T00:00:00.000Z',
  };
  const result = prioritizeCandidates(candidates, seenMap);
  assert.deepEqual(result.map((c) => c.repo), ['checked-old', 'checked-recent']);
});

test('prioritizeCandidates é case-insensitive na chave owner/repo', () => {
  const candidates = [{ owner: 'Vercel', repo: 'Flags', programs: [] }];
  const seenMap = { 'vercel/flags': '2026-01-01T00:00:00.000Z' };
  const result = prioritizeCandidates(candidates, seenMap);
  // Já visto (mesmo com case diferente) -- com só 1 candidato "nunca visto"
  // vazio, ele cai na lista alreadySeen, não deveria estourar nem duplicar.
  assert.equal(result.length, 1);
});
