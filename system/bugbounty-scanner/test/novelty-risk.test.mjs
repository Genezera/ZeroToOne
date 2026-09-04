import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessNoveltyRisk, duplicateCheckGate, verifiedRegressionGate, verifiedLongstandingExposureGate, MIN_LONGSTANDING_EXPOSURE_DAYS } from '../novelty-risk.mjs';

const NOW = new Date('2026-09-03T18:00:00Z').getTime();
const INTRODUCED = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PARENT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PROOF = {
  kind: 'verified_regression', introducedCommit: INTRODUCED, parentCommit: PARENT,
  introducedAt: '2026-09-01T12:00:00Z',
  baseline: { ref: PARENT, result: 'not_vulnerable', command: 'node poc.mjs', observedOutcome: 'controle recusado' },
  candidate: { ref: INTRODUCED, result: 'vulnerable', command: 'node poc.mjs', observedOutcome: 'exploit reproduzido' },
};
const CLEAN = {
  methods: ['github_issues', 'github_advisories', 'hacktivity'],
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
  assert.match(verifiedRegressionGate({ ...PROOF, introducedAt: '2026-08-26T00:00:00Z' }, { now: NOW }).reason, /máximo 7/);
});

test('duplicateCheck null de dado legado bloqueia com motivo em vez de lançar', () => {
  const result = duplicateCheckGate(null, { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.reason, /sem métodos/);
});

// Achado real, 04/09/2026: verifiedRegressionGate só aceita commit
// introdutor com <=7 dias -- não cobre código que nunca foi seguro (design
// original, não regressão). LONGSTANDING_PROOF é o caminho alternativo:
// mesmo rigor de verificação real (git), limiar temporal oposto.
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

test('exposição de longa data verificada é um segundo caminho de prova, não substitui os outros requisitos', () => {
  assert.equal(duplicateCheckGate(LONGSTANDING_CLEAN, { now: NOW }).ok, true);
  // continua exigindo os mesmos requisitos compartilhados (cobertura, consultas, frescor, risco, zero duplicatas prévias)
  assert.equal(duplicateCheckGate({ ...LONGSTANDING_CLEAN, methods: ['github_issues'] }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...LONGSTANDING_CLEAN, riskScore: 60 }, { now: NOW }).ok, false);
  assert.equal(duplicateCheckGate({ ...LONGSTANDING_CLEAN, signals: { priorDuplicateSubmissions: 1 } }, { now: NOW }).ok, false);
  // noveltyStatus continua tendo que ser um dos dois valores reconhecidos
  assert.equal(duplicateCheckGate({ ...LONGSTANDING_CLEAN, noveltyStatus: 'private_unknown' }, { now: NOW }).ok, false);
});

test('verifiedLongstandingExposureGate exige idade mínima, ancestralidade real e proof consistente', () => {
  assert.equal(verifiedLongstandingExposureGate(LONGSTANDING_PROOF, { now: NOW }).ok, true);
  assert.match(
    verifiedLongstandingExposureGate({ ...LONGSTANDING_PROOF, introducedAt: '2026-08-01T00:00:00Z', ageDays: 33 }, { now: NOW }).reason,
    new RegExp(`mínimo ${MIN_LONGSTANDING_EXPOSURE_DAYS}`),
  );
  assert.equal(
    verifiedLongstandingExposureGate({ ...LONGSTANDING_PROOF, stillPresentOnDefaultBranch: false }, { now: NOW }).ok,
    false,
  );
  assert.equal(
    verifiedLongstandingExposureGate({ ...LONGSTANDING_PROOF, ageDays: 1 }, { now: NOW }).ok,
    false,
  ); // ageDays não bate com introducedAt real -- não confia em número solto do chamador
  assert.equal(
    verifiedLongstandingExposureGate({ ...LONGSTANDING_PROOF, kind: 'verified_regression' }, { now: NOW }).ok,
    false,
  );
  assert.equal(verifiedLongstandingExposureGate(null, { now: NOW }).ok, false);
});
