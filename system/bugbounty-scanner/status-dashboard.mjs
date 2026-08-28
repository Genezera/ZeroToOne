// Painel único do "centro de operações": agrega alvos ativos, fila e
// vereditos recentes num Markdown gerado — o jeito mais barato de dar uma
// visão de conjunto sem inventar um mecanismo de comunicação novo (tudo já
// é arquivo commitado no git). Lotes futuros (dependência/CVE, descoberta
// de alvo) só adicionam sua própria seção aqui, sem redesenhar isto.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function loadQueue(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** targetLists: {clarity: TARGETS, js: JS_TARGETS, ...} — cada lista de
 * alvo tem seu próprio formato (Clarity usa `contracts`, os outros usam
 * `owner`/`repo`), então isso normaliza pra uma linha comum de exibição. */
export function summarizeTargets(targetLists) {
  const rows = [];
  for (const [language, list] of Object.entries(targetLists)) {
    for (const t of list) {
      const label = t.repo ? `${t.owner}/${t.repo}` : `${(t.contracts || []).length} contrato(s)`;
      rows.push({ language, program: t.program, platform: t.platform, target: label });
    }
  }
  return rows;
}

export function summarizeQueue(queueEntries) {
  const pending = queueEntries.filter((e) => e.status === 'pending');
  const reviewed = queueEntries.filter((e) => e.status && e.status !== 'pending');
  const recentReviewed = [...reviewed]
    .sort((a, b) => (b.foundAt || '').localeCompare(a.foundAt || ''))
    .slice(0, 5);
  return { pendingCount: pending.length, reviewedCount: reviewed.length, recentReviewed };
}

export function renderStatusMarkdown({ targetRows, queueSummary, lastScanAt }) {
  const lines = [];
  lines.push('# Centro de operações — status');
  lines.push('');
  lines.push(`Gerado automaticamente por \`status-dashboard.mjs\` a cada rodada do scanner. Não editar à mão. Última rodada: ${lastScanAt || 'nunca'}.`);
  lines.push('');
  lines.push('## Alvos ativos');
  lines.push('');
  lines.push('| Linguagem | Programa | Plataforma | Alvo |');
  lines.push('|---|---|---|---|');
  for (const r of targetRows) {
    lines.push(`| ${r.language} | ${r.program} | ${r.platform} | ${r.target} |`);
  }
  lines.push('');
  lines.push('## Fila de bug bounty');
  lines.push('');
  lines.push(`- Pendentes (aguardando o agente de nuvem): **${queueSummary.pendingCount}**`);
  lines.push(`- Já revisados: ${queueSummary.reviewedCount}`);
  if (queueSummary.recentReviewed.length > 0) {
    lines.push('');
    lines.push('### Últimos vereditos');
    lines.push('');
    lines.push('| Tipo | Programa | Veredito | Quando |');
    lines.push('|---|---|---|---|');
    for (const e of queueSummary.recentReviewed) {
      lines.push(`| ${e.type} | ${e.program} | ${e.verdict || '—'} | ${e.foundAt || '—'} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function generateStatusDashboard({ queuePath, targetLists, statusPath, lastScanAt }) {
  const queueEntries = loadQueue(queuePath);
  const targetRows = summarizeTargets(targetLists);
  const queueSummary = summarizeQueue(queueEntries);
  const md = renderStatusMarkdown({ targetRows, queueSummary, lastScanAt });
  writeFileSync(statusPath, md, 'utf8');
  return { targetRows, queueSummary };
}
