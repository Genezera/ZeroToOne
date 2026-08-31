// Centro de Sinais — site estático multi-página do "centro de operações",
// gerado do zero a cada rodada do scanner com os dados reais do momento
// (fila completa, histórico de atividade do ledger, estatística de
// veredito, alvos ativos). Sem framework, sem dependência — abre local
// (file://), sempre reflete o estado mais recente depois de cada rodada.
// Publicar isso como link é sempre um INSTANTÂNEO daquele momento, não uma
// página com dado ao vivo (a página não tem como ler o repositório privado
// sem expor credencial) — documentado no rodapé de cada página.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openDb, listFindings, stateCounts, closeDb, getFinding, listValidations, latestPlatformOutcome } from './db.mjs';
import { getEvidenceGrade } from './evidence-grade.mjs';
import { loadProgramPolicy, getBlockReason } from './program-policy.mjs';
import { computeQuarantinedRules } from './quarantine.mjs';

/** Snapshot do banco v2 (state machine + grau de evidência) -- adicionado
 * 31/08/2026. Até aqui o painel só conhecia queue.jsonl (status/verdict
 * antigos); o pipeline de estado de verdade (candidate->...->human_ready
 * ->submitted->outcome) nunca aparecia visualmente, apesar de ser onde
 * mora todo achado avançado desta missão (Solana em reproduced_local,
 * wire-schema bloqueado em human_ready por política de programa, etc.).
 * Isolado em try/catch: banco ausente/erro de leitura vira painel vazio
 * (honesto), nunca quebra a geração do resto do dashboard. */
function loadDbSnapshot(dbPath) {
  if (!dbPath || !existsSync(dbPath)) return { findings: [], counts: {} };
  let db;
  try {
    db = openDb(dbPath);
    const findings = listFindings(db, {}).map((f) => ({
      ...f,
      evidenceGrade: getEvidenceGrade(db, f.id, { getFinding, listValidations, latestPlatformOutcome }),
    }));
    const counts = stateCounts(db);
    return { findings, counts };
  } catch (err) {
    return { findings: [], counts: {}, error: err.message };
  } finally {
    if (db) closeDb(db);
  }
}

function loadQuarantineOverrides(filePath) {
  if (!filePath || !existsSync(filePath)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(filePath, 'utf8'));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function loadQueue(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function loadJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LANGUAGE_LABEL = { clarity: 'Clarity', js: 'JS/TS', go: 'Go', jvm: 'Kotlin/Java', swift: 'Swift/ObjC', unknown: '?' };

// Ordem conceitual do pipeline real (state-machine.mjs) -- não é ordem
// alfabética nem de contagem, é a ordem em que um achado REALMENTE anda
// (candidate -> ... -> human_ready -> submitted -> outcome), com os
// estados de refutação (false_positive/inconclusive/known_duplicate) no
// fim por serem saídas laterais, não passos do funil principal.
const STATE_PIPELINE_ORDER = ['candidate', 'corroborated_static', 'reproduced_local', 'scope_verified', 'human_ready', 'submitted', 'triaged', 'paid', 'resolved', 'duplicate', 'informative', 'rejected', 'false_positive', 'inconclusive', 'known_duplicate'];
const STATE_LABEL = {
  candidate: 'Candidato', corroborated_static: 'Corroborado (estático)', reproduced_local: 'Reproduzido (local)',
  scope_verified: 'Escopo verificado', human_ready: 'Pronto p/ humano', submitted: 'Enviado',
  triaged: 'Triado', paid: 'Pago', resolved: 'Resolvido', duplicate: 'Duplicata', informative: 'Informativo',
  rejected: 'Rejeitado', false_positive: 'Falso positivo', inconclusive: 'Inconclusivo', known_duplicate: 'Duplicata conhecida',
};
const EVIDENCE_GRADE_ORDER = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5'];

// ---------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------

/** Molda todos os dados que as 5 páginas precisam — função pura, testável
 * sem tocar disco. ledgerEntries já deve vir filtrado (só bugbounty_*). */
export function buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary, lastScanAt, dbFindings = [], dbStateCounts = {}, programPolicy = {}, quarantined = [], promotionLog = null }) {
  const pending = queueEntries.filter((e) => e.status === 'pending');
  const reviewed = queueEntries.filter((e) => e.status && e.status !== 'pending');
  const confirmed = reviewed.filter((e) => e.verdict === 'confirmado');
  const falsePositive = reviewed.filter((e) => e.verdict === 'falso_positivo');

  const targetRows = [];
  for (const [language, list] of Object.entries(targetLists)) {
    for (const t of list) {
      const target = t.repo ? `${t.owner}/${t.repo}` : `${(t.contracts || []).length} contrato(s)`;
      targetRows.push({
        language,
        program: t.program,
        platform: t.platform,
        target,
        branch: t.branch || '—',
        pathPrefixes: t.pathPrefixes || null,
        maxBountyUsd: t.maxBountyUsd,
      });
    }
  }
  const programsCount = new Set(targetRows.map((r) => r.program)).size;
  const languagesCount = new Set(targetRows.map((r) => r.language)).size;

  const queueSorted = [...queueEntries].sort((a, b) => (b.foundAt || '').localeCompare(a.foundAt || ''));
  const activitySorted = [...ledgerEntries].sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

  const heuristicByLanguage = Object.entries(stats?.byTypeLanguage || {})
    .map(([key, t]) => {
      const [type, language] = key.split('::');
      return { type, language: LANGUAGE_LABEL[language] || language, ...t };
    })
    .sort((a, b) => (b.fpRate ?? -1) - (a.fpRate ?? -1));

  const heuristicByProgram = Object.entries(stats?.byTypeProgram || {})
    .map(([key, t]) => {
      const [type, program] = key.split('::');
      return { type, program, ...t };
    })
    .sort((a, b) => (b.fpRate ?? -1) - (a.fpRate ?? -1));

  // Funil real do state-machine.mjs -- só estados com pelo menos 1 achado
  // aparecem (nunca fabrica uma barra de "0 de tudo" pra estado que a
  // missão nunca alcançou ainda).
  const statePipeline = STATE_PIPELINE_ORDER
    .map((state) => ({ state, label: STATE_LABEL[state] || state, count: dbStateCounts[state] || 0 }))
    .filter((s) => s.count > 0);
  const totalDbFindings = Object.values(dbStateCounts).reduce((a, b) => a + b, 0);

  const evidenceGradeCounts = {};
  for (const f of dbFindings) {
    const g = f.evidenceGrade || 'E0';
    evidenceGradeCounts[g] = (evidenceGradeCounts[g] || 0) + 1;
  }
  const evidenceGradeRows = EVIDENCE_GRADE_ORDER.map((g) => ({ grade: g, count: evidenceGradeCounts[g] || 0 })).filter((g) => g.count > 0);

  // Achado que só não avança porque o PROGRAMA está bloqueado (não porque
  // faltou evidência) -- distinção real: isso é sobre elegibilidade, não
  // sobre qualidade da investigação (mesmo princípio de evidence-grade.mjs).
  const policyBlockedFindings = dbFindings
    .map((f) => ({ f, reason: getBlockReason(f.program, programPolicy) }))
    .filter((x) => x.reason)
    .map((x) => ({ id: x.f.id, program: x.f.program, state: x.f.state, evidenceGrade: x.f.evidenceGrade, reason: x.reason }));

  const decisionEntries = activitySorted.filter((e) => e.type === 'bugbounty_state_transition');

  return {
    lastScanAt,
    lastScanSummary: lastScanSummary || null,
    totals: {
      targets: targetRows.length,
      programs: programsCount,
      languages: languagesCount,
      pending: pending.length,
      reviewed: reviewed.length,
      confirmed: confirmed.length,
      falsePositive: falsePositive.length,
      scanRuns: ledgerEntries.filter((e) => e.type === 'bugbounty_scan').length,
      dbFindings: totalDbFindings,
    },
    targetRows,
    queueEntries: queueSorted,
    activityEntries: activitySorted,
    decisionEntries,
    heuristicByLanguage,
    heuristicByProgram,
    statePipeline,
    totalDbFindings,
    evidenceGradeRows,
    policyBlockedFindings,
    programPolicy,
    quarantined,
    promotionLog,
  };
}

