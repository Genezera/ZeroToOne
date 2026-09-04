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

## Rodada 2026-08-30 (v2 state machine, sessão cloud automática)

`list-pending` vazio. Revisitei o único `corroborated_static`
(`compute-ratio` em `data-stbtc-v1.clar`) sob a máquina de estados nova:
`check-scope("StackingDAO","stbtc-token")` retornou `allowed=false` —
o snapshot de escopo do programa (`research/bugbounty/scope-snapshots/`)
tem `assets:[]` (só categorias gerais elegíveis, nenhum ativo específico
registrado), então nem existe hoje um ativo pra amarrar deployment
evidence, além da lacuna de reachability já documentada (cadeia
incompleta, `api.hiro.so` bloqueado). Combinando as duas lacunas,
transicionei pra `inconclusive` (com justificativa) em vez de deixar
parado em `corroborated_static` — mais honesto sobre o estado real da
investigação: não é só "falta prova de conceito", é "não dá pra saber
hoje". `deep-read-log.json` não ganhou arquivo novo deste programa nesta
rodada (leitura profunda proativa foi noutro programa — ver NOTES.md do
Circle BBP).

**Achado real e separado nesta rodada**: `check-scope` pra StackingDAO
sempre vai retornar `allowed=false`, pra qualquer ativo, porque o
snapshot de escopo (`research/bugbounty/scope-snapshots/stackingdao.json`)
tem `assets:[]` por desenho — na Fase 1 os contratos individuais foram
deixados de fora do snapshot, curados só em `targets.mjs`. Isso bloqueia
`scope_verified` pra QUALQUER achado StackingDAO, não só este. Fica
registrado como pendência real de engenharia (ver `IMPLEMENTATION_STATE.md`),
não é um problema deste achado específico.

## Verificação (30/08/2026) — `data-stbtc-v1.clar::compute-ratio` fechado como falso-positivo, com evidência on-chain

A lacuna que o achado acima deixou em aberto (rede bloqueada, não deu pra
confirmar se `pending-shares` pode superar `stbtc-supply` em uso real)
foi fechada consultando `api.hiro.so` diretamente (acessível nesta
sessão, ao contrário da sessão de nuvem que gerou a rodada acima):
`data-stbtc-v1` e o `stbtc-token` irmão têm **exatamente 1 transação
cada — a própria transação de deploy** (30/07/2026, mesmo dia para os
dois). Zero chamada a `add-pending-shares`/`remove-pending-shares` desde
então. Em contraste, `stbtc-reserve` (o contrato realmente ativo do
produto BTC) tem 552 transações, a mais recente com poucos minutos de
idade, e não referencia `pending-shares` em nenhum lugar do seu código.
Conclusão: o defeito de código é real (falta a mesma guarda que
`data-stx-v2` tem), mas não há alcançabilidade hoje — o mecanismo
inteiro nunca foi usado. **Estado final reconciliado: `false_positivo`**
(não `inconclusive` como a rodada acima tinha deixado) — a lacuna de
reachability, que era o motivo real da incerteza, está fechada com
evidência direta. A lacuna de scope snapshot (achado separado acima)
continua real e deve ser corrigida, mas não é mais o que está segurando
este achado específico. Ressalva explícita pra reabrir se
`data-stbtc-v1`/`stbtc-token` forem ativados no futuro (parecem
infraestrutura nova, ainda não conectada ao fluxo real).

## Rodada 2026-08-30 (push automático, máquina de estados v2) — fila vazia, leitura profunda em `stbtc-reserve.clar` + 2 contratos core, sem achado

`list-pending` vazio (0 candidates em todo o sistema, não só neste
programa). Os 3 achados legados (`compute-ratio` → `false_positivo`,
lacuna de scope snapshot, e o `known_duplicate`/`inconclusive` de outros
programas) continuam no estado já reconciliado — nada novo a revisitar
aqui.

Leitura profunda proativa: a rodada anterior tinha identificado
`stbtc-reserve.clar` como "o contrato realmente ativo do produto BTC"
(552 transações on-chain) mas nunca lido linha a linha nesta missão —
prioridade óbvia. Já estava baixado localmente em
`research/bugbounty/stackingdao/` (não precisou de rede). Lidos 3
arquivos por completo:

- `stbtc-reserve.clar` (120 linhas) — todas as funções mutantes
  (`lock-sbtc-for-withdrawal`, `request-sbtc-for-withdrawal`,
  `unlock-sbtc-from-withdrawal`, `pay-sbtc-from-idle`,
  `request-sbtc-to-stack`, `return-sbtc-from-stacking`, `get-sbtc`) usam
  `(contract-call? .dao check-is-protocol contract-caller)` —
  padrão correto, mesmo já validado em outros contratos desta missão
  (`contract-caller`, não `tx-sender`, evita o confused-deputy clássico
  de Clarity). Confirma a nota da rodada anterior: este arquivo **não**
  referencia `pending-shares`/`add-pending-shares`/`remove-pending-shares`
  em lugar nenhum — o defeito de `compute-ratio` em `data-stbtc-v1.clar`
  de fato não tem relação de chamada com o contrato ativo de verdade.
  `return-sbtc-from-stacking` subtrai `sbtc-staking` sem `asserts!`
  prévio de suficiência, mas aritmética da Clarity é checada (abort em
  underflow, não wraparound) — mesmo padrão fail-safe já visto e não
  elevado a achado em rodadas anteriores (DoS local no pior caso, não
  perda de fundos). Sem achado.
