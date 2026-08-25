import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuotes } from '../quoting-engine.mjs';

const params = { baseSpreadBps: 5, maxPositionUsd: 200, skewBpsPerFullPosition: 10 };

test('posição zero: bid e ask simétricos ao redor do mid', () => {
  const q = computeQuotes(100, 0, params);
  const midOfQuotes = (q.bidPrice + q.askPrice) / 2;
  assert.ok(Math.abs(midOfQuotes - 100) < 1e-9);
  assert.ok(q.bidPrice < 100 && q.askPrice > 100);
});

test('posição longa empurra o ask para mais perto do mid (mais vontade de vender)', () => {
  const flat = computeQuotes(100, 0, params);
  const long = computeQuotes(100, 1, params); // 1 unidade a $100 = $100 de exposição, metade do máximo
  assert.ok(long.askPrice < flat.askPrice, 'ask deveria ficar mais agressivo (mais perto do mid) quando comprado');
  assert.ok(long.bidPrice < flat.bidPrice, 'bid deveria ficar mais longe (menos agressivo) quando já comprado');
});

test('posição curta empurra o bid para mais perto do mid (mais vontade de comprar)', () => {
  const flat = computeQuotes(100, 0, params);
  const short = computeQuotes(100, -1, params);
  assert.ok(short.bidPrice > flat.bidPrice, 'bid deveria ficar mais agressivo quando vendido');
  assert.ok(short.askPrice > flat.askPrice, 'ask deveria ficar mais longe quando já vendido');
});

test('trava de risco: no limite de posição comprada, para de cotar bid (nunca aumenta exposição)', () => {
  const q = computeQuotes(100, 2, params); // 2 * 100 = $200 = maxPositionUsd exato
  assert.equal(q.bidPrice, null, 'não deveria oferecer comprar mais estando no teto');
  assert.ok(q.askPrice !== null, 'deveria continuar oferecendo vender (reduzir posição)');
});

test('trava de risco: no limite vendido, para de cotar ask (nunca aumenta exposição short)', () => {
  const q = computeQuotes(100, -2, params);
  assert.equal(q.askPrice, null);
  assert.ok(q.bidPrice !== null, 'deveria continuar oferecendo comprar (reduzir posição short)');
});

test('nunca aumenta agressividade depois de perda — skew só reage à posição, nunca ao PnL', () => {
  // Garantia estrutural: computeQuotes não recebe PnL/histórico de perdas
  // como argumento, então é impossível a lógica "tentar mais forte depois
  // de perder" (martingale). Este teste documenta essa garantia de design.
  assert.equal(computeQuotes.length, 3); // (midPrice, position, params) — sem parâmetro de PnL/histórico
});
