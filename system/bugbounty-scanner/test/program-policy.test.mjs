import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadProgramPolicy, loadProgramPolicyStrict, getBlockReason, isProgramBanned, filterBannedTargets, getReviewValidityReason } from '../program-policy.mjs';

const CURRENT_REVIEW = {
  roeReviewed: true, reviewedAt: '2026-09-04', nextReviewAt: '2099-12-31',
  policyUrl: 'https://example.test/program', reviewMethod: 'fixture_test',
};

test('loadProgramPolicy devolve {} quando o arquivo não existe, nunca lança', () => {
  const missing = path.join(tmpdir(), 'nao-existe-de-verdade-' + Date.now() + '.json');
  assert.deepEqual(loadProgramPolicy(missing), {});
});

test('loadProgramPolicy devolve {} pra JSON inválido, nunca lança', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'program-policy-test-'));
  const p = path.join(dir, 'policy.json');
  writeFileSync(p, '{ isto nao é json', 'utf8');
  assert.deepEqual(loadProgramPolicy(p), {});
});

test('loadProgramPolicyStrict falha fechado quando arquivo não existe ou está inválido', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'program-policy-strict-'));
  const missing = path.join(dir, 'missing.json');
  assert.throws(() => loadProgramPolicyStrict(missing), /obrigatória ausente/);
  const invalid = path.join(dir, 'invalid.json');
  writeFileSync(invalid, '{ isto nao é json', 'utf8');
  assert.throws(() => loadProgramPolicyStrict(invalid), /policy inválida/);
  const malformed = path.join(dir, 'malformed.json');
  writeFileSync(malformed, JSON.stringify({ Acme: { roeReviewed: 'sim' } }), 'utf8');
  assert.throws(() => loadProgramPolicyStrict(malformed), /roeReviewed precisa ser boolean/);
  const contradictory = path.join(dir, 'contradictory.json');
  writeFileSync(contradictory, JSON.stringify({ Acme: { ...CURRENT_REVIEW, blocked: true } }), 'utf8');
  assert.throws(() => loadProgramPolicyStrict(contradictory), /contraditória/);
  const staleShape = path.join(dir, 'missing-review-date.json');
  writeFileSync(staleShape, JSON.stringify({ Acme: { roeReviewed: true } }), 'utf8');
  assert.throws(() => loadProgramPolicyStrict(staleShape), /reviewedAt precisa ser data ISO/);
  const invalidCalendarDate = path.join(dir, 'invalid-calendar-date.json');
  writeFileSync(invalidCalendarDate, JSON.stringify({ Acme: { ...CURRENT_REVIEW, nextReviewAt: '2099-02-31' } }), 'utf8');
  assert.throws(() => loadProgramPolicyStrict(invalidCalendarDate), /nextReviewAt precisa ser data ISO/);
});

test('loadProgramPolicy lê um arquivo real corretamente', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'program-policy-test-'));
  const p = path.join(dir, 'policy.json');
  const data = { 'Programa X': { aiResearchBanned: true, reason: 'motivo Y' } };
  writeFileSync(p, JSON.stringify(data), 'utf8');
  assert.deepEqual(loadProgramPolicy(p), data);
});

test('getBlockReason bloqueia programa ausente da policy', () => {
  assert.match(getBlockReason('Programa Qualquer', {}), /sem decisão explícita/);
});

test('getBlockReason devolve null pra programa presente mas sem aiResearchBanned=true', () => {
  const policy = { 'Programa X': { ...CURRENT_REVIEW, aiResearchBanned: false } };
  assert.equal(getBlockReason('Programa X', policy), null);
});

test('getBlockReason devolve o reason quando aiResearchBanned=true', () => {
  const policy = { 'Programa X': { aiResearchBanned: true, reason: 'motivo Y' } };
  assert.equal(getBlockReason('Programa X', policy), 'motivo Y');
});

test('getBlockReason devolve uma frase genérica quando aiResearchBanned=true mas reason está ausente', () => {
  const policy = { 'Programa X': { aiResearchBanned: true } };
  assert.match(getBlockReason('Programa X', policy), /proibida/);
});

