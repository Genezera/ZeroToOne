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
