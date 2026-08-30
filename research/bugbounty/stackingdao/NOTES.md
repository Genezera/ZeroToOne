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

## Rodada 2 — revisão da fila do scanner automático (2026-08-26)
Scanner automático (`system/bugbounty-scanner`) gerou 3 candidatos novos em
`queue.jsonl`, todos revisados nesta rodada:

1. **`set-token-uri` (auth_arg_inconsistency)** — verdict: **confirmado**
   (a inconsistência tx-sender/contract-caller é real, já documentada acima),
   mas confidence alta que NÃO é elegível — só metadado (URI), sem fundos
   envolvidos. Nenhum relatório escrito (não se encaixa nas categorias que o
   programa paga).
2. **`deposit` (unguarded_transfer)** — verdict: **falso_positivo**,
   confidence alta. `(stx-transfer? stx-amount tx-sender .stx-reserve)`
   (linha 38) já passa `tx-sender` como o próprio argumento `sender` — a VM
   Clarity só permite mover fundos de quem é `tx-sender` (ou do próprio
   contrato sob `as-contract`), então não existe caminho para debitar
   fundos de terceiros. Análise autocontida, sem depender de outro arquivo.
3. **`init-withdraw` (unguarded_transfer)** — verdict: **falso_positivo**,
   confidence **média** (não alta). A única transferência de valor chama
   `.ststxbtc-token-v2 transfer ststxbtc-amount sender current-contract
   none` com `sender=tx-sender` (linha 49). O padrão SIP-010 deste mesmo
   protocolo (confirmado em `ststx-token.clar` linha 44:
   `(asserts! (is-eq tx-sender sender) ...)`) garante que só o dono dos
   tokens pode movê-los. **Não consegui baixar `ststxbtc-token-v2.clar`
   para confirmar byte a byte** — a API pública da Hiro (`api.hiro.so`)
   está bloqueada pela política de egress deste ambiente nesta sessão
   (403 no proxy, confirmado via `$HTTPS_PROXY/__agentproxy/status`). Por
   isso a confidence ficou em média, não alta, apesar do argumento sender
   ser sempre `tx-sender` dentro da própria função (o que já limita o
   dano mesmo no pior cenário).

Nenhum item desta rodada gerou rascunho de relatório — todos foram
falso_positivo ou confirmado-mas-não-elegível (metadado, não fundos).

## O que falta
- `ststxbtc-token-v2.clar`, `ststxbtc-data-v1.clar`,
  `ststxbtc-withdraw-nft-v2.clar` ainda não foram baixados (bloqueio de
  rede desta sessão específica — tentar de novo em outra sessão/ambiente
  onde api.hiro.so não esteja bloqueado, para fechar com confidence alta
  o item `init-withdraw`).
- `dao.clar` e os demais contratos já baixados no diretório ainda não
  foram lidos linha a linha nesta rodada (só reconfirmados os pontos
  relevantes para os 3 candidatos da fila).
- Programa StackingDAO ainda tem mais superfície a revisar; outros
  programas Immunefi ainda não iniciados.

## Honestidade
Isso é trabalho de segurança real, não instantâneo. Pode levar sessões
inteiras e ainda assim não confirmar nada — é exatamente o padrão descrito
na pesquisa sobre bug bounty (90% dos iniciantes não ganham nada, e mesmo
para quem ganha, o primeiro achado leva semanas). Não vou reportar isto ao
Immunefi até ter uma cadeia de chamada completa e uma prova de conceito
real.

## Rodada 3 — leitura profunda proativa (2026-08-29)
Fila do scanner estava vazia. Li por completo, pela primeira vez linha a
linha nesta missão, `dao.clar` (contrato raiz — admins/contracts, checks
`check-is-admin`/`check-is-protocol`), `signer-admin-v1.clar` (registro de
admin compartilhado dos signer-manager) e `stacker-2.clar` (contrato
"admin" prioritário por nome/função crítica).

