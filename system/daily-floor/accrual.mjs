// Matemática pura de composição diária. As séries SGS 11 (Selic) e 12 (CDI)
// do Banco Central publicam o fator diário em % ao dia útil; a convenção
// padrão de mercado no Brasil anualiza por 252 dias úteis/ano.

const BUSINESS_DAYS_PER_YEAR = 252;

/** dailyRatePct: ex. 0.051660 significa 0,051660% ao dia (não 0.05166 como fração). */
export function annualizedRate(dailyRatePct) {
  return (Math.pow(1 + dailyRatePct / 100, BUSINESS_DAYS_PER_YEAR) - 1) * 100;
}

export function compoundDaily(principal, dailyRatePct, businessDays) {
  if (principal < 0) throw new Error('principal não pode ser negativo');
  if (businessDays < 0) throw new Error('businessDays não pode ser negativo');
  return principal * Math.pow(1 + dailyRatePct / 100, businessDays);
}

/** Quanto renderia (bruto) em UM dia útil, em valor monetário. */
export function oneDayAccrual(principal, dailyRatePct) {
  return compoundDaily(principal, dailyRatePct, 1) - principal;
}
