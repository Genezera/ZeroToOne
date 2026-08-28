// Painel visual do "centro de operações" — HTML autocontido, gerado a cada
// rodada do scanner com os dados reais do momento (fila, estatística de
// veredito, alvos ativos). Sem framework, sem dependência — um arquivo só,
// que abre local (file://) e sempre reflete o estado mais recente depois
// de cada rodada agendada. Publicar isso como link é sempre um INSTANTÂNEO
// daquele momento, não uma página com dado ao vivo (a página não tem como
// ler o repositório privado sem expor credencial) — documentado no rodapé
// do próprio painel, pra não prometer "tempo real" que não é literal.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function loadQueue(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LANGUAGE_LABEL = { clarity: 'Clarity', js: 'JS/TS', go: 'Go', jvm: 'Kotlin/Java', swift: 'Swift/ObjC', unknown: '?' };

/** Monta todos os números/listas que o template precisa, a partir dos
 * dados brutos — função pura, testável sem tocar disco. */
export function buildDashboardData({ queueEntries, stats, targetLists, lastScanSummary, lastScanAt }) {
  const pending = queueEntries.filter((e) => e.status === 'pending');
  const reviewed = queueEntries.filter((e) => e.status && e.status !== 'pending');
  const confirmed = reviewed.filter((e) => e.verdict === 'confirmado');
  const falsePositive = reviewed.filter((e) => e.verdict === 'falso_positivo');

  const targetRows = [];
  for (const [language, list] of Object.entries(targetLists)) {
    for (const t of list) {
      const label = t.repo ? `${t.owner}/${t.repo}` : `${(t.contracts || []).length} contrato(s)`;
      targetRows.push({ language, program: t.program, platform: t.platform, target: label });
    }
  }
  const programsCount = new Set(targetRows.map((r) => r.program)).size;
  const languagesCount = new Set(targetRows.map((r) => r.language)).size;

  const recentActivity = [...reviewed]
    .sort((a, b) => (b.foundAt || '').localeCompare(a.foundAt || ''))
    .slice(0, 8)
    .map((e) => ({
      type: e.type,
      program: e.program,
      language: LANGUAGE_LABEL[e.language] || e.language || '?',
      verdict: e.verdict,
      foundAt: e.foundAt,
    }));

  const heuristicRows = Object.entries(stats?.byTypeLanguage || {})
    .map(([key, t]) => {
      const [type, language] = key.split('::');
      return { type, language: LANGUAGE_LABEL[language] || language, reviewed: t.reviewed, fpRate: t.fpRate };
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
    },
    targetRows,
    recentActivity,
    heuristicRows,
  };
}

function statTile(value, label, id) {
  return `
      <div class="tile">
        <div class="tile-value" data-countup="${value}" id="${id}">0</div>
        <div class="tile-label">${esc(label)}</div>
      </div>`;
}

function fpBarColor(fpRate) {
  if (fpRate === null || fpRate === undefined) return 'var(--info)';
  if (fpRate < 0.34) return 'var(--good)';
  if (fpRate < 0.67) return 'var(--accent)';
  return 'var(--critical)';
}

function verdictChip(verdict) {
  if (verdict === 'confirmado') return `<span class="chip chip-info">confirmado</span>`;
  if (verdict === 'falso_positivo') return `<span class="chip chip-good">falso positivo</span>`;
  return `<span class="chip chip-muted">${esc(verdict || 'pendente')}</span>`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  } catch {
    return iso;
  }
}

/** Gera o documento HTML completo — função pura (recebe os dados já
 * moldados por buildDashboardData, não toca disco). */
