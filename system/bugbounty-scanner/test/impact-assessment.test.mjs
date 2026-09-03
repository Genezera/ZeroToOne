import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImpactAssessment, reportabilityGate } from '../impact-assessment.mjs';

const REPORTABLE = {
  technicalValidity: 'confirmed', attackerControlledInput: true,
  attacker: 'usuário remoto', victim: 'outro usuário', securityBoundary: 'isolamento entre contas',
  observableOutcome: 'leitura de dado da conta vítima', rationale: 'reproduzido com duas contas próprias',
  confidentiality: 'low', integrity: 'none', availability: 'none',
  impactScope: 'other_user', reportable: true,
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

test('campo obrigatório ausente falha fechado', () => {
  const malformed = { ...REPORTABLE };
  delete malformed.attackerControlledInput;
  const result = reportabilityGate(malformed);
  assert.equal(result.ok, false);
  assert.match(result.reason, /attackerControlledInput/);
});

