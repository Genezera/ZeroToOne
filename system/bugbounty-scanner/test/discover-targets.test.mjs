import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubUrl, extractGithubCandidates, diffAgainstKnownTargets, prioritizeCandidates, distinctHackerOneHandles, attachProgramAge, mapWithConcurrency, partitionCandidatesByProgramPolicy, buildAuthorizedMonitorCandidates } from '../discover-targets.mjs';

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

test('partitionCandidatesByProgramPolicy bloqueia antes do metadado programa ausente, proibido ou revisão expirada', () => {
  const candidates = [
    { owner: 'a', repo: 'ok', programs: [{ program: 'Permitido' }] },
    { owner: 'b', repo: 'ausente', programs: [{ program: 'Desconhecido' }] },
    { owner: 'c', repo: 'proibido', programs: [{ program: 'Bloqueado' }] },
    { owner: 'd', repo: 'expirado', programs: [{ program: 'Expirado' }] },
  ];
  const policy = {
    Permitido: { roeReviewed: true, reviewedAt: '2026-09-04', nextReviewAt: '2099-12-31' },
    Bloqueado: { blocked: true, reason: 'scanner não permitido' },
    Expirado: { roeReviewed: true, reviewedAt: '2026-01-01', nextReviewAt: '2026-02-01' },
  };
  const result = partitionCandidatesByProgramPolicy(candidates, policy);
  assert.deepEqual(result.authorized.map((item) => item.repo), ['ok']);
  assert.deepEqual(result.blocked.map((item) => item.repo), ['ausente', 'proibido', 'expirado']);
  assert.match(result.blocked[0].policyBlocks[0].reason, /sem decisão explícita/);
  assert.match(result.blocked[2].policyBlocks[0].reason, /expirou/);
});

test('partitionCandidatesByProgramPolicy é conservador para repo compartilhado com programa bloqueado', () => {
  const result = partitionCandidatesByProgramPolicy([{
    owner: 'shared', repo: 'repo', programs: [{ program: 'Permitido' }, { program: 'Bloqueado' }],
  }], {
    Permitido: { roeReviewed: true, reviewedAt: '2026-09-04', nextReviewAt: '2099-12-31' },
    Bloqueado: { aiResearchBanned: true, reason: 'IA proibida' },
  });
  assert.equal(result.authorized.length, 0);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].policyBlocks[0].program, 'Bloqueado');
});

test('buildAuthorizedMonitorCandidates preserva todos os autorizados sem metadado ou código', () => {
  const result = buildAuthorizedMonitorCandidates([
    { owner: 'Zed', repo: 'Large', language: 'Unknown', programs: [{ program: 'P2', platform: 'HackerOne', handle: 'p2', url: 'https://hackerone.com/p2' }] },
    { owner: 'acme', repo: 'api', programs: [{ program: 'P1', platform: 'Bugcrowd', url: 'https://bugcrowd.com/p1', maxPayoutUsd: 5000 }] },
  ]);
  assert.deepEqual(result.map((item) => `${item.owner}/${item.repo}`), ['acme/api', 'Zed/Large']);
  assert.equal(result[0].language, undefined);
  assert.equal(result[0].programs[0].program, 'P1');
  assert.equal(result[1].programs[0].handle, 'p2');
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

test('prioritizeCandidates, entre os nunca-vistos, coloca programa mais novo (newestProgramStartedAt mais recente) primeiro', () => {
  const candidates = [
    { owner: 'a', repo: 'old-program', programs: [], newestProgramStartedAt: '2020-01-01T00:00:00Z' },
    { owner: 'b', repo: 'new-program', programs: [], newestProgramStartedAt: '2026-06-01T00:00:00Z' },
    { owner: 'c', repo: 'no-age-data', programs: [] },
  ];
  const result = prioritizeCandidates(candidates, {});
  // programa mais novo primeiro, depois o mais antigo, e quem não tem
  // dado de idade nenhuma vai por último dentro do grupo "nunca visto"
  // (desconhecido não deveria furar fila na frente de quem sabemos ser novo).
  assert.deepEqual(result.map((c) => c.repo), ['new-program', 'old-program', 'no-age-data']);
});

test('distinctHackerOneHandles extrai handles únicos, ignora Bugcrowd (sem handle consultável)', () => {
  const candidates = [
    { owner: 'a', repo: 'x', programs: [{ platform: 'HackerOne', handle: 'circle-bbp' }, { platform: 'HackerOne', handle: 'vercel-open-source' }] },
    { owner: 'b', repo: 'y', programs: [{ platform: 'HackerOne', handle: 'circle-bbp' }] },
    { owner: 'c', repo: 'z', programs: [{ platform: 'Bugcrowd', handle: undefined }] },
  ];
  const handles = distinctHackerOneHandles(candidates);
  assert.deepEqual([...handles].sort(), ['circle-bbp', 'vercel-open-source']);
});

test('attachProgramAge anexa a data MAIS RECENTE entre os programas HackerOne do candidato', () => {
  const candidates = [
    {
      owner: 'a', repo: 'multi-program',
      programs: [
        { platform: 'HackerOne', handle: 'old-one' },
        { platform: 'HackerOne', handle: 'new-one' },
      ],
    },
    { owner: 'b', repo: 'no-match', programs: [{ platform: 'HackerOne', handle: 'unknown-handle' }] },
  ];
  const ageByHandle = { 'old-one': '2020-01-01T00:00:00Z', 'new-one': '2026-06-01T00:00:00Z' };
  const result = attachProgramAge(candidates, ageByHandle);
  assert.equal(result[0].newestProgramStartedAt, '2026-06-01T00:00:00Z');
  assert.equal(result[1].newestProgramStartedAt, undefined);
});

test('mapWithConcurrency preserva a ordem dos resultados mesmo com itens terminando fora de ordem', async () => {
  const items = [30, 10, 20];
  const result = await mapWithConcurrency(items, 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    return ms;
  });
  assert.deepEqual(result, [30, 10, 20]);
});

test('mapWithConcurrency nunca roda mais que "concurrency" chamadas ao mesmo tempo', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 2, async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
  });
  assert.ok(maxInFlight <= 2, `esperava no máximo 2 em voo, viu ${maxInFlight}`);
});

test('mapWithConcurrency processa todo mundo mesmo quando concurrency > items.length', async () => {
  const result = await mapWithConcurrency([1, 2], 10, async (x) => x * 2);
  assert.deepEqual(result, [2, 4]);
});
