import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.ZERO2ONE_LEDGER_DIR = mkdtempSync(path.join(tmpdir(), 'z21-ledger-'));

const { appendEntry, readLedger, verifyChain } = await import('../ledger/ledger.mjs');

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

test('rejeita ambiente inválido', () => {
  assert.throws(() => appendEntry('nao-existe', {}));
});