// ---------------------------------------------------------------------
// Componentes compartilhados (design system — ver research/bugbounty/
// dashboard/, tema "Centro de Sinais": estação de sinal/radar)
// ---------------------------------------------------------------------

const SHARED_STYLES = `
:root {
  --ground: #0b0f17;
  --surface: #131a26;
  --surface-2: #1b2433;
  --border: #232d3d;
  --ink: #e8ecf2;
  --ink-muted: #8996ab;
  --ink-faint: #5c6b82;
  --accent: #f5943d;
  --accent-glow: rgba(245, 148, 61, 0.25);
  --good: #5ec9a6;
  --critical: #ff5c5c;
  --info: #6e8cff;
  --font-display: 'Big Shoulders', 'Arial Narrow', sans-serif;
  --font-body: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', 'Courier New', monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--ground); color: var(--ink); font-family: var(--font-body); min-height: 100vh; }
a { color: inherit; }
.shell { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
@media (max-width: 760px) { .shell { grid-template-columns: 1fr; } }

.sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 24px 18px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
@media (max-width: 760px) { .sidebar { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border); } }
.brand { font-family: var(--font-display); font-weight: 800; font-size: 22px; letter-spacing: 0.01em; margin-bottom: 2px; }
.brand-eyebrow { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
.pulse-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-right: 6px; box-shadow: 0 0 0 0 var(--accent-glow); animation: pulse 2.4s ease-out infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 var(--accent-glow); } 70% { box-shadow: 0 0 0 8px rgba(245,148,61,0); } 100% { box-shadow: 0 0 0 0 rgba(245,148,61,0); } }
@media (prefers-reduced-motion: reduce) { .pulse-dot { animation: none; } }

.nav { list-style: none; margin: 22px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
@media (max-width: 760px) { .nav { flex-direction: row; flex-wrap: wrap; margin-top: 14px; } }
.nav a { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 7px; font-size: 13.5px; color: var(--ink-muted); text-decoration: none; transition: background 0.12s ease, color 0.12s ease; }
.nav a:hover { background: var(--surface-2); color: var(--ink); }
.nav a[aria-current="page"] { background: var(--surface-2); color: var(--accent); font-weight: 600; }
.nav-icon { font-family: var(--font-mono); font-size: 11px; opacity: 0.7; }

.sidebar-foot { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-faint); line-height: 1.6; }

.main { padding: 36px 40px 60px; max-width: 1180px; }
@media (max-width: 760px) { .main { padding: 24px 18px 48px; } }
h1 { font-family: var(--font-display); font-weight: 800; font-size: clamp(28px, 4vw, 42px); letter-spacing: 0.01em; margin: 0 0 6px; text-wrap: balance; }
.page-sub { color: var(--ink-muted); font-size: 14.5px; max-width: 70ch; margin: 0 0 28px; }
h2 { font-family: var(--font-display); font-weight: 700; font-size: 19px; margin: 0 0 4px; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 28px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; opacity: 0; animation: rise 0.5s ease forwards; animation-delay: calc(var(--i, 0) * 0.05s); }
.tile-value { font-family: var(--font-display); font-weight: 700; font-size: 34px; font-variant-numeric: tabular-nums; line-height: 1; }
.tile-label { font-size: 11.5px; color: var(--ink-muted); margin-top: 5px; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 22px; margin-bottom: 20px; }
.panel-sub { color: var(--ink-faint); font-size: 12.5px; margin-bottom: 16px; }

.chip { font-family: var(--font-mono); font-size: 10.5px; padding: 2px 8px; border-radius: 999px; letter-spacing: 0.02em; white-space: nowrap; }
.chip-info { background: rgba(110,140,255,0.15); color: var(--info); }
.chip-good { background: rgba(94,201,166,0.15); color: var(--good); }
.chip-critical { background: rgba(255,92,92,0.15); color: var(--critical); }
.chip-muted { background: rgba(137,150,171,0.15); color: var(--ink-muted); }
.chip-accent { background: rgba(245,148,61,0.15); color: var(--accent); }

.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 13px 15px; opacity: 0; animation: rise 0.45s ease forwards; animation-delay: calc(var(--i, 0) * 0.03s); transition: transform 0.15s ease, border-color 0.15s ease; }
.card:hover { transform: translateY(-2px); border-color: var(--accent); }
.card-eyebrow { font-family: var(--font-mono); font-size: 10.5px; color: var(--accent); letter-spacing: 0.06em; text-transform: uppercase; }
.card-title { font-family: var(--font-mono); font-size: 13px; margin-top: 4px; overflow-wrap: anywhere; }
.card-meta { font-size: 11px; color: var(--ink-faint); margin-top: 4px; }
.card-kv { font-size: 11px; color: var(--ink-muted); margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px 10px; }

.filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.filters select, .filters input { background: var(--surface-2); border: 1px solid var(--border); color: var(--ink); font-family: var(--font-mono); font-size: 12px; padding: 7px 10px; border-radius: 6px; }
.filters .count { font-family: var(--font-mono); font-size: 12px; color: var(--ink-faint); align-self: center; margin-left: auto; }

.finding-list { display: flex; flex-direction: column; gap: 10px; }
.finding { background: var(--surface-2); border: 1px solid var(--border); border-left: 3px solid var(--ink-faint); border-radius: 8px; padding: 14px 16px; opacity: 0; animation: rise 0.4s ease forwards; animation-delay: calc(var(--i, 0) * 0.02s); }
.finding[data-verdict="confirmado"] { border-left-color: var(--info); }
.finding[data-verdict="falso_positivo"] { border-left-color: var(--good); }
.finding[data-status="pending"] { border-left-color: var(--accent); }
.finding-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.finding-type { font-weight: 600; font-size: 14.5px; }
.finding-time { font-family: var(--font-mono); font-size: 11px; color: var(--ink-faint); white-space: nowrap; }
.finding-meta { font-size: 12px; color: var(--ink-muted); margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.finding-file { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-faint); margin-top: 6px; overflow-wrap: anywhere; }
.finding-note { font-size: 12.5px; color: var(--ink-muted); margin-top: 8px; line-height: 1.5; }
.finding-reasoning { font-size: 12.5px; color: var(--ink); margin-top: 8px; line-height: 1.5; background: var(--surface); border-radius: 6px; padding: 10px 12px; border: 1px solid var(--border); }
.finding-reasoning-label { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); margin-bottom: 4px; }

.timeline { position: relative; padding-left: 22px; }
.timeline::before { content: ''; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: var(--border); }
.timeline-item { position: relative; padding-bottom: 20px; opacity: 0; animation: rise 0.4s ease forwards; animation-delay: calc(var(--i, 0) * 0.03s); }
.timeline-item::before { content: ''; position: absolute; left: -22px; top: 3px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); border: 2px solid var(--ground); }
.timeline-item[data-kind="verdict"]::before { background: var(--info); }
.timeline-item[data-kind="discovery"]::before { background: var(--good); }
.timeline-item[data-kind="digest"]::before { background: var(--critical); }
.timeline-item[data-kind="transition"]::before { background: var(--accent); }
.timeline-body a { color: var(--accent); }
.timeline-time { font-family: var(--font-mono); font-size: 11px; color: var(--ink-faint); }
.timeline-title { font-size: 13.5px; font-weight: 500; margin-top: 2px; }
.timeline-body { font-size: 12px; color: var(--ink-muted); margin-top: 3px; }

.bar-row { display: grid; grid-template-columns: 1.3fr 2fr auto; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
.bar-row:last-child { border-bottom: none; }
.bar-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-lang { font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-faint); }
.bar-track { height: 8px; background: var(--surface); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; width: var(--pct); transform: scaleX(0); transform-origin: left; transition: transform 0.8s cubic-bezier(.16,1,.3,1); transition-delay: calc(var(--i, 0) * 0.06s); }
.bar-fill.show { transform: scaleX(1); }
.bar-value { font-family: var(--font-mono); font-size: 12px; color: var(--ink-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bar-n { color: var(--ink-faint); }

.empty { color: var(--ink-faint); font-size: 13px; padding: 14px 0; }
footer.page-footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 11.5px; color: var(--ink-faint); line-height: 1.6; }

.page { display: none; }
.page.active { display: block; animation: pageIn 0.32s cubic-bezier(.16,1,.3,1); }
@keyframes pageIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .page.active { animation: none; } }

.nav a { transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease; }
.nav a:active { transform: scale(0.97); }

.funnel { display: flex; flex-direction: column; gap: 6px; }
.funnel-row { display: grid; grid-template-columns: 150px 1fr auto; gap: 12px; align-items: center; }
.funnel-label { font-size: 12.5px; color: var(--ink-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.funnel-track { height: 20px; background: var(--surface-2); border-radius: 5px; overflow: hidden; }
.funnel-fill { height: 100%; border-radius: 5px; width: var(--pct); min-width: 3px; transform: scaleX(0); transform-origin: left; transition: transform 0.7s cubic-bezier(.16,1,.3,1); transition-delay: calc(var(--i, 0) * 0.05s); background: linear-gradient(90deg, var(--info), var(--accent)); }
.funnel-fill.terminal-good { background: linear-gradient(90deg, var(--good), #3fae8a); }
.funnel-fill.terminal-bad { background: linear-gradient(90deg, var(--ink-faint), #47536a); }
.funnel-fill.show { transform: scaleX(1); }
.funnel-value { font-family: var(--font-mono); font-size: 12px; color: var(--ink-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }

.terminal { background: #05070b; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.terminal-bar { display: flex; align-items: center; gap: 6px; padding: 9px 12px; background: #0d1219; border-bottom: 1px solid var(--border); }
.terminal-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--border); }
.terminal-title { margin-left: 8px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-faint); }
.terminal-body { padding: 14px 16px; font-family: var(--font-mono); font-size: 12px; line-height: 1.7; max-height: 360px; overflow-y: auto; }
.terminal-line { white-space: pre-wrap; overflow-wrap: anywhere; opacity: 0; animation: rise 0.3s ease forwards; animation-delay: calc(var(--i, 0) * 0.04s); }
.terminal-prompt { color: var(--good); }
.terminal-arrow { color: var(--accent); }
.terminal-dim { color: var(--ink-faint); }
.terminal-empty { color: var(--ink-faint); font-family: var(--font-mono); font-size: 12px; }

.grade-row { display: flex; align-items: center; gap: 10px; }
.grade-badge { font-family: var(--font-mono); font-weight: 700; font-size: 12px; width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; background: var(--surface-2); border: 1px solid var(--border); flex-shrink: 0; }
.grade-badge.g-E0, .grade-badge.g-E1 { color: var(--ink-faint); }
.grade-badge.g-E2 { color: var(--info); }
.grade-badge.g-E3, .grade-badge.g-E4 { color: var(--accent); }
.grade-badge.g-E5 { color: var(--good); }

.signal-block { border-left: 3px solid var(--critical); background: var(--surface-2); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; }
.signal-block.ok { border-left-color: var(--good); }
.signal-title { font-weight: 600; font-size: 13.5px; }
.signal-meta { font-size: 12px; color: var(--ink-muted); margin-top: 4px; }
`;

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">`;