Levantei uma hipótese real em `stacker-2.clar`: `initiate-stacking` envolve
a chamada a `reserve-contract.request-stx-to-stack` em `(as-contract ...)`,
mas `stack-increase` faz a MESMA chamada sem `as-contract` — mesmo padrão,
tratamento inconsistente. Investiguei a fundo (rastreei
`request-stx-to-stack` em `stx-reserve-v2.clar`) e **refutei**: essa função
usa exclusivamente `contract-caller` (nunca `tx-sender`) tanto para
autorização quanto para o destinatário dos fundos, e `contract-caller`
não muda com `as-contract` (só `tx-sender` muda) — logo o destinatário é
sempre o stacker correto, com ou sem `as-contract`. Inconsistência
estilística inofensiva, não vulnerabilidade. Registrado em `queue.jsonl`
como `falso_positivo`, confidence alta, cadeia de chamada 100% fechada
sem depender de nenhum arquivo externo.

`dao.clar` e `signer-admin-v1.clar`: nenhum achado — padrão de autorização
consistente com o resto do código já revisado (DAO-gated via
`check-is-protocol`/`check-is-admin`, sem lacunas óbvias).

## Rodada 4 — leitura profunda proativa (2026-08-29)
Fila do scanner novamente vazia (0 pendentes). Li por completo
`stacker-3.clar`, `stacker-4.clar` e `stacker-5.clar` (ainda não lidos
nesta missão). Resultado: são bit-a-bit idênticos a `stacker-1.clar`
(confirmado via `diff`, sem nenhuma diferença) — mesmas 4 funções
públicas (`initiate-stacking`, `stack-increase`, `stack-extend`,
`return-stx`), mesmo padrão de autorização (`check-is-protocol`/
`check-is-enabled` via `.dao`) e mesmo uso de `as-contract` em
`return-stx`/`initiate-stacking`. `stack-increase` repete o mesmo padrão
"sem `as-contract`" já investigado e refutado em `stacker-2.clar` (rodada
3): a função chamada na reserva (`request-stx-to-stack`) usa exclusivamente
`contract-caller`, nunca `tx-sender`, então o resultado é idêntico com ou
sem `as-contract`. Nenhum achado novo — atualizado `deep-read-log.json`.

Com isso, todos os 5 contratos `stacker-N` (1 a 5) e os contratos raiz
(`dao`, `signer-admin-v1`) já foram lidos linha a linha nesta missão.
Restam para próximas rodadas: `stbtc-token.clar`, `data-stbtc-v1.clar`,
`data-stx-v2.clar` (já visto en passant, não linha a linha),
`stacking-dao-core-ststxbtc-v1.clar` (já lido via investigação da fila,
não via deep-read-log) — e os 3 contratos SIP-010/NFT auxiliares que
seguem bloqueados por rede (`ststxbtc-token-v2`, `ststxbtc-data-v1`,
`ststxbtc-withdraw-nft-v2`).

## Rodada 2026-08-29 (push automático, máquina de estados v2)

Migração pro novo schema (`system/bugbounty-scanner/state-machine.mjs`)
herdou `set-token-uri` (auth_arg_inconsistency) em `corroborated_static`.
Mesma conclusão já documentada várias rodadas atrás (confirmado mas não
elegível — só metadado de URI, sem fundos/privilégio envolvidos): fechado
formalmente como `false_positive` no novo state machine, com reasoning
explicando que o fechamento é por falta de impacto elegível, não porque
a inconsistência tx-sender/contract-caller não exista de fato.

Tentei de novo baixar `ststxbtc-token-v2.clar` (pendência de rede há
várias rodadas): `api.hiro.so` continua bloqueado nesta sessão (CONNECT
403 do agent-proxy). Também tentei achar um mirror em GitHub do
protocolo StackingDAO (não achei nenhum org/repo público óbvio — os
contratos parecem só existir on-chain via Hiro, sem fonte GitHub
espelhada conhecida) — não vou adivinhar URLs de repositório às cegas.
Continua bloqueado; sem novo progresso nesta rodada além do fechamento
do item já mencionado.

## Rodada 2026-08-30 (push automático) — leitura profunda em stbtc-token/data-stx-v2/data-stbtc-v1

