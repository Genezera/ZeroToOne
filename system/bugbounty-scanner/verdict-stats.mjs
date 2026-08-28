// Retroalimentação de veredito: cada achado confirmado/falso-positivo pela
// revisão (humana ou do agente de nuvem) vira dado pra afinar a confiança
// de achados futuros do mesmo tipo/linguagem. Tudo registrado em arquivos
// simples (JSON/Markdown), revisável a olho — nunca um modelo caixa-preta.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const EXT_LANGUAGE = [
  [/\.clar$/, 'clarity'],
  [/\.(js|jsx|ts|tsx|mjs|cjs)$/, 'js'],
  [/\.go$/, 'go'],
  [/\.(kt|kts|java)$/, 'jvm'],
  [/\.(swift|m|h)$/, 'swift'],
];

/** Achados novos (pós-backfill) já trazem `language`; entradas antigas são
 * inferidas pela extensão do arquivo. */
export function deriveLanguage(finding) {
  if (finding.language) return finding.language;
  const file = finding.file || '';
  for (const [re, lang] of EXT_LANGUAGE) {
    if (re.test(file)) return lang;
  }
  return 'unknown';
}

function emptyTally() {
  return { reviewed: 0, confirmed: 0, falsePositive: 0, other: 0 };
}

function accumulate(map, key, entry) {
  const t = map[key] || emptyTally();
  t.reviewed++;
  if (entry.verdict === 'confirmado') t.confirmed++;
  else if (entry.verdict === 'falso_positivo') t.falsePositive++;
  else t.other++;
  map[key] = t;
}

function finalize(map) {
  const out = {};
  for (const [key, t] of Object.entries(map)) {
    out[key] = { ...t, fpRate: t.reviewed > 0 ? t.falsePositive / t.reviewed : null };
  }
  return out;
}

/** Agrupa achados JÁ REVISADOS (status !== 'pending') por tipo×linguagem e
 * tipo×programa, contando confirmado/falso-positivo/outro e a taxa de FP
 * resultante (null quando não há amostra ainda). */
export function computeStats(queueEntries) {
  const byTypeLanguage = {};
  const byTypeProgram = {};
  for (const entry of queueEntries) {
    if (!entry.status || entry.status === 'pending') continue;
    const language = deriveLanguage(entry);
    accumulate(byTypeLanguage, `${entry.type}::${language}`, entry);
    accumulate(byTypeProgram, `${entry.type}::${entry.program}`, entry);
  }
  return { byTypeLanguage: finalize(byTypeLanguage), byTypeProgram: finalize(byTypeProgram) };
}

/** Confiança histórica pra anexar num achado NOVO do mesmo tipo/linguagem —
 * null se não houver amostra suficiente ainda (padrão: mínimo 5 revisados),
 * pra não sugerir confiança com base em 1-2 pontos de dado. */
export function historicalConfidenceFor(stats, type, language, minSample = 5) {
  const bucket = stats?.byTypeLanguage?.[`${type}::${language}`];
  if (!bucket || bucket.reviewed < minSample) return null;
  return { fpRate: bucket.fpRate, sampleSize: bucket.reviewed };
}

export function renderStatsMarkdown(stats) {
  const lines = [];
  lines.push('# Estatística de heurísticas — taxa de falso-positivo');
  lines.push('');
  lines.push('Gerado automaticamente por `verdict-stats.mjs` a cada rodada do scanner. Não editar à mão.');
  lines.push('');
  lines.push('## Por tipo × linguagem');
  lines.push('');
  lines.push('| Tipo | Linguagem | Revisados | Confirmados | Falso-positivo | Outro | Taxa FP |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [key, t] of Object.entries(stats.byTypeLanguage).sort()) {
    const [type, language] = key.split('::');
    const fpRateStr = t.fpRate === null ? '—' : `${Math.round(t.fpRate * 100)}%`;
    lines.push(`| ${type} | ${language} | ${t.reviewed} | ${t.confirmed} | ${t.falsePositive} | ${t.other} | ${fpRateStr} |`);
  }
  lines.push('');
  lines.push('## Por tipo × programa');
  lines.push('');
  lines.push('| Tipo | Programa | Revisados | Confirmados | Falso-positivo | Outro | Taxa FP |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [key, t] of Object.entries(stats.byTypeProgram).sort()) {
    const [type, program] = key.split('::');
    const fpRateStr = t.fpRate === null ? '—' : `${Math.round(t.fpRate * 100)}%`;
    lines.push(`| ${type} | ${program} | ${t.reviewed} | ${t.confirmed} | ${t.falsePositive} | ${t.other} | ${fpRateStr} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Acha itens recém-revisados OU cujo veredito mudou desde a última rodada
 * (comparando contra um snapshot {id: verdict}). Isso é o que vira entrada
 * nova no ledger — sem isso, uma revisão de veredito (ex.: agente de nuvem
 * corrige um veredito anterior) não deixaria rastro nenhum, porque
 * queue.jsonl é reescrito em cima da mesma linha, não é append-only. */
export function diffNewlyReviewed(queueEntries, previouslySeenVerdicts) {
  const changed = [];
  const updatedSnapshot = { ...previouslySeenVerdicts };
  for (const entry of queueEntries) {
    if (!entry.id) continue;
    if (!entry.status || entry.status === 'pending') continue;
    const prevVerdict = previouslySeenVerdicts[entry.id];
    if (prevVerdict === undefined || prevVerdict !== entry.verdict) {
      changed.push(entry);
    }
    updatedSnapshot[entry.id] = entry.verdict;
  }
  return { changed, updatedSnapshot };
}

export function loadStats(path) {
  if (!existsSync(path)) return { byTypeLanguage: {}, byTypeProgram: {} };
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadQueue(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function loadSnapshot(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Wrapper de I/O fino: lê a fila atual, recalcula estatística, escreve
 * heuristic-stats.json/.md e o snapshot de veredito, e retorna os itens
 * recém-revisados/mudados pra quem chamou decidir o que fazer com eles
 * (ex.: gravar no ledger) — este módulo não conhece o ledger, mantém baixo
 * acoplamento. */
export function runVerdictStats({ queuePath, statsJsonPath, statsMdPath, snapshotPath }) {
  const queueEntries = loadQueue(queuePath);
  const previouslySeenVerdicts = loadSnapshot(snapshotPath);
  const { changed, updatedSnapshot } = diffNewlyReviewed(queueEntries, previouslySeenVerdicts);
  const stats = computeStats(queueEntries);

  writeFileSync(statsJsonPath, JSON.stringify(stats, null, 2), 'utf8');
  writeFileSync(statsMdPath, renderStatsMarkdown(stats), 'utf8');
  writeFileSync(snapshotPath, JSON.stringify(updatedSnapshot, null, 2), 'utf8');

  return { stats, newlyReviewed: changed };
}
