// Quarentena automática de regra ruim — seção 6.11/P1 da auditoria
// externa (ZeroToOne_Auditoria_e_Prompt_Mestre.md). Caso concreto que
// motivou isso: `ssrf_risk` chegou a 13 revisões, 13 falso-positivo
// (0% de precisão) e continuava gerando candidato novo toda rodada,
// gastando esforço de revisão à toa.
//
// Política: usa a MESMA estatística por tipo×linguagem que já existe em
// `verdict-stats.mjs` (nenhuma fonte de dado nova) — se uma regra tem
// amostra suficiente e taxa de falso-positivo no limiar, ela para de
// gerar candidato novo na fila normal. Isso é PERMANENTE até revisão
// humana por desenho: uma regra quarentenada nunca mais chega na fila,
// então nunca mais acumula amostra nova pra "se corrigir sozinha" — a
// única saída é reescrever a heurística de verdade (não só esperar mais
// dado do mesmo padrão ruim) e então remover a entrada correspondente
// de `research/bugbounty/quarantine-overrides.json`.

const DEFAULT_MIN_SAMPLE = 5;
const DEFAULT_FP_THRESHOLD = 1.0; // 100% — mesmo limiar do caso ssrf_risk documentado

/** Decide se um tipo×linguagem está quarentenado, a partir das MESMAS
 * `stats.byTypeLanguage` que `historicalConfidenceFor` já lê. Pura —
 * não toca disco. `overrides` (opcional) é um Set de chaves
 * `type::language` liberadas manualmente mesmo com FP alto (regra já
 * reescrita, aguardando nova amostra se acumular antes de decidir de
 * novo) — nunca o contrário (nunca quarentena por override; overrides
 * só destravam). */
export function isQuarantined(stats, type, language, { minSample = DEFAULT_MIN_SAMPLE, fpThreshold = DEFAULT_FP_THRESHOLD, overrides = new Set() } = {}) {
  const key = `${type}::${language}`;
  if (overrides.has(key)) return false;
  const bucket = stats?.byTypeLanguage?.[key];
  if (!bucket || bucket.reviewed < minSample || bucket.fpRate === null) return false;
  return bucket.fpRate >= fpThreshold;
}

/** Lista toda regra quarentenada agora, com o motivo — pra gerar
 * `quarantine-status.json`/relatório legível, não só pra decisão
 * inline durante o scan. */
export function computeQuarantinedRules(stats, opts = {}) {
  const { minSample = DEFAULT_MIN_SAMPLE, fpThreshold = DEFAULT_FP_THRESHOLD, overrides = new Set() } = opts;
  const out = [];
  for (const [key, bucket] of Object.entries(stats?.byTypeLanguage || {})) {
    const [type, language] = key.split('::');
    if (isQuarantined(stats, type, language, { minSample, fpThreshold, overrides })) {
      out.push({ key, type, language, fpRate: bucket.fpRate, reviewed: bucket.reviewed, falsePositive: bucket.falsePositive });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function renderQuarantineMarkdown(quarantined, suppressedThisRound = 0) {
  const lines = [];
  lines.push('# Regras em quarentena');
  lines.push('');
  lines.push('Gerado automaticamente por `quarantine.mjs` a cada rodada do scanner. Não editar à mão.');
  lines.push('');
  if (quarantined.length === 0) {
    lines.push('Nenhuma regra quarentenada no momento.');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`${suppressedThisRound} candidato(s) suprimido(s) nesta rodada por regra quarentenada.`);
  lines.push('');
  lines.push('| Tipo | Linguagem | Revisados | Falso-positivo | Taxa FP |');
  lines.push('|---|---|---|---|---|');
  for (const q of quarantined) {
    lines.push(`| ${q.type} | ${q.language} | ${q.reviewed} | ${q.falsePositive} | ${Math.round(q.fpRate * 100)}% |`);
  }
  lines.push('');
  lines.push('**Como tirar uma regra da quarentena:** reescreva a heurística de verdade em `heuristics-*.mjs` (o objetivo é resolver a causa do falso-positivo, não só esperar passar) e adicione a chave `"tipo::linguagem"` em `research/bugbounty/quarantine-overrides.json` (array de strings). Isso libera a regra pra voltar a gerar candidato — se ela continuar ruim, a estatística vai refletir isso nas próximas revisões e ela pode voltar a ser quarentenada.');
  lines.push('');
  return lines.join('\n');
}
