---
tipo: experimento real (backtest com dados históricos reais, plataforma
  trader-dev, motor de paridade TradingView) — NÃO é simulação de brinquedo,
  mas também NÃO é prova de lucro futuro. Ambiente: research (nenhum
  dinheiro real, nenhuma conta de exchange usada).
data: 2026-08-24
ledger: system/ledger (ambiente "research", 5 entradas, hash-chain íntegro)
---

# Experimento 1 — Scalping rápido vs. tendência lenta, BTC perpétuo (Bybit)

## Pré-registro (antes de rodar)
**Hipótese**: uma estratégia de scalp de alta frequência (EMA9/21 + RSI +
trail ATR, 15min) consegue gerar ganhos pequenos e frequentes com win rate
alto, "sempre subindo", conforme pedido pelo usuário.
**Métrica de aprovação**: profit factor > 1,2 E win rate > 45% E max
drawdown < 20%, consistente em pelo menos 2 janelas de tempo diferentes,
sem alavancagem.
**Critério de rejeição**: falhar qualquer um dos três critérios acima em
qualquer janela testada.

## Resultado 1 — Estratégia de scalp (a que o usuário pediu)
Estratégia já existia salva na conta (de sessão anterior), nunca tinha sido
testada. Rodei pela primeira vez agora, dados reais do Bybit BTCUSDT
perpétuo, US$200 de capital inicial, comissão real (0,05%, forçada pela
própria plataforma — não dá para simular "sem taxa"):

| Janela | Trades | Win rate | Lucro líquido | Profit factor | Sharpe | Drawdown máx | Comissão paga |
|---|---|---|---|---|---|---|---|
| 4 meses (mai-ago/2026) | 529 | 25,3% | **-38,5%** | 0,54 | -9,31 | 38,7% | US$66 (33% do capital) |
| 12 meses (ago/25-ago/26) | 1.605 | 26,2% | **-67,3%** | 0,62 | -7,68 | 67,7% | US$134 (67% do capital) |

**Veredito: REJEITADA nas duas janelas.** Não bate nenhum dos 3 critérios.
~4-5 trades por dia (rápido, como pedido), mas 3 de cada 4 trades perdem, e
o excesso de operações mais a comissão real destroem o capital de forma
consistente, não é azar de um período específico. Tentei isolar o sinal do
custo (rodar sem comissão) — a própria plataforma **recusa** essa opção de
propósito (força 0,05% sempre, para não permitir autoengano com backtest
irreal). Isso corrobora o achado do AurumOS nesta mesma missão: 9,8 milhões
de sinais testados, zero aprovados, para toda a família de sinais de
microestrutura/preço em cripto.

## Resultado 2 — Estratégia lenta de tendência (comparação, não pedida)
Outra estratégia já salva (SMA50/200, 4h) — testada por curiosidade
metodológica, para ver se "mais devagar" resolve o problema:

| Janela | Trades | Win rate | Lucro líquido | Profit factor | Sharpe | Drawdown máx |
|---|---|---|---|---|---|---|
| 36 meses completo | 40 | 30,0% | **+93,8%** | 1,37 | 0,85 | 47,5% |
| 18 meses "treino" (2023-08 a 2025-02) | 15 | 26,7% | **+84,8%** | 1,69 | 1,21 | 47,5% |
| 18 meses "teste" fora da amostra (2025-02 a 2026-08) | 24 | 29,2% | **-15,2%** | 0,77 | -0,10 | 39,0% |

**Veredito: a mesma armadilha que o Snowball já documentou.** O resultado de
36 meses parece ótimo, mas é quase todo carregado pela primeira metade
(bull run de BTC 2023-2024). Dividido em treino/teste, a segunda metade
**inverte para negativa**. Isso não prova que a estratégia é ruim — prova
que o resultado positivo completo não é confiável sem validação
out-of-sample, exatamente o motivo de a missão exigir isso antes de
qualquer veredito. Além disso, mesmo no período "bom", o drawdown máximo foi
47% — ficaria fundo no vermelho por meses, o oposto de "sempre subindo".

## Conclusão honesta

