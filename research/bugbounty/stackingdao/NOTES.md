---
programa: StackingDAO (Immunefi), Clarity/Stacks, max bounty US$100.000
status: investigação EM ANDAMENTO, nada confirmado ainda
data: 2026-08-26
---

# Investigação em andamento — StackingDAO

## O que já fiz
Baixei código-fonte real e ao vivo (via API pública Hiro, sem precisar de
conta) dos contratos em escopo: `stx-reserve-v2`, `stbtc-reserve`,
`ststx-token`, `stbtc-token`, `signer-admin-v1`, `data-stx-v2`,
`data-stbtc-v1`, `dao`, `stacking-dao-core-btc-v3`,
`stacking-dao-core-ststxbtc-v1`. Arquivos `.clar` salvos neste diretório.

## Pista em investigação (NÃO CONFIRMADA)
Em `stx-reserve-v2.clar`, a função `return-stx-from-stacking` (linha 236)
valida `contract-caller` contra a whitelist do `.dao` (`check-is-protocol`),
mas debita STX de `tx-sender`, não de `contract-caller`:

```clarity
(define-public (return-stx-from-stacking (stx-amount uint))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (try! (contract-call? .dao check-is-enabled))
    (var-set stx-staking (- (var-get stx-staking) stx-amount))
    (try! (stx-transfer? stx-amount tx-sender current-contract))
    ...
```

Em Clarity, `tx-sender` é quem assinou a transação original, `contract-caller`
é quem chamou o contrato atual (podem ser diferentes numa cadeia de
chamadas). Se algum contrato "protocolo" (whitelisted) chamar esta função
dentro de uma transação iniciada por um usuário comum, o STX debitado sai
da carteira desse usuário — não necessariamente de quem "deveria" pagar.
Isso PODE ser desenho intencional (padrão comum: contrato privilegiado
valida o valor, usuário paga com o próprio saldo) OU pode ser um bug se
existir um caminho de chamada onde `stx-amount` não é validado contra o
que aquele `tx-sender` específico realmente deve.

`stacking-dao-core-ststxbtc-v1.clar` (que eu já li por completo) NÃO chama
`return-stx-from-stacking` nem `return-stx-from-staking-split` — chama
`.stx-reserve` (não `.stx-reserve-v2`!) só para `lock-stx-for-ststxbtc`,
`request-stx-for-withdrawal-ststxbtc`, `pay-stx-from-idle-ststxbtc`. Ou
seja, essas duas funções suspeitas provavelmente são chamadas por outro
contrato ainda não lido — possivelmente `stacking-dao-core-btc-v3`
(13KB, só li as primeiras 100 linhas) ou um dos contratos `stacker-N`
(ainda não baixados) que interagem com PoX stacking de verdade.

## Atualização — li stacking-dao-core-btc-v3.clar por completo (359 linhas)
Padrão confirmado no resto do código: toda vez que o CORE quer que a
RESERVA pague um usuário, a chamada vem envolvida em `(as-contract
(contract-call? reserve ...))` — isso faz `tx-sender`, dentro da chamada
aninhada, virar o PRÓPRIO CONTRATO que está chamando (não a pessoa que
assinou a transação original). Isso é o idioma padrão de Clarity para "aja
como o contrato, não como quem chamou".

`return-stx-from-stacking`/`return-stx-from-staking-split` NÃO são
chamadas nem por `stacking-dao-core-btc-v3` nem por
`stacking-dao-core-ststxbtc-v1` (os dois arquivos que já li por completo).
Isso são funções para DEVOLVER à reserva o STX que foi retirado para
stacking de verdade (PoX) — quem provavelmente chama isso são os
contratos `stacker-N`, que ainda não baixei.

**Hipótese refinada**: se o `stacker-N` que chama `return-stx-from-stacking`
envolver a chamada em `as-contract` (mesmo padrão do resto do código), o
`tx-sender` vira o próprio stacker (correto — ele devolve do próprio saldo,
onde estava guardando o STX retirado). Se ALGUM caminho chamar essa função
SEM `as-contract`, o `tx-sender` seria quem assinou a transação de fora
(possivelmente um keeper/bot automatizado, ou pior, um usuário comum) — aí
sim seria um bug real. **Ainda não sei qual dos dois casos é verdade.**

## RESOLVIDO — não é bug
Baixei e li `stacker-1.clar`. Linha 179: `(try! (as-contract
(contract-call? reserve-contract return-stx-from-stacking stx-amount)))` —
a chamada ESTÁ envolvida em `as-contract`, então `tx-sender` dentro de
`return-stx-from-stacking` corretamente vira o próprio stacker (não um
terceiro). E `stx-amount` (linha 173) é `(stx-get-balance (as-contract
tx-sender))` — o próprio saldo do stacker, não um valor arbitrário
controlado por usuário. **Desenho seguro, confirmado por evidência direta,
não é vulnerabilidade.**

## Achado real, mas de severidade baixa (provavelmente não elegível)
`ststx-token.clar`, função `set-token-uri` (linha 61-66): usa `(contract-call?
.dao check-is-protocol tx-sender)` — é a ÚNICA função de todo o código lido
que usa `tx-sender` em vez de `contract-caller` para essa checagem (todas
as outras ~25 funções administrativas do resto do código usam
`contract-caller` consistentemente). Isso é uma inconsistência real, mas
`set-token-uri` só altera uma string de metadado (URI do token) — não
mexe em fundos, não permite mintar/queimar/roubar nada. Não se encaixa em
nenhuma das categorias de severidade do programa (roubo de fundos,
congelamento, mintagem não autorizada, insolvência). Provavelmente
"informational", não elegível para recompensa, mas vale reportar como
observação de qualidade de código.

## Resto do código lido (10 contratos, ~40KB de Clarity)
`signer-admin-v1.clar`, `stbtc-reserve.clar` (mesmo padrão seguro do
stx-reserve), `data-stx-v2.clar` (cálculo de taxa de câmbio stSTX/STX,
sem problema óbvio à primeira vista) — nenhum problema de severidade
alta encontrado nesta primeira passada.

## Status honesto depois desta rodada
Nenhuma vulnerabilidade crítica/alta confirmada ainda. Isso é normal e
esperado — bate exatamente com a pesquisa sobre bug bounty (maioria não
acha nada nas primeiras tentativas). O trabalho real foi feito: código
real lido com cuidado, uma hipótese séria investigada e corretamente
descartada com evidência (não "desisti", "verifiquei e estava errado" —
isso é bom processo, não fracasso). Ainda há mais contratos no escopo do
programa (13 total, li os 10 mais relevantes para custódia de fundos) e
outros programas na Immunefi para tentar depois.

## Honestidade
Isso é trabalho de segurança real, não instantâneo. Pode levar sessões
inteiras e ainda assim não confirmar nada — é exatamente o padrão descrito
na pesquisa sobre bug bounty (90% dos iniciantes não ganham nada, e mesmo
para quem ganha, o primeiro achado leva semanas). Não vou reportar isto ao
Immunefi até ter uma cadeia de chamada completa e uma prova de conceito
real.
