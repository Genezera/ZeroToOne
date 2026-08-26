import { test } from 'node:test';
import assert from 'node:assert/strict';
import { irRateForHoldingDays, netReturn } from '../tax.mjs';

test('tabela regressiva: 22,5% até 180 dias', () => {
  assert.equal(irRateForHoldingDays(1), 0.225);
  assert.equal(irRateForHoldingDays(180), 0.225);
});

test('tabela regressiva: 20% de 181 a 360 dias', () => {
  assert.equal(irRateForHoldingDays(181), 0.20);
  assert.equal(irRateForHoldingDays(360), 0.20);
});

test('tabela regressiva: 17,5% de 361 a 720 dias', () => {
  assert.equal(irRateForHoldingDays(361), 0.175);
  assert.equal(irRateForHoldingDays(720), 0.175);
});

test('tabela regressiva: 15% acima de 720 dias', () => {
  assert.equal(irRateForHoldingDays(721), 0.15);
  assert.equal(irRateForHoldingDays(5000), 0.15);
});

test('netReturn aplica a alíquota correta sobre o lucro bruto', () => {
  assert.ok(Math.abs(netReturn(100, 10) - 77.5) < 1e-9);
  assert.ok(Math.abs(netReturn(100, 800) - 85) < 1e-9);
});

test('netReturn ignora imposto quando exempt=true (LCI/LCA)', () => {
  assert.equal(netReturn(100, 10, { exempt: true }), 100);
});

test('rejeita dias negativos', () => {
  assert.throws(() => irRateForHoldingDays(-1));
});
