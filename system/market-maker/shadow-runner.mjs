// Runner de shadow trading: conecta no WebSocket PÚBLICO da Bybit (não
// precisa de conta, chave de API, nem dinheiro real), simula cotações de
// market making contra o book/tape reais, e registra tudo no ledger
// (ambiente "shadow"). Nunca envia nenhuma ordem real. Reconecta sozinho
// com backoff. Kill switch simulado: para de cotar (não o processo) se o
// prejuízo simulado ultrapassar o limite configurado, e registra isso.

import { createInventory, applyFill, netWorth } from './inventory.mjs';
import { computeQuotes } from './quoting-engine.mjs';
import { simulateFill } from './fill-simulator.mjs';
import { appendEntry } from '../ledger/ledger.mjs';

const SYMBOL = process.env.MM_SYMBOL || 'BTCUSDT';
const BASE_SPREAD_BPS = Number(process.env.MM_BASE_SPREAD_BPS || 5);
const MAX_POSITION_USD = Number(process.env.MM_MAX_POSITION_USD || 200);
const SKEW_BPS = Number(process.env.MM_SKEW_BPS || 10);
const MAKER_FEE_RATE = Number(process.env.MM_MAKER_FEE_RATE || 0.0001); // 0.01%, conservador (Bybit costuma dar rebate, tratamos como custo)
const QUOTE_QTY_USD = Number(process.env.MM_QUOTE_QTY_USD || 20); // tamanho de cada cotação simulada
const SNAPSHOT_INTERVAL_MS = Number(process.env.MM_SNAPSHOT_INTERVAL_MS || 60_000);
const SIMULATED_LOSS_KILL_USD = Number(process.env.MM_KILL_LOSS_USD || 10); // mesmo limite de RISK_LIMITS.md, aplicado ao shadow por disciplina

const WS_URL = 'wss://stream.bybit.com/v5/public/linear';

let inv = createInventory();
let midPrice = null;
let lastQuotes = { bidPrice: null, askPrice: null };
let killed = false;
let ws = null;
let pingTimer = null;
let lastSnapshotAt = 0;

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function recomputeQuotes() {
  if (midPrice == null || killed) return;
  const params = { baseSpreadBps: BASE_SPREAD_BPS, maxPositionUsd: MAX_POSITION_USD, skewBpsPerFullPosition: SKEW_BPS };
  lastQuotes = computeQuotes(midPrice, inv.position, params);
}

function maybeSnapshot(force) {
  const now = Date.now();
  if (!force && now - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
  lastSnapshotAt = now;
  if (midPrice == null) return;
  const nw = netWorth(inv, midPrice);
  appendEntry('shadow', {
    type: 'mm_snapshot',
    symbol: SYMBOL,
    midPrice,
    position: inv.position,
    positionUsd: inv.position * midPrice,
    cash: inv.cash,
    netWorth: nw,
    fills: inv.fills,
    feesPaid: inv.feesPaid,
    killed,
  });
  log(`snapshot mid=${midPrice.toFixed(2)} pos=${inv.position.toFixed(6)} netWorth=$${nw.toFixed(4)} fills=${inv.fills} feesPaid=$${inv.feesPaid.toFixed(4)}`);
}

function handleOrderbook(data) {
  const bestBid = data.b && data.b.length ? Number(data.b[0][0]) : null;
  const bestAsk = data.a && data.a.length ? Number(data.a[0][0]) : null;
  if (bestBid && bestAsk) {
    midPrice = (bestBid + bestAsk) / 2;
    recomputeQuotes();
  }
}

function handleTrades(trades) {
  if (killed || midPrice == null) return;
  for (const t of trades) {
    const trade = { price: Number(t.p), qty: Number(t.v) };
    const quoteQty = QUOTE_QTY_USD / midPrice;
    const fill = simulateFill(lastQuotes, trade, quoteQty);
    if (!fill) continue;
    inv = applyFill(inv, { side: fill.side, price: fill.price, qty: fill.qty, makerFeeRate: MAKER_FEE_RATE });
    appendEntry('shadow', {
      type: 'mm_fill',
      symbol: SYMBOL,
      side: fill.side,
      price: fill.price,
      qty: fill.qty,
      positionAfter: inv.position,
      cashAfter: inv.cash,
    });
    log(`FILL ${fill.side} ${fill.qty.toFixed(6)} @ ${fill.price.toFixed(2)} | pos=${inv.position.toFixed(6)}`);
    recomputeQuotes();

    const nw = netWorth(inv, midPrice);
    if (nw <= -SIMULATED_LOSS_KILL_USD && !killed) {
      killed = true;
      appendEntry('shadow', { type: 'mm_kill_switch', symbol: SYMBOL, netWorth: nw, reason: `prejuízo simulado atingiu -$${SIMULATED_LOSS_KILL_USD}` });
      log(`KILL SWITCH acionado: netWorth=$${nw.toFixed(4)} <= -$${SIMULATED_LOSS_KILL_USD}. Parando de cotar (processo continua rodando, só de olho).`);
    }
  }
}

function connect() {
  log(`Conectando em ${WS_URL} ...`);
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    log('Conectado. Inscrevendo em orderbook e trades públicos (sem autenticação, sem dinheiro real).');
    ws.send(JSON.stringify({ op: 'subscribe', args: [`orderbook.1.${SYMBOL}`, `publicTrade.${SYMBOL}`] }));
    appendEntry('shadow', { type: 'mm_connected', symbol: SYMBOL, params: { BASE_SPREAD_BPS, MAX_POSITION_USD, SKEW_BPS, MAKER_FEE_RATE, QUOTE_QTY_USD } });
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
    }, 20_000);
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.topic && msg.topic.startsWith('orderbook.') && msg.data) {
        handleOrderbook(msg.data);
        maybeSnapshot(false);
      } else if (msg.topic && msg.topic.startsWith('publicTrade.') && Array.isArray(msg.data)) {
        handleTrades(msg.data);
      }
    } catch (err) {
      log(`Erro processando mensagem: ${err.message}`);
    }
  });

  ws.addEventListener('close', () => {
    log('Conexão fechada. Reconectando em 5s...');
    clearInterval(pingTimer);
    appendEntry('shadow', { type: 'mm_disconnected', symbol: SYMBOL });
    setTimeout(connect, 5000);
  });

  ws.addEventListener('error', (err) => {
    log(`Erro de WebSocket: ${err.message || err}`);
  });
}

log(`Iniciando shadow market maker: ${SYMBOL} | spread base=${BASE_SPREAD_BPS}bps | posição máx=$${MAX_POSITION_USD} | taxa maker=${MAKER_FEE_RATE * 100}% | kill switch=-$${SIMULATED_LOSS_KILL_USD}`);
log('NENHUM dinheiro real envolvido. NENHUMA ordem real é enviada. Isso só observa o mercado real e simula.');
connect();
maybeSnapshot(true);

process.on('SIGINT', () => {
  log('Encerrando por SIGINT. Snapshot final:');
  maybeSnapshot(true);
  process.exit(0);
});
