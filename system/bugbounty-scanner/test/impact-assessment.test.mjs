import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImpactAssessment, reportabilityGate } from '../impact-assessment.mjs';

const REPORTABLE = {
  technicalValidity: 'confirmed', attackerControlledInput: true,
  attacker: 'usuário remoto', victim: 'outro usuário', securityBoundary: 'isolamento entre contas',
  observableOutcome: 'leitura de dado da conta vítima', rationale: 'reproduzido com duas contas próprias',
  confidentiality: 'low', integrity: 'none', availability: 'none',
  impactScope: 'other_user', reportable: true,
  severityRating: 'medium', severityRationale: 'acesso entre contas exige classificação Medium',
};

test('assessment completo e com vítima distinta passa o gate', () => {
  assert.equal(validateImpactAssessment(REPORTABLE).ok, true);
  assert.equal(reportabilityGate(REPORTABLE).ok, true);
});

test('defeito técnico sem impacto de segurança fica registrado mas não passa', () => {
  const functionalOnly = {
    ...REPORTABLE, victim: 'o próprio chamador', securityBoundary: 'nenhuma fronteira cruzada',
    observableOutcome: 'a própria requisição falha', confidentiality: 'none',
    impactScope: 'self_request_only', reportable: false,
  };
  assert.equal(validateImpactAssessment(functionalOnly).ok, true);
  assert.equal(reportabilityGate(functionalOnly).ok, false);
});

test('reportable=true nunca contorna ausência de entrada controlada pelo atacante', () => {
  const result = reportabilityGate({ ...REPORTABLE, attackerControlledInput: false, reportable: true });
  assert.equal(result.ok, false);
  assert.match(result.reason, /entrada controlada pelo atacante/);
});

test('achado Low permanece registrável, mas nunca passa o gate Medium+', () => {
  const low = { ...REPORTABLE, severityRating: 'low', severityRationale: 'impacto limitado e recuperável' };
  assert.equal(validateImpactAssessment(low).ok, true);
  const result = reportabilityGate(low);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Medium\+/);
});

test('reportable sem severidade justificada falha fechado', () => {
  const malformed = { ...REPORTABLE };
  delete malformed.severityRating;
  delete malformed.severityRationale;
  const result = reportabilityGate(malformed);
  assert.equal(result.ok, false);
  assert.match(result.reason, /severityRating/);
});

test('campo obrigatório ausente falha fechado', () => {
  const malformed = { ...REPORTABLE };
  delete malformed.attackerControlledInput;
  const result = reportabilityGate(malformed);
  assert.equal(result.ok, false);
  assert.match(result.reason, /attackerControlledInput/);
});

test('assessment null de dado legado bloqueia com motivo em vez de lançar', () => {
  const result = reportabilityGate(null);
  assert.equal(result.ok, false);
  assert.match(result.reason, /impactAssessment incompleto/);
});
