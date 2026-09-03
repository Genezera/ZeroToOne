import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysSince } from '../code-age.mjs';

// fetchFileLastCommit/codeAgeSignal fazem chamada de rede real -- mesmo
// padrão de h1-api.mjs (getMyReports/getReport também não são mockados
// aqui); só a parte pura (daysSince) tem teste unitário.

test('daysSince calcula dias corridos a partir de uma data de referência', () => {
  const now = new Date('2026-09-03T00:00:00Z').getTime();
  assert.equal(daysSince('2020-03-31T09:55:46Z', now), Math.floor((now - new Date('2020-03-31T09:55:46Z').getTime()) / 86400000));
});

test('daysSince nunca devolve negativo (data no futuro vira 0, não negativo)', () => {
  const now = new Date('2026-09-03T00:00:00Z').getTime();
  assert.equal(daysSince('2030-01-01T00:00:00Z', now), 0);
});

test('daysSince devolve null pra data inválida, nunca lança', () => {
  assert.equal(daysSince('não é uma data'), null);
  assert.equal(daysSince(undefined), null);
  assert.equal(daysSince(null), null);
});

test('daysSince do commit real f1a1d76 (31/03/2020) até hoje bate com "6+ anos" citado no relatório do Kiwi.com', () => {
  const now = new Date('2026-09-03T18:00:00Z').getTime();
  const days = daysSince('2020-03-31T09:55:46Z', now);
  assert.ok(days > 365 * 6, `esperava mais de 6 anos (${365 * 6} dias), obteve ${days}`);
});
