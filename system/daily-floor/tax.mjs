// Tabela regressiva de IR sobre renda fixa no Brasil (CDB, Tesouro Selic,
// SEP/CCB) — LCI/LCA são isentas, tratadas à parte por quem chamar. Fonte:
// legislação padrão de IR sobre renda fixa (Lei 11.033/2004 e regulamentação
// da Receita Federal), confirmada nesta sessão via pesquisa (research/registry_round1_partial.md).

const BRACKETS = [
  { maxDays: 180, rate: 0.225 },
  { maxDays: 360, rate: 0.20 },
  { maxDays: 720, rate: 0.175 },
  { maxDays: Infinity, rate: 0.15 },
];

export function irRateForHoldingDays(days) {
  if (days < 0) throw new Error('days não pode ser negativo');
  const bracket = BRACKETS.find((b) => days <= b.maxDays);
  return bracket.rate;
}

/** grossReturn: lucro bruto em valor monetário (não %). Retorna lucro líquido. */
export function netReturn(grossReturn, holdingDays, { exempt = false } = {}) {
  if (exempt) return grossReturn;
  const rate = irRateForHoldingDays(holdingDays);
  return grossReturn * (1 - rate);
}