export function renderDashboardHtml(data) {
  const { totals, targetRows, recentActivity, heuristicRows, lastScanAt, lastScanSummary } = data;

  const targetCards = targetRows
    .map(
      (r, i) => `
        <div class="target-card" style="--i:${i}">
          <div class="target-lang">${esc(LANGUAGE_LABEL[r.language] || r.language)}</div>
          <div class="target-name">${esc(r.target)}</div>
          <div class="target-meta">${esc(r.program)} · ${esc(r.platform)}</div>
        </div>`
    )
    .join('');

  const activityRows = recentActivity.length
    ? recentActivity
        .map(
          (e, i) => `
        <div class="activity-row" style="--i:${i}">
          <div class="activity-dot dot-${e.verdict === 'confirmado' ? 'info' : e.verdict === 'falso_positivo' ? 'good' : 'muted'}"></div>
          <div class="activity-body">
            <div class="activity-title">${esc(e.type)} <span class="activity-lang">${esc(e.language)}</span></div>
            <div class="activity-sub">${esc(e.program)} — ${verdictChip(e.verdict)}</div>
          </div>
          <div class="activity-time">${esc(fmtTime(e.foundAt))}</div>
        </div>`
        )
        .join('')
    : `<div class="empty">Nenhuma revisão registrada ainda.</div>`;

  const heuristicBars = heuristicRows.length
    ? heuristicRows
        .map((h, i) => {
          const pct = h.fpRate === null ? 0 : Math.round(h.fpRate * 100);
          const color = fpBarColor(h.fpRate);
          return `
        <div class="bar-row" style="--i:${i}">
          <div class="bar-label">${esc(h.type)} <span class="bar-lang">${esc(h.language)}</span></div>
          <div class="bar-track"><div class="bar-fill" style="--pct:${pct}%; background:${color}"></div></div>
          <div class="bar-value">${h.fpRate === null ? '—' : pct + '%'} <span class="bar-n">(${h.reviewed})</span></div>
        </div>`;
        })
        .join('')
    : `<div class="empty">Ainda sem amostra suficiente pra estatística.</div>`;

  const scanLine = lastScanSummary
    ? `${lastScanSummary.contractsChecked ?? 0} contrato(s) Clarity + ${lastScanSummary.repoFilesChecked ?? 0} arquivo(s) checados na última rodada, ${lastScanSummary.fetchErrors ?? 0} erro(s) de busca.`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Centro de Sinais</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
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
body {
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-body);
  min-height: 100vh;
  overflow-x: hidden;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 40px 28px 64px; position: relative; }

/* --- radar de fundo, ambiente, sutil --- */
.radar {
  position: absolute; top: -220px; right: -220px; width: 640px; height: 640px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, var(--accent-glow), transparent 30%);
  filter: blur(2px);
  animation: sweep 14s linear infinite;
  pointer-events: none;
  z-index: 0;
}
@keyframes sweep { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .radar { animation: none; } }

header { position: relative; z-index: 1; display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
.eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
h1 { font-family: var(--font-display); font-weight: 800; font-size: clamp(36px, 5vw, 56px); letter-spacing: 0.01em; margin: 4px 0 0; text-wrap: balance; }
.subtitle { color: var(--ink-muted); font-size: 15px; max-width: 65ch; margin-top: 6px; }
.status-pill { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 13px; color: var(--ink-muted); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 6px 14px; white-space: nowrap; }
.pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 0 var(--accent-glow); animation: pulse 2.4s ease-out infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 var(--accent-glow); } 70% { box-shadow: 0 0 0 10px rgba(245,148,61,0); } 100% { box-shadow: 0 0 0 0 rgba(245,148,61,0); } }
@media (prefers-reduced-motion: reduce) { .pulse-dot { animation: none; } }

.tiles { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 32px 0; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; opacity: 0; animation: rise 0.5s ease forwards; animation-delay: calc(var(--i, 0) * 0.06s); }
.tile-value { font-family: var(--font-display); font-weight: 700; font-size: 40px; font-variant-numeric: tabular-nums; line-height: 1; color: var(--ink); }
.tile-label { font-size: 12px; color: var(--ink-muted); margin-top: 6px; letter-spacing: 0.02em; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 20px; align-items: start; }
@media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }

.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 22px; }
.panel + .panel { margin-top: 20px; }
.panel h2 { font-family: var(--font-display); font-weight: 700; font-size: 20px; margin: 0 0 4px; letter-spacing: 0.01em; }
.panel .panel-sub { color: var(--ink-faint); font-size: 12.5px; margin-bottom: 16px; }

.target-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.target-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; opacity: 0; animation: rise 0.45s ease forwards; animation-delay: calc(var(--i, 0) * 0.04s); transition: transform 0.15s ease, border-color 0.15s ease; }
.target-card:hover { transform: translateY(-2px); border-color: var(--accent); }
.target-lang { font-family: var(--font-mono); font-size: 11px; color: var(--accent); letter-spacing: 0.06em; text-transform: uppercase; }
.target-name { font-family: var(--font-mono); font-size: 13.5px; color: var(--ink); margin-top: 4px; overflow-wrap: anywhere; }
.target-meta { font-size: 11.5px; color: var(--ink-faint); margin-top: 4px; }