test('program-policy.json real do projeto marca Block Open Source como bloqueado', () => {
  const policy = loadProgramPolicy();
  assert.equal(getBlockReason('Block Open Source', policy) !== null, true, 'program-policy.json deveria bloquear Block Open Source (regras do Bugcrowd proíbem pesquisa assistida por IA)');
});

test('getBlockReason devolve o reason quando blocked=true (motivo genérico, não RoE)', () => {
  const policy = { 'Programa X': { blocked: true, reason: 'motivo Y' } };
  assert.equal(getBlockReason('Programa X', policy), 'motivo Y');
});

test('getBlockReason devolve uma frase genérica quando blocked=true mas reason está ausente', () => {
  const policy = { 'Programa X': { blocked: true } };
  assert.match(getBlockReason('Programa X', policy), /bloqueado/);
});

test('getBlockReason devolve null pra programa presente mas sem blocked=true nem aiResearchBanned=true', () => {
  const policy = { 'Programa X': { ...CURRENT_REVIEW, blocked: false, aiResearchBanned: false } };
  assert.equal(getBlockReason('Programa X', policy), null);
});

test('getBlockReason falha fechado enquanto revisão de RoE estiver pendente', () => {
  const policy = { 'Programa X': { roeReviewNeeded: true, reason: 'revisar termos antes de pesquisar' } };
  assert.equal(getBlockReason('Programa X', policy), 'revisar termos antes de pesquisar');
  assert.equal(isProgramBanned('Programa X', policy), true);
});

test('getBlockReason falha fechado quando a revisão de RoE expira', () => {
  const policy = { 'Programa X': { roeReviewed: true, reviewedAt: '2026-01-01', nextReviewAt: '2026-02-01' } };
  assert.match(getBlockReason('Programa X', policy, { now: Date.parse('2026-02-02T00:00:00Z') }), /expirou/);
  assert.equal(getReviewValidityReason(policy['Programa X'], { now: Date.parse('2026-02-01T23:59:59Z') }), null);
});

test('program-policy.json real do projeto marca Circle BBP como bloqueado (instrução direta do usuário, não RoE)', () => {
  const policy = loadProgramPolicy();
  assert.equal(getBlockReason('Circle BBP', policy) !== null, true, 'program-policy.json deveria bloquear Circle BBP (usuário pediu explicitamente pra parar, 02/09/2026)');
});

test('isProgramBanned bloqueia proibição explícita e programa sem registro', () => {
  const policy = { 'Programa X': { aiResearchBanned: true, reason: 'motivo' } };
  assert.equal(isProgramBanned('Programa X', policy), true);
  assert.equal(isProgramBanned('Programa Y', policy), true);
  assert.equal(isProgramBanned('Programa X', {}), true);
});

test('filterBannedTargets remove só candidato não autorizado, preserva programas revisados', () => {
  const policy = {
    'Block Open Source': { aiResearchBanned: true, reason: 'RoE proíbe IA' },
    'Vercel Open Source': { ...CURRENT_REVIEW },
    'Circle BBP': { ...CURRENT_REVIEW },
  };
  const candidates = [
    { program: 'Block Open Source', owner: 'cashapp', repo: 'misk' },
    { program: 'Vercel Open Source', owner: 'vercel', repo: 'vercel' },
    { program: 'Circle BBP', owner: 'circlefin', repo: 'noble-cctp' },
  ];
  const result = filterBannedTargets(candidates, policy);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((c) => c.program), ['Vercel Open Source', 'Circle BBP']);
});

test('filterBannedTargets com policy vazia falha fechado', () => {
  const candidates = [{ program: 'Qualquer Programa', owner: 'a', repo: 'b' }];
  assert.deepEqual(filterBannedTargets(candidates, {}), []);
});

test('filterBannedTargets recusa candidato sem campo program', () => {
  const policy = { 'Block Open Source': { aiResearchBanned: true } };
  const candidates = [{ owner: 'a', repo: 'b' }];
  assert.deepEqual(filterBannedTargets(candidates, policy), []);
});
