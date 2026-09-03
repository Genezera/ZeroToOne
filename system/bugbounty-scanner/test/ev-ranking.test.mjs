import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probabilityValid, probabilityNovel, probabilityImpactAccepted, computeExpectedValue } from '../ev-ranking.mjs';

test('probabilityValid: tabela citável, prior neutro (0.5) quando ainda não avaliado', () => {
  assert.equal(probabilityValid('confirmed'), 0.95);
  assert.equal(probabilityValid('refuted'), 0.02);
  assert.equal(probabilityValid('inconclusive'), 0.3);
  assert.equal(probabilityValid(null), 0.5);
  assert.equal(probabilityValid(undefined), 0.5);
});

test('probabilityNovel: inverso direto do riskScore 0-100; sem avaliação usa prior conservador (0.2), não otimista', () => {
  assert.equal(probabilityNovel(0), 1);
  assert.equal(probabilityNovel(100), 0);
  assert.equal(probabilityNovel(60), 0.4);
  assert.equal(probabilityNovel(null), 0.2);
  assert.equal(probabilityNovel(undefined), 0.2);
});

test('probabilityImpactAccepted: reportable=false é sempre 0, mesmo com impactScope favorável', () => {
  assert.equal(probabilityImpactAccepted({ reportable: false, impactScope: 'systemic' }), 0);
});

test('probabilityImpactAccepted: impactScope pondera quando reportable=true; sem avaliação usa prior neutro-baixo', () => {
  assert.equal(probabilityImpactAccepted({ reportable: true, impactScope: 'systemic' }), 0.85);
  assert.equal(probabilityImpactAccepted({ reportable: true, impactScope: 'self_request_only' }), 0.1);
  assert.equal(probabilityImpactAccepted(null), 0.4);
});

test('computeExpectedValue: caso real do Kiwi.com (technicalValidity confirmed, mas reportable=false e riskScore=100) dá EV líquido negativo/zero', () => {
  const ev = computeExpectedValue({
    technicalValidity: 'confirmed',
    riskScore: 100,
    impactAssessment: { reportable: false },
    expectedBountyUsd: 500,
    researchCostUsd: 50,
  });
  assert.equal(ev.probabilityImpactAccepted, 0); // reportable=false zera tudo
  assert.equal(ev.grossExpectedValueUsd, 0);
  assert.equal(ev.netExpectedValueUsd, -50); // só o custo já gasto, nenhum retorno esperado
});

test('computeExpectedValue: caso bom (válido, novo, impacto aceito) dá EV líquido positivo e maior que um caso fraco', () => {
  const strong = computeExpectedValue({
    technicalValidity: 'confirmed', riskScore: 15,
    impactAssessment: { reportable: true, impactScope: 'other_system' },
    expectedBountyUsd: 2000, researchCostUsd: 100,
  });
  const weak = computeExpectedValue({
    technicalValidity: 'inconclusive', riskScore: 80,
    impactAssessment: { reportable: true, impactScope: 'self_request_only' },
    expectedBountyUsd: 2000, researchCostUsd: 100,
  });
  assert.ok(strong.netExpectedValueUsd > weak.netExpectedValueUsd);
  assert.ok(strong.netExpectedValueUsd > 0);
});

test('computeExpectedValue: sem bounty/custo informado, assume 0 em vez de lançar', () => {
  const ev = computeExpectedValue({ technicalValidity: 'confirmed', riskScore: 10 });
  assert.equal(ev.expectedBountyUsd, 0);
  assert.equal(ev.researchCostUsd, 0);
  assert.equal(ev.grossExpectedValueUsd, 0);
});

test('computeExpectedValue: breakdown cita os 4 fatores, nunca "número misterioso"', () => {
  const ev = computeExpectedValue({ technicalValidity: 'confirmed', riskScore: 20, expectedBountyUsd: 1000 });
  assert.equal(ev.breakdown.length, 4);
  assert.ok(ev.breakdown.some((b) => b.includes('P(válido)')));
  assert.ok(ev.breakdown.some((b) => b.includes('P(novo)')));
  assert.ok(ev.breakdown.some((b) => b.includes('P(impacto aceito)')));
  assert.ok(ev.breakdown.some((b) => b.includes('bounty esperado')));
});