Fila do scanner novamente vazia (0 candidatos). Confirmei de novo que
`api.hiro.so` segue bloqueado nesta sessão (CONNECT 403 no agent-proxy) —
os 3 contratos SIP-010/NFT `ststxbtc-*` continuam impossíveis de baixar.

Leitura profunda proativa (3 arquivos ainda não lidos linha a linha):

- `stbtc-token.clar` — padrão idêntico a `ststx-token.clar`
  (`mint-for-protocol`/`burn-for-protocol` gated por
  `check-is-protocol contract-caller`, `transfer` exige
  `tx-sender == sender`). Achado colateral: nenhum dos 10 contratos já
  baixados nesta missão chama `.stbtc-token mint-for-protocol` nem
  `burn-for-protocol` (confirmado via grep) — o contrato que de fato
  gerencia o fluxo BTC→stBTC não está entre os já baixados. Sem achado
  de vulnerabilidade neste arquivo isoladamente.
- `data-stx-v2.clar` — cálculo de `get-stx-per-ststx`
  (share price stSTX/STX). `active-supply` é calculado com guarda contra
  underflow (`if ststx-supply > escrow then (- ...) else u0`). Sem achado.
- `data-stbtc-v1.clar` — **achado real, registrado como finding novo**
  (`StackingDAO::data-stbtc-v1.clar::compute-ratio::ai_deep_read_finding`,
  avançado até `corroborated_static`): `compute-ratio` (linha 32) faz
  `active-supply = (- stbtc-supply (var-get pending-shares))` **sem** a
  mesma guarda contra underflow que o contrato irmão `data-stx-v2.clar`
  usa para o cálculo equivalente. Se `pending-shares` já superou
  `stbtc-supply` em algum momento, a subtração unsigned da Clarity
  aborta a transação (Clarity tem aritmética checada — não é wraparound
  estilo Solidity pré-0.8), o que quebraria as funções read-only
  `get-sbtc-per-stbtc`/`get-sbtc-per-stbtc-up` (DoS local nessa leitura,
  não roubo de fundos direto). **Cadeia incompleta**: `add-pending-shares`/
  `remove-pending-shares` são gated por `check-is-protocol`, mas nenhum
  dos 10 contratos já baixados os chama — o contrato real do fluxo de
  depósito BTC→stBTC que presumivelmente os chama não está entre os
  baixados, e `api.hiro.so` bloqueado impede buscar mais. Registrado
  deployment evidence como `unverified` (honesto — não sei se isso é
  sequer alcançável) e a transição para `scope_verified` foi corretamente
  recusada pela state machine. Fica em `corroborated_static`: achado de
  código real (assimetria com o contrato irmão), mas alcançabilidade e
  impacto de fundos não confirmados. Não é elegível para rascunho de
  relatório neste estado.

`deep-read-log.json` atualizado com os 3 arquivos desta rodada.

## Verificação (30/08/2026) — `data-stbtc-v1.clar::compute-ratio` fechado como falso-positivo, com evidência on-chain

A lacuna que o achado acima deixou em aberto (rede bloqueada, não deu pra
confirmar se `pending-shares` pode superar `stbtc-supply` em uso real)
foi fechada consultando `api.hiro.so` diretamente: `data-stbtc-v1` e o
`stbtc-token` irmão têm **exatamente 1 transação cada — a própria
transação de deploy** (30/07/2026, mesmo dia para os dois). Zero chamada
a `add-pending-shares`/`remove-pending-shares` desde então. Em contraste,
`stbtc-reserve` (o contrato realmente ativo do produto BTC) tem 552
transações, a mais recente com poucos minutos de idade, e não referencia
`pending-shares` em nenhum lugar do seu código. Conclusão: o defeito de
código é real (falta a mesma guarda que `data-stx-v2` tem), mas não há
alcançabilidade hoje — o mecanismo inteiro nunca foi usado. Fechado como
`false_positivo`, com ressalva explícita pra reabrir se
`data-stbtc-v1`/`stbtc-token` forem ativados no futuro (parecem
infraestrutura nova, ainda não conectada ao fluxo real).
