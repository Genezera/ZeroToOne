// Núcleo puro (sem SDK do Apify) do "br-series-fetcher": busca séries
// temporais do SGS (Sistema Gerenciador de Séries Temporais) do Banco
// Central do Brasil — dados abertos oficiais, publicados para reuso
// (https://dadosabertos.bcb.gov.br/), sem restrição documentada contra
// consultas automatizadas (ao contrário da BrasilAPI, que proíbe
// explicitamente "requisições em loop" — por isso este produto usa a fonte
// oficial diretamente, não um agregador comunitário).
//
// Valor agregado real sobre chamar a API crua: (1) BCB limita o volume
// retornado por consulta de série histórica desde 26/03/2025 — este módulo
// fatia automaticamente o intervalo pedido em blocos anuais e concatena o
// resultado, o que a maioria dos usuários não implementaria sozinha; (2)
// normaliza o formato inconsistente (vírgula decimal, datas DD/MM/AAAA) para
// JSON limpo (ISO date, number); (3) inclui metadados amigáveis (nome,
// unidade) para os códigos de série mais usados, evitando que o usuário
// precise consultar o catálogo do BCB para saber o que é o código 11 ou 12.

const BASE_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs';

// Catálogo de códigos verificados manualmente contra a API real nesta sessão
// (11, 12, 1) ou documentados publicamente pelo BCB (433, 432). Antes de
// confiar em um código novo fora desta lista, confirme no catálogo oficial:
// https://www3.bcb.gov.br/sgspub
export const KNOWN_SERIES = {
  11: { name: 'Taxa Selic (fator diário, % ao dia)', unit: '% a.d.', frequency: 'diária' },
  12: { name: 'CDI (fator diário, % ao dia)', unit: '% a.d.', frequency: 'diária' },
  1: { name: 'Dólar americano (venda, PTAX)', unit: 'BRL/USD', frequency: 'diária' },
  433: { name: 'IPCA (variação mensal, %)', unit: '% a.m.', frequency: 'mensal' },
  432: { name: 'Meta Selic definida pelo Copom (% a.a.)', unit: '% a.a.', frequency: 'por reunião' },
};

function parseBrDate(brDate) {
  const [d, m, y] = brDate.split('/');
  return `${y}-${m}-${d}`;
}

function formatBrDate(date) {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

/** Divide [start, end] em blocos de no máximo `maxDays` dias (padrão: ~1 ano). */
export function chunkDateRange(start, end, maxDays = 365) {
  const chunks = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endUtc) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > endUtc) chunkEnd.setTime(endUtc.getTime());
    chunks.push([new Date(cursor), new Date(chunkEnd)]);
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

// A API do BCB ocasionalmente responde com 200 OK mas corpo inesperado
// (observado nesta sessão: uma resposta não-array transitória) — checar só
// res.ok não basta. Valida a FORMA dos dados, não só o status HTTP, e tenta
// de novo se a forma não bater.
async function fetchWithRetry(url, { retries = 3, backoffMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`);
      const data = await res.json();
      if (!Array.isArray(data)) {
        throw new Error(`Resposta inesperada (não é array) de ${url}: ${JSON.stringify(data).slice(0, 200)}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
    }
  }
  throw new Error(`Falhou após ${retries + 1} tentativas: ${lastErr.message}`);
}

/**
 * Busca uma série do SGS/BCB entre startDate e endDate (objetos Date, UTC),
 * fatiando automaticamente em blocos anuais para respeitar o limite de
 * volume da API. Retorna linhas normalizadas: { seriesCode, date (ISO),
 * value (number), seriesName, unit }.
 */
export async function fetchSeries(seriesCode, { startDate, endDate, retries } = {}) {
  const meta = KNOWN_SERIES[seriesCode] || { name: null, unit: null };
  const chunks = chunkDateRange(startDate, endDate);
  const rows = [];
  for (const [chunkStart, chunkEnd] of chunks) {
    const url = `${BASE_URL}.${seriesCode}/dados?formato=json&dataInicial=${formatBrDate(chunkStart)}&dataFinal=${formatBrDate(chunkEnd)}`;
    const data = await fetchWithRetry(url, { retries });
    for (const item of data) {
      rows.push({
        seriesCode,
        seriesName: meta.name,
        unit: meta.unit,
        date: parseBrDate(item.data),
        value: Number(item.valor),
      });
    }
  }
  return rows;
}

/** Busca os últimos N valores de uma série (não precisa fatiar por data). */
export async function fetchLatest(seriesCode, n = 1, { retries } = {}) {
  const meta = KNOWN_SERIES[seriesCode] || { name: null, unit: null };
  const url = `${BASE_URL}.${seriesCode}/dados/ultimos/${n}?formato=json`;
  const data = await fetchWithRetry(url, { retries });
  return data.map((item) => ({
    seriesCode,
    seriesName: meta.name,
    unit: meta.unit,
    date: parseBrDate(item.data),
    value: Number(item.valor),
  }));
}
