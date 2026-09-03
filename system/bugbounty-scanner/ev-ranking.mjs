// Fecha a lacuna #7 (metade "ranking por EV") da revisão de 03/09/2026.
// A própria revisão avisou: "com apenas seis resultados, ainda não vale
// treinar modelo sofisticado. Comece com regras explícitas e
// probabilidades suavizadas; depois calibre quando houver amostra
// suficiente." Isto é exatamente isso -- probabilidades explícitas,
// documentadas, ajustáveis à mão conforme mais outcomes reais chegarem,
// nunca um modelo treinado que finge precisão que a amostra (6 casos)
// não sustenta.
//
// EV = P(tecnicamente válido) × P(novo) × P(impacto aceito) × bounty
//      esperado − custo de pesquisa
//
// Cada P(...) tem uma tabela pequena e citável, não uma rede neural.

/** technicalValidity -> probabilidade de que a alegação técnica está
 * correta. `null` (ainda não avaliado) usa o prior neutro -- nunca finge
 * já saber antes de investigar. */
const VALIDITY_PRIOR = {
  confirmed: 0.95,
  inconclusive: 0.3,
  refuted: 0.02,
};
const DEFAULT_VALIDITY_PRIOR = 0.5;

export function probabilityValid(technicalValidity) {
  if (technicalValidity == null) return DEFAULT_VALIDITY_PRIOR;
  return VALIDITY_PRIOR[technicalValidity] ?? DEFAULT_VALIDITY_PRIOR;
}

/** riskScore (0-100, de novelty-risk.mjs::assessNoveltyRisk) -> P(não é
 * duplicata). Inversão direta e documentada, não uma curva calibrada --
 * é o que a amostra atual sustenta honestamente. `null` (nunca avaliado)
 * usa o prior mais conservador (0.2): sem avaliação de novidade nenhuma,
 * o portfólio real (6/6 duplicate) diz que assumir "provavelmente novo"
 * seria otimismo não sustentado pelos dados. */
export function probabilityNovel(riskScore) {
  if (!Number.isFinite(riskScore)) return 0.2;
  return Math.max(0, Math.min(1, 1 - riskScore / 100));
}

/** impactAssessment -> P(o resultado, se reportado, seria aceito como
 * achado de segurança de verdade, não fechado Informative/Not Applicable).
 * reportable=false já é 0 (o SecurityImpactGate concorda: nunca deveria
 * ter chegado a relatório). impactScope pondera o quão longe o efeito
 * alcança -- mesma hierarquia que reportabilityGate usa pra rejeitar
 * self_request_only. */
const IMPACT_SCOPE_PROB = {
  systemic: 0.85,
  other_system: 0.75,
  other_user: 0.6,
  self_request_only: 0.1,
};

export function probabilityImpactAccepted(impactAssessment) {
  if (!impactAssessment) return 0.4; // ainda não avaliado -- prior neutro-baixo, não otimista
  if (impactAssessment.reportable === false) return 0;
  return IMPACT_SCOPE_PROB[impactAssessment.impactScope] ?? 0.4;
}

/**
 * `input`: { technicalValidity, riskScore, impactAssessment,
 * expectedBountyUsd, researchCostUsd }. `expectedBountyUsd`/
 * `researchCostUsd` são estimativas de quem chama (payout do programa,
 * horas já gastas × valor da hora) -- este módulo não inventa nenhum dos
 * dois. Pura, determinística, cada fator citado em `breakdown` pro
 * resultado nunca ser "número misterioso" (mesmo princípio de
 * scoreCandidate/evidence-grade.mjs).
 */
export function computeExpectedValue(input = {}) {
  const pValid = probabilityValid(input.technicalValidity);
  const pNovel = probabilityNovel(input.riskScore);
  const pImpact = probabilityImpactAccepted(input.impactAssessment);
  const bounty = Number.isFinite(input.expectedBountyUsd) ? input.expectedBountyUsd : 0;
  const cost = Number.isFinite(input.researchCostUsd) ? input.researchCostUsd : 0;

  const grossExpectedValueUsd = pValid * pNovel * pImpact * bounty;
  const netExpectedValueUsd = grossExpectedValueUsd - cost;

  return {
    probabilityValid: pValid,
    probabilityNovel: pNovel,
    probabilityImpactAccepted: pImpact,
    expectedBountyUsd: bounty,
    researchCostUsd: cost,
    grossExpectedValueUsd: Math.round(grossExpectedValueUsd * 100) / 100,
    netExpectedValueUsd: Math.round(netExpectedValueUsd * 100) / 100,
    breakdown: [
      `P(válido)=${pValid} (technicalValidity=${input.technicalValidity ?? 'não avaliado'})`,
      `P(novo)=${pNovel.toFixed(2)} (riskScore=${Number.isFinite(input.riskScore) ? input.riskScore : 'não avaliado'})`,
      `P(impacto aceito)=${pImpact} (impactAssessment=${input.impactAssessment ? (input.impactAssessment.reportable ? input.impactAssessment.impactScope : 'reportable=false') : 'não avaliado'})`,
      `bounty esperado=US$${bounty} − custo de pesquisa=US$${cost}`,
    ],
  };
}