const NAV_ITEMS = [
  { key: 'index', label: 'Visão geral', icon: '◎' },
  { key: 'targets', label: 'Alvos', icon: '▤' },
  { key: 'queue', label: 'Fila completa', icon: '≡' },
  { key: 'activity', label: 'Atividade ao vivo', icon: '↯' },
  { key: 'signals', label: 'Sinais', icon: '◈' },
  { key: 'stats', label: 'Estatística', icon: '▲' },
];

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  } catch {
    return iso;
  }
}

function verdictChip(verdict, status) {
  if (status === 'pending') return `<span class="chip chip-accent">pendente</span>`;
  if (verdict === 'confirmado') return `<span class="chip chip-info">confirmado</span>`;
  if (verdict === 'falso_positivo') return `<span class="chip chip-good">falso positivo</span>`;
  return `<span class="chip chip-muted">${esc(verdict || '—')}</span>`;
}

function fpBarColor(fpRate) {
  if (fpRate === null || fpRate === undefined) return 'var(--info)';
  if (fpRate < 0.34) return 'var(--good)';
  if (fpRate < 0.67) return 'var(--accent)';
  return 'var(--critical)';
}

/** Uma "página" agora é uma <section> dentro do MESMO documento, trocada
 * via hash (#targets, #queue...) — não um arquivo .html separado. Isso é
 * proposital: um Artifact publicado só serve UM arquivo, então links entre
 * páginas separadas quebrariam na versão publicada; navegação por hash
 * funciona idêntico local (file://) e publicado. */
