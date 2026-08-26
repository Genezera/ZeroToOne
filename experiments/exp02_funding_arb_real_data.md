---
tipo: experimento real (dados históricos reais de funding rate da Bybit,
  API pública, sem conta/dinheiro real). Ambiente: research.
data: 2026-08-26
ledger: system/ledger (ambiente "research", 3 entradas novas)
---

# Experimento 2 — Funding-rate arbitrage, primeiro teste com dado real

## Por que este teste
AurumOS e Snowball (projetos anteriores desta missão) convergiram,
independentemente, na mesma hipótese remanescente depois de refutar sinais
direcionais: funding-rate arbitrage (comprar à vista + vender perpétuo,
delta-neutro, embolsando o pagamento de funding a cada 8h). Nenhum dos dois
chegou a testar isso com dado real até o fim — só pesquisa de mesa. Esta
sessão também só tinha pesquisa de mesa sobre isso até agora. Testei pela
primeira vez com dado real.

## Método
Busquei o histórico real de funding rate (API pública da Bybit,
`/v5/market/funding/history`) para BTCUSDT, ETHUSDT, SOLUSDT — 333 dias,
1000 pagamentos de funding por moeda (3 por dia, a cada 8h). Somei a taxa
de funding acumulada e apliquei sobre o notional realista: **US$100 por
perna** (não US$200) — com US$200 de capital total e SEM alavancagem
(regra do RISK_LIMITS.md), o máximo de exposição delta-neutra por perna é
metade do capital. Descontei taxas de abertura+fechamento uma única vez
(spot 0,1% + perp 0,05%, round-trip nas duas pernas = US$0,60 sobre
US$100/perna), assumindo a posição mantida o período inteiro sem
rebalanceamento (cenário favorável — rebalancear custaria mais).

## Resultado

| Moeda | Funding acumulado | Taxas | Lucro líquido (333d) | Por dia |
|---|---|---|---|---|
| BTC | +US$4,73 | -US$0,60 | +US$2,07 | **US$0,0062/dia** |
| ETH | +US$4,04 | -US$0,60 | +US$1,72 | **US$0,0052/dia** |
| SOL | -US$2,35 | -US$0,60 | -US$2,95 | **-US$0,0044/dia** |

Comparação direta com o piso já verificado e rodando
(`system/daily-floor`): **US$0,084/dia**.

## Conclusão honesta

Funding-rate arbitrage em BTC/ETH tem retorno **líquido positivo real**,
mas **13-16x menor que o piso de renda fixa já em produção**, com MUITO
mais risco: exposto a risco de contraparte de exchange, risco de base
(spot e perp não se movem perfeitamente juntos — não modelado aqui, cenário
otimista), risco jurídico (CVM proíbe oferta de derivativos cripto a
brasileiro sem autorização), e capital preso numa exchange — o que viola a
regra de liquidez total confirmada em 2026-08-26 (sacar de exchange cripto
para conta real não é instantâneo). Em SOL, o resultado é negativo — nem
sequer supera o custo de transação.

**Isso fecha, com evidência real pela primeira vez, a hipótese que os dois
projetos anteriores mais valorizavam.** Não é uma hipótese ruim em teoria —
a lógica econômica é real (quem paga é o especulador alavancado) — mas na
prática, com US$200, sem alavancagem, e depois de custo/risco reais, perde
para simplesmente deixar o dinheiro numa conta remunerada com garantia do
FGC. Não vale a pena perseguir isto com dinheiro real.
