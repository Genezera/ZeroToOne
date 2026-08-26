import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.ZERO2ONE_LEDGER_DIR = mkdtempSync(path.join(tmpdir(), 'z21-dailyfloor-'));

const { runOnce } = await import('../daily-runner.mjs');

// Testes de integração: batem na API real do BCB (rede necessária), igual
// aos testes do br-series-fetcher.

test('runOnce busca CDI real, calcula rendimento líquido e grava no ledger paper', async () => {
  const s = await runOnce();
  assert.equal(s.env, 'paper');
  assert.equal(s.balanceBefore, 200);
  assert.ok(s.netAccrual > 0, 'rendimento líquido deveria ser positivo com CDI positivo');
  assert.ok(s.balance > s.balanceBefore);
  assert.ok(s.account, 'deveria escolher alguma conta conhecida');
});

test('rodar de novo no mesmo dia não duplica — devolve o snapshot existente', async () => {
  const first = await runOnce();
  const second = await runOnce();
  assert.equal(second.duplicate, true);
  assert.equal(second.balance, first.balance);
});