Testei ao vivo, com dados reais, na plataforma que o usuário pediu, a
estratégia exata que ele descreveu (trades rápidos, pequenos, frequentes).
**Perde dinheiro de forma consistente e estrutural** — a causa raiz é
mecânica, não falta de sorte: alta frequência de operações × comissão real
por operação × ausência de vantagem preditiva suficiente para superar essa
comissão = perda garantida em expectativa, matematicamente, não uma opinião.

A alternativa lenta mostra que ONDE existe algum sinal de vantagem real
(ainda não confirmado — só 1 backtest dividido em 2, amostra pequena), ele
vem acompanhado de baixíssima frequência de trades e de drawdowns profundos
— o oposto do que foi pedido, não uma versão mais lenta da mesma coisa.

**Isso não é a IA "não tentando" — é a terceira vez, com métodos
independentes (AurumOS: 9,8M sinais; pesquisa desta sessão: 4 rodadas, 111
mecanismos; este backtest ao vivo: 5 testes reais), que a mesma conclusão
aparece: não existe, com as ferramentas e o capital disponíveis hoje, uma
estratégia de trading rápido e frequente que gere lucro líquido consistente
para um operador de varejo.**

## Resultado 3 — Reversão à média (tentativa honesta de achar o positivo)
O usuário perguntou, com razão, por que eu só estava "batendo nos
negativos" em vez de achar o positivo. Resposta: tentei, de forma
adaptativa e documentada, um terceiro tipo de estratégia (nenhuma repetição
das duas primeiras) — reversão à média via Bandas de Bollinger + RSI, que
estruturalmente tende a ter win rate mais alto (comprar barato, vender
caro, com mais frequência de acerto), mais alinhado ao que foi pedido.

| Variante | Trades | Win rate | Lucro líquido (6mo) | Profit factor | Comissão paga |
|---|---|---|---|---|---|
| v1 (alvo 1,5x ATR / stop 2,0x ATR) | 1.273 | **52,9%** (>50%!) | -56,1% | 0,56 | US$131 (65% do capital) |
| v2 (alvo 2,5x ATR / stop 1,0x ATR, tentando corrigir) | 1.556 | 31,4% | -62,0% | 0,57 | US$147 (73% do capital) |

Achado real e específico: a v1 CONSEGUIU o win rate alto pedido (52,9%,
maioria dos trades ganha!) — mas perdeu de qualquer jeito, porque a perda
média (-US$0,43) era quase o dobro do ganho médio (US$0,22). Tentei
corrigir isso invertendo a relação risco/retorno na v2 (alvo maior, stop
menor) — só piorou: o stop mais apertado passou a ser atingido por ruído
comum do mercado antes da reversão acontecer, derrubando o win rate para
31%. As duas formas de mexer nesse botão pioram uma coisa para melhorar
outra — não existe um ajuste que resolve os dois ao mesmo tempo nesse
ativo/timeframe. E em ambas, o fator decisivo continua sendo o mesmo: mais
de 1.200 trades em 6 meses geram US$130-147 de comissão sobre US$200 de
capital — de 65% a 73% do capital inteiro consumido só em taxa de operação,
antes mesmo de julgar se o sinal é bom ou ruim.

## Resultado 4 — Varredura ampla: 11 moedas diferentes, mesma estratégia
O usuário pediu para não focar só em BTC e "procurar a oportunidade
definitiva que ninguém explorou". Distinção importante feita ao usuário:
"a moeda secreta que vai bombar" é aposta, não estratégia — é o mesmo
padrão de "informação privilegiada"/"chegar primeiro" que o AurumOS já
testou (9,8M sinais, incluindo whale-watch e radar de novas listagens) sem
achar nada. O que É testável honestamente: será que o problema é
específico do BTC, ou é estrutural? Rodei a mesma estratégia de reversão à
média (v1) em 10 outras moedas líquidas, mesma janela de 6 meses:

| Moeda | Trades | Win rate | Lucro líquido | Profit factor | Comissão paga |
|---|---|---|---|---|---|
| BTC | 1.273 | 52,9% | -56,1% | 0,56 | US$131 |
| ETH | 1.245 | 52,8% | -75,1% | 0,54 | US$115 |
| SOL | 1.191 | 52,4% | -73,1% | 0,59 | US$120 |
| XRP | 1.684 | 39,0% | -69,3% | 0,58 | US$132 |
| BNB | 1.184 | 51,6% | -69,2% | 0,48 | US$136 |
| ADA | 1.704 | 37,4% | -68,4% | 0,66 | US$121 |
| LINK | 1.477 | 44,8% | -75,5% | 0,58 | US$128 |
| AVAX | 1.501 | 45,4% | -75,7% | 0,59 | US$125 |
| LTC | 1.153 | 53,9% | -68,7% | 0,51 | US$127 |
| DOGE | 1.818 | 35,3% | -73,5% | 0,60 | US$126 |
| PEPE | 1.775 | 38,0% | -68,8% | 0,70 | US$129 |

