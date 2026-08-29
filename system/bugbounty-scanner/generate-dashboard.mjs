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

// ---------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------

/** Molda todos os dados que as 5 páginas precisam — função pura, testável
 * sem tocar disco. ledgerEntries já deve vir filtrado (só bugbounty_*). */
export function buildDashboardData({ queueEntries, ledgerEntries, stats, targetLists, lastScanSummary, lastScanAt }) {
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
    },
    targetRows,
    queueEntries: queueSorted,
    activityEntries: activitySorted,
    heuristicByLanguage,
    heuristicByProgram,
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
.page.active { display: block; }
`;

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">`;

const NAV_ITEMS = [
  { key: 'index', label: 'Visão geral', icon: '◎' },
  { key: 'targets', label: 'Alvos', icon: '▤' },
  { key: 'queue', label: 'Fila completa', icon: '≡' },
  { key: 'activity', label: 'Atividade ao vivo', icon: '↯' },
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
      root.querySelectorAll('.bar-fill').forEach(function (el) { el.classList.add('show'); });
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

// ---------------------------------------------------------------------
// Página: Visão geral
// ---------------------------------------------------------------------

function renderOverviewPage(data) {
  const { totals, targetRows, queueEntries, activityEntries, heuristicByLanguage, lastScanSummary, lastScanAt } = data;

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

export function generateDashboard({ queuePath, statsJsonPath, ledgerEntries, targetLists, outputPath, lastScanSummary, lastScanAt }) {
  const queueEntries = loadQueue(queuePath);
  const stats = loadJson(statsJsonPath, { byTypeLanguage: {}, byTypeProgram: {} });
  const RELEVANT_TYPES = new Set(['bugbounty_scan', 'bugbounty_verdict', 'bugbounty_discovery', 'bugbounty_digest']);
  const relevantLedger = (ledgerEntries || []).filter((e) => RELEVANT_TYPES.has(e.type));
  const data = buildDashboardData({ queueEntries, ledgerEntries: relevantLedger, stats, targetLists, lastScanSummary, lastScanAt });
  const html = renderDashboardApp(data);

  const outDir = path.dirname(outputPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, html, 'utf8');
  return data;
}
