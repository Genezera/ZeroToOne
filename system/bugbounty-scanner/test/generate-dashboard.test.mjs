import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardData, renderDashboardPages } from '../generate-dashboard.mjs';

const targetLists = {
  clarity: [{ program: 'StackingDAO', platform: 'Immunefi', contracts: ['a', 'b'], branch: 'main' }],
  go: [{ program: 'Block Open Source', platform: 'Bugcrowd', owner: 'cashapp', repo: 'hermit', branch: 'master', maxBountyUsd: 5000 }],
};

const queueEntries = [
  { id: '1', type: 'auth_arg_inconsistency', language: 'clarity', program: 'StackingDAO', platform: 'Immunefi', status: 'reviewed', verdict: 'confirmado', foundAt: '2026-08-26T20:13:55.473Z', file: 'x.clar', function: 'f' },
  { id: '2', type: 'unguarded_transfer', language: 'clarity', program: 'StackingDAO', platform: 'Immunefi', status: 'reviewed', verdict: 'falso_positivo', foundAt: '2026-08-26T20:14:07.131Z', file: 'y.clar', function: 'g', reasoning: 'motivo detalhado' },
  { id: '3', type: 'known_vulnerable_dependency', language: 'go', program: 'Block Open Source', platform: 'Bugcrowd', status: 'pending', file: 'cashapp/hermit/go.mod', function: 'foo@1.0.0' },
];

const ledgerEntries = [
  { type: 'bugbounty_scan', ts: '2026-08-28T21:20:26.881Z', contractsChecked: 13, repoFilesChecked: 0, manifestsChecked: 273, fetchErrors: 1, newFindingsCount: 4, newlyReviewedCount: 0, byLanguage: { go: 107 } },
  { type: 'bugbounty_verdict', ts: '2026-08-26T20:14:10.000Z', findingType: 'unguarded_transfer', language: 'clarity', program: 'StackingDAO', verdict: 'falso_positivo', reasoning: 'explicação' },
  { type: 'bugbounty_scan_ignoreme', ts: '2026-08-28T00:00:00Z' }, // não deve aparecer (filtro por tipo)
];

const stats = {
  byTypeLanguage: { 'unguarded_transfer::clarity': { reviewed: 2, confirmed: 0, falsePositive: 2, other: 0, fpRate: 1 } },
  byTypeProgram: { 'unguarded_transfer::StackingDAO': { reviewed: 2, confirmed: 0, falsePositive: 2, other: 0, fpRate: 1 } },
};

test('buildDashboardData conta totais corretamente, incluindo rodadas do ledger', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: '2026-08-28T21:20:00Z' });
  assert.equal(data.totals.pending, 1);
  assert.equal(data.totals.reviewed, 2);
  assert.equal(data.totals.confirmed, 1);
  assert.equal(data.totals.falsePositive, 1);
  assert.equal(data.totals.targets, 2);
  assert.equal(data.totals.scanRuns, 1);
});

test('buildDashboardData mantém TODA a fila (não só os mais recentes), ordenada', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  assert.equal(data.queueEntries.length, 3);
  assert.equal(data.queueEntries[0].id, '2'); // foundAt mais recente primeiro
});

test('buildDashboardData ordena atividade por ts, mais recente primeiro', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  assert.equal(data.activityEntries[0].type, 'bugbounty_scan');
});

test('renderDashboardPages produz as 5 páginas esperadas, todas HTML autocontido e não-vazio', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: { contractsChecked: 13, repoFilesChecked: 0, manifestsChecked: 273, fetchErrors: 1 }, lastScanAt: '2026-08-28T21:20:00Z' });
  const pages = renderDashboardPages(data);
  const names = Object.keys(pages);
  assert.deepEqual(names.sort(), ['activity.html', 'index.html', 'queue.html', 'stats.html', 'targets.html']);
  for (const html of Object.values(pages)) {
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('Centro de Sinais'));
  }
});

test('página de alvos lista o repositório real e o escopo', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const pages = renderDashboardPages(data);
  assert.ok(pages['targets.html'].includes('cashapp/hermit'));
  assert.ok(pages['targets.html'].includes('StackingDAO'));
});

test('página de fila inclui o raciocínio completo da revisão (não truncado)', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const pages = renderDashboardPages(data);
  assert.ok(pages['queue.html'].includes('motivo detalhado'));
  assert.ok(pages['queue.html'].includes('cashapp/hermit/go.mod'));
});

test('página de atividade mostra a rodada do scanner e o veredito, mas ignora tipo de ledger não relacionado', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const pages = renderDashboardPages(data);
  assert.ok(pages['activity.html'].includes('achado(s) novo(s)'));
  assert.ok(pages['activity.html'].includes('explicação'));
});

test('página de atividade também mostra rodada de descoberta e de digest', () => {
  const ledgerWithMore = [
    ...ledgerEntries,
    { type: 'bugbounty_discovery', ts: '2026-08-28T21:49:16.893Z', totalCandidatesInDatasets: 194, newCandidatesFound: 186, truncatedCount: 156 },
    { type: 'bugbounty_digest', ts: '2026-08-28T21:51:46.971Z', watchedPackagesCount: 3, totalAdvisories: 16 },
  ];
  const data = buildDashboardData({ queueEntries, ledgerEntries: ledgerWithMore, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const pages = renderDashboardPages(data);
  assert.ok(pages['activity.html'].includes('Descoberta de alvo'));
  assert.ok(pages['activity.html'].includes('186 candidato'));
  assert.ok(pages['activity.html'].includes('Digest de segurança'));
  assert.ok(pages['activity.html'].includes('16 advisory'));
});

test('página de estatística mostra as duas quebras (linguagem e programa)', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const pages = renderDashboardPages(data);
  assert.ok(pages['stats.html'].includes('Por tipo × linguagem'));
  assert.ok(pages['stats.html'].includes('Por tipo × programa'));
});

test('escapa conteúdo pra evitar quebra de HTML', () => {
  const evilQueue = [{ id: '1', type: '<script>evil</script>', language: 'go', program: 'X', platform: 'Y', status: 'reviewed', verdict: 'confirmado', foundAt: '2026-01-01T00:00:00Z', file: 'x', function: 'y' }];
  const data = buildDashboardData({ queueEntries: evilQueue, ledgerEntries: [], stats: { byTypeLanguage: {}, byTypeProgram: {} }, targetLists: {}, lastScanSummary: null, lastScanAt: null });
  const pages = renderDashboardPages(data);
  assert.ok(!pages['queue.html'].includes('<script>evil</script>'));
  assert.ok(pages['queue.html'].includes('&lt;script&gt;'));
});

test('lida com estado totalmente vazio sem quebrar (honesto, sem dado fabricado)', () => {
  const data = buildDashboardData({ queueEntries: [], ledgerEntries: [], stats: { byTypeLanguage: {}, byTypeProgram: {} }, targetLists: {}, lastScanSummary: null, lastScanAt: null });
  const pages = renderDashboardPages(data);
  assert.ok(pages['index.html'].includes('Nenhum achado registrado ainda.'));
  assert.ok(pages['queue.html'].includes('A fila está vazia'));
  assert.ok(pages['activity.html'].includes('Nenhuma atividade registrada ainda.'));
});
