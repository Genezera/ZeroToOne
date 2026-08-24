// Entrypoint do Apify Actor. Depende do pacote `apify` (SDK oficial) —
// ainda NÃO instalado neste checkout porque o núcleo (lib.mjs) já está 100%
// testado e funcional sem ele; a instalação/deploy real acontece quando
// houver uma conta Apify para rodar `apify push` (ver README.md).
import { Actor } from 'apify';
import { fetchSeries, fetchLatest } from './lib.mjs';

await Actor.init();

const input = await Actor.getInput();
const { seriesCodes, mode, lastN, startDate, endDate } = input;

if (!Array.isArray(seriesCodes) || seriesCodes.length === 0) {
  throw new Error('Informe ao menos um código de série em "seriesCodes".');
}

for (const code of seriesCodes) {
  let rows;
  if (mode === 'latest') {
    rows = await fetchLatest(code, lastN || 30);
  } else if (mode === 'range') {
    if (!startDate || !endDate) {
      throw new Error('Modo "range" exige startDate e endDate (AAAA-MM-DD).');
    }
    rows = await fetchSeries(code, {
      startDate: new Date(`${startDate}T00:00:00Z`),
      endDate: new Date(`${endDate}T00:00:00Z`),
    });
  } else {
    throw new Error(`Modo inválido: "${mode}". Use "latest" ou "range".`);
  }
  await Actor.pushData(rows);
}

await Actor.exit();
