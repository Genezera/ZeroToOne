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

## Próximo passo (não feito ainda)
1. Ler `stacking-dao-core-btc-v3.clar` por completo (faltam ~250 linhas).
2. Baixar e ler `stacker-1` a `stacker-10` (ou os stackers atualmente
   ativos) — são os candidatos mais prováveis a chamar
   `return-stx-from-stacking`/`return-stx-from-staking-split`.
3. Confirmar se existe um caminho onde `stx-amount` chega até essas
   funções sem ser derivado de um valor específico daquele `tx-sender`
   (ex.: um parâmetro livre que o usuário escolhe, não um valor lido de um
   map indexado por endereço do usuário).
4. Só depois de um caminho de chamada completo e verificado, considerar
   isso um achado de verdade — nada disso é confirmado ainda.

## Honestidade
Isso é trabalho de segurança real, não instantâneo. Pode levar sessões
inteiras e ainda assim não confirmar nada — é exatamente o padrão descrito
na pesquisa sobre bug bounty (90% dos iniciantes não ganham nada, e mesmo
para quem ganha, o primeiro achado leva semanas). Não vou reportar isto ao
Immunefi até ter uma cadeia de chamada completa e uma prova de conceito
real.
