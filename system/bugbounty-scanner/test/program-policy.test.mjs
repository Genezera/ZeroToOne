import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadProgramPolicy, getBlockReason } from '../program-policy.mjs';

test('loadProgramPolicy devolve {} quando o arquivo não existe, nunca lança', () => {
  const missing = path.join(tmpdir(), 'nao-existe-de-verdade-' + Date.now() + '.json');
  assert.deepEqual(loadProgramPolicy(missing), {});
});

test('loadProgramPolicy devolve {} pra JSON inválido, nunca lança', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'program-policy-test-'));
  const p = path.join(dir, 'policy.json');
  writeFileSync(p, '{ isto nao é json', 'utf8');
  assert.deepEqual(loadProgramPolicy(p), {});
});

test('loadProgramPolicy lê um arquivo real corretamente', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'program-policy-test-'));
  const p = path.join(dir, 'policy.json');
  const data = { 'Programa X': { aiResearchBanned: true, reason: 'motivo Y' } };
  writeFileSync(p, JSON.stringify(data), 'utf8');
  assert.deepEqual(loadProgramPolicy(p), data);
});

test('getBlockReason devolve null pra programa ausente da policy', () => {
  assert.equal(getBlockReason('Programa Qualquer', {}), null);
});

test('getBlockReason devolve null pra programa presente mas sem aiResearchBanned=true', () => {
  const policy = { 'Programa X': { aiResearchBanned: false } };
  assert.equal(getBlockReason('Programa X', policy), null);
});

test('getBlockReason devolve o reason quando aiResearchBanned=true', () => {
  const policy = { 'Programa X': { aiResearchBanned: true, reason: 'motivo Y' } };
  assert.equal(getBlockReason('Programa X', policy), 'motivo Y');
});

test('getBlockReason devolve uma frase genérica quando aiResearchBanned=true mas reason está ausente', () => {
  const policy = { 'Programa X': { aiResearchBanned: true } };
  assert.match(getBlockReason('Programa X', policy), /proibida/);
});

test('program-policy.json real do projeto marca Block Open Source como bloqueado', () => {
  const policy = loadProgramPolicy();
  assert.equal(getBlockReason('Block Open Source', policy) !== null, true, 'program-policy.json deveria bloquear Block Open Source (regras do Bugcrowd proíbem pesquisa assistida por IA)');
});
