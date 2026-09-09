import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveLanguage,
  computeStats,
  historicalConfidenceFor,
  renderStatsMarkdown,
  diffNewlyReviewed,
} from '../verdict-stats.mjs';

test('deriveLanguage usa o campo language quando presente', () => {
  assert.equal(deriveLanguage({ language: 'go', file: 'x.js' }), 'go');
});

test('deriveLanguage infere pela extensão quando language ausente (compat com entradas antigas)', () => {
  assert.equal(deriveLanguage({ file: 'ststx-token.clar' }), 'clarity');
  assert.equal(deriveLanguage({ file: 'pkg/flags/index.ts' }), 'js');
  assert.equal(deriveLanguage({ file: 'cashapp/hermit/main.go' }), 'go');
  assert.equal(deriveLanguage({ file: 'misk/Foo.kt' }), 'jvm');
  assert.equal(deriveLanguage({ file: 'Sources/Afterpay.swift' }), 'swift');
  assert.equal(deriveLanguage({ file: 'weird.xyz' }), 'unknown');
});

test('computeStats ignora itens pending e conta confirmado/falso_positivo/outro corretamente', () => {
  const entries = [
    { type: 'a', language: 'go', program: 'P', status: 'pending', verdict: undefined },
    { type: 'a', language: 'go', program: 'P', status: 'reviewed', verdict: 'confirmado' },
    { type: 'a', language: 'go', program: 'P', status: 'reviewed', verdict: 'falso_positivo' },
    { type: 'a', language: 'go', program: 'P', status: 'reviewed', verdict: 'falso_positivo' },
    { type: 'a', language: 'go', program: 'P', status: 'reviewed', verdict: 'inconclusivo' },
  ];
  const stats = computeStats(entries);
  const bucket = stats.byTypeLanguage['a::go'];
  assert.deepEqual(bucket, { reviewed: 4, confirmed: 1, falsePositive: 2, other: 1, fpRate: 0.5 });
});

test('computeStats retorna fpRate null quando não há amostra revisada', () => {
  const stats = computeStats([{ type: 'a', language: 'go', program: 'P', status: 'pending' }]);
  assert.deepEqual(stats.byTypeLanguage, {});
});

test('computeStats também agrupa por tipo × programa', () => {
  const entries = [
    { type: 'a', language: 'go', program: 'ProgX', status: 'reviewed', verdict: 'confirmado' },
  ];
  const stats = computeStats(entries);
  assert.ok(stats.byTypeProgram['a::ProgX']);
  assert.equal(stats.byTypeProgram['a::ProgX'].confirmed, 1);
});

test('historicalConfidenceFor retorna null abaixo do mínimo de amostra', () => {
  const stats = { byTypeLanguage: { 'a::go': { reviewed: 3, confirmed: 0, falsePositive: 3, other: 0, fpRate: 1 } } };
  assert.equal(historicalConfidenceFor(stats, 'a', 'go', 5), null);
});

test('historicalConfidenceFor retorna dado quando amostra suficiente', () => {
  const stats = { byTypeLanguage: { 'a::go': { reviewed: 10, confirmed: 2, falsePositive: 8, other: 0, fpRate: 0.8 } } };
  const conf = historicalConfidenceFor(stats, 'a', 'go', 5);
  assert.deepEqual(conf, { fpRate: 0.8, sampleSize: 10 });
});

test('historicalConfidenceFor retorna null pra combinação inexistente', () => {
  const stats = { byTypeLanguage: {} };
  assert.equal(historicalConfidenceFor(stats, 'a', 'go'), null);
});

test('historicalConfidenceFor prefers sufficiently sampled program-specific outcomes', () => {
  const stats = {
    byTypeLanguage: { 'a::go': { reviewed: 20, fpRate: 0.5 } },
    byTypeProgram: { 'a::Program A': { reviewed: 6, fpRate: 1 } },
  };
  assert.deepEqual(historicalConfidenceFor(stats, 'a', 'go', 5, 'Program A'), {
    fpRate: 1, sampleSize: 6, basis: 'type_program', program: 'Program A',
  });
});

test('renderStatsMarkdown produz markdown não-vazio com os cabeçalhos esperados', () => {
  const stats = computeStats([
    { type: 'hardcoded_secret', language: 'go', program: 'Block', status: 'reviewed', verdict: 'confirmado' },
  ]);
  const md = renderStatsMarkdown(stats);
  assert.ok(md.includes('# Estatística de heurísticas'));
  assert.ok(md.includes('## Por tipo × linguagem'));
  assert.ok(md.includes('## Por tipo × programa'));
  assert.ok(md.includes('hardcoded_secret'));
});

test('diffNewlyReviewed detecta item recém-revisado (ausente do snapshot anterior)', () => {
  const entries = [{ id: 'abc', status: 'reviewed', verdict: 'confirmado' }];
  const { changed, updatedSnapshot } = diffNewlyReviewed(entries, {});
  assert.equal(changed.length, 1);
  assert.equal(updatedSnapshot.abc, 'confirmado');
});

test('diffNewlyReviewed detecta veredito que MUDOU desde a última vez visto', () => {
  const entries = [{ id: 'abc', status: 'reviewed', verdict: 'confirmado' }];
  const { changed } = diffNewlyReviewed(entries, { abc: 'falso_positivo' });
  assert.equal(changed.length, 1);
});

test('diffNewlyReviewed NÃO sinaliza item já visto com o mesmo veredito', () => {
  const entries = [{ id: 'abc', status: 'reviewed', verdict: 'confirmado' }];
  const { changed } = diffNewlyReviewed(entries, { abc: 'confirmado' });
  assert.equal(changed.length, 0);
});

test('diffNewlyReviewed ignora itens pending e itens sem id', () => {
  const entries = [
    { id: 'x', status: 'pending', verdict: undefined },
    { status: 'reviewed', verdict: 'confirmado' }, // sem id
  ];
  const { changed } = diffNewlyReviewed(entries, {});
  assert.equal(changed.length, 0);
});
