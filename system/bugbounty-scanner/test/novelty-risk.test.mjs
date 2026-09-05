import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessNoveltyRisk, duplicateCheckGate, verifiedRegressionGate } from '../novelty-risk.mjs';

const NOW = new Date('2026-09-03T18:00:00Z').getTime();
const INTRODUCED = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PARENT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PROOF = {
  kind: 'verified_regression', introducedCommit: INTRODUCED, parentCommit: PARENT,
  introducedAt: '2026-09-02T12:00:00Z',
  baseline: { ref: PARENT, result: 'not_vulnerable', command: 'node poc.mjs', observedOutcome: 'controle recusado' },
  candidate: { ref: INTRODUCED, result: 'vulnerable', command: 'node poc.mjs', observedOutcome: 'exploit reproduzido' },
};
const CLEAN = {
  methods: ['github_issues', 'github_commits', 'github_advisories', 'hacktivity'],
  queries: ['function root cause', 'source sink missing guard', 'commit regression vulnerability'],
  foundExisting: false, noveltyStatus: 'regression', riskScore: 20,
  signals: { priorDuplicateSubmissions: 0 }, noveltyProof: PROOF,
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

test('gate estrito exige cobertura pública plural, três consultas, frescor e regressão comprovada', () => {
  assert.equal(duplicateCheckGate(CLEAN, { now: NOW }).ok, true);
  assert.equal(duplicateCheckGate({ ...CLEAN, methods: ['github_issues'] }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...CLEAN, queries: ['uma só', 'duas'] }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...CLEAN, ts: '2026-08-01T00:00:00Z' }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...CLEAN, riskScore: 60 }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...CLEAN, noveltyStatus: 'private_unknown' }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...CLEAN, noveltyProof: null }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...CLEAN, signals: { priorDuplicateSubmissions: 1 } }, { now: NOW }).ok, false);
});

test('prova de regressão compara o parent seguro com o commit vulnerável usando o mesmo comando', () => {
  assert.equal(verifiedRegressionGate(PROOF, { now: NOW }).ok, true);
  assert.equal(verifiedRegressionGate({ ...PROOF, introducedAt: '2026-01-01T00:00:00Z' }, { now: NOW }).ok, false);
  assert.equal(verifiedRegressionGate({ ...PROOF, baseline: { ...PROOF.baseline, result: 'vulnerable' } }, { now: NOW }).ok, false);
  assert.equal(verifiedRegressionGate({ ...PROOF, candidate: { ...PROOF.candidate, command: 'node outro.mjs' } }, { now: NOW }).ok, false);
  assert.match(verifiedRegressionGate({ ...PROOF, introducedAt: '2026-08-26T00:00:00Z' }, { now: NOW }).reason, /máximo 48 horas/);
});

test('duplicateCheck null de dado legado bloqueia com motivo em vez de lançar', () => {
  const result = duplicateCheckGate(null, { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.reason, /sem métodos/);
});

// Evidência de longa exposição continua útil para calcular idade/risco,
// mas não é prova de novidade: reports privados permanecem invisíveis e
// código antigo teve mais oportunidades de já ser reportado.
const LONGSTANDING_PROOF = {
  kind: 'verified_longstanding_exposure',
  repositoryUrl: 'https://github.com/kubernetes/publishing-bot.git',
  introducedCommit: INTRODUCED,
  introducedAt: '2018-02-13T11:12:50Z',
  ageDays: Math.floor((NOW - Date.parse('2018-02-13T11:12:50Z')) / 86400000),
  stillPresentOnDefaultBranch: true,
  verifiedAt: '2026-09-03T17:55:00Z',
};
const LONGSTANDING_CLEAN = {
  ...CLEAN, noveltyStatus: 'longstanding_exposure', noveltyProof: LONGSTANDING_PROOF,
};

test('exposição pública antiga nunca substitui regressão recente como prova de novidade', () => {
  const result = duplicateCheckGate(LONGSTANDING_CLEAN, { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exposição antiga aumenta o risco/);
});
