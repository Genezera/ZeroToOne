import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadProgramPolicy, getBlockReason, isProgramBanned, filterBannedTargets } from '../program-policy.mjs';

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

test('isProgramBanned devolve true só quando aiResearchBanned=true', () => {
  const policy = { 'Programa X': { aiResearchBanned: true, reason: 'motivo' } };
  assert.equal(isProgramBanned('Programa X', policy), true);
  assert.equal(isProgramBanned('Programa Y', policy), false);
  assert.equal(isProgramBanned('Programa X', {}), false);
});

test('filterBannedTargets remove só candidato de programa banido, preserva o resto', () => {
  const policy = { 'Block Open Source': { aiResearchBanned: true, reason: 'RoE proíbe IA' } };
  const candidates = [
    { program: 'Block Open Source', owner: 'cashapp', repo: 'misk' },
    { program: 'Vercel Open Source', owner: 'vercel', repo: 'vercel' },
    { program: 'Circle BBP', owner: 'circlefin', repo: 'noble-cctp' },
  ];
  const result = filterBannedTargets(candidates, policy);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((c) => c.program), ['Vercel Open Source', 'Circle BBP']);
});

test('filterBannedTargets com policy vazia não remove nada', () => {
  const candidates = [{ program: 'Qualquer Programa', owner: 'a', repo: 'b' }];
  assert.deepEqual(filterBannedTargets(candidates, {}), candidates);
});

test('filterBannedTargets nunca lança pra candidato sem campo program', () => {
  const policy = { 'Block Open Source': { aiResearchBanned: true } };
  const candidates = [{ owner: 'a', repo: 'b' }];
  assert.deepEqual(filterBannedTargets(candidates, policy), candidates);
});