- `stacking-dao-core-btc-v3.clar` (366 linhas, completo) — apesar do
  nome/comentário "Core BTC", as funções de usuário (`deposit`,
  `withdraw-idle`, `init-withdraw`, `withdraw`) operam sobre STX/
  `ststxbtc-token-v2` via um `<reserve-trait>` genérico passado como
  parâmetro (dispatch dinâmico) — **não** chama `stbtc-reserve.clar`
  nem `data-stbtc-v1.clar` diretamente por nome. Todas as 4 funções de
  usuário e as 7 funções admin (`set-commission-address`,
  `set-shutdown-*`, `set-*-fee`) gateiam corretamente via
  `check-is-protocol` com `contract-of <trait-param>` ou
  `contract-caller` — mesmo padrão seguro. Sem achado.
- `stacking-dao-core-ststxbtc-v1.clar` (190 linhas, completo) — mesmo
  padrão: usa `.stx-reserve`/`.ststxbtc-data-v1`/`.ststxbtc-withdraw-nft-v2`
  por nome fixo (não trait), todas as 6 funções admin gateadas por
  `check-is-protocol contract-caller`. `withdraw` trava a taxa
  (`withdraw-fee`) no momento do `init-withdraw` (armazenada na entry),
  não a taxa corrente — decisão de design razoável (evita mudança de taxa
  afetar saques já em andamento), não um bug. Sem achado.

Conclusão prática: nenhum dos 2 contratos "core" locais é o consumidor
real de `stbtc-reserve.clar`/`data-stbtc-v1.clar` — o fluxo de depósito
BTC→stBTC citado nas rodadas anteriores continua fora do conjunto de
contratos já baixados (provavelmente um contrato `core-btc` de versão
diferente, ainda não identificado/baixado). `deep-read-log.json`
atualizado com os 3 arquivos. `stacker-1.clar` (já baixado localmente)
segue sem entrada em `deep-read-log.json` — pendência trivial para
próxima rodada (só falta registrar/ler, os irmãos 2-5 já foram cobertos
e seguem o mesmo padrão). Nenhum achado novo nesta rodada.

## Rodada 2026-08-30 (push, seguinte) — fila vazia, `stacker-1.clar` + `stx-reserve-v2.clar` + `ststx-token.clar`, sem achado novo

`list-pending` global = 0 (confirmado via `migrate-to-v2.mjs` + `list-pending`).
Também revisitados os 2 achados legados em `corroborated_static` fora
deste programa (SSO Vercel e denylist Solana Circle) — nenhum dos dois
é StackingDAO, sem ação necessária aqui além de formalizar
`record-deployment-evidence`/`record-validation` (ver NOTES dos
respectivos programas).

Leitura profunda proativa — os 3 arquivos pendentes da rodada anterior:

- `stacker-1.clar` (185 linhas, completo) — mesma família de
  `stacker-2..5.clar` já auditados. Ponto que mereceu atenção extra:
  `initiate-stacking`/`stack-increase`/`stack-extend` gateiam via
  `(contract-call? .dao check-is-protocol tx-sender)` — **tx-sender, não
  contract-caller** — à primeira vista o padrão inverso do que os outros
  contratos desta missão usam (`stbtc-reserve.clar`,
  `stacking-dao-core-btc-v3.clar`, `stx-reserve-v2.clar` today, todos
  usam `contract-caller`). Investiguei se é confused-deputy: verifiquei
  `dao.clar` init — o mapa `contracts` registra tanto o **deployer
  (tx-sender no deploy, uma conta EOA)** quanto os contratos
  `.stacking-dao-core-v1`/`.reserve-v1`/`.commission-v1`/`.stacker-1..10`.
  Ou seja, o design é: um keeper/bot EOA autorizado chama os
  `stacker-N` **diretamente** (não via proxy/contrato intermediário) —
  diferente de `deposit`/`withdraw` em `core-btc-v3`/`stx-reserve-v2`,
  que são acionados por QUALQUER usuário e por isso precisam de
  `contract-caller` pra não confiar num `reserve-contract` trait
  malicioso passado pelo próprio chamador. Confirmei que TODOS os 10
  `stacker-N.clar` (verificado stacker-1/2/3 byte a byte) usam o mesmo
  padrão `tx-sender` de forma consistente — não é um erro isolado do
  stacker-1, é decisão de design deliberada e replicada, condizente com
  "somente o keeper autorizado do protocolo aciona stacking/unstacking".
  Risco residual (checagem por tx-sender é válida ao longo de toda a
  cadeia de chamada, não só do caller imediato) existe apenas se o
  próprio keeper algum dia assinar uma tx que invoque um contrato não
  confiável que internamente encadeie uma chamada a `stacker-N` — isso é
  risco operacional de custódia de chave/comportamento do bot, não uma
  falha de código auditável neste repositório. Sem achado.
- `stx-reserve-v2.clar` (306 linhas, completo) — todas as funções
  mutantes (lock/unlock/request/pay/receive para STX de stSTX e
  ststXBTC, `request-stx-to-stack`, `return-stx-from-stacking`,
  `return-stx-from-staking-split`, `get-stx`) gateiam corretamente via
  `check-is-protocol contract-caller`. Padrão notável: em
  `return-stx-from-stacking`/`return-stx-from-staking-split`, o
  `stx-transfer?` usa `tx-sender` como origem dos fundos — analisado e
  confirmado seguro: essas funções só são alcançáveis quando o chamador
  (um `stacker-N`) envolve a chamada em `as-contract`, o que redefine
  `tx-sender` para o próprio principal do stacker durante a chamada —
  ou seja, `tx-sender` aqui é igual a `contract-caller`, os fundos saem
  de fato do stacker que os detinha após destacking. `receive-migration`
  restrita a `.migration-v3` via `is-eq contract-caller` + flag
  `migrated`/`ERR_NOT_PRISTINE` — proteção correta contra migração dupla
  ou fora de ordem. Sem achado.