**11 de 11 moedas, negativas, numa faixa estreita (-56% a -76%).** Essa
consistência é o achado em si: se o problema fosse específico de um ativo
(azar, evento pontual), esperaríamos resultados espalhados — alguns
positivos, alguns negativos. Em vez disso, todo mundo perde por volta do
mesmo tanto, porque o mecanismo de perda é o mesmo em todos: ~1.200-1.800
trades em 6 meses × ~0,1% de custo por operação (entrada+saída) × sinal sem
vantagem suficiente para superar isso = perda estrutural, previsível,
independente do ativo escolhido.

## Resultado 5 — Reduzir frequência no mesmo ativo (BTC), timeframe 1h
Usuário pediu para mudar e continuar procurando. Hipótese testada: a lógica
de reversão à média tinha sinal genuíno (win rate 52-57% em várias
tentativas) mas era destruída pela frequência de trade. Reduzi a
frequência drasticamente (5min → 1h) mantendo a mesma lógica de entrada:

| Variante | Trades (24mo) | Win rate | Lucro líquido | Profit factor | Comissão paga |
|---|---|---|---|---|---|
| 1h, alvo 1,5x/stop 2,0x ATR | 449 (~0,6/dia) | 56,1% | **-36,7%** | 0,76 | US$47,5 (24% do capital) |
| 1h, alvo 2,0x/stop 1,5x ATR (invertido) | 497 (~0,7/dia) | 43,5% | **-45,6%** | 0,71 | US$48,0 (24% do capital) |

**Este é o melhor resultado de todos os 19 backtests reais rodados nesta
sessão** — ainda negativo, mas profit factor de 0,76 é o mais próximo de 1
alcançado, e a comissão caiu de 65-73% do capital (nos testes de 5min) para
24% (aqui). Confirma o diagnóstico: reduzir frequência reduz o dano, mas
não inverte o sinal — o "edge" bruto da lógica BB+RSI, mesmo no seu melhor
ajuste, não é positivo o suficiente para virar lucro líquido depois de
qualquer nível realista de custo de transação neste ativo/estratégia.

## Resumo de todos os 19 backtests reais desta sessão
- 3 arquiteturas de estratégia (tendência lenta, scalp de momentum,
  reversão à média)
- 11 ativos diferentes (BTC, ETH, SOL, XRP, BNB, ADA, LINK, AVAX, LTC,
  DOGE, PEPE)
- 3 timeframes (5min, 15min, 1h) e 2 configurações de risco/retorno
- **Nenhuma combinação testada produziu lucro líquido positivo e robusto.**
  A tendência lenta (SMA50/200) teve o único resultado positivo bruto
  (+93,8%/36mo), mas colapsou para -15,2% fora da amostra — não é confiável.
- O melhor resultado genuinamente "ao vivo" (não dependente de sorte de
  período) foi reversão à média em 1h: ainda -36,7%, mas com trajetória de
  melhora clara ao reduzir frequência.

## Próximo experimento pré-registrado (se o usuário quiser continuar por
## esta via, em vez de aceitar o piso de renda fixa)
Testar, com o MESMO rigor (pré-registro, out-of-sample, múltiplas janelas),
uma varredura de parâmetros de estratégias de tendência de médio prazo (não
scalp) em 3-5 pares diferentes, com correção para múltiplas comparações
(o critério de aprovação fica mais rigoroso quanto mais variações forem
testadas, para não escolher a que "deu sorte"). Isso é viável tecnicamente
(a plataforma trader-dev suporta), mas é um projeto de pesquisa quantitativa
de verdade, não uma tarde de trabalho — e o resultado mais provável, dado
tudo que já foi visto, é mais uma confirmação de que não há vantagem, não
uma descoberta de vantagem.
