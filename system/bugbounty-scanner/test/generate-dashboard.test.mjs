import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardData, renderDashboardHtml } from '../generate-dashboard.mjs';

const targetLists = {
  clarity: [{ program: 'StackingDAO', platform: 'Immunefi', contracts: ['a', 'b'] }],
  go: [{ program: 'Block Open Source', platform: 'Bugcrowd', owner: 'cashapp', repo: 'hermit' }],
};

const queueEntries = [
  { id: '1', type: 'auth_arg_inconsistency', language: 'clarity', program: 'StackingDAO', status: 'reviewed', verdict: 'confirmado', foundAt: '2026-08-26T20:13:55.473Z' },
  { id: '2', type: 'unguarded_transfer', language: 'clarity', program: 'StackingDAO', status: 'reviewed', verdict: 'falso_positivo', foundAt: '2026-08-26T20:14:07.131Z' },
  { id: '3', type: 'hardcoded_secret', language: 'go', program: 'Block Open Source', status: 'pending' },
];

const stats = {
  byTypeLanguage: {
    'unguarded_transfer::clarity': { reviewed: 2, confirmed: 0, falsePositive: 2, other: 0, fpRate: 1 },
  },
  byTypeProgram: {},
};

test('buildDashboardData conta pendente/revisado/confirmado/falso-positivo corretamente', () => {
  const data = buildDashboardData({ queueEntries, stats, targetLists, lastScanSummary: null, lastScanAt: '2026-08-28T12:00:00Z' });
  assert.equal(data.totals.pending, 1);
  assert.equal(data.totals.reviewed, 2);
  assert.equal(data.totals.confirmed, 1);
  assert.equal(data.totals.falsePositive, 1);
  assert.equal(data.totals.targets, 2);
  assert.equal(data.totals.programs, 2);
});

test('buildDashboardData ordena atividade recente do mais novo pro mais velho', () => {
  const data = buildDashboardData({ queueEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  assert.equal(data.recentActivity[0].foundAt, '2026-08-26T20:14:07.131Z');
});

test('renderDashboardHtml produz HTML autocontido e não-vazio com as seções esperadas', () => {
  const data = buildDashboardData({ queueEntries, stats, targetLists, lastScanSummary: { contractsChecked: 2, repoFilesChecked: 0, fetchErrors: 0 }, lastScanAt: '2026-08-28T12:00:00Z' });
  const html = renderDashboardHtml(data);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<title>Centro de Sinais</title>'));
  assert.ok(html.includes('Alvos ativos'));
  assert.ok(html.includes('Atividade recente'));
  assert.ok(html.includes('Taxa de falso-positivo'));
  assert.ok(html.includes('cashapp/hermit'));
  assert.ok(html.includes('StackingDAO'));
});

test('renderDashboardHtml escapa conteúdo pra evitar quebra de HTML', () => {
  const data = buildDashboardData({
    queueEntries: [{ id: '1', type: '<script>evil</script>', language: 'go', program: 'X', status: 'reviewed', verdict: 'confirmado', foundAt: '2026-01-01T00:00:00Z' }],
    stats: { byTypeLanguage: {}, byTypeProgram: {} },
    targetLists: {},
    lastScanSummary: null,
    lastScanAt: null,
  });
  const html = renderDashboardHtml(data);
  assert.ok(!html.includes('<script>evil</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderDashboardHtml lida com fila vazia sem quebrar (estado inicial honesto)', () => {
  const data = buildDashboardData({ queueEntries: [], stats: { byTypeLanguage: {}, byTypeProgram: {} }, targetLists: {}, lastScanSummary: null, lastScanAt: null });
  const html = renderDashboardHtml(data);
  assert.ok(html.includes('Nenhuma revisão registrada ainda.'));
  assert.ok(html.includes('Ainda sem amostra suficiente'));
});
