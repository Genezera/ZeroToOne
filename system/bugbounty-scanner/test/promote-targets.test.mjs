import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapGithubLanguage, pickBestProgram, scoreCandidate, classifyCandidate, promoteTargets, renderAutoPromotedModule, MAX_REPO_SIZE_KB } from '../promote-targets.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const NOW = new Date('2026-08-31T00:00:00Z').getTime();

function candidate(overrides = {}) {
  return {
    owner: 'foo',
    repo: 'bar',
    programs: [{ program: 'Foo Program', platform: 'HackerOne', url: 'https://hackerone.com/foo', handle: 'foo' }],
    language: 'Go',
    sizeKb: 500,
    pushedAt: null,
    stars: null,
    ...overrides,
  };
}

test('mapGithubLanguage mapeia as 5 linguagens suportadas e devolve null pro resto', () => {
  assert.equal(mapGithubLanguage('JavaScript'), 'js');
  assert.equal(mapGithubLanguage('TypeScript'), 'js');
  assert.equal(mapGithubLanguage('Go'), 'go');
  assert.equal(mapGithubLanguage('Kotlin'), 'jvm');
  assert.equal(mapGithubLanguage('Java'), 'jvm');
  assert.equal(mapGithubLanguage('Swift'), 'swift');
  assert.equal(mapGithubLanguage('Objective-C'), 'swift');
  assert.equal(mapGithubLanguage('Solidity'), 'solidity');
  assert.equal(mapGithubLanguage('Python'), null);
  assert.equal(mapGithubLanguage('Rust'), null);
  assert.equal(mapGithubLanguage(null), null);
});

test('pickBestProgram escolhe o de maior maxPayoutUsd conhecido', () => {
  const programs = [
    { program: 'A', maxPayoutUsd: 1000 },
    { program: 'B', maxPayoutUsd: 25000 },
    { program: 'C', maxPayoutUsd: 5000 },
  ];
  assert.equal(pickBestProgram(programs).program, 'B');
});

test('pickBestProgram usa o primeiro quando nenhum tem maxPayoutUsd', () => {
  const programs = [{ program: 'A' }, { program: 'B' }];
  assert.equal(pickBestProgram(programs).program, 'A');
});

test('pickBestProgram devolve null pra lista vazia/ausente', () => {
  assert.equal(pickBestProgram([]), null);
  assert.equal(pickBestProgram(undefined), null);
});

test('scoreCandidate: nenhum sinal presente dá score 0 e reasons vazio', () => {
  const r = scoreCandidate(candidate({ programs: [{ program: 'X' }] }), NOW);
  assert.equal(r.score, 0);
  assert.deepEqual(r.reasons, []);
});

test('scoreCandidate: payout maior aumenta score, capado em US$100.000', () => {
  const low = scoreCandidate(candidate({ programs: [{ program: 'X', maxPayoutUsd: 5000 }] }), NOW);
  const high = scoreCandidate(candidate({ programs: [{ program: 'X', maxPayoutUsd: 50000 }] }), NOW);
  const capped = scoreCandidate(candidate({ programs: [{ program: 'X', maxPayoutUsd: 1000000 }] }), NOW);
  assert.ok(high.score > low.score);
  assert.equal(capped.score, 100); // 100000/1000, nunca mais que isso mesmo com payout de $1M
  assert.match(low.reasons[0], /teto de recompensa/);
});

test('scoreCandidate: programa lançado recentemente pontua mais que um lançado há mais tempo, e nada além de 180 dias', () => {
  const recent = scoreCandidate(candidate({ newestProgramStartedAt: '2026-08-20T00:00:00Z' }), NOW); // 11 dias atrás
  const older = scoreCandidate(candidate({ newestProgramStartedAt: '2026-06-01T00:00:00Z' }), NOW); // ~91 dias atrás
  const tooOld = scoreCandidate(candidate({ newestProgramStartedAt: '2025-01-01T00:00:00Z' }), NOW); // bem mais que 180 dias
  assert.ok(recent.score > older.score);
  assert.ok(older.score > 0);
  assert.equal(tooOld.score, 0);
});

test('scoreCandidate: estrelas só contam a partir de 100, atividade recente só dentro de 90 dias', () => {
  const fewStars = scoreCandidate(candidate({ stars: 5 }), NOW);
  const manyStars = scoreCandidate(candidate({ stars: 500 }), NOW);
  assert.equal(fewStars.score, 0);
  assert.ok(manyStars.score > 0);

  const stalePush = scoreCandidate(candidate({ pushedAt: '2025-01-01T00:00:00Z' }), NOW);
  const freshPush = scoreCandidate(candidate({ pushedAt: '2026-08-25T00:00:00Z' }), NOW);
  assert.equal(stalePush.score, 0);
  assert.ok(freshPush.score > 0);
});