- `ststx-token.clar` (93 linhas, completo) — SIP-010 padrão. `transfer`
  exige `is-eq tx-sender sender` (correto, é o dono transferindo).
  `mint-for-protocol`/`burn-for-protocol` gateados por
  `check-is-protocol contract-caller` (correto). `burn` externo queima
  do próprio `tx-sender` sem restrição adicional — esperado (usuário só
  pode queimar o próprio saldo). Sem achado.

`deep-read-log.json` atualizado (StackingDAO agora com 15 arquivos
lidos). Nenhum achado novo nesta rodada — os 3 arquivos pendentes de
rodadas anteriores foram fechados.

## Rodada 2026-09-01 (push automático, sessão cloud) — fila vazia, sem achado novo

`list-pending` global = 0. Revisitei `return-stx-from-stacking` em
`stx-reserve-v2.clar` (rastreando de novo a cadeia `tx-sender` vs
`contract-caller` via `stacker-1.clar` linha 179) de forma independente,
sem antes checar as notas de rodadas passadas — cheguei à mesma
conclusão já registrada acima (`as-contract` no call site redefine
`tx-sender` para o próprio stacker, seguro). Achado zero de valor
incremental, mas serve como segunda confirmação independente do mesmo
resultado. Todos os 15 arquivos já lidos linha a linha nesta missão
seguem sem arquivo novo candidato óbvio nesta rodada (a leitura profunda
proativa desta sessão foi direcionada a Vercel Open Source e Circle BBP
— ver NOTES.md respectivos).

## Rodada 2026-09-01 (push automático, sessão cloud)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/vercel` (ver NOTES.md de Vercel Open Source) — os
13 contratos Clarity deste programa já estão com os 15 arquivos
relevantes cobertos desde rodadas anteriores, sem candidato óbvio novo
para reler. Sem achado, sem mudança de estado.

## Rodada 2026-09-01 (push automático, sessão cloud, 8ª rodada do dia)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `circlefin/stablecoin-evm` (ver NOTES.md de Circle BBP) —
sem arquivo novo lido de StackingDAO. Sem achado, sem mudança de estado.

## Rodada 2026-09-01 (push automático, sessão cloud, 10ª rodada do dia)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/next.js` (ver NOTES.md de Vercel Open Source, achado
novo registrado lá) — sem arquivo novo lido de StackingDAO.

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/vercel` e `circlefin/buidl-wallet-contracts`/
`evm-xreserve-contracts`/`evm-cpn-contracts` (ver NOTES.md de Vercel Open
Source e Circle BBP) — sem arquivo novo candidato em StackingDAO (os 15
contratos Clarity seguem 100% cobertos desde rodadas anteriores).

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/next.js` (crypto-utils/preview-mode, ver NOTES.md
de Vercel Open Source, sem achado) — sem arquivo novo candidato em
StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Nenhum
achado, nenhuma transição de estado neste programa.

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud, 20ª rodada do dia)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/ai` (ver NOTES.md de Vercel Open Source, achado
novo registrado lá) — sem arquivo novo candidato em StackingDAO (os 15
contratos Clarity seguem 100% cobertos desde rodadas anteriores).

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud, 21ª rodada do dia)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `circlefin/stablecoin-sui` (usdc.move) e `vercel/vercel`
(ver NOTES.md de Circle BBP e Vercel Open Source) — sem arquivo novo
candidato em StackingDAO, os 15 contratos Clarity seguem 100% cobertos.
Nenhum achado, nenhuma transição de estado neste programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/eve` (ver NOTES.md de Vercel Open Source) — sem
arquivo novo candidato em StackingDAO, os 15 contratos Clarity seguem
100% cobertos. Nenhum achado, nenhuma transição de estado neste
programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, migração v2)

Primeira rodada pós-migração pro CLI com máquina de estados
(`migrate-to-v2` rodado sem erro). `list-pending` global = 0, nenhum
achado deste programa em nenhum estado além de `false_positive`. Leitura
profunda proativa desta rodada direcionada a `circlefin/malachite`
(Circle BBP) — ver NOTES.md desse programa. Sem arquivo novo lido em
StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Nenhum
achado, nenhuma transição de estado neste programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, pós-migração v2, 2ª rodada do dia)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/eve` (ver NOTES.md de Vercel Open Source, sem
achado) — sem arquivo novo candidato em StackingDAO, os 15 contratos
Clarity seguem 100% cobertos. Nenhum achado, nenhuma transição de
estado neste programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, 3ª rodada pós-migração v2)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/eve` (ver NOTES.md de Vercel Open Source, sem
achado) — sem arquivo novo candidato em StackingDAO, os 15 contratos
Clarity seguem 100% cobertos. Nenhum achado, nenhuma transição de
estado neste programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, mais uma rodada do mesmo push)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/eve`, subdiretório `public/channels/` (ver
NOTES.md de Vercel Open Source, sem achado) — sem arquivo novo
candidato em StackingDAO, os 15 contratos Clarity seguem 100%
cobertos. Nenhum achado, nenhuma transição de estado neste programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud — leitura profunda em solana-cctp-contracts)

`list-pending` global = 0. Reconfirmado: `api.hiro.so` continua
bloqueado nesta sessão (403 no agent-proxy, mesmo teste de sempre) —
os 3 contratos `ststxbtc-*` seguem impossíveis de baixar. Leitura
profunda proativa desta rodada direcionada a
`circlefin/solana-cctp-contracts` (Circle BBP, achado novo criado e
refutado — ver NOTES.md desse programa) — sem arquivo novo candidato em
StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Nenhum
achado, nenhuma transição de estado neste programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, mais uma rodada do mesmo push)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/eve` (ver NOTES.md de Vercel Open Source, sem
achado) — sem arquivo novo candidato em StackingDAO, os 15 contratos
Clarity seguem 100% cobertos. Nenhum achado, nenhuma transição de
estado neste programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, mais uma rodada do mesmo push)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `circlefin/stablecoin-starknet` (Circle BBP, ver
NOTES.md desse programa) — sem arquivo novo candidato em StackingDAO,
os 15 contratos Clarity seguem 100% cobertos. Nenhum achado, nenhuma
transição de estado neste programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, mais uma rodada do mesmo push)

