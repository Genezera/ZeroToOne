import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'z21-riskgate-'));
process.env.ZERO2ONE_LEDGER_DIR = path.join(dir, 'ledger');
mkdirSync(process.env.ZERO2ONE_LEDGER_DIR, { recursive: true });
const limitsPath = path.join(dir, 'risk_limits.json');
writeFileSync(limitsPath, JSON.stringify({
  maxPerExperimentUsd: 10,
  maxDailyLossUsd: 10,
  cumulativeHardStopUsd: 20,
  leverageAllowed: false,
  requireInstantLiquidity: true,
  maxLockupDays: 0,
}), 'utf8');
process.env.ZERO2ONE_RISK_LIMITS_PATH = limitsPath;

const { checkRealMoneyAction, getRiskStatus } = await import('../risk-gate/risk-gate.mjs');
const { appendEntry } = await import('../ledger/ledger.mjs');

test('bloqueia sem aprovação explícita do usuário', () => {
  const result = checkRealMoneyAction({ env: 'canary', amountUsd: 5, description: 'teste', approvedByUser: false, lockupDays: 0 });
  assert.equal(result.allowed, false);
});

test('permite dentro dos limites com aprovação explícita e liquidez imediata', () => {
  const result = checkRealMoneyAction({ env: 'canary', amountUsd: 5, description: 'teste ok', approvedByUser: true, lockupDays: 0 });
  assert.equal(result.allowed, true);
});

test('bloqueia acima do máximo por experimento mesmo aprovado', () => {
  const result = checkRealMoneyAction({ env: 'canary', amountUsd: 50, description: 'teste grande', approvedByUser: true, lockupDays: 0 });
  assert.equal(result.allowed, false);
});

test('bloqueia menção a alavancagem mesmo aprovado e dentro do valor', () => {
  const result = checkRealMoneyAction({ env: 'canary', amountUsd: 5, description: 'operação com alavancagem 5x', approvedByUser: true, lockupDays: 0 });
  assert.equal(result.allowed, false);
});

test('toda checagem (aprovada ou bloqueada) fica registrada no ledger de audit', () => {
  checkRealMoneyAction({ env: 'canary', amountUsd: 3, description: 'para auditoria', approvedByUser: true, lockupDays: 0 });
  const status = getRiskStatus();
  assert.equal(typeof status.lossCumulative, 'number');
});

test('bloqueia qualquer trava de capital (lockupDays > 0), mesmo aprovado e dentro do valor', () => {
  const result = checkRealMoneyAction({ env: 'canary', amountUsd: 5, description: 'CDB com carência de 2 anos', approvedByUser: true, lockupDays: 730 });
  assert.equal(result.allowed, false);
  assert.ok(result.checks.some((c) => c.includes('liquidez total')));
});

test('bloqueia quando lockupDays não é informado — nunca assume liquidez por padrão', () => {
  const result = checkRealMoneyAction({ env: 'canary', amountUsd: 5, description: 'teste sem declarar liquidez', approvedByUser: true });
  assert.equal(result.allowed, false);
});

test('hard stop bloqueia qualquer nova ação após perda acumulada atingir o teto', () => {
  appendEntry('production', { type: 'realized_pnl', amountUsd: -20 });
  const status = getRiskStatus();
  assert.equal(status.hardStopTriggered, true);
  const result = checkRealMoneyAction({ env: 'canary', amountUsd: 1, description: 'depois do hard stop', approvedByUser: true, lockupDays: 0 });
  assert.equal(result.allowed, false);
});
