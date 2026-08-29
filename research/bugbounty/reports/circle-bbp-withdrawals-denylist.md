# ⚠️ RASCUNHO — REVISÃO HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de análise de código-fonte
público. **Não foi enviado a nenhuma plataforma.** Antes de copiar/colar e
enviar, confira:

- [ ] Escopo confirmado — o ativo afetado está no escopo do programa AGORA
      (escopo pode mudar; reconfirme na página do programa antes de enviar)
- [ ] Categoria confirmada — bate com uma categoria que o programa
      declara como elegível para recompensa (não é metadado/cosmético)
- [ ] Evidência conferida — os trechos de código abaixo realmente
      existem no arquivo/linha citados (não foi paráfrase/alucinação)
- [ ] Não é duplicata — checado contra relatórios já enviados por você
      a este programa

---

## Título
Denylist (freeze de compliance) não é aplicado no caminho de saque permissionless de `GatewayWallet`, permitindo que um endereço congelado retire fundos já depositados

## Programa / Plataforma
Circle BBP via HackerOne — https://hackerone.com/circle-bbp

## Categoria / Severidade declarada
Falha de controle de acesso / bypass de mecanismo de compliance em
contrato inteligente de infraestrutura de produção (ativo confirmado
`asset_type: SMART_CONTRACT`, `eligible_for_bounty: true`). Não é
metadado nem cosmético: o bug permite que uma conta explicitamente
congelada pela Circle (via a função `denylist()`) continue movendo fundos
reais para fora do contrato.

## Ativo afetado
- Repositório: `circlefin/evm-gateway-contracts`
- Arquivo: `src/modules/wallet/Withdrawals.sol`
- Linha(s): 76 (`initiateWithdrawal`), 104 (`withdraw`), efeito em 113
  (`safeTransfer`)
- Commit/branch no momento da análise: `master` (verificar SHA atual
  antes de enviar — o código pode ter mudado desde a varredura)

## Resumo
`GatewayWallet` implementa um mecanismo de denylist (`Denylist.sol`) para
congelar endereços por motivo de compliance/sanção, e esse controle é
aplicado consistentemente em todos os outros caminhos que envolvem fundos
do contrato: depósitos (`Deposits.sol`, inclusive para terceiros),
delegação de autorização sobre saldo (`Delegation.sol`), e o pagamento de
mint na ponte (`Mints.sol::gatewayMint`, que checa tanto o chamador quanto
o destinatário do mint). O módulo `Withdrawals.sol`, que implementa o
caminho de saque permissionless (`initiateWithdrawal` + `withdraw`) e
transfere tokens ERC-20 reais diretamente para `msg.sender`, não tem
nenhuma checagem `notDenylisted` em nenhuma das duas funções. Isso permite
que um endereço denylistado depois de já ter depositado continue sacando
seu saldo `available` livremente, contornando o congelamento de
compliance que o resto do contrato aplica sistematicamente.

## Cadeia de chamada confirmada
- `src/modules/wallet/Withdrawals.sol:76` — `initiateWithdrawal(address token, uint256 value) external whenNotPaused tokenSupported(token)` — sem `notDenylisted`.
- `src/modules/wallet/Withdrawals.sol:104` — `withdraw(address token) external whenNotPaused tokenSupported(token)` — sem `notDenylisted`; termina em `IERC20(token).safeTransfer(msg.sender, balanceToWithdraw)` na linha 113, pagando fundos reais.
- `src/modules/wallet/Deposits.sol:61-196` — todas as 5 variantes de depósito (`deposit`, `depositFor`, 2x `depositWithPermit`, 2x `depositWithAuthorization`) aplicam `notDenylisted(msg.sender)` e, quando há uma contraparte (`depositor`/`owner`/`from`), também `notDenylisted` nela — confirma que o padrão do contrato é checar denylist em toda operação relacionada a fundos.
- `src/modules/wallet/Delegation.sol:80-108` — `addDelegate`/`removeDelegate` (que nem movem fundos diretamente) também checam `notDenylisted`, reforçando que o design pretendido é abrangente.
- `src/modules/minter/Mints.sol:161-296` — `gatewayMint` (o pagamento simétrico, no lado do `GatewayMinter`, de fundos que chegam de outra chain) checa `notDenylisted(msg.sender)` (linha 164) E, dentro de `_validateAttestationTransferSpec`, valida explicitamente que o destinatário do mint não está denylistado (linha ~291, comentário "Ensure the intended recipient is not denylisted") — ou seja, exatamente o tipo de operação "pagar fundos reais para um endereço" que `withdraw()` faz é protegido no lado mint, mas não no lado de saque direto.
- `src/GatewayCommon.sol` e `src/GatewayWallet.sol` — confirmam que `Denylist` é herdado só para inicialização/storage compartilhados; não existe nenhum modifier global aplicado a todas as funções externas que faria essa checagem "por trás" de `Withdrawals.sol`.
- `grep -rln "notDenylisted" src/` no clone completo do repositório retorna apenas `Denylist.sol` (definição), `Deposits.sol`, `Delegation.sol` e `Mints.sol` — confirmando que `Withdrawals.sol` é a exceção, não documentei nenhuma outra checagem escondida.

