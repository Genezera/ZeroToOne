import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

process.env.ZERO2ONE_LEDGER_DIR = mkdtempSync(path.join(tmpdir(), 'z21-ledger-'));

const { appendEntry, readLedger, repairChainFile, verifyChain } = await import('../ledger/ledger.mjs');

test('appendEntry grava, encadeia por hash, e verifyChain valida', () => {
  appendEntry('research', { type: 'test_entry', note: 'entrada 1' });
  appendEntry('research', { type: 'test_entry', note: 'entrada 2' });
  const entries = readLedger('research');
  assert.equal(entries.length, 2);
  assert.equal(entries[1].prevHash, entries[0].hash);
  const check = verifyChain('research');
  assert.equal(check.valid, true);
  assert.equal(check.entries, 2);
});

test('verifyChain detecta adulteração de conteúdo já gravado', () => {
  const dir = process.env.ZERO2ONE_LEDGER_DIR;
  const file = path.join(dir, 'ledger.simulation.jsonl');
  appendEntry('simulation', { type: 'test_entry', amountUsd: 5 });
  appendEntry('simulation', { type: 'test_entry', amountUsd: 7 });
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  const tampered = JSON.parse(lines[0]);
  tampered.amountUsd = 999;
  lines[0] = JSON.stringify(tampered);
  writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  const check = verifyChain('simulation');
  assert.equal(check.valid, false);
});

test('repairChainFile preserva payloads e reencadeia sufixos concorrentes com evento de auditoria', () => {
  const dir = process.env.ZERO2ONE_LEDGER_DIR;
  const file = path.join(dir, 'ledger.paper.jsonl');
  const base = appendEntry('paper', { type: 'base', note: 'ancestral comum', ts: '2026-09-07T00:00:00Z' });
  const branchA = appendEntry('paper', { type: 'branch_a', note: 'scanner', ts: '2026-09-07T00:01:00Z' });
  const branchBRecord = {
    type: 'branch_b', note: 'analista', ts: '2026-09-07T00:02:00Z',
    env: 'paper', prevHash: base.hash,
  };
  const branchB = { ...branchBRecord,
    hash: createHash('sha256').update(JSON.stringify(branchBRecord)).digest('hex') };
  writeFileSync(file, [base, branchA, branchB].map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  assert.equal(verifyChain('paper').valid, false);

  const repaired = repairChainFile(file, { environment: 'paper', now: () => new Date('2026-09-07T00:03:00Z') });
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.repairedFrom, 2);
  assert.equal(verifyChain('paper').valid, true);
  const entries = readLedger('paper');
  assert.equal(entries[2].type, 'branch_b');
  assert.equal(entries[2].note, 'analista');
  assert.equal(entries[2].prevHash, entries[1].hash);
  assert.equal(entries[3].type, 'ledger_chain_repair');
});

test('rejeita ambiente inválido', () => {
  assert.throws(() => appendEntry('nao-existe', {}));
});