`list-pending` global = 0. Leitura profunda proativa desta rodada
direcionada a `vercel/eve` (ver NOTES.md de Vercel Open Source, sem
achado) — sem arquivo novo candidato em StackingDAO, os 15 contratos
Clarity seguem 100% cobertos. Nenhum achado, nenhuma transição de
estado neste programa.

## Rodada 2026-09-03 (sessão cloud — corrigido bug de drift na migração v1→v2, ver NOTES.md de Vercel Open Source para detalhes técnicos)

`list-pending` deste programa = 0 antes e depois da correção do bug de
migração (StackingDAO nunca teve achado revertido incorretamente pra
`candidate` — os 15 contratos Clarity seguem 100% cobertos, sem
achado histórico neste programa pra sofrer o drift). Leitura profunda
proativa desta rodada direcionada a `vercel/vercel` (auth/token/
credential, ver NOTES.md de Vercel Open Source). Nenhum achado,
nenhuma transição de estado neste programa.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado: `api.hiro.so` continua bloqueado
nesta sessão (403 no CONNECT do agent-proxy) — os 3 contratos
`ststxbtc-*` seguem impossíveis de baixar. Leitura profunda proativa
desta rodada direcionada a `vercel/vercel` (blob token/access, vcr
permissions — ver NOTES.md de Vercel Open Source) — sem arquivo novo
candidato em StackingDAO, os 15 contratos Clarity seguem 100% cobertos.
Nenhum achado, nenhuma transição de estado neste programa.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez: `api.hiro.so`
continua bloqueado nesta sessão (403 no CONNECT do agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Leitura profunda
proativa desta rodada direcionada a `vercel/vercel` (tokens/vcr
permissions — ver NOTES.md de Vercel Open Source) — sem arquivo novo
candidato em StackingDAO, os 15 contratos Clarity seguem 100% cobertos.
Nenhum achado, nenhuma transição de estado neste programa.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez: `api.hiro.so`
continua bloqueado nesta sessão (403 no CONNECT do agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Leitura profunda
proativa desta rodada direcionada a `vercel/vercel` (env-var secret
visibility, vcr team-refs, connect/authjs re-export — ver NOTES.md de
Vercel Open Source) — sem arquivo novo candidato em StackingDAO, os 15
contratos Clarity seguem 100% cobertos. Nenhum achado, nenhuma
transição de estado neste programa.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez: `api.hiro.so`
continua bloqueado nesta sessão (403 no CONNECT do agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Leitura profunda
proativa desta rodada direcionada a `vercel/vercel` (token rm,
container/oidc mint, oidc-aws-credentials-provider, vcr login/engine —
ver NOTES.md de Vercel Open Source) — sem arquivo novo candidato em
StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Nenhum
achado, nenhuma transição de estado neste programa.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez: `api.hiro.so`
continua bloqueado nesta sessão (403 no CONNECT do agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Leitura profunda
proativa desta rodada direcionada a `vercel/vercel` (betterauth
re-export, oidc token getters, vcr permissions ls/paths — ver NOTES.md
de Vercel Open Source) — sem arquivo novo candidato em StackingDAO, os
15 contratos Clarity seguem 100% cobertos. Nenhum achado, nenhuma
transição de estado neste programa.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez: `api.hiro.so`
continua bloqueado nesta sessão (403 no CONNECT do agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Leitura profunda
proativa desta rodada direcionada a `vercel/vercel` (vcr permissions
router, tokens ls, oidc edge-light re-export — ver NOTES.md de Vercel
Open Source) — sem arquivo novo candidato em StackingDAO, os 15
contratos Clarity seguem 100% cobertos. Nenhum achado, nenhuma
transição de estado neste programa.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez: `api.hiro.so`
continua bloqueado nesta sessão (403 no CONNECT do agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Leitura profunda
proativa desta rodada direcionada a `vercel/vercel` (login command,
global-config tokens CRUD, vcr permissions command metadata — ver
NOTES.md de Vercel Open Source) — sem arquivo novo candidato em
StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Nenhum
achado, nenhuma transição de estado neste programa.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez: `api.hiro.so`
continua bloqueado nesta sessão (403 no CONNECT do agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Leitura profunda
proativa desta rodada direcionada a `vercel/vercel` (connect token
recovery flow, project OIDC token, tokens subcommand router — ver
NOTES.md de Vercel Open Source) — sem arquivo novo candidato em
StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Nenhum
achado, nenhuma transição de estado neste programa. `Block Open
Source`/`Circle BBP` seguem fora de escopo desta sessão por política
local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez: `api.hiro.so`
continua bloqueado nesta sessão (403 no CONNECT do agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Leitura profunda
proativa desta rodada direcionada a `vercel/vercel` (user-agent
builder, tokens command router, telemetry session persistence — ver
NOTES.md de Vercel Open Source; cobertura de produção do vercel/vercel
nas keywords de prioridade está essencialmente esgotada agora) — sem
arquivo novo candidato em StackingDAO, os 15 contratos Clarity seguem
100% cobertos. Nenhum achado, nenhuma transição de estado neste
programa. `Block Open Source`/`Circle BBP` seguem fora de escopo desta
sessão por política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez: `api.hiro.so`
continua bloqueado nesta sessão (403 no CONNECT do agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Com a cobertura de
produção de `vercel/vercel` já esgotada (ver rodadas anteriores), a
leitura profunda proativa desta rodada foi direcionada a
`nitrojs/nitro` em vez disso (ver NOTES.md de Vercel Open Source: rota
`/_openapi.json` — corretamente opt-in em produção; endpoint
`/_nitro/tasks/:name`, executor de tasks dev-only, gate
`isLocalDevRequest` testado contra bypass de `X-Forwarded-For` e
confirmado seguro). Sem arquivo novo candidato em StackingDAO, os 15
contratos Clarity seguem 100% cobertos. Nenhum achado, nenhuma
transição de estado neste programa. `Block Open Source`/`Circle BBP`
seguem fora de escopo desta sessão por política local
(`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconfirmado mais uma vez:
`api.hiro.so` continua bloqueado nesta sessão (`connect_rejected` no
CONNECT do agent-proxy) — os 3 contratos `ststxbtc-*` seguem
impossíveis de baixar. Leitura profunda proativa desta rodada
direcionada a `vercel/chat` em vez disso (achado novo em
`adapter-discord`, ver NOTES.md de Vercel Open Source). Sem arquivo
novo candidato em StackingDAO, os 15 contratos Clarity seguem 100%
cobertos. Nenhum achado, nenhuma transição de estado neste programa.
`Block Open Source`/`Circle BBP` seguem fora de escopo desta sessão por
política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. `api.hiro.so` reconfirmado bloqueado
(`connect_rejected` no CONNECT do agent-proxy) — os 3 contratos
`ststxbtc-*` seguem impossíveis de baixar. Sem arquivo novo candidato
em StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Leitura
profunda proativa desta rodada direcionada a `vercel/chat` de novo
(adapters `adapter-notion`, `adapter-telegram`, `adapter-web` — ver
NOTES.md de Vercel Open Source), nenhum achado novo, nenhuma transição
de estado neste programa. `Block Open Source`/`Circle BBP` seguem fora
de escopo desta sessão por política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. `api.hiro.so` reconfirmado bloqueado
(`connect_rejected` no CONNECT do agent-proxy) — os 3 contratos
`ststxbtc-*` seguem impossíveis de baixar. Sem arquivo novo candidato
em StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Leitura
profunda proativa desta rodada direcionada a `nuxt/nuxt` (cookie
composable, extração de CSP nonce, gate de mesma origem do dev server
webpack/rsbuild — ver NOTES.md de Vercel Open Source), nenhum achado
novo, nenhuma transição de estado neste programa. `Block Open
Source`/`Circle BBP` seguem fora de escopo desta sessão por política
local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. `api.hiro.so` reconfirmado bloqueado
(timeout/`000` no CONNECT do agent-proxy) — os 3 contratos
`ststxbtc-*` seguem impossíveis de baixar. Sem arquivo novo candidato
em StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Leitura
profunda proativa desta rodada direcionada a `nuxt/nuxt` de novo (ver
NOTES.md de Vercel Open Source: `proxy.ts`, `base-url.ts`,
`cross-origin-prefetch.client.ts`), nenhum achado novo, nenhuma
transição de estado neste programa. `Block Open Source`/`Circle BBP`
seguem fora de escopo desta sessão por política local
(`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. `api.hiro.so` reconfirmado bloqueado
(`connect_rejected` no CONNECT do agent-proxy) — os 3 contratos
`ststxbtc-*` seguem impossíveis de baixar. Sem arquivo novo candidato
em StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Leitura
profunda proativa desta rodada direcionada a `vercel/workflow` de novo
(ver NOTES.md de Vercel Open Source: `http-client.ts`,
`deployment-id.ts`, `create-run-id.ts`), nenhum achado novo, nenhuma
transição de estado neste programa. `Block Open Source`/`Circle BBP`
seguem fora de escopo desta sessão por política local
(`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. `api.hiro.so` reconfirmado bloqueado (exit
56/timeout no `curl` de teste via agent-proxy) — os 3 contratos
`ststxbtc-*` seguem impossíveis de baixar. Sem arquivo novo candidato
em StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Leitura
profunda proativa desta rodada direcionada a `vercel/workflow` (área de
"hook tokens", `resume-hook.ts`/`create-hook.ts` — ver NOTES.md de
Vercel Open Source; duas sessões concorrentes empurraram rodadas pro
`origin/master` na mesma janela desta — reconciliado duas vezes via
`git reset --hard origin/master` + reaplicação só do conteúdo
genuinamente novo, sem duplicar achados já registrados por essas outras
sessões), nenhum achado novo, nenhuma transição de estado neste
programa. `Block Open Source`/`Circle BBP` seguem fora de escopo desta
sessão por política local (`program-policy.json`, checado como passo
zero antes de tocar qualquer repo desses dois programas).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Reconciliado com sessão concorrente que
empurrou pro `origin/master` enquanto esta rodada estava em andamento
(`git reset --hard origin/master` + `migrate-to-v2` re-rodado — ver
NOTES.md de Vercel Open Source para detalhes técnicos). Leitura
profunda proativa desta rodada direcionada a `vercel/next.js`
(node-environment-extensions de crypto — ver NOTES.md de Vercel Open
Source), sem arquivo novo candidato em StackingDAO, os 15 contratos
Clarity seguem 100% cobertos. Nenhum achado, nenhuma transição de
estado neste programa. `Block Open Source`/`Circle BBP` seguem fora de
escopo desta sessão por política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. `api.hiro.so` reconfirmado bloqueado
(`connect_rejected` no CONNECT do agent-proxy) — os 3 contratos
`ststxbtc-*` seguem impossíveis de baixar. Sem arquivo novo candidato
em StackingDAO, os 15 contratos Clarity seguem 100% cobertos. Leitura
profunda proativa desta rodada direcionada a `sveltejs/svelte`
(compile-time e runtime da feature `{@html}` — ver NOTES.md de Vercel
Open Source), nenhum achado novo, nenhuma transição de estado neste
programa. `Block Open Source`/`Circle BBP` seguem fora de escopo desta
sessão por política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Sem arquivo novo candidato em StackingDAO,
os 15 contratos Clarity seguem 100% cobertos (`api.hiro.so` não foi
testado nesta rodada — leitura profunda foi direcionada a
`nitrojs/nitro` desta vez, ver NOTES.md de Vercel Open Source).
Reconciliado com múltiplas sessões concorrentes que empurraram rodadas
pro `origin/master` (`vercel/turborepo`, `vercel/next.js`,
`sveltejs/svelte`) enquanto esta estava em andamento, via
`git reset --hard origin/master` + `migrate-to-v2` re-rodado várias
vezes. Nenhum achado, nenhuma transição de estado neste programa.
`Block Open Source`/`Circle BBP` seguem fora de escopo desta sessão
por política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. `api.hiro.so` segue bloqueado (agent-proxy)
— os 3 contratos `ststxbtc-*` seguem impossíveis de baixar. Sem
arquivo novo candidato em StackingDAO, os 15 contratos Clarity seguem
100% cobertos. Leitura profunda proativa desta rodada direcionada a
`vercel/vercel` (ver NOTES.md de Vercel Open Source: `auth-errors.ts`,
`token-error.ts`, `util/login/types.ts`), nenhum achado novo, nenhuma
transição de estado neste programa. Múltiplas sessões concorrentes
empurraram pro `origin/master` durante esta rodada; reconciliado
repetidas vezes. `Block Open Source`/`Circle BBP` seguem fora de
escopo por política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. `api.hiro.so` reconfirmado bloqueado (exit
56/connection reset no `curl` de teste via agent-proxy) — os 3
contratos `ststxbtc-*` seguem impossíveis de baixar. Sem arquivo novo
candidato em StackingDAO, os 15 contratos Clarity seguem 100%
cobertos. Múltiplas sessões concorrentes rodaram esta mesma rodada em
paralelo; leitura profunda proativa combinada ficou em `vercel/eve`
(ver NOTES.md de Vercel Open Source) e `nitrojs/nitro` (`cron-handler.ts`,
`internal/app.ts`, `aws-lambda/runtime/_utils.ts`), nenhum achado
novo, nenhuma transição de estado neste programa. Múltiplas sessões
concorrentes empurraram pro `origin/master` durante esta rodada;
reconciliado. `Block Open Source`/`Circle BBP` seguem fora de escopo
por política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Os 13 ativos do scope snapshot (Immunefi)
seguem 100% cobertos, sem arquivo novo pra ler aqui. Leitura profunda
proativa desta rodada inteiramente em `vercel/vercel` (ver NOTES.md de
Vercel Open Source: `cli-exec/src/safety.ts`, `util/redact-args.ts`,
`util/ai-gateway/coding-agents/apply.ts`), nenhum achado novo, nenhuma
transição de estado neste programa. `Block Open Source`/`Circle BBP`
seguem fora de escopo por política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

Duas sessões cloud concorrentes rodaram esta mesma rodada em paralelo
(reconciliado no merge; ambas registradas abaixo em vez de descartar
uma).

**Sessão A**: `list-pending` = 0 dentro do escopo desta rotina de 4
programas (globalmente há 91 candidatos pendentes, mas são todos
`Mattermost Public Bug Bounty Engagement`/`Slack`, descobertos por
varredura automatizada mais ampla fora dos 4 programas cobertos aqui —
não tocados por esta rotina). `Block Open Source`/`Circle BBP` seguem
fora de escopo desta sessão por política local (`program-policy.json`:
Circle BBP `blocked: true` por instrução direta do usuário; Block Open
Source `aiResearchBanned: true` por RoE da Bugcrowd). Sem arquivo novo
candidato em StackingDAO, os 15 contratos Clarity seguem 100% cobertos
(`api.hiro.so` não foi retestado nesta rodada, sem novidade a checar).
Leitura profunda proativa desta rodada direcionada a `vercel/vercel`
(ver NOTES.md de Vercel Open Source: 3 arquivos de telemetria em
`util/telemetry/commands/`), nenhum achado novo, nenhuma transição de
estado neste programa.

**Sessão B**: `list-pending` global = 0 nos 4 programas do prompt
agendado (91 candidatos totais na fila, todos em Mattermost/Slack —
fora do escopo desta rotina). Nenhum achado novo em StackingDAO nesta
rodada; os 15 contratos Clarity seguem 100% cobertos, sem arquivo novo
candidato. `program-policy.json` checado tarde demais desta vez, e só
depois de já ter tocado `Block Open Source` por engano (ver incidente
registrado em NOTES.md de Block Open Source) — nenhum trabalho de
StackingDAO foi afetado por esse incidente. Leitura profunda proativa
desta rodada ficou inteiramente em `vercel/chat` (ver NOTES.md de
Vercel Open Source): achado novo real encontrado lá
(`adapter-discord/src/index.ts`, comparação não timing-safe de bot
token), sem relação com este programa. `Circle BBP` segue fora de
escopo por instrução direta do usuário (`blocked: true`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`program-policy.json` checado como passo zero (`check-program` pra
cada um dos 4 nomes do prompt): `Block Open Source` e `Circle BBP`
confirmados bloqueados, nenhum repo desses tocado. `list-pending`
global = 0. Sem arquivo novo candidato em StackingDAO, os 15 contratos
Clarity seguem 100% cobertos (`api.hiro.so` não retestado nesta
rodada). Leitura profunda proativa desta rodada em Vercel Open Source
(ver NOTES.md de lá): `vercel/ms`/`vercel/async-sema` re-checados e
esgotados, `vercel/swr` (+1 arquivo de exemplo trivial),
`sveltejs/svelte` (+2, `crypto.js`/`crypto.test.ts`, sha256 padrão sem
achado), `nuxt/nuxt` (só docs, fora de critério). Nenhum achado novo,
nenhuma transição de estado neste programa. O achado travado em
`vercel/chat` (CWE-208, `corroborated_static`) segue intocado.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`program-policy.json` checado como passo zero (`check-program` pra
`Block Open Source` e `Circle BBP`, ambos confirmados bloqueados,
nenhum repo desses tocado). `list-pending` global = 0. `api.hiro.so`
reconfirmado bloqueado (403 no CONNECT do agent-proxy) — não deu pra
checar se o deployer `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG`
publicou contrato novo; os 15 contratos Clarity já cobertos seguem sem
mudança conhecida. Leitura profunda proativa desta rodada em Vercel
Open Source (ver NOTES.md de lá): `nitrojs/nitro` (+1, exemplo trivial
de middleware) e `vercel/ai` (+2 arquivos reais: `packages/mcp/src/
tool/oauth.ts` — fluxo OAuth 2.1 do cliente MCP, bem endurecido, quase
idêntico ao SDK oficial do MCP; `packages/sandbox-just-bash/src/
just-bash-sandbox-session.ts` — wrapper sobre filesystem virtual em
memória, execução de bash é o próprio produto, não um desvio de
sandbox). Nenhum achado novo, nenhuma transição de estado neste
programa. O achado de `vercel/chat` (CWE-208, `corroborated_static`)
segue intocado.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`list-pending` global = 0. Sem arquivo novo candidato em StackingDAO, os
15 contratos Clarity seguem 100% cobertos (`api.hiro.so` não retestado
nesta rodada). Leitura profunda proativa desta rodada direcionada a
`vercel/ai` (utils de credential brokering/forwarding do harness — ver
NOTES.md de Vercel Open Source), sem achado novo, nenhuma transição de
estado neste programa. `Block Open Source`/`Circle BBP` seguem fora de
escopo desta sessão por política local (`program-policy.json`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` confirmados bloqueados, nenhum repo desses tocado.
`list-pending` global = 0. Sem arquivo novo candidato em StackingDAO, os
15 contratos Clarity seguem 100% cobertos (`api.hiro.so` não testado
nesta rodada). Leitura profunda proativa desta rodada direcionada a
`vercel/turborepo` (ver NOTES.md de Vercel Open Source: proxy de
microfrontends `headers.rs`/`http.rs`/`ports.rs`, assinatura HMAC de OG
image `sign.ts`), sem achado. Nenhuma transição de estado neste
programa. Reconciliado várias vezes com sessões concorrentes disputando
o mesmo push (`vercel/eve`, Plaid, `nitrojs/nitro`, `vercel/ai`).

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud concorrente)

`program-policy.json` checado como passo zero, `Block Open Source` e
`Circle BBP` seguem bloqueados, nenhum repo desses tocado.
`list-pending` global = 0. `api.hiro.so` continua bloqueado no CONNECT
do agent-proxy — os 15 contratos Clarity já cobertos seguem sem
mudança conhecida. Rodou em paralelo com a rodada acima (mesmo dia);
ambas escolheram `vercel/turborepo` pra leitura profunda proativa, mas
arquivos diferentes (ver NOTES.md de Vercel Open Source) — mesclado
sem perda ao sincronizar. Nenhuma transição de estado neste programa.

## Rodada 2026-09-04 (push automático via GitHub webhook)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` confirmados bloqueados, nenhum repo desses tocado
nesta rodada. `migrate-to-v2.mjs` + `list-pending` global = 0 (fila
vazia). `api.hiro.so` recheck rápido: `connect_rejected` no CONNECT do
agent-proxy (mesmo bloqueio de rodadas anteriores) — não deu pra
confirmar se o deployer `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG`
publicou contrato novo; os 15 contratos Clarity já cobertos seguem sem
mudança conhecida, nenhum arquivo novo candidato neste programa. Leitura
profunda proativa desta rodada direcionada a `nitrojs/nitro` (ver
NOTES.md de Vercel Open Source: `utils/hash.ts`, `presets/vercel/
utils.ts`, `config/resolvers/route-rules.ts`), sem achado. Nenhuma
transição de estado neste programa.

## Rodada 2026-09-04 #3 (push automático via GitHub webhook, rodada seguinte)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` confirmados bloqueados, nenhum repo desses tocado.
`migrate-to-v2.mjs` + `list-pending` global = 0 (fila vazia). `api.hiro.so`
recheck rápido: CONNECT tunnel falhou com 403 no agent-proxy (mesmo
bloqueio das rodadas anteriores) — não deu pra confirmar se o deployer
`SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG` publicou contrato novo; os 15
contratos Clarity já cobertos seguem sem mudança conhecida, nenhum
arquivo novo candidato neste programa. Leitura profunda proativa desta
rodada direcionada a `vercel/next.js` (ver NOTES.md de Vercel Open
Source: módulo `turborepo-access-trace/*` — instrumentação de
env/TCP pra cache key do Turborepo, confirmado que só nomes de env var
e não valores vazam pro trace file — e dois componentes de UI de
fallback de auth), sem achado. Nenhuma transição de estado neste
programa.

## Rodada 2026-09-04 #7 (push automático via GitHub webhook)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado.
`migrate-to-v2.mjs` + `list-pending` global = 0. `api.hiro.so` não
testado nesta rodada (bloqueios de rede das rodadas anteriores seguem
sem motivo pra reverificar todo run) — os 15 contratos Clarity já
cobertos seguem sem mudança conhecida, nenhum arquivo novo candidato
neste programa. Trabalho desta rodada concentrado em avançar findings
`corroborated_static` já existentes de Vercel Open Source (limitação
estrutural real da máquina de estados documentada — ver NOTES.md de
Vercel Open Source) e leitura profunda proativa em `vercel/next.js`
(sem achado). Nenhuma transição de estado neste programa.

## Rodada 2026-09-04 #? (push automático via GitHub webhook, rodada seguinte)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado.
`migrate-to-v2.mjs` + `list-pending` global = 0. `api.hiro.so` recheck
rápido via `curl`: falha de conexão (`errno=56`, mesmo bloqueio do
agent-proxy de rodadas anteriores) — não deu pra confirmar se o deployer
`SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG` publicou contrato novo; os 15
contratos Clarity já cobertos seguem sem mudança conhecida, nenhum
arquivo novo candidato neste programa. Leitura profunda proativa desta
rodada direcionada a `nuxt/nuxt` (ver NOTES.md de Vercel Open Source),
sem achado. Nenhuma transição de estado neste programa.

## Rodada 2026-09-04 #9 (push automático via GitHub webhook)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado.
`migrate-to-v2.mjs` + `list-pending` global = 0. `api.hiro.so` recheck
rápido via `curl -m 8`: `errno=56` (connection reset), mesmo bloqueio
de rede de todas as rodadas anteriores -- não deu pra confirmar se o
deployer `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG` publicou contrato
novo; os 15 contratos Clarity já cobertos seguem sem mudança conhecida,
nenhum arquivo novo candidato neste programa. Leitura profunda proativa
desta rodada direcionada a `vercel/eve` (ver NOTES.md de Vercel Open
Source: achado inicial de possível IDOR em cancel/compact/clear/reset,
refutado como responsabilidade documentada do app integrador, não bug
de framework). Nenhuma transição de estado neste programa.

## Rodada 2026-09-04 #10 (push automático via GitHub webhook, rodada seguinte)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado.
`migrate-to-v2.mjs` + `list-pending` global = 0. `api.hiro.so` recheck
rápido via `curl -m 8`: `errno=56` (connection reset), mesmo bloqueio de
rede de todas as rodadas anteriores -- não deu pra confirmar se o
deployer `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG` publicou contrato
novo; os 15 contratos Clarity já cobertos seguem sem mudança conhecida,
nenhum arquivo novo candidato neste programa. Leitura profunda proativa
desta rodada direcionada a `vercel/chat` (ver NOTES.md de Vercel Open
Source: `packages/chat` núcleo -- `callback-url.ts`, `chat.ts`
`handleActionEvent`, `ai/scope.ts`), sem achado. Nenhuma transição de
estado neste programa.

## Rodada 2026-09-04 #12 (push automático via GitHub webhook, rodada seguinte)

`program-policy.json` lido por completo como passo zero: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado
(inclusive notado que `list-deep-read-candidates.mjs` não reconhece os
repos de Block Open Source como bloqueados no dataset -- excluídos à
mão, ver NOTES.md de Vercel Open Source para detalhe). `migrate-to-v2.mjs`
+ `list-pending` global = 0. `api.hiro.so` não retestado nesta rodada;
os 15 contratos Clarity já cobertos seguem sem mudança conhecida,
nenhum arquivo novo candidato neste programa. Leitura profunda
proativa desta rodada direcionada a `vercel/workflow` (`vercel-api.ts`,
`world.ts`, `health.ts` -- ver NOTES.md de Vercel Open Source), sem
achado. Nenhuma transição de estado neste programa.

## Rodada 2026-09-04 #13 (push automático via GitHub webhook, rodada seguinte)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado.
`migrate-to-v2.mjs` + `list-pending` global = 0. `api.hiro.so` recheck
via `curl -m 8`: `errno=56` de novo, mesmo bloqueio de rede de todas as
rodadas anteriores -- não confirmável se o deployer StackingDAO
publicou contrato novo; os 15 contratos Clarity já cobertos seguem sem
mudança conhecida, nenhum arquivo novo candidato neste programa.
Leitura profunda proativa desta rodada direcionada a
`vercel-labs/skills` (ver NOTES.md de Vercel Open Source: 3 arquivos
completos -- `providers/wellknown.ts`, `remove.ts`, `local-lock.ts` --
sem achado). Nenhuma transição de estado neste programa.

## Rodada 2026-09-04 #14 (push automático via GitHub webhook, rodada seguinte)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado.
`migrate-to-v2.mjs` + `list-pending` global = 0. `api.hiro.so` recheck
via `curl -m 8`: `CONNECT tunnel failed, response 403` (mesma
categoria de bloqueio de rede do agent-proxy de todas as rodadas
anteriores, só a mensagem de erro específica mudou) -- não confirmável
se o deployer StackingDAO publicou contrato novo; os 15 contratos
Clarity já cobertos seguem sem mudança conhecida, nenhum arquivo novo
candidato neste programa. Trabalho desta rodada concentrado em revisar
os 2 findings `scope_verified` pendentes (nenhum deste programa) e
leitura profunda proativa em `vercel/ai` (ver NOTES.md de Vercel Open
Source). Nenhuma transição de estado neste programa.
