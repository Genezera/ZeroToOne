// Lógica pura de cotação (market making): dado o preço médio do mercado e o
// inventário atual, decide o bid/ask que eu "postaria". Nunca aumenta risco
// depois de perda — o skew de inventário sempre empurra na direção de
// REDUZIR posição, nunca de dobrar. Sem martingale, por design.

/**
 * @param {number} midPrice - preço médio do book real (best bid+ask)/2
 * @param {number} position - posição atual (unidades do ativo, +long/-short)
 * @param {object} params
 * @param {number} params.baseSpreadBps - meio-spread base, em pontos-base (ex.: 5 = 0,05%)
 * @param {number} params.maxPositionUsd - exposição máxima permitida (USD nocional)
 * @param {number} params.skewBpsPerFullPosition - quanto o meio-spread desloca (em bps) quando a posição está no limite máximo
 */
export function computeQuotes(midPrice, position, params) {
  const { baseSpreadBps, maxPositionUsd, skewBpsPerFullPosition } = params;
  const positionUsd = position * midPrice;
  const inventoryRatio = maxPositionUsd > 0 ? positionUsd / maxPositionUsd : 0; // -1..+1 tipicamente
  const skewBps = inventoryRatio * skewBpsPerFullPosition;

  const bidSpreadBps = baseSpreadBps + skewBps; // long demais -> bid mais longe (menos vontade de comprar mais)
  const askSpreadBps = baseSpreadBps - skewBps; // long demais -> ask mais perto (mais vontade de vender)

  const bidPrice = midPrice * (1 - bidSpreadBps / 10000);
  const askPrice = midPrice * (1 + askSpreadBps / 10000);

  // Trava de risco dura: nunca cotar do lado que AUMENTARIA uma posição já
  // no limite ou além dele. Reduzir é sempre permitido.
  const atLongLimit = positionUsd >= maxPositionUsd;
  const atShortLimit = positionUsd <= -maxPositionUsd;

  return {
    bidPrice: atLongLimit ? null : bidPrice,
    askPrice: atShortLimit ? null : askPrice,
    inventoryRatio,
  };
}