function renderSection({ key, title, subtitle, bodyHtml }) {
  return `<section class="page" id="page-${key}" data-page="${key}">
    <h1>${esc(title)}</h1>
    ${subtitle ? `<div class="page-sub">${subtitle}</div>` : ''}
    ${bodyHtml}
  </section>`;
}

function renderApp({ sections, lastScanAt, extraScripts }) {
  const navHtml = NAV_ITEMS.map(
    (n) => `<li><a href="#${n.key}" data-nav="${n.key}"${n.key === 'index' ? ' aria-current="page"' : ''}><span class="nav-icon">${n.icon}</span>${esc(n.label)}</a></li>`
  ).join('');
  const sectionsHtml = sections.map((s) => renderSection(s)).join('\n');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Centro de Sinais</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${FONT_LINK}
<style>${SHARED_STYLES}</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <div class="brand-eyebrow">ZeroToOne · Bug Bounty</div>
    <div class="brand">Centro de Sinais</div>
    <ul class="nav">${navHtml}</ul>
    <div class="sidebar-foot"><span class="pulse-dot"></span>Última rodada<br>${esc(fmtTime(lastScanAt))}</div>
  </aside>
  <main class="main">
    ${sectionsHtml}
    <footer class="page-footer">Gerado automaticamente por <code>generate-dashboard.mjs</code> a cada rodada do scanner. Instantâneo deste momento — não é uma página com dado ao vivo (o repositório é privado). Pra ver sempre a versão mais recente, abra o arquivo local em <code>research/bugbounty/dashboard/index.html</code>.</footer>
  </main>
</div>
<script>
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('[data-nav]'));
  var animated = {};

  function runAnimations(key) {
    if (animated[key]) return;
    animated[key] = true;
    var root = document.getElementById('page-' + key);
    if (!root) return;
    root.querySelectorAll('[data-countup]').forEach(function (el) {
      var target = parseInt(el.getAttribute('data-countup'), 10) || 0;
      if (reduce) { el.textContent = target; return; }
      var start = null, dur = 800;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        el.textContent = Math.round((1 - Math.pow(1 - p, 3)) * target);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    requestAnimationFrame(function () {
      root.querySelectorAll('.bar-fill, .funnel-fill').forEach(function (el) { el.classList.add('show'); });
    });
  }

  function showPage(key) {
    var valid = pages.some(function (p) { return p.dataset.page === key; });
    if (!valid) key = 'index';
    pages.forEach(function (p) { p.classList.toggle('active', p.dataset.page === key); });
    navLinks.forEach(function (a) { if (a.dataset.nav === key) { a.setAttribute('aria-current', 'page'); } else { a.removeAttribute('aria-current'); } });
    runAnimations(key);
    document.title = 'Centro de Sinais' + (key === 'index' ? '' : ' — ' + a11yLabel(key));
  }
  function a11yLabel(key) {
    var found = navLinks.find ? navLinks.find(function (a) { return a.dataset.nav === key; }) : null;
    return found ? found.textContent.trim() : key;
  }
  window.addEventListener('hashchange', function () { showPage(location.hash.slice(1)); });
  showPage(location.hash.slice(1) || 'index');
})();
${extraScripts}
</script>
</body>
</html>`;
}

function statTile(value, label, i) {
  return `<div class="tile" style="--i:${i}"><div class="tile-value" data-countup="${value}">0</div><div class="tile-label">${esc(label)}</div></div>`;
}

/** Funil do pipeline real (state-machine.mjs) -- barra por estado, na
 * ordem em que um achado de verdade progride, largura relativa ao maior
 * valor presente (não ao total, senão candidate sempre dominaria tudo e
 * esconderia a diferença entre os estados avançados). */
function renderPipelineFunnel(statePipeline) {
  if (!statePipeline.length) return `<div class="empty">Nenhum achado no banco de estado ainda.</div>`;
  const max = Math.max(...statePipeline.map((s) => s.count));
  const TERMINAL_GOOD = new Set(['paid', 'resolved', 'triaged']);
  const TERMINAL_NEUTRAL = new Set(['false_positive', 'inconclusive', 'known_duplicate', 'duplicate', 'informative', 'rejected']);
  return `<div class="funnel">${statePipeline
    .map((s, i) => {
      const pct = Math.max(3, Math.round((s.count / max) * 100));
      const cls = TERMINAL_GOOD.has(s.state) ? 'terminal-good' : TERMINAL_NEUTRAL.has(s.state) ? 'terminal-bad' : '';
      return `<div class="funnel-row" style="--i:${i}">
        <div class="funnel-label">${esc(s.label)}</div>
        <div class="funnel-track"><div class="funnel-fill ${cls}" style="--pct:${pct}%"></div></div>
        <div class="funnel-value">${s.count}</div>
      </div>`;
    })
    .join('')}</div>`;
}

function decisionLine(entry, i) {
  const from = entry.from ? esc(entry.from) : '?';
  const to = esc(entry.to || '?');
  const actor = entry.actor ? ` <span class="terminal-dim">(${esc(entry.actor)})</span>` : '';
  const rationale = entry.rationale ? `\n        <span class="terminal-dim">→ ${esc(entry.rationale)}</span>` : '';
  return `<div class="terminal-line" style="--i:${i}"><span class="terminal-prompt">$</span> transition <span class="terminal-dim">${esc((entry.findingId || '').slice(0, 70))}</span>
        ${from} <span class="terminal-arrow">→</span> ${to}${actor}${rationale}</div>`;
}

/** "Terminal" com as últimas decisões reais da state machine (from->to +
 * motivo) -- resposta direta a "o que está pensando, que decisão está
 * tomando": não é log genérico, é literalmente a razão gravada por
 * state-machine.mjs pra cada transição, no mesmo texto que reprova ou
 * aprova a mudança de estado. */
function renderDecisionTerminal(decisionEntries, limit = 12) {
  const shown = decisionEntries.slice(0, limit);
  const body = shown.length
    ? shown.map((e, i) => decisionLine(e, i)).join('\n')
    : `<div class="terminal-empty">$ nenhuma transição de estado registrada ainda</div>`;
  return `<div class="terminal">
    <div class="terminal-bar"><span class="terminal-dot"></span><span class="terminal-dot"></span><span class="terminal-dot"></span><span class="terminal-title">decisões-da-state-machine</span></div>
    <div class="terminal-body">${body}</div>
  </div>`;
}

// ---------------------------------------------------------------------
// Página: Visão geral
// ---------------------------------------------------------------------

function renderOverviewPage(data) {
  const { totals, targetRows, queueEntries, activityEntries, heuristicByLanguage, lastScanSummary, lastScanAt, statePipeline, decisionEntries } = data;

  const scanLine = lastScanSummary
    ? `${lastScanSummary.contractsChecked ?? 0} contrato(s) Clarity, ${lastScanSummary.repoFilesChecked ?? 0} arquivo(s) de código e ${lastScanSummary.manifestsChecked ?? 0} manifesto(s) de dependência checados na última rodada, ${lastScanSummary.fetchErrors ?? 0} erro(s) de busca.`
    : 'Varredura estática multi-linguagem, mais retroalimentação de veredito, cross-referência de dependência/CVE e revisão por IA.';

  const recentFindings = queueEntries.slice(0, 6);
  const findingsHtml = recentFindings.length
    ? `<div class="finding-list">${recentFindings.map((e, i) => findingCard(e, i)).join('')}</div>`
    : `<div class="empty">Nenhum achado registrado ainda.</div>`;

  const recentActivity = activityEntries.slice(0, 6);
  const activityHtml = recentActivity.length
    ? `<div class="timeline">${recentActivity.map((e, i) => timelineItem(e, i)).join('')}</div>`
    : `<div class="empty">Nenhuma rodada registrada ainda.</div>`;

  const topBars = heuristicByLanguage.slice(0, 5);
  const barsHtml = topBars.length
    ? topBars.map((h, i) => barRow(h, LANGUAGE_LABEL[h.language] || h.language, i)).join('')
    : `<div class="empty">Ainda sem amostra suficiente pra estatística.</div>`;

  return {
    key: 'index',
    title: 'Visão geral',
    subtitle: esc(scanLine),
    bodyHtml: `
    <div class="tiles">
      ${statTile(totals.targets, 'Alvos ativos', 0)}
      ${statTile(totals.programs, 'Programas', 1)}
      ${statTile(totals.languages, 'Linguagens', 2)}
      ${statTile(totals.scanRuns, 'Rodadas registradas', 3)}
      ${statTile(totals.pending, 'Sinais pendentes', 4)}
      ${statTile(totals.reviewed, 'Já revisados', 5)}
    </div>
    <div class="panel">
      <h2>Funil de estado (banco v2)</h2>
      <div class="panel-sub">Onde cada achado está de verdade no pipeline candidate → ... → human_ready → submitted → resultado — ver <a href="#signals">Sinais</a> pra grau de evidência e bloqueios de política.</div>
      ${renderPipelineFunnel(statePipeline)}
    </div>
    <div class="panel">
      <h2>Decisões em tempo real</h2>
      <div class="panel-sub">As últimas transições de estado, com o motivo exato que a state machine aceitou ou recusou.</div>
      ${renderDecisionTerminal(decisionEntries)}
    </div>
    <div class="panel">
      <h2>Últimos achados</h2>
      <div class="panel-sub"><a href="#queue">Ver a fila completa →</a></div>
      ${findingsHtml}
    </div>
    <div class="panel">
      <h2>Atividade recente</h2>
      <div class="panel-sub"><a href="#activity">Ver o histórico completo →</a></div>
      ${activityHtml}
    </div>
    <div class="panel">
      <h2>Heurísticas mais ruidosas</h2>
      <div class="panel-sub"><a href="#stats">Ver estatística completa →</a></div>
      ${barsHtml}
    </div>`,
  };
}

// ---------------------------------------------------------------------
// Página: Alvos
// ---------------------------------------------------------------------

function renderTargetsPage(data) {
  const { targetRows } = data;
  const byLanguage = {};
  for (const r of targetRows) {
    byLanguage[r.language] = byLanguage[r.language] || [];
    byLanguage[r.language].push(r);
  }
  const groupedHtml = Object.entries(byLanguage)
    .map(([language, rows]) => {
      const cards = rows
        .map(
          (r, i) => `
        <div class="card" style="--i:${i}">
          <div class="card-eyebrow">${esc(r.platform)}</div>
          <div class="card-title">${esc(r.target)}</div>
          <div class="card-meta">${esc(r.program)} · branch ${esc(r.branch)}</div>
          <div class="card-kv">
            ${r.maxBountyUsd ? `<span>teto US$${esc(r.maxBountyUsd)}</span>` : '<span>teto não publicado</span>'}
            ${r.pathPrefixes ? `<span>escopo: ${r.pathPrefixes.map((p) => esc(p)).join(', ')}</span>` : '<span>escopo: repositório inteiro</span>'}
          </div>
        </div>`
        )
        .join('');
      return `<div class="panel"><h2>${esc(LANGUAGE_LABEL[language] || language)}</h2><div class="panel-sub">${rows.length} alvo(s)</div><div class="card-grid">${cards}</div></div>`;
    })
    .join('');

  return {
    key: 'targets',
    title: 'Alvos ativos',
    subtitle: `${targetRows.length} repositórios/contratos sob varredura contínua, agrupados por linguagem.`,
    bodyHtml: groupedHtml,
  };
}

// ---------------------------------------------------------------------
// Página: Fila completa (com filtro client-side)
// ---------------------------------------------------------------------

function findingCard(e, i) {
  const conf = e.historicalConfidence
    ? `<span class="chip chip-muted">FP histórico ${Math.round(e.historicalConfidence.fpRate * 100)}% (n=${e.historicalConfidence.sampleSize})</span>`
    : '';
  return `
  <div class="finding" style="--i:${i}" data-status="${esc(e.status)}" data-verdict="${esc(e.verdict || '')}" data-program="${esc(e.program)}" data-language="${esc(e.language || '')}">
    <div class="finding-head">
      <div class="finding-type">${esc(e.type)}</div>
      <div class="finding-time">${esc(fmtTime(e.foundAt))}</div>
    </div>
    <div class="finding-meta">
      ${verdictChip(e.verdict, e.status)}
      <span class="chip chip-muted">${esc(LANGUAGE_LABEL[e.language] || e.language || '?')}</span>
      <span>${esc(e.program)} · ${esc(e.platform)}</span>
      ${e.confidence ? `<span class="chip chip-muted">confiança ${esc(e.confidence)}</span>` : ''}
      ${conf}
    </div>
    <div class="finding-file">${esc(e.file)}${e.function ? ' — ' + esc(e.function) : ''}</div>
    ${e.note ? `<div class="finding-note">${esc(e.note)}</div>` : ''}
    ${e.reasoning ? `<div class="finding-reasoning"><div class="finding-reasoning-label">Raciocínio da revisão</div>${esc(e.reasoning)}</div>` : ''}
  </div>`;
}

function renderQueuePage(data) {
  const { queueEntries } = data;
  const programs = [...new Set(queueEntries.map((e) => e.program))].sort();
  const languages = [...new Set(queueEntries.map((e) => e.language).filter(Boolean))].sort();

  const programOptions = programs.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const languageOptions = languages.map((l) => `<option value="${esc(l)}">${esc(LANGUAGE_LABEL[l] || l)}</option>`).join('');

  const listHtml = queueEntries.length
    ? `<div class="finding-list" id="finding-list">${queueEntries.map((e, i) => findingCard(e, i)).join('')}</div>`
    : `<div class="empty">A fila está vazia — nenhum achado ainda.</div>`;

  const script = `
