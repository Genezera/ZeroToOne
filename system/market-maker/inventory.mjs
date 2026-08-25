// Contabilidade pura de inventário/caixa para o simulador de market making.
// Modelo: cash (USD) + position (unidades do ativo base). Sem average-cost —
// PnL é sempre derivado de cash + position*markPrice, o que é robusto e
// simples de auditar (evita erros sutis de contabilidade de custo médio).

export function createInventory() {
  return { cash: 0, position: 0, fills: 0, feesPaid: 0 };
}

/**
 * Aplica um fill simulado. side: 'buy' (aumenta position, reduz cash) ou
 * 'sell' (reduz position, aumenta cash). Taxa de maker sempre reduz cash
 * (custo), nunca é tratada como rebate — postura conservadora.
 */
export function applyFill(inv, { side, price, qty, makerFeeRate }) {
  if (qty <= 0) throw new Error('qty precisa ser positivo');
  if (price <= 0) throw new Error('price precisa ser positivo');
  const notional = price * qty;
  const fee = notional * makerFeeRate;
  const next = { ...inv };
  if (side === 'buy') {
    next.position += qty;
    next.cash -= notional + fee;
  } else if (side === 'sell') {
    next.position -= qty;
    next.cash += notional - fee;
  } else {
    throw new Error(`side inválido: ${side}`);
  }
  next.fills += 1;
  next.feesPaid += fee;
  return next;
}

export function netWorth(inv, markPrice) {
  return inv.cash + inv.position * markPrice;
}
