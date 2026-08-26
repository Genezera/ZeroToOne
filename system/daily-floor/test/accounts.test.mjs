import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_ACCOUNTS, daysSinceVerified, withStaleness, STALE_WARNING_DAYS } from '../accounts.mjs';

test('todas as contas conhecidas têm fonte e data de verificação', () => {
  for (const a of KNOWN_ACCOUNTS) {
    assert.ok(a.source && a.source.startsWith('http'), `${a.name} sem fonte`);
    assert.match(a.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('daysSinceVerified calcula corretamente a partir de uma data de referência', () => {
  const acc = { verifiedOn: '2026-08-23' };
  const today = new Date('2026-09-10T00:00:00Z');
  assert.equal(daysSinceVerified(acc, today), 18);
});

test('withStaleness marca como stale quando passou do limite configurado', () => {
  const acc = [{ verifiedOn: '2026-08-23', name: 'teste' }];
  const farFuture = new Date('2027-01-01T00:00:00Z');
  const [result] = withStaleness(acc, farFuture);
  assert.equal(result.stale, true);
  assert.ok(result.staleDays > STALE_WARNING_DAYS);
});

test('withStaleness não marca como stale logo após a verificação', () => {
  const acc = [{ verifiedOn: '2026-08-23', name: 'teste' }];
  const sameDay = new Date('2026-08-23T12:00:00Z');
  const [result] = withStaleness(acc, sameDay);
  assert.equal(result.stale, false);
});