(function () {
  var statusSel = document.getElementById('f-status');
  var programSel = document.getElementById('f-program');
  var languageSel = document.getElementById('f-language');
  var countEl = document.getElementById('f-count');
  var cards = Array.prototype.slice.call(document.querySelectorAll('#finding-list .finding'));
  function apply() {
    var s = statusSel.value, p = programSel.value, l = languageSel.value, visible = 0;
    cards.forEach(function (c) {
      var okS = !s || c.dataset.status === s || (s === 'reviewed' && c.dataset.status !== 'pending');
      var okP = !p || c.dataset.program === p;
      var okL = !l || c.dataset.language === l;
      var show = okS && okP && okL;
      c.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    countEl.textContent = visible + ' de ' + cards.length;
  }
  [statusSel, programSel, languageSel].forEach(function (el) { el.addEventListener('change', apply); });
  apply();
})();`;

  return {
    key: 'queue',
    title: 'Fila completa',
    subtitle: `Todo achado que o scanner já produziu — pendente e revisado, com o raciocínio completo de quem revisou.`,
    bodyHtml: `
    <div class="filters">
      <select id="f-status"><option value="">Todo status</option><option value="pending">Pendente</option><option value="reviewed">Revisado</option></select>
      <select id="f-program"><option value="">Todo programa</option>${programOptions}</select>
      <select id="f-language"><option value="">Toda linguagem</option>${languageOptions}</select>
      <span class="count" id="f-count"></span>
    </div>
    ${listHtml}`,
    extraScript: script,
  };
}

// ---------------------------------------------------------------------
// Página: Atividade ao vivo (histórico do ledger)
// ---------------------------------------------------------------------

function timelineItem(entry, i) {
  if (entry.type === 'bugbounty_scan') {
    const langs = entry.byLanguage ? Object.entries(entry.byLanguage).map(([l, n]) => `${LANGUAGE_LABEL[l] || l}: ${n}`).join(', ') : '';
    return `
    <div class="timeline-item" style="--i:${i}" data-kind="scan">
      <div class="timeline-time">${esc(fmtTime(entry.ts))}</div>
      <div class="timeline-title">Rodada do scanner — ${entry.newFindingsCount ?? 0} achado(s) novo(s), ${entry.newlyReviewedCount ?? 0} veredito(s) atualizado(s)</div>
      <div class="timeline-body">${entry.contractsChecked ?? 0} contrato(s) Clarity, ${entry.repoFilesChecked ?? 0} arquivo(s) de código${entry.manifestsChecked !== undefined ? `, ${entry.manifestsChecked} manifesto(s)` : ''} checados${langs ? ' (' + esc(langs) + ')' : ''}. ${entry.fetchErrors ? entry.fetchErrors + ' erro(s) de busca.' : ''}</div>
    </div>`;
  }
  if (entry.type === 'bugbounty_verdict') {
    return `
    <div class="timeline-item" style="--i:${i}" data-kind="verdict">
      <div class="timeline-time">${esc(fmtTime(entry.ts))}</div>
      <div class="timeline-title">Veredito: ${esc(entry.findingType)} ${verdictChip(entry.verdict)}</div>
      <div class="timeline-body">${esc(entry.program)} (${esc(LANGUAGE_LABEL[entry.language] || entry.language)})${entry.reasoning ? ' — ' + esc(entry.reasoning.slice(0, 220)) + (entry.reasoning.length > 220 ? '…' : '') : ''}</div>
    </div>`;
  }
  if (entry.type === 'bugbounty_discovery') {
    return `
    <div class="timeline-item" style="--i:${i}" data-kind="discovery">
      <div class="timeline-time">${esc(fmtTime(entry.ts))}</div>
      <div class="timeline-title">Descoberta de alvo — ${entry.newCandidatesFound ?? 0} candidato(s) novo(s)</div>
      <div class="timeline-body">${entry.totalCandidatesInDatasets ?? 0} alvo(s) com recompensa real no dataset inteiro (HackerOne+Bugcrowd)${entry.truncatedCount ? `, ${entry.truncatedCount} ficou pra próxima rodada` : ''}. Ver <a href="../discovered-targets.json">discovered-targets.json</a>.</div>
    </div>`;
  }
  if (entry.type === 'bugbounty_state_transition') {
    return `
    <div class="timeline-item" style="--i:${i}" data-kind="transition">
      <div class="timeline-time">${esc(fmtTime(entry.ts))}</div>
      <div class="timeline-title">Transição: ${esc(entry.from || '?')} → ${esc(entry.to || '?')}${entry.actor ? ' — ' + esc(entry.actor) : ''}</div>
      <div class="timeline-body">${esc((entry.findingId || '').slice(0, 90))}${entry.rationale ? '<br>' + esc(entry.rationale) : ''}</div>
    </div>`;
  }
  if (entry.type === 'bugbounty_digest') {
    return `
    <div class="timeline-item" style="--i:${i}" data-kind="digest">
      <div class="timeline-time">${esc(fmtTime(entry.ts))}</div>
      <div class="timeline-title">Digest de segurança — ${entry.totalAdvisories ?? 0} advisory(s) em ${entry.watchedPackagesCount ?? 0} pacote(s) observado(s)</div>
      <div class="timeline-body">Ver <a href="../security-digest.md">security-digest.md</a> pra decisão manual sobre heurística nova.</div>
    </div>`;
  }
  return '';
}

function renderActivityPage(data) {
  const { activityEntries } = data;
  const shown = activityEntries.slice(0, 80);
  const html = shown.length
    ? `<div class="timeline">${shown.map((e, i) => timelineItem(e, i)).join('')}</div>`
    : `<div class="empty">Nenhuma atividade registrada ainda.</div>`;
  const truncNote = activityEntries.length > shown.length ? `<div class="panel-sub">Mostrando as ${shown.length} mais recentes de ${activityEntries.length} entradas totais no ledger.</div>` : '';

  return {
    key: 'activity',
    title: 'Atividade ao vivo',
    subtitle: 'Toda rodada de varredura e todo veredito registrado no ledger encadeado por hash (research/ledger.research.jsonl) — histórico auditável, nunca sobrescrito.',
    bodyHtml: `<div class="panel">${truncNote}${html}</div>`,
  };
}

// ---------------------------------------------------------------------
// Página: Sinais (política de programa, quarentena, grau de evidência,
// pipeline de promoção) -- consolida em UM lugar visual o que hoje só
// existia espalhado em program-policy.json/quarantine-status.md/
// targets-auto-promoted-log.json, sem nenhuma tela própria.
// ---------------------------------------------------------------------

function renderEvidenceGradeBar(evidenceGradeRows, totalDbFindings) {
  if (!evidenceGradeRows.length) return `<div class="empty">Nenhum achado com grau de evidência calculado ainda.</div>`;
  return `<div class="card-grid">${evidenceGradeRows
    .map(
      (g, i) => `
    <div class="card" style="--i:${i}">
      <div class="grade-row">
        <div class="grade-badge g-${esc(g.grade)}">${esc(g.grade)}</div>
        <div>
          <div class="card-title">${g.count} achado(s)</div>
          <div class="card-meta">${totalDbFindings ? Math.round((g.count / totalDbFindings) * 100) : 0}% do total</div>
        </div>
      </div>
    </div>`
    )
    .join('')}</div>`;
}

function renderPolicyBlocks(policyBlockedFindings, programPolicy) {
  const programs = Object.entries(programPolicy).filter(([, v]) => v.aiResearchBanned);
  const policyHtml = programs.length
    ? programs
        .map(
          ([name, v]) => `
      <div class="signal-block">
        <div class="signal-title">🚫 ${esc(name)}</div>
        <div class="signal-meta">${esc(v.reason || 'pesquisa assistida por IA proibida pelas regras deste programa')}</div>
      </div>`
        )
        .join('')
    : `<div class="empty">Nenhum programa bloqueado por política agora.</div>`;

  const findingsHtml = policyBlockedFindings.length
    ? `<div class="card-grid">${policyBlockedFindings
        .map(
          (f, i) => `
      <div class="card" style="--i:${i}">
        <div class="card-eyebrow">${esc(f.program)}</div>
        <div class="card-title">${esc(f.id.split('::').slice(1).join('::').slice(0, 60))}</div>
        <div class="card-meta">estado: ${esc(STATE_LABEL[f.state] || f.state)}${f.evidenceGrade ? ' · grau ' + esc(f.evidenceGrade) : ''}</div>
      </div>`
        )
        .join('')}</div>`
    : `<div class="empty">Nenhum achado real afetado por bloqueio de programa agora.</div>`;

  return `${policyHtml}${policyBlockedFindings.length ? `<h2 style="margin-top:22px">Achados travados por política</h2><div class="panel-sub">Investigação real, tecnicamente válida, mas que a state machine nunca deixa passar de human_ready por causa do programa.</div>${findingsHtml}` : ''}`;
}

function renderQuarantineBlock(quarantined) {
  if (!quarantined.length) return `<div class="empty">Nenhuma regra quarentenada agora — toda heurística ativa ainda tem taxa de falso-positivo aceitável.</div>`;
  return `<div class="card-grid">${quarantined
    .map(
      (q, i) => `
    <div class="card" style="--i:${i}">
      <div class="card-eyebrow">${esc(q.language)}</div>
      <div class="card-title">${esc(q.type)}</div>
      <div class="card-meta">${Math.round(q.fpRate * 100)}% falso-positivo (${q.falsePositive}/${q.reviewed} revisados)</div>
    </div>`
    )
    .join('')}</div>`;
}

function renderPromotionBlock(promotionLog) {
  if (!promotionLog) return `<div class="empty">Pipeline de promoção ainda não rodou nesta cópia do repositório.</div>`;
  const promoted = promotionLog.promotedThisRound || [];
  const skipped = promotionLog.skippedThisRound || {};
  const promotedHtml = promoted.length
    ? `<div class="card-grid">${promoted
        .map(
          (p, i) => `
      <div class="card" style="--i:${i}">
        <div class="card-eyebrow">${esc(p.program)} · score ${esc(p.score)}</div>
        <div class="card-title">${esc(p.owner)}/${esc(p.repo)}</div>
        <div class="card-meta">${(p.reasons || []).map((r) => esc(r)).join(' · ') || 'sem motivo registrado'}</div>
      </div>`
        )
        .join('')}</div>`
    : `<div class="empty">Nenhum alvo novo promovido na última rodada.</div>`;
  const skipCounts = [
    ['Programa bloqueado', skipped.blockedProgram?.length || 0],
    ['Linguagem não suportada', skipped.unsupportedLanguage?.length || 0],
    ['Repo grande demais', skipped.tooLarge?.length || 0],
    ['Sem sinal positivo', skipped.insufficientSignal?.length || 0],
    ['Erro de metadado', skipped.metadataFetchFailed?.length || 0],
    ['Elegível, sem vaga na rodada', skipped.deferredToNextRun?.length || 0],
    ['Já promovido antes', skipped.alreadyPromoted || 0],
  ].filter(([, n]) => n > 0);
  const skipHtml = skipCounts.length
    ? `<div class="card-grid">${skipCounts.map(([label, n], i) => `<div class="card" style="--i:${i}"><div class="card-title">${n}</div><div class="card-meta">${esc(label)}</div></div>`).join('')}</div>`
    : `<div class="empty">Nada recusado na última rodada.</div>`;
  return `
    <div class="panel-sub">Última rodada: ${esc(fmtTime(promotionLog.generatedAt))} — ${promotionLog.totalActiveAutoPromoted ?? 0} alvo(s) auto-promovido(s) ativo(s) no total.</div>
    <h2 style="font-size:15px">Promovidos nesta rodada</h2>
    ${promotedHtml}
    <h2 style="font-size:15px;margin-top:18px">Recusados nesta rodada, por motivo</h2>
    ${skipHtml}`;
}

function renderSignalsPage(data) {
  const { policyBlockedFindings, programPolicy, quarantined, evidenceGradeRows, totalDbFindings, promotionLog } = data;
  return {
    key: 'signals',
    title: 'Sinais',
    subtitle: 'Tudo que hoje decide sozinho o que avança, o que é suprimido e o que nunca pode ser enviado — política de programa, quarentena de heurística, grau de evidência e promoção automática de alvo.',
    bodyHtml: `
    <div class="panel">
      <h2>Grau de evidência (E0–E5)</h2>
      <div class="panel-sub">Quão bem provado cada achado está, derivado do que já foi gravado — nunca uma opinião solta.</div>
      ${renderEvidenceGradeBar(evidenceGradeRows, totalDbFindings)}
    </div>
    <div class="panel">
      <h2>Política de programa</h2>
      <div class="panel-sub">Programa cujas próprias regras proíbem pesquisa assistida por IA — bloqueado no gate scope_verified→human_ready, automaticamente, pra qualquer chamador.</div>
      ${renderPolicyBlocks(policyBlockedFindings, programPolicy || {})}
    </div>
    <div class="panel">
      <h2>Heurísticas em quarentena</h2>
      <div class="panel-sub">Regra com taxa de falso-positivo no limiar para de gerar candidato novo, automaticamente, nos 3 pontos de entrada do scanner.</div>
      ${renderQuarantineBlock(quarantined || [])}
    </div>
    <div class="panel">
      <h2>Pipeline de promoção automática de alvo</h2>
      <div class="panel-sub">Candidato descoberto que virou alvo de varredura ativa sozinho, por pontuação — e tudo que foi considerado e recusado, sem corte silencioso.</div>
      ${renderPromotionBlock(promotionLog)}
    </div>`,
  };
}

// ---------------------------------------------------------------------
// Página: Estatística
// ---------------------------------------------------------------------

function barRow(h, labelSuffix, i) {
  const pct = h.fpRate === null || h.fpRate === undefined ? 0 : Math.round(h.fpRate * 100);
  const color = fpBarColor(h.fpRate);
  return `
  <div class="bar-row" style="--i:${i}">
    <div class="bar-label">${esc(h.type)} <span class="bar-lang">${esc(labelSuffix)}</span></div>
    <div class="bar-track"><div class="bar-fill" style="--pct:${pct}%; background:${color}"></div></div>
    <div class="bar-value">${h.fpRate === null || h.fpRate === undefined ? '—' : pct + '%'} <span class="bar-n">(${h.reviewed})</span></div>
  </div>`;
}

function renderStatsPage(data) {
  const { heuristicByLanguage, heuristicByProgram } = data;
  const byLangHtml = heuristicByLanguage.length
    ? heuristicByLanguage.map((h, i) => barRow(h, h.language, i)).join('')
    : `<div class="empty">Ainda sem amostra suficiente.</div>`;
  const byProgHtml = heuristicByProgram.length
    ? heuristicByProgram.map((h, i) => barRow(h, h.program, i)).join('')
    : `<div class="empty">Ainda sem amostra suficiente.</div>`;

  return {
    key: 'stats',
    title: 'Estatística de heurísticas',
    subtitle: 'Taxa de falso-positivo calculada a partir de todo veredito já registrado — isso é a retroalimentação que afina achados futuros (research/bugbounty/heuristic-stats.json).',
    bodyHtml: `
    <div class="panel"><h2>Por tipo × linguagem</h2>${byLangHtml}</div>
    <div class="panel"><h2>Por tipo × programa</h2>${byProgHtml}</div>`,
  };
}

// ---------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------

/** Monta as 5 seções (dados ainda, não HTML) — usado pelos testes pra
 * checar cada seção isoladamente sem parsear o documento inteiro. */
export function renderDashboardSections(data) {
  return {
    index: renderOverviewPage(data),
    targets: renderTargetsPage(data),
    queue: renderQueuePage(data),
    activity: renderActivityPage(data),
    signals: renderSignalsPage(data),
    stats: renderStatsPage(data),
  };
}

/** Documento único autocontido (todas as 5 "páginas" como <section>,
 * trocadas por hash) — é isso que vira o arquivo publicado/aberto local. */
export function renderDashboardApp(data) {
  const sectionsByKey = renderDashboardSections(data);
  const sections = Object.values(sectionsByKey);
  const extraScripts = sections.map((s) => s.extraScript || '').join('\n');
  return renderApp({ sections, lastScanAt: data.lastScanAt, extraScripts });
}

export function generateDashboard({ queuePath, statsJsonPath, ledgerEntries, targetLists, outputPath, lastScanSummary, lastScanAt, dbPath, quarantineOverridesPath, promotionLogPath }) {
  const queueEntries = loadQueue(queuePath);
  const stats = loadJson(statsJsonPath, { byTypeLanguage: {}, byTypeProgram: {} });
  const RELEVANT_TYPES = new Set(['bugbounty_scan', 'bugbounty_verdict', 'bugbounty_discovery', 'bugbounty_digest', 'bugbounty_state_transition']);
  const relevantLedger = (ledgerEntries || []).filter((e) => RELEVANT_TYPES.has(e.type));

  const { findings: dbFindings, counts: dbStateCounts } = loadDbSnapshot(dbPath);
  const programPolicy = loadProgramPolicy();
  const quarantined = computeQuarantinedRules(stats, { overrides: loadQuarantineOverrides(quarantineOverridesPath) });
  const promotionLog = promotionLogPath ? loadJson(promotionLogPath, null) : null;

  const data = buildDashboardData({ queueEntries, ledgerEntries: relevantLedger, stats, targetLists, lastScanSummary, lastScanAt, dbFindings, dbStateCounts, programPolicy, quarantined, promotionLog });
  const html = renderDashboardApp(data);

  const outDir = path.dirname(outputPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, html, 'utf8');
  return data;
}
