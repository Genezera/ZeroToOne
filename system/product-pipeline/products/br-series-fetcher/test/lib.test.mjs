import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDateRange, fetchSeries, fetchLatest, KNOWN_SERIES } from '../lib.mjs';

test('chunkDateRange fatia um intervalo de 800 dias em blocos <=365 dias', () => {
  const start = new Date(Date.UTC(2024, 0, 1));
  const end = new Date(Date.UTC(2026, 2, 10)); // ~800 dias depois
  const chunks = chunkDateRange(start, end, 365);
  assert.ok(chunks.length >= 3, `esperava >=3 blocos, veio ${chunks.length}`);
  for (const [s, e] of chunks) {
    const days = (e - s) / 86400000;
    assert.ok(days <= 365, `bloco com ${days} dias excede o máximo`);
  }
  assert.equal(chunks[0][0].getTime(), start.getTime());
  assert.equal(chunks[chunks.length - 1][1].getTime(), end.getTime());
});

test('chunkDateRange com intervalo pequeno retorna um único bloco', () => {
  const start = new Date(Date.UTC(2026, 0, 1));
  const end = new Date(Date.UTC(2026, 0, 10));
  const chunks = chunkDateRange(start, end, 365);
  assert.equal(chunks.length, 1);
});

test('KNOWN_SERIES documenta os códigos usados nos testes de integração', () => {
  assert.ok(KNOWN_SERIES[11].name.includes('Selic'));
  assert.ok(KNOWN_SERIES[12].name.includes('CDI'));
  assert.ok(KNOWN_SERIES[1].name.includes('Dólar'));
});

// --- Testes de integração: batem na API real do Banco Central (rede
// necessária). Se a rede não estiver disponível, estes dois testes falham
// com erro de fetch — isso é esperado e documentado, não um bug do código. ---

test('fetchLatest(11) retorna dados reais e recentes da Selic', async () => {
  const rows = await fetchLatest(11, 3);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.seriesCode, 11);
    assert.ok(Number.isFinite(row.value));
    assert.ok(row.value > 0 && row.value < 1, `valor fora da faixa esperada para fator diário: ${row.value}`);
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('fetchSeries(1) busca dólar PTAX num intervalo curto e normaliza o formato', async () => {
  const rows = await fetchSeries(1, {
    startDate: new Date(Date.UTC(2026, 7, 20)),
    endDate: new Date(Date.UTC(2026, 7, 24)),
  });
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.equal(row.seriesCode, 1);
    assert.ok(row.value > 3 && row.value < 10, `cotação USD/BRL fora de faixa plausível: ${row.value}`);
  }
});

test('fetchSeries(12) atravessa >365 dias e concatena múltiplos blocos automaticamente (o valor-agregado central do produto)', async () => {
  const rows = await fetchSeries(12, {
    startDate: new Date(Date.UTC(2024, 0, 1)),
    endDate: new Date(Date.UTC(2026, 5, 30)), // ~2.5 anos, força >=3 blocos de 365 dias
  });
  // CDI é publicado em dias úteis; ~2.5 anos tem bem mais de 500 dias úteis.
  assert.ok(rows.length > 500, `esperava >500 linhas concatenadas, veio ${rows.length}`);
  const dates = rows.map((r) => r.date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted, 'linhas dos vários blocos devem sair em ordem cronológica, sem furos de ordenação nas bordas dos blocos');
  assert.equal(new Set(dates).size, dates.length, 'não deve haver datas duplicadas nas bordas dos blocos concatenados');
});
