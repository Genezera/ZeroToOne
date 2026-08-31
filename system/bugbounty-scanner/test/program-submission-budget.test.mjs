import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSubmissionBudget, getSubmissionBudget } from '../program-submission-budget.mjs';

test('loadSubmissionBudget devolve {} quando o arquivo não existe, nunca lança', () => {
  const missing = path.join(tmpdir(), 'nao-existe-' + Date.now() + '.json');
  assert.deepEqual(loadSubmissionBudget(missing), {});
});

test('loadSubmissionBudget devolve {} pra JSON inválido, nunca lança', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'budget-test-'));
  const p = path.join(dir, 'budget.json');
  writeFileSync(p, '{ nao é json', 'utf8');
  assert.deepEqual(loadSubmissionBudget(p), {});
});

test('loadSubmissionBudget lê um arquivo real corretamente', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'budget-test-'));
  const p = path.join(dir, 'budget.json');
  const data = { 'Programa X': { remaining: 3 } };
  writeFileSync(p, JSON.stringify(data), 'utf8');
  assert.deepEqual(loadSubmissionBudget(p), data);
});

test('getSubmissionBudget devolve null pra programa sem orçamento rastreado (a maioria dos programas)', () => {
  assert.equal(getSubmissionBudget('Programa Qualquer', {}), null);
});

test('getSubmissionBudget devolve o registro completo quando existe', () => {
  const budget = { 'Programa X': { remaining: 2, used: 2 } };
  assert.deepEqual(getSubmissionBudget('Programa X', budget), { remaining: 2, used: 2 });
});

test('orçamento real do projeto: Circle BBP tem 2 restantes rastreados', () => {
  const budget = loadSubmissionBudget();
  const entry = getSubmissionBudget('Circle BBP', budget);
  assert.ok(entry, 'esperava um orçamento rastreado pro Circle BBP');
  assert.equal(entry.remaining, 2);
});
