// Busca a taxa CDI/Selic real de hoje, reaproveitando o cliente já testado
// do BCB SGS (system/product-pipeline/products/br-series-fetcher/lib.mjs).
import { fetchLatest } from '../product-pipeline/products/br-series-fetcher/lib.mjs';

const SELIC_SERIES = 11;
const CDI_SERIES = 12;

/** Retorna o fator diário mais recente publicado pelo BCB (% ao dia útil). */
export async function fetchLatestDailyRate(seriesCode) {
  const rows = await fetchLatest(seriesCode, 1);
  if (!rows.length) throw new Error(`BCB não retornou dado para a série ${seriesCode}`);
  return { date: rows[0].date, dailyRatePct: rows[0].value };
}

export async function fetchLatestSelic() {
  return fetchLatestDailyRate(SELIC_SERIES);
}

export async function fetchLatestCdi() {
  return fetchLatestDailyRate(CDI_SERIES);
}
