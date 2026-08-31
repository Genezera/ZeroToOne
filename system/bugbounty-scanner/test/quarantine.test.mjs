import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuarantined, computeQuarantinedRules, renderQuarantineMarkdown } from '../quarantine.mjs';

function statsWith(bucket) {
  return { byTypeLanguage: bucket, byTypeProgram: {} };
}

test('isQuarantined é true quando fpRate=1.0 e amostra >= mínimo (caso real: ssrf_risk 13/13)', () => {
  const stats = statsWith({ 'ssrf_risk::js': { reviewed: 13, confirmed: 0, falsePositive: 13, other: 0, fpRate: 1.0 } });
  assert.equal(isQuarantined(stats, 'ssrf_risk', 'js'), true);
});

test('isQuarantined é false quando a amostra é pequena demais, mesmo com 100% FP', () => {
  const stats = statsWith({ 'x::js': { reviewed: 3, confirmed: 0, falsePositive: 3, other: 0, fpRate: 1.0 } });
  assert.equal(isQuarantined(stats, 'x', 'js'), false);
});

test('isQuarantined é false quando fpRate está abaixo do limiar, mesmo com amostra grande', () => {
  const stats = statsWith({ 'x::js': { reviewed: 20, confirmed: 2, falsePositive: 18, other: 0, fpRate: 0.9 } });
  assert.equal(isQuarantined(stats, 'x', 'js'), false);
});

test('isQuarantined é false quando não há bucket nenhum pra esse tipo/linguagem', () => {
  const stats = statsWith({});
  assert.equal(isQuarantined(stats, 'nunca_visto', 'js'), false);
});

test('override manual destrava uma regra mesmo com FP 100%, nunca o contrário', () => {
  const stats = statsWith({ 'ssrf_risk::js': { reviewed: 13, confirmed: 0, falsePositive: 13, other: 0, fpRate: 1.0 } });
  const overrides = new Set(['ssrf_risk::js']);
  assert.equal(isQuarantined(stats, 'ssrf_risk', 'js', { overrides }), false);
  // override de uma chave DIFERENTE não afeta esta
  assert.equal(isQuarantined(stats, 'ssrf_risk', 'js', { overrides: new Set(['outra::coisa']) }), true);
});

test('computeQuarantinedRules lista todas as regras quarentenadas, ordenadas, ignora as que não batem o limiar', () => {
  const stats = statsWith({
    'ssrf_risk::js': { reviewed: 13, confirmed: 0, falsePositive: 13, other: 0, fpRate: 1.0 },
    'reentrancy_risk::solidity': { reviewed: 8, confirmed: 3, falsePositive: 5, other: 0, fpRate: 0.625 },
    'zzz_risk::go': { reviewed: 6, confirmed: 0, falsePositive: 6, other: 0, fpRate: 1.0 },
  });
  const result = computeQuarantinedRules(stats);
  assert.deepEqual(result.map((r) => r.key), ['ssrf_risk::js', 'zzz_risk::go']);
});

test('renderQuarantineMarkdown produz "nenhuma regra" quando a lista está vazia', () => {
  const md = renderQuarantineMarkdown([]);
  assert.match(md, /Nenhuma regra quarentenada/);
});

test('renderQuarantineMarkdown lista tipo/linguagem/taxa quando há regra quarentenada', () => {
  const md = renderQuarantineMarkdown([{ key: 'ssrf_risk::js', type: 'ssrf_risk', language: 'js', fpRate: 1.0, reviewed: 13, falsePositive: 13 }], 2);
  assert.match(md, /ssrf_risk/);
  assert.match(md, /100%/);
  assert.match(md, /2 candidato\(s\) suprimido/);
});
