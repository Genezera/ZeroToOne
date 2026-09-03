import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessNoveltyRisk, duplicateCheckGate } from '../novelty-risk.mjs';

const NOW = new Date('2026-09-03T18:00:00Z').getTime();
const CLEAN = {
  methods: ['github_issues', 'github_advisories', 'hacktivity'],
  queries: ['function root cause', 'source sink missing guard'],
  foundExisting: false, noveltyStatus: 'private_unknown', riskScore: 30,
  ts: '2026-09-03T17:00:00Z',
};

test('match público domina qualquer outro sinal e bloqueia', () => {
  const risk = assessNoveltyRisk({ foundPublicMatch: true, regressionAfterVerifiedFix: true });
  assert.equal(risk.riskScore, 100);
  assert.equal(risk.noveltyStatus, 'public_match');
  assert.equal(duplicateCheckGate({ ...CLEAN, ...risk, foundExisting: true }, { now: NOW }).ok, false);
});

test('código novo/regressão reduz risco; código antigo, óbvio e alvo queimado aumenta', () => {
  const novel = assessNoveltyRisk({ codeAgeDays: 20, programAgeDays: 50, regressionAfterVerifiedFix: true });
  const crowded = assessNoveltyRisk({ codeAgeDays: 2000, programAgeDays: 1500, repoStars: 20000, priorDuplicateSubmissions: 3, obviousness: 'high' });
  assert.ok(novel.riskScore < crowded.riskScore);
  assert.equal(novel.noveltyStatus, 'regression');
  assert.equal(crowded.riskLevel, 'high');
});

test('histórico global só pesa depois de amostra mínima', () => {
  const tooSmall = assessNoveltyRisk({ portfolioSubmissionCount: 2, portfolioDuplicateRate: 1 });
  const learned = assessNoveltyRisk({ portfolioSubmissionCount: 6, portfolioDuplicateRate: 1 });
  assert.equal(tooSmall.riskScore, 20);
  assert.equal(learned.riskScore, 40);
  assert.match(learned.reasons.join(' '), /100% de duplicates/);
});

test('gate exige cobertura pública plural, duas consultas e frescor', () => {
  assert.equal(duplicateCheckGate(CLEAN, { now: NOW }).ok, true);
  assert.equal(duplicateCheckGate({ ...CLEAN, methods: ['github_issues'] }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...CLEAN, queries: ['uma só'] }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...CLEAN, ts: '2026-08-01T00:00:00Z' }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...CLEAN, riskScore: 60 }, { now: NOW }).ok, false);
});