test('classifyCandidate: programa bloqueado nunca é elegível, mesmo com linguagem suportada e tamanho ok', () => {
  const c = candidate({ programs: [{ program: 'Bloqueado Inc' }] });
  const policy = { 'Bloqueado Inc': { aiResearchBanned: true, reason: 'motivo X' } };
  const r = classifyCandidate(c, { programPolicy: policy, now: NOW });
  assert.equal(r.verdict, 'blocked_program');
  assert.equal(r.reason, 'motivo X');
});

test('classifyCandidate: linguagem não suportada é excluída explicitamente, não promovida silenciosamente', () => {
  const r = classifyCandidate(candidate({ language: 'Python' }), { now: NOW });
  assert.equal(r.verdict, 'unsupported_language');
  assert.equal(r.githubLanguage, 'Python');
});

test('classifyCandidate: repo maior que o teto vira revisão manual, não descarte nem promoção às cegas', () => {
  const r = classifyCandidate(candidate({ sizeKb: MAX_REPO_SIZE_KB + 1 }), { now: NOW });
  assert.equal(r.verdict, 'too_large');
});

test('classifyCandidate: erro de metadado (fetch falhou) vira categoria própria, não "linguagem desconhecida"', () => {
  const r = classifyCandidate(candidate({ language: null, metadataError: 'HTTP 404' }), { now: NOW });
  assert.equal(r.verdict, 'metadata_fetch_failed');
});

test('classifyCandidate: candidato limpo é elegível e carrega score+reasons+bestProgram', () => {
  const r = classifyCandidate(candidate({ programs: [{ program: 'X', maxPayoutUsd: 5000 }], stars: 500 }), { now: NOW });
  assert.equal(r.verdict, 'eligible');
  assert.equal(r.language, 'go');
  assert.ok(r.score > 0);
  assert.ok(r.reasons.length > 0);
});

test('promoteTargets: promove os de maior score primeiro, respeitando o teto por rodada', () => {
  const candidates = [
    candidate({ owner: 'low', repo: 'a', programs: [{ program: 'X', maxPayoutUsd: 1000 }] }),
    candidate({ owner: 'high', repo: 'b', programs: [{ program: 'X', maxPayoutUsd: 50000 }] }),
    candidate({ owner: 'mid', repo: 'c', programs: [{ program: 'X', maxPayoutUsd: 10000 }] }),
  ];
  const result = promoteTargets(candidates, { maxPromotionsPerRun: 2, now: NOW });
  assert.equal(result.promoted.length, 2);
  assert.deepEqual(result.promoted.map((p) => p.repo), ['b', 'c']); // high, mid — não low
  assert.deepEqual(result.skipped.deferredToNextRun.map((r) => r.repo), ['a']); // low ainda elegível, só não coube no orçamento desta rodada
  assert.equal(result.skipped.atCap, false); // motivo foi o orçamento por rodada, não o teto total
});

test('promoteTargets: nunca promove o mesmo repo duas vezes entre rodadas (existingPromotedKeys)', () => {
  const candidates = [candidate({ owner: 'foo', repo: 'bar' })];
  const result = promoteTargets(candidates, { existingPromotedKeys: new Set(['foo/bar']), now: NOW });
  assert.equal(result.promoted.length, 0);
  assert.equal(result.skipped.alreadyPromoted, 1);
});

test('promoteTargets: respeita o teto TOTAL de alvos auto-promovidos, não só o teto por rodada', () => {
  const candidates = [candidate({ owner: 'a', repo: '1', stars: 500 }), candidate({ owner: 'b', repo: '2', stars: 500 })];
  const result = promoteTargets(candidates, { maxPromotionsPerRun: 5, maxTotalPromoted: 10, currentTotalPromoted: 9, now: NOW });
  assert.equal(result.promoted.length, 1); // só 1 vaga sobrando, mesmo com orçamento por rodada de 5
});

test('promoteTargets: teto total já esgotado reporta atCap=true em vez de promover além do limite', () => {
  const candidates = [candidate({ stars: 500 })];
  const result = promoteTargets(candidates, { maxTotalPromoted: 10, currentTotalPromoted: 10, now: NOW });
  assert.equal(result.promoted.length, 0);
  assert.equal(result.skipped.atCap, true);
});

