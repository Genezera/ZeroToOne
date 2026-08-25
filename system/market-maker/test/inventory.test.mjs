import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventory, applyFill, netWorth } from '../inventory.mjs';

test('comprar aumenta position e reduz cash pelo notional + taxa', () => {
  let inv = createInventory();
  inv = applyFill(inv, { side: 'buy', price: 100, qty: 1, makerFeeRate: 0.0001 });
  assert.equal(inv.position, 1);
  assert.equal(inv.cash, -(100 + 100 * 0.0001));
  assert.equal(inv.fills, 1);
});

test('vender reduz position e aumenta cash pelo notional - taxa', () => {
  let inv = createInventory();
  inv = applyFill(inv, { side: 'sell', price: 100, qty: 1, makerFeeRate: 0.0001 });
  assert.equal(inv.position, -1);
  assert.equal(inv.cash, 100 - 100 * 0.0001);
});

test('netWorth soma cash + position*markPrice, refletindo lucro/prejuízo não realizado', () => {
  let inv = createInventory();
  inv = applyFill(inv, { side: 'buy', price: 100, qty: 1, makerFeeRate: 0 });
  assert.equal(netWorth(inv, 100), 0); // comprou a 100, mercado ainda a 100 -> flat
  assert.equal(netWorth(inv, 110), 10); // mercado subiu -> lucro não realizado de 10
  assert.equal(netWorth(inv, 90), -10);
});

test('round-trip completo (compra depois venda) realiza o lucro do spread', () => {
  let inv = createInventory();
  inv = applyFill(inv, { side: 'buy', price: 99.9, qty: 1, makerFeeRate: 0 });
  inv = applyFill(inv, { side: 'sell', price: 100.1, qty: 1, makerFeeRate: 0 });
  assert.equal(inv.position, 0);
  assert.ok(Math.abs(netWorth(inv, 100) - 0.2) < 1e-9, 'deveria capturar 0.2 de spread');
});

test('rejeita qty ou price inválidos', () => {
  const inv = createInventory();
  assert.throws(() => applyFill(inv, { side: 'buy', price: 0, qty: 1, makerFeeRate: 0 }));
  assert.throws(() => applyFill(inv, { side: 'buy', price: 100, qty: 0, makerFeeRate: 0 }));
  assert.throws(() => applyFill(inv, { side: 'hold', price: 100, qty: 1, makerFeeRate: 0 }));
});
