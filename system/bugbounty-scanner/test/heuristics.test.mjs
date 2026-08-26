import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitTopLevelForms, findAuthInconsistencies, findUnguardedTransfers, scanSource } from '../heuristics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stackingDaoDir = path.resolve(__dirname, '..', '..', '..', 'research', 'bugbounty', 'stackingdao');

test('splitTopLevelForms separa formas balanceadas corretamente', () => {
  const src = '(define-public (a) (ok true)) (define-read-only (b) (+ 1 1))';
  const forms = splitTopLevelForms(src);
  assert.equal(forms.length, 2);
  assert.ok(forms[0].startsWith('(define-public (a)'));
  assert.ok(forms[1].startsWith('(define-read-only (b)'));
});

test('findAuthInconsistencies encontra o achado real de hoje (set-token-uri em ststx-token.clar)', () => {
  const source = readFileSync(path.join(stackingDaoDir, 'ststx-token.clar'), 'utf8');
  const findings = findAuthInconsistencies(source, 'ststx-token.clar');
  const names = findings.map((f) => f.function);
  assert.ok(names.includes('set-token-uri'), `esperava achar set-token-uri, achou: ${names.join(', ')}`);
});

test('findAuthInconsistencies NÃO sinaliza stx-reserve-v2.clar (uso consistente de contract-caller)', () => {
  const source = readFileSync(path.join(stackingDaoDir, 'stx-reserve-v2.clar'), 'utf8');
  const findings = findAuthInconsistencies(source, 'stx-reserve-v2.clar');
  assert.equal(findings.length, 0, `esperava 0 achados (todas as funções usam contract-caller consistentemente), achou ${findings.length}`);
});

test('findUnguardedTransfers roda sem quebrar em todos os contratos já baixados', () => {
  const files = ['stx-reserve-v2.clar', 'stbtc-reserve.clar', 'ststx-token.clar', 'dao.clar', 'stacker-1.clar'];
  for (const f of files) {
    const source = readFileSync(path.join(stackingDaoDir, f), 'utf8');
    const findings = findUnguardedTransfers(source, f);
    assert.ok(Array.isArray(findings));
  }
});

test('scanSource combina os dois tipos de achado', () => {
  const source = readFileSync(path.join(stackingDaoDir, 'ststx-token.clar'), 'utf8');
  const findings = scanSource(source, 'ststx-token.clar');
  assert.ok(findings.some((f) => f.type === 'auth_arg_inconsistency'));
});

test('não gera ruído em arquivo pequeno com só 1 checagem de auth (sem maioria clara)', () => {
  const source = readFileSync(path.join(stackingDaoDir, 'signer-admin-v1.clar'), 'utf8');
  const findings = findAuthInconsistencies(source, 'signer-admin-v1.clar');
  assert.equal(findings.length, 0);
});