## Passo a passo de reprodução
1. Endereço `A` deposita tokens suportados em `GatewayWallet` via `deposit()` (nesse momento `A` ainda não está denylistado, então o depósito passa).
2. O `denylister` da Circle chama `denylist(A)` depois de identificar atividade suspeita/sancionada associada a `A` (ex.: fluxo AML/compliance).
3. `A` chama `initiateWithdrawal(token, value)` com `value <= availableBalance(token, A)` — a chamada não reverte porque não há checagem de denylist nessa função.
4. Após `withdrawalDelay` blocos, `A` chama `withdraw(token)` — a chamada não reverte, e `IERC20(token).safeTransfer(msg.sender, balanceToWithdraw)` transfere os tokens reais para `A`, apesar de `A` estar denylistado.

## Evidência
```solidity
// src/modules/wallet/Withdrawals.sol
function initiateWithdrawal(address token, uint256 value) external whenNotPaused tokenSupported(token) {
    // ... nenhuma checagem notDenylisted(msg.sender) aqui
}

function withdraw(address token) external whenNotPaused tokenSupported(token) {
    _ensureWithdrawable(token, msg.sender);
    uint256 balanceToWithdraw = _emptyWithdrawingBalance(token, msg.sender);
    _setWithdrawalBlock(token, msg.sender, 0);

    // Transfer the funds to the depositor
    IERC20(token).safeTransfer(msg.sender, balanceToWithdraw);

    emit WithdrawalCompleted(token, msg.sender, balanceToWithdraw);
}
```

Comparar com o padrão usado em todo o resto do contrato, por exemplo:
```solidity
// src/modules/wallet/Deposits.sol
function deposit(address token, uint256 value)
    external
    whenNotPaused
    notDenylisted(msg.sender)
    tokenSupported(token)
{ ... }
```
```solidity
// src/modules/minter/Mints.sol
function gatewayMint(bytes memory attestationPayload, bytes memory signature)
    external
    whenNotPaused
    notDenylisted(msg.sender)
{ ... }
// dentro de _validateAttestationTransferSpec:
// "Ensure the intended recipient is not denylisted"
```

## Impacto
O mecanismo de denylist existe especificamente para permitir que a Circle
congele endereços por motivo de compliance/sanção/segurança (ex.: fundos
associados a exploit conhecido, endereço sancionado pela OFAC, conta
comprometida). Como está, esse controle é inteiramente contornável para
fundos já depositados: assim que um endereço é denylistado, ele ainda
pode extrair integralmente seu saldo `available` de `GatewayWallet` via
`initiateWithdrawal`/`withdraw`, sem nenhuma restrição adicional além do
delay padrão de saque. Isso derruba a garantia central que o resto do
contrato (depósitos, delegação, mint) impõe consistentemente, e pode
representar uma falha de compliance regulatório relevante para uma
emissora de stablecoin como a Circle — o freeze não congela de fato os
fundos, apenas bloqueia novos depósitos/mints/delegações.

## Correção sugerida
Adicionar o modifier `notDenylisted(msg.sender)` em `initiateWithdrawal` e
em `withdraw` (`src/modules/wallet/Withdrawals.sol`, linhas 76 e 104),
seguindo exatamente o mesmo padrão já usado em `Deposits.sol`,
`Delegation.sol` e `Mints.sol`. Isso é uma mudança mínima e localizada —
não requer alterar a lógica de saldo/delay já existente.

---
*Gerado automaticamente em 2026-08-29T00:00:00Z a partir do achado
`Circle BBP::circlefin/evm-gateway-contracts/src/modules/wallet/Withdrawals.sol::initiateWithdrawal_withdraw::ai_deep_read_finding`
na fila (`research/bugbounty/queue.jsonl`). Ver histórico completo do
veredito em `ledger/ledger.research.jsonl`.*
