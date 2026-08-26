import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annualizedRate, compoundDaily, oneDayAccrual } from '../accrual.mjs';

test('annualizedRate reproduz ~14% a.a. a partir do fator diário real observado nesta sessão (0,05166%)', () => {
  const annual = annualizedRate(0.05166);
  assert.ok(annual > 13 && annual < 15, `esperava entre 13% e 15%, veio ${annual.toFixed(3)}%`);
});

test('compoundDaily com 0 dias retorna o principal inalterado', () => {
  assert.equal(compoundDaily(200, 0.05166, 0), 200);
});

test('compoundDaily composto ao longo de 252 dias úteis bate com annualizedRate', () => {
  const dailyRatePct = 0.05166;
  const principal = 200;
  const afterOneYear = compoundDaily(principal, dailyRatePct, 252);
  const expected = principal * (1 + annualizedRate(dailyRatePct) / 100);
  assert.ok(Math.abs(afterOneYear - expected) < 1e-6);
});

test('oneDayAccrual sobre US$200 a 0,05166%/dia é um valor pequeno e positivo', () => {
  const accrual = oneDayAccrual(200, 0.05166);
  assert.ok(accrual > 0 && accrual < 1, `esperava um valor pequeno positivo, veio ${accrual}`);
});

test('rejeita principal ou businessDays negativos', () => {
  assert.throws(() => compoundDaily(-1, 0.05, 1));
  assert.throws(() => compoundDaily(1, 0.05, -1));
});
