import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardData, renderDashboardSections, renderDashboardApp } from '../generate-dashboard.mjs';

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

test('renderDashboardSections produz as 6 seções esperadas, cada uma com título/corpo', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: { contractsChecked: 13, repoFilesChecked: 0, manifestsChecked: 273, fetchErrors: 1 }, lastScanAt: '2026-08-28T21:20:00Z' });
  const sections = renderDashboardSections(data);
  assert.deepEqual(Object.keys(sections).sort(), ['activity', 'index', 'queue', 'signals', 'stats', 'targets']);
  for (const s of Object.values(sections)) {
    assert.equal(s.key, Object.keys(sections).find((k) => sections[k] === s));
    assert.ok(typeof s.title === 'string' && s.title.length > 0);
    assert.ok(typeof s.bodyHtml === 'string' && s.bodyHtml.length > 0);
  }
});

test('página de alvos lista o repositório real e o escopo', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const sections = renderDashboardSections(data);
  assert.ok(sections.targets.bodyHtml.includes('cashapp/hermit'));
  assert.ok(sections.targets.bodyHtml.includes('StackingDAO'));
});

test('página de fila inclui o raciocínio completo da revisão (não truncado)', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const sections = renderDashboardSections(data);
  assert.ok(sections.queue.bodyHtml.includes('motivo detalhado'));
  assert.ok(sections.queue.bodyHtml.includes('cashapp/hermit/go.mod'));
  assert.ok(sections.queue.extraScript.includes('f-status')); // filtro client-side presente
});

test('página de atividade mostra a rodada do scanner e o veredito, mas ignora tipo de ledger não relacionado', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const sections = renderDashboardSections(data);
  assert.ok(sections.activity.bodyHtml.includes('achado(s) novo(s)'));
  assert.ok(sections.activity.bodyHtml.includes('explicação'));
});

test('página de atividade também mostra rodada de descoberta e de digest', () => {
  const ledgerWithMore = [
    ...ledgerEntries,
    { type: 'bugbounty_discovery', ts: '2026-08-28T21:49:16.893Z', totalCandidatesInDatasets: 194, newCandidatesFound: 186, truncatedCount: 156 },
    { type: 'bugbounty_digest', ts: '2026-08-28T21:51:46.971Z', watchedPackagesCount: 3, totalAdvisories: 16 },
  ];
  const data = buildDashboardData({ queueEntries, ledgerEntries: ledgerWithMore, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const sections = renderDashboardSections(data);
  assert.ok(sections.activity.bodyHtml.includes('Descoberta de alvo'));
  assert.ok(sections.activity.bodyHtml.includes('186 candidato'));
  assert.ok(sections.activity.bodyHtml.includes('Digest de segurança'));
  assert.ok(sections.activity.bodyHtml.includes('16 advisory'));
});

test('página de estatística mostra as duas quebras (linguagem e programa)', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const sections = renderDashboardSections(data);
  assert.ok(sections.stats.bodyHtml.includes('Por tipo × linguagem'));
  assert.ok(sections.stats.bodyHtml.includes('Por tipo × programa'));
});

test('renderDashboardApp produz UM documento autocontido com as 5 seções e navegação por hash', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: '2026-08-28T21:20:00Z' });
  const html = renderDashboardApp(data);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<title>Centro de Sinais</title>'));
  ['page-index', 'page-targets', 'page-queue', 'page-activity', 'page-signals', 'page-stats'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `esperava seção ${id}`);
  });
  ['#index', '#targets', '#queue', '#activity', '#signals', '#stats'].forEach((href) => {
    assert.ok(html.includes(`href="${href}"`), `esperava link de nav ${href}`);
  });
  assert.ok(html.includes('cashapp/hermit')); // conteúdo da página de alvos presente no mesmo doc
  assert.ok(html.includes('hashchange')); // roteamento client-side presente
});

