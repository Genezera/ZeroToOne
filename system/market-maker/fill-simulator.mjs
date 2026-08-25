// Simula se um trade real (do tape público da Bybit) teria cruzado minhas
// cotações simuladas. LIMITAÇÃO HONESTA: isso assume prioridade de fila
// favorável (que meu bid/ask "estaria na frente" quando o preço cruza) —
// é uma aproximação otimista. Resultado positivo aqui é evidência fraca,
// não prova; documentar isso sempre que reportar resultados.

/**
 * @param {{bidPrice: number|null, askPrice: number|null}} quotes
 * @param {{price: number, qty: number}} trade - print real do mercado
 * @param {number} quoteQty - quanto eu estaria disposto a negociar por fill
 * @returns {{side: 'buy'|'sell', price: number, qty: number}|null}
 */
export function simulateFill(quotes, trade, quoteQty) {
  if (quotes.bidPrice != null && trade.price <= quotes.bidPrice) {
    return { side: 'buy', price: quotes.bidPrice, qty: Math.min(quoteQty, trade.qty) };
  }
  if (quotes.askPrice != null && trade.price >= quotes.askPrice) {
    return { side: 'sell', price: quotes.askPrice, qty: Math.min(quoteQty, trade.qty) };
  }
  return null;
}
