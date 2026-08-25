import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateFill } from '../fill-simulator.mjs';

test('trade real no bid ou abaixo dele -> fill de compra simulado', () => {
  const quotes = { bidPrice: 99, askPrice: 101 };
  const fill = simulateFill(quotes, { price: 98.5, qty: 0.01 }, 0.02);
  assert.deepEqual(fill, { side: 'buy', price: 99, qty: 0.01 });
});

test('trade real no ask ou acima dele -> fill de venda simulado', () => {
  const quotes = { bidPrice: 99, askPrice: 101 };
  const fill = simulateFill(quotes, { price: 101.5, qty: 0.02 }, 0.01);
  assert.deepEqual(fill, { side: 'sell', price: 101, qty: 0.01 });
});

test('trade dentro do spread -> nenhum fill', () => {
  const quotes = { bidPrice: 99, askPrice: 101 };
  assert.equal(simulateFill(quotes, { price: 100, qty: 1 }, 0.01), null);
});

test('lado travado por limite de risco (null) nunca gera fill nesse lado', () => {
  const quotes = { bidPrice: null, askPrice: 101 };
  assert.equal(simulateFill(quotes, { price: 50, qty: 1 }, 0.01), null);
});

test('quantidade do fill é limitada pelo menor entre quoteQty e o tamanho do trade real', () => {
  const quotes = { bidPrice: 99, askPrice: 101 };
  const fill = simulateFill(quotes, { price: 99, qty: 0.005 }, 0.5);
  assert.equal(fill.qty, 0.005);
});