test('renderDashboardApp escapa conteúdo pra evitar quebra de HTML', () => {
  const evilQueue = [{ id: '1', type: '<script>evil</script>', language: 'go', program: 'X', platform: 'Y', status: 'reviewed', verdict: 'confirmado', foundAt: '2026-01-01T00:00:00Z', file: 'x', function: 'y' }];
  const data = buildDashboardData({ queueEntries: evilQueue, ledgerEntries: [], stats: { byTypeLanguage: {}, byTypeProgram: {} }, targetLists: {}, lastScanSummary: null, lastScanAt: null });
  const html = renderDashboardApp(data);
  assert.ok(!html.includes('<script>evil</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('funil de estado (banco v2) mostra só estados com pelo menos 1 achado, na ordem real do pipeline', () => {
  const data = buildDashboardData({
    queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null,
    dbStateCounts: { candidate: 5, human_ready: 1, false_positive: 38, reproduced_local: 2 },
  });
  assert.deepEqual(data.statePipeline.map((s) => s.state), ['candidate', 'reproduced_local', 'human_ready', 'false_positive']);
  const sections = renderDashboardSections(data);
  assert.ok(sections.index.bodyHtml.includes('Funil de estado'));
  assert.ok(sections.index.bodyHtml.includes('funnel-row'));
});

test('página de atividade mostra transição de estado com from/to/rationale', () => {
  const withTransition = [...ledgerEntries, { type: 'bugbounty_state_transition', ts: '2026-08-31T18:00:00Z', findingId: 'Circle BBP::x.rs::f::risk', from: 'scope_verified', to: 'human_ready', actor: 'claude', rationale: 'rascunho de relatório pronto + checagem de duplicata feita' }];
  const data = buildDashboardData({ queueEntries, ledgerEntries: withTransition, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const sections = renderDashboardSections(data);
  assert.ok(sections.activity.bodyHtml.includes('scope_verified'));
  assert.ok(sections.activity.bodyHtml.includes('human_ready'));
  assert.ok(sections.activity.bodyHtml.includes('checagem de duplicata feita'));
});

test('terminal de decisões na Visão geral mostra a transição mais recente com o motivo', () => {
  const withTransition = [{ type: 'bugbounty_state_transition', ts: '2026-08-31T18:00:00Z', findingId: 'Block Open Source::wire.kt::f::path_traversal_risk', from: 'scope_verified', to: 'human_ready', actor: 'claude', rationale: 'programa bloqueado' }];
  const data = buildDashboardData({ queueEntries, ledgerEntries: withTransition, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  assert.equal(data.decisionEntries.length, 1);
  const sections = renderDashboardSections(data);
  assert.ok(sections.index.bodyHtml.includes('terminal-body'));
  assert.ok(sections.index.bodyHtml.includes('programa bloqueado'));
});

test('terminal de decisões mostra estado vazio honesto quando não há transição nenhuma', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries: [], stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const sections = renderDashboardSections(data);
  assert.ok(sections.index.bodyHtml.includes('nenhuma transição de estado registrada'));
});

test('página de Sinais mostra grau de evidência, política de programa, quarentena e promoção — cada um só quando há dado real', () => {
  const data = buildDashboardData({
    queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null,
    dbFindings: [
      { id: 'Block Open Source::wire.kt::f::path_traversal_risk', program: 'Block Open Source', state: 'scope_verified', evidenceGrade: 'E3' },
      { id: 'Circle BBP::x.rs::f::risk', program: 'Circle BBP', state: 'reproduced_local', evidenceGrade: 'E3' },
    ],
    programPolicy: { 'Block Open Source': { aiResearchBanned: true, reason: 'proíbe pesquisa assistida por IA' } },
    quarantined: [{ type: 'ssrf_risk', language: 'js', fpRate: 1, reviewed: 13, falsePositive: 13 }],
    promotionLog: {
      generatedAt: '2026-08-31T18:44:50Z',
      totalActiveAutoPromoted: 2,
      promotedThisRound: [{ program: 'Kubernetes', owner: 'kubernetes', repo: 'apimachinery', score: 20, reasons: ['901 estrelas'] }],
      skippedThisRound: { blockedProgram: [], unsupportedLanguage: [{ owner: 'a', repo: 'b' }], tooLarge: [], insufficientSignal: [{ owner: 'c', repo: 'd', score: 0 }], metadataFetchFailed: [], deferredToNextRun: [], alreadyPromoted: 0 },
    },
  });
  const sections = renderDashboardSections(data);
  assert.ok(sections.signals.bodyHtml.includes('E3'));
  assert.ok(sections.signals.bodyHtml.includes('Block Open Source'));
  assert.ok(sections.signals.bodyHtml.includes('proíbe pesquisa assistida por IA'));
  assert.ok(sections.signals.bodyHtml.includes('ssrf_risk'));
  assert.ok(sections.signals.bodyHtml.includes('kubernetes/apimachinery'));
  assert.ok(sections.signals.bodyHtml.includes('901 estrelas'));
  assert.ok(sections.signals.bodyHtml.includes('Linguagem não suportada'));
});

test('página de Sinais lida com tudo ausente sem quebrar (nenhuma política, quarentena ou promoção ainda)', () => {
  const data = buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary: null, lastScanAt: null });
  const sections = renderDashboardSections(data);
  assert.ok(sections.signals.bodyHtml.includes('Nenhum programa bloqueado por política agora'));
  assert.ok(sections.signals.bodyHtml.includes('Nenhuma regra quarentenada agora'));
  assert.ok(sections.signals.bodyHtml.includes('Pipeline de promoção automática de alvo ainda não rodou') || sections.signals.bodyHtml.includes('ainda não rodou nesta cópia'));
});

test('lida com estado totalmente vazio sem quebrar (honesto, sem dado fabricado)', () => {
  const data = buildDashboardData({ queueEntries: [], ledgerEntries: [], stats: { byTypeLanguage: {}, byTypeProgram: {} }, targetLists: {}, lastScanSummary: null, lastScanAt: null });
  const sections = renderDashboardSections(data);
  assert.ok(sections.index.bodyHtml.includes('Nenhum achado registrado ainda.'));
  assert.ok(sections.queue.bodyHtml.includes('A fila está vazia'));
  assert.ok(sections.activity.bodyHtml.includes('Nenhuma atividade registrada ainda.'));
});