test('promoteTargets: candidato sem NENHUM sinal positivo (score 0) nunca é promovido só pra preencher a rodada — bug real pego na primeira rodada ao vivo (ExodusOSS/crypto, ExodusOSS/hydra)', () => {
  const candidates = [candidate({ owner: 'sem-sinal', repo: 'x' })]; // sem payout, sem estrelas, sem push recente, sem idade de programa
  const result = promoteTargets(candidates, { now: NOW });
  assert.equal(result.promoted.length, 0);
  assert.deepEqual(result.skipped.insufficientSignal, [{ owner: 'sem-sinal', repo: 'x', score: 0 }]);
});

test('promoteTargets: nenhum candidato desaparece em silêncio — todo mundo aparece em promoted OU em algum balde de skipped', () => {
  const candidates = [
    candidate({ owner: 'a', repo: '1', programs: [{ program: 'Bloqueado' }] }),
    candidate({ owner: 'b', repo: '2', language: 'Python' }),
    candidate({ owner: 'c', repo: '3', sizeKb: MAX_REPO_SIZE_KB + 1 }),
    candidate({ owner: 'd', repo: '4', language: null, metadataError: 'timeout' }),
    candidate({ owner: 'e', repo: '5', stars: 500 }), // único com sinal real — vira o "promoted" desta lista
    candidate({ owner: 'f', repo: '6' }), // sem sinal nenhum — vira insufficientSignal
  ];
  const policy = { Bloqueado: { aiResearchBanned: true, reason: 'x' } };
  const result = promoteTargets(candidates, { programPolicy: policy, now: NOW });
  const accountedFor =
    result.promoted.length +
    result.skipped.blockedProgram.length +
    result.skipped.unsupportedLanguage.length +
    result.skipped.tooLarge.length +
    result.skipped.metadataFetchFailed.length +
    result.skipped.insufficientSignal.length +
    result.skipped.deferredToNextRun.length;
  assert.equal(accountedFor, candidates.length);
});

test('classifyCandidate: score exatamente 0 (nenhum sinal) vira insufficient_signal, não eligible', () => {
  const r = classifyCandidate(candidate(), { now: NOW });
  assert.equal(r.verdict, 'insufficient_signal');
  assert.equal(r.score, 0);
});

test('promoteTargets: entrada promovida tem o formato exato que scan-runner.mjs espera de um target', () => {
  const result = promoteTargets([candidate({ programs: [{ program: 'X', platform: 'HackerOne', maxPayoutUsd: 5000 }], defaultBranch: 'develop' })], { now: NOW });
  const t = result.promoted[0];
  assert.equal(t.program, 'X');
  assert.equal(t.platform, 'HackerOne');
  assert.equal(t.owner, 'foo');
  assert.equal(t.repo, 'bar');
  assert.equal(t.branch, 'develop');
  assert.equal(t.maxBountyUsd, 5000);
  assert.deepEqual(t.pathPrefixes, []);
  assert.equal(t.language, 'go');
  assert.ok(typeof t.score === 'number');
  assert.ok(Array.isArray(t.reasons));
  assert.ok(t.promotedAt);
});

test('promoteTargets: sem defaultBranch, usa "main" como fallback', () => {
  const result = promoteTargets([candidate({ defaultBranch: undefined, stars: 500 })], { now: NOW });
  assert.equal(result.promoted[0].branch, 'main');
});

test('renderAutoPromotedModule produz um módulo ES válido e importável, vazio ou com dados', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'auto-promoted-test-'));

  const emptyPath = path.join(dir, 'empty.mjs');
  writeFileSync(emptyPath, renderAutoPromotedModule([]), 'utf8');
  const emptyMod = await import(`file://${emptyPath.replace(/\\/g, '/')}`);
  assert.deepEqual(emptyMod.AUTO_PROMOTED_TARGETS, []);

  const filledPath = path.join(dir, 'filled.mjs');
  const entries = [{ program: 'X', platform: 'HackerOne', owner: 'foo', repo: 'bar', branch: 'main', maxBountyUsd: 5000, pathPrefixes: [], language: 'go', score: 42.5, reasons: ['motivo A'], promotedAt: '2026-08-31T00:00:00.000Z' }];
  writeFileSync(filledPath, renderAutoPromotedModule(entries), 'utf8');
  const filledMod = await import(`file://${filledPath.replace(/\\/g, '/')}`);
  assert.deepEqual(filledMod.AUTO_PROMOTED_TARGETS, entries);
});
