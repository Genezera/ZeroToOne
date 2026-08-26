// Roda uma vez por dia (ou sob demanda): busca a taxa CDI real de hoje no
// BCB, escolhe a melhor conta remunerada conhecida, calcula o rendimento
// líquido do dia sobre o saldo atual, e registra no ledger "paper" — não é
// dinheiro real ainda (o usuário precisa mover o dinheiro de verdade para
// a conta escolhida; eu não posso criar conta nem mexer em dinheiro real
// sem aprovação explícita). Isso é o "quanto estaria rendendo se estivesse
// alocado direito", com dados 100% reais, pronto para virar rastreamento
// real assim que o usuário confirmar que moveu o capital.

import { fetchLatestCdi } from './rates.mjs';
import { KNOWN_ACCOUNTS, withStaleness } from './accounts.mjs';
import { oneDayAccrual } from './accrual.mjs';
import { netReturn } from './tax.mjs';
import { appendEntry, readLedger } from '../ledger/ledger.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const STARTING_PRINCIPAL_USD = Number(process.env.DF_STARTING_PRINCIPAL_USD || 200);
const START_DATE = process.env.DF_START_DATE || null; // ISO date; se não informado, usa a primeira entrada do ledger ou hoje

function loadLastSnapshot() {
  const entries = readLedger('paper').filter((e) => e.type === 'daily_floor_snapshot');
  return entries.length ? entries[entries.length - 1] : null;
}

function pickBestAccount(cdiDailyRatePct) {
  const withStale = withStaleness(KNOWN_ACCOUNTS);
  const usable = withStale.filter((a) => !a.stale);
  const pool = usable.length ? usable : withStale; // se tudo estiver velho, usa mesmo assim mas avisa
  const best = pool.reduce((a, b) => (b.cdiMultiplier > a.cdiMultiplier ? b : a));
  return { ...best, effectiveDailyRatePct: cdiDailyRatePct * best.cdiMultiplier, allStale: !usable.length };
}

export async function runOnce() {
  const cdi = await fetchLatestCdi();
  const last = loadLastSnapshot();

  // Proteção contra duplicidade: já existe snapshot para esta data do BCB
  // (ex.: rodado 2x no mesmo dia) — não registrar de novo, devolver o que
  // já existe.
  if (last && last.date === cdi.date) {
    return { ...last, duplicate: true };
  }

  const startDate = START_DATE || (last ? last.startDate : cdi.date);
  const principalBefore = last ? last.balance : STARTING_PRINCIPAL_USD;
  const holdingDays = Math.max(1, Math.floor((new Date(cdi.date + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z')) / 86400000) || 1);

  const account = pickBestAccount(cdi.dailyRatePct);
  const grossAccrual = oneDayAccrual(principalBefore, account.effectiveDailyRatePct);
  const netAccrual = netReturn(grossAccrual, holdingDays);
  const balanceAfter = principalBefore + netAccrual;

  const snapshot = appendEntry('paper', {
    type: 'daily_floor_snapshot',
    startDate,
    date: cdi.date,
    cdiDailyRatePct: cdi.dailyRatePct,
    account: account.name,
    accountSource: account.source,
    accountStale: account.stale,
    effectiveDailyRatePct: account.effectiveDailyRatePct,
    holdingDays,
    balanceBefore: principalBefore,
    grossAccrual,
    netAccrual,
    balance: balanceAfter,
  });

  return snapshot;
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runOnce()
    .then((s) => {
      console.log(`[${s.date}] Conta: ${s.account} | CDI hoje: ${s.cdiDailyRatePct}%/dia | Saldo: $${s.balanceBefore.toFixed(4)} -> $${s.balance.toFixed(4)} (+$${s.netAccrual.toFixed(6)} líquido, dia ${s.holdingDays})`);
      if (s.accountStale) console.log('AVISO: a taxa da conta usada está desatualizada (>30 dias) — confirmar no app antes de confiar.');
    })
    .catch((err) => {
      console.error('Erro ao rodar daily-runner:', err.message);
      process.exit(1);
    });
}
