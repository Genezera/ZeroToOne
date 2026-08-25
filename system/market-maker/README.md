# market-maker/ — shadow test de market making (dados reais, zero dinheiro real)

Última avenida ainda não testada para "ganho frequente": em vez de apostar
na direção do preço (testado exaustivamente em `experiments/exp01_*`, 19
backtests, todos negativos), cotar compra e venda ao mesmo tempo e lucrar
do spread — não depende de acertar para onde o preço vai.

## Como funciona
- `inventory.mjs` — contabilidade pura (cash + position, sem average-cost).
- `quoting-engine.mjs` — decide bid/ask a partir do mid price real e do
  inventário atual. **Trava de risco embutida**: nunca cota do lado que
  aumentaria uma posição já no limite — reduzir é sempre permitido, nunca
  martingale (não há sequer parâmetro de PnL/histórico de perdas na função,
  ver teste "nunca aumenta agressividade depois de perda").
- `fill-simulator.mjs` — decide se um trade real do tape cruzou minhas
  cotações simuladas.
- `shadow-runner.mjs` — conecta no WebSocket **público** da Bybit
  (`wss://stream.bybit.com/v5/public/linear`, sem autenticação, sem conta,
  sem dinheiro real), alimenta os módulos acima com book/tape reais, e
  registra cada fill simulado e snapshots periódicos no ledger `shadow`.
  Reconecta sozinho com backoff. Kill switch simulado no mesmo limite de
  RISK_LIMITS.md (-US$10).

## Limitação honesta (documentada no código, repetir sempre que reportar resultado)
O fill simulado assume prioridade de fila favorável — que minha cotação
"estaria na frente" quando o preço real cruza aquele nível. É uma
aproximação otimista. **Um resultado positivo aqui é evidência fraca, não
prova.** Antes de qualquer dinheiro real: validar contra fills reais em
testnet/demo (como o AurumOS fez na Bybit Demo), medir seleção adversa de
verdade, e rodar por período longo o suficiente para ter amostra
estatística (o próprio Snowball exigia >=25 episódios antes de qualquer
veredito).

## Rodando
```
node system/market-maker/shadow-runner.mjs
```
Variáveis de ambiente (todas opcionais, com default):
`MM_SYMBOL`, `MM_BASE_SPREAD_BPS`, `MM_MAX_POSITION_USD`, `MM_SKEW_BPS`,
`MM_MAKER_FEE_RATE`, `MM_QUOTE_QTY_USD`, `MM_SNAPSHOT_INTERVAL_MS`,
`MM_KILL_LOSS_USD`.

## Testes
`node --test "system/market-maker/test/*.test.mjs"` — 16 testes, cobrindo
contabilidade, geração de cotação (incluindo trava de risco e a garantia
estrutural anti-martingale), e simulação de fill. Nenhum teste depende de
rede — a conexão real foi verificada manualmente (dados reais de BTC
confirmados fluindo, ver commit da sessão).