.activity-row { display: grid; grid-template-columns: 10px 1fr auto; gap: 12px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--border); opacity: 0; animation: rise 0.45s ease forwards; animation-delay: calc(var(--i, 0) * 0.05s); }
.activity-row:last-child { border-bottom: none; }
.activity-dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; }
.dot-info { background: var(--info); }
.dot-good { background: var(--good); }
.dot-muted { background: var(--ink-faint); }
.activity-title { font-size: 14px; font-weight: 500; }
.activity-lang { font-family: var(--font-mono); font-size: 11px; color: var(--ink-faint); }
.activity-sub { font-size: 12.5px; color: var(--ink-muted); margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.activity-time { font-family: var(--font-mono); font-size: 11px; color: var(--ink-faint); white-space: nowrap; }

.chip { font-family: var(--font-mono); font-size: 10.5px; padding: 2px 8px; border-radius: 999px; letter-spacing: 0.02em; }
.chip-info { background: rgba(110,140,255,0.15); color: var(--info); }
.chip-good { background: rgba(94,201,166,0.15); color: var(--good); }
.chip-muted { background: rgba(137,150,171,0.15); color: var(--ink-muted); }

.bar-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: 12px; align-items: center; padding: 8px 0; }
.bar-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-lang { font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-faint); }
.bar-track { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; width: var(--pct); transform: scaleX(0); transform-origin: left; transition: transform 0.8s cubic-bezier(.16,1,.3,1); transition-delay: calc(var(--i, 0) * 0.08s); }
.bar-fill.show { transform: scaleX(1); }
.bar-value { font-family: var(--font-mono); font-size: 12px; color: var(--ink-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bar-n { color: var(--ink-faint); }

.empty { color: var(--ink-faint); font-size: 13px; padding: 12px 0; }

footer { position: relative; z-index: 1; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); font-size: 12px; color: var(--ink-faint); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
footer a { color: var(--ink-muted); }
</style>
</head>
<body>
<div class="wrap">
  <div class="radar" aria-hidden="true"></div>
  <header>
    <div>
      <div class="eyebrow">ZeroToOne · Bug Bounty</div>
      <h1>Centro de Sinais</h1>
      <div class="subtitle">${esc(scanLine || 'Varredura estática multi-linguagem, mais retroalimentação de veredito e revisão por IA.')}</div>
    </div>
    <div class="status-pill"><span class="pulse-dot"></span>Última rodada: ${esc(fmtTime(lastScanAt))}</div>
  </header>

  <div class="tiles">
    ${statTile(totals.targets, 'Alvos ativos', 't-targets')}
    ${statTile(totals.programs, 'Programas', 't-programs')}
    ${statTile(totals.languages, 'Linguagens', 't-languages')}
    ${statTile(totals.pending, 'Sinais pendentes', 't-pending')}
    ${statTile(totals.reviewed, 'Já revisados', 't-reviewed')}
    ${statTile(totals.falsePositive, 'Falso positivo', 't-fp')}
  </div>

  <div class="grid">
    <div>
      <div class="panel">
        <h2>Alvos ativos</h2>
        <div class="panel-sub">Programas e repositórios sob varredura contínua.</div>
        <div class="target-list">${targetCards}</div>
      </div>
    </div>
    <div>
      <div class="panel">
        <h2>Atividade recente</h2>
        <div class="panel-sub">Últimos vereditos da fila.</div>
        ${activityRows}
      </div>
      <div class="panel">
        <h2>Taxa de falso-positivo</h2>
        <div class="panel-sub">Por tipo de heurística × linguagem — quanto mais alto, mais ruído.</div>
        ${heuristicBars}
      </div>
    </div>
  </div>

  <footer>
    <div>Gerado automaticamente por <code>generate-dashboard.mjs</code> a cada rodada do scanner. Instantâneo deste momento — não é uma página com dado ao vivo (o repositório é privado). Pra ver sempre a versão mais recente, abra <code>research/bugbounty/dashboard.html</code> local.</div>
  </footer>
</div>
<script>
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-countup]').forEach(function (el) {
    var target = parseInt(el.getAttribute('data-countup'), 10) || 0;
    if (reduce) { el.textContent = target; return; }
    var start = null, dur = 900;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  requestAnimationFrame(function () {
    document.querySelectorAll('.bar-fill').forEach(function (el) { el.classList.add('show'); });
  });
})();
</script>
</body>
</html>`;
}

export function generateDashboard({ queuePath, statsJsonPath, targetLists, outputPath, lastScanSummary, lastScanAt }) {
  const queueEntries = loadQueue(queuePath);
  const stats = loadJson(statsJsonPath, { byTypeLanguage: {}, byTypeProgram: {} });
  const data = buildDashboardData({ queueEntries, stats, targetLists, lastScanSummary, lastScanAt });
  const html = renderDashboardHtml(data);
  writeFileSync(outputPath, html, 'utf8');
  return data;
}
