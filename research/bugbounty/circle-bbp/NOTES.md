---
programa: Circle BBP (HackerOne), Solidity
status: pipeline automatizado criado e testado; primeira rodada real: 6 candidatos
data: 2026-08-29
---

# Circle BBP — cobertura automatizada

## Por que este programa
Descoberto pelo módulo de descoberta automática de alvo
(`discover-targets.mjs`, Lote 5) — não escolhido manualmente do zero.
Circle é a empresa emissora do USDC (segunda maior stablecoin do mundo);
o programa `circle-bbp` na HackerOne (`https://hackerone.com/circle-bbp`,
`managed_program: true`, `offers_bounties: true`) tem 15 repositórios em
escopo, a maioria contrato Solidity de infraestrutura real: CCTP
(Cross-Chain Transfer Protocol, a ponte oficial de USDC entre chains),
gateway, wallet, reserva cross-chain, além de código Go/Rust/Move
(remote signer, nó de consenso, contratos Aptos/Solana).

Confirmado direto no dataset (`hackerone_data.json`) que
`evm-cctp-contracts` é `asset_type: SMART_CONTRACT`,
`eligible_for_bounty: true`, `max_severity: critical` — alvo real e ativo,
não um repo esquecido.

## Por que só Solidity nesta rodada (não Go/Rust/Move do mesmo programa)
O programa tem repos em 4 linguagens diferentes das que já cobríamos.
Escolhi construir cobertura Solidity primeiro porque:
- É a linguagem com MAIS repos elegíveis do programa (5 dos 15).
- Smart contract Solidity é a categoria de bug bounty historicamente mais
  bem paga do espaço cripto (reentrância já causou perdas reais de
  centenas de milhões de dólares — caso The DAO, 2016).
- Já temos experiência de heurística de linguagem de contrato inteligente
  (Clarity/StackingDAO) — o modo de pensar (rastrear efeito colateral de
  chamada externa, checagem de autorização) transfere.
- Go/Rust/Move do mesmo programa ficam registrados como próximo passo
  natural, não descartados — `arc-remote-signer`/`noble-cctp` (Go) podem
  reusar o scanner Go já existente quase sem trabalho novo; Move e Rust
  exigiriam heurística nova, fica para depois.

## Alvos escolhidos (5 de 15 repositórios do programa)
| Repo | Tamanho | Por quê |
|---|---|---|
| `circlefin/evm-cctp-contracts` | 1,9MB, 227★ | Núcleo do CCTP — ponte oficial de USDC cross-chain, `max_severity: critical` confirmado |
| `circlefin/evm-gateway-contracts` | 3,3MB | Gateway de acesso |
| `circlefin/buidl-wallet-contracts` | 2,9MB | Contratos de smart wallet |
| `circlefin/evm-xreserve-contracts` | 1,4MB | Reserva cross-chain |
| `circlefin/evm-cpn-contracts` | 0,3MB | Menor do grupo, cobertura completa viável |

Os outros 10 repos do programa (Move, Rust, Go, e os TypeScript/Solidity
mistos como `stablecoin-evm`) ficam de fora desta rodada — registrados em
`research/bugbounty/discovered-targets.json` para expansão futura.

## Heurísticas novas (`heuristics-solidity.mjs`) — 4 classes bem
## estabelecidas de vulnerabilidade de contrato inteligente
Mesmo espírito das outras: baseadas em checklist real de auditoria
(Consensys Diligence, Trail of Bits, OpenZeppelin), não inventadas:
1. `reentrancy_risk` — chamada externa (`.call`) seguida de escrita de
   estado DEPOIS da chamada, dentro da mesma função (violação do padrão
   checks-effects-interactions — o bug do hack da The DAO).
2. `unchecked_call_return` — `.call(...)` sem capturar/checar o retorno
   booleano — falha silenciosa.
3. `tx_origin_auth_risk` — `tx.origin` usado em checagem de autorização
   (vulnerável a phishing via contrato intermediário).
4. `delegatecall_risk` — `delegatecall` em endereço que não é
   constant/immutable — risco de colisão de storage/execução arbitrária.

9 testes automatizados, incluindo confirmação de que o padrão CORRETO
(estado atualizado ANTES da chamada externa) não gera ruído.

## Primeira rodada real (2026-08-29)
229 arquivos checados nesta rodada (JS/TS+Go+JVM+Swift+Solidity
combinados, cache de SHA parcial), **6 candidatos Solidity genuínos**:
- 1 `reentrancy_risk` em `evm-gateway-contracts/script/
  004_UpgradeGatewayWallet.sol` (função `run`)
- 2 `unchecked_call_return` no mesmo arquivo
- 2 `reentrancy_risk` em scripts de deploy do `buidl-wallet-contracts`
- 1 `delegatecall_risk` em `buidl-wallet-contracts/src/utils/
  ExecutionUtils.sol`

**Observação honesta importante**: os 5 primeiros achados estão em
arquivos `script/`/`.s.sol` — scripts de deploy/upgrade rodados pelo
DEPLOYER (não código de contrato em produção exposto a usuário
não-confiável). Isso reduz bastante a severidade esperada mesmo se
"confirmado" tecnicamente — o padrão de checks-effects-interactions
ainda vale, mas o modelo de ameaça de um script de deploy (que só o
próprio time da Circle executa) é muito diferente do de uma função
pública de contrato. `ExecutionUtils.sol:69` (delegatecall) é código de
runtime de verdade (`src/`, não `script/`), potencialmente mais
relevante — ainda não revisado pelo agente de nuvem no momento desta
nota. Nenhum veredito próprio aqui — aguardando a revisão cética do
agente de nuvem, mesmo processo dos outros achados.

## O que falta
- Verificar se a conta HackerOine existente do usuário (mesma conta do
  Vercel Open Source) já cobre este programa ou se precisa de aceite de
  termo separado.
- Considerar expandir pra Go do mesmo programa (`arc-remote-signer`,
  `noble-cctp`, `noble-fiattokenfactory`) — reusa scanner Go existente.

## Revisão do agente de nuvem — rodada 2026-08-29 (6 candidatos)
Todos os 6 candidatos pendentes desta rodada foram investigados com rastreio
de cadeia de chamada completo (clone local via `git clone` público de
`evm-gateway-contracts` e `buidl-wallet-contracts`) e revertidos como
**falso_positivo**, confirmando a suspeita já registrada na nota acima:

- 3 achados (`reentrancy_risk` em `004_UpgradeGatewayWallet.sol::run`,
  `reentrancy_risk` em `103_DeployColdStorageAddressBookPlugin.s.sol::run`,
  `reentrancy_risk` em `104_DeployWeightedWebauthnMultisigPlugin.s.sol::run`)
  são scripts Foundry de deploy/upgrade (`is Script`), executados só pelo
  deployer/owner confiável via `vm.startBroadcast(...)` com a própria chave
  — não são contrato on-chain persistente exposto a terceiros, então o
  modelo de ameaça de reentrância clássico não se aplica. A "escrita após
  chamada externa" que a heurística pegou é sempre variável local do
  script, nunca storage de contrato.
- 2 achados (`unchecked_call_return` em `004_UpgradeGatewayWallet.sol`,
  linhas 116 e 135) são falso positivo simples: o retorno booleano de cada
  `.call(...)` É capturado e checado com `require(...)` logo em seguida —
  a heurística aparentemente não olhou as linhas seguintes à chamada.
- 1 achado (`delegatecall_risk` em `buidl-wallet-contracts/src/utils/
  ExecutionUtils.sol:69`) é o mais interessante de investigar mas também
  falso positivo: é uma função de biblioteca genérica (`to` é parâmetro por
  definição). Rastreei os 3 call sites reais (`BaseMSCA.sol:228,238`,
  `UpgradableMSCA.sol:71`) — todos usam `address(PLUGIN_MANAGER)`, que é
  `immutable`, fixado uma única vez no constructor. Não é delegatecall para
  endereço controlável por atacante; é o padrão intencional do ERC-6900
  (modular account delegando para seu próprio Plugin Manager fixo), com
  autorização (`validateNativeFunction`) nas funções externas que o
  acionam.

Nenhum relatório escrito nesta rodada (0 confirmado).

## Leitura profunda proativa — rodada 2026-08-29
3 arquivos novos lidos em `circlefin/evm-cctp-contracts` (núcleo do CCTP,
ainda não coberto no deep-read-log): `src/MessageTransmitter.sol`,
`src/roles/Attestable.sol`, `src/v2/BaseMessageTransmitter.sol` —
justamente o caminho de verificação de assinatura de attestation e
liberação de mensagem cross-chain (`receiveMessage`/
`_verifyAttestationSignatures`), a superfície de maior valor do programa
inteiro (se quebrada, permitiria mintagem forjada de USDC ponte).
Ordem de checagens em `receiveMessage` confirmada correta (verifica
assinaturas → formato → domain → destinationCaller → version → nonce não
usado → **marca nonce como usado antes** da chamada externa
`handleReceiveMessage` — padrão CEI correto, sem reentrância de nonce).
Multisig de attesters em `Attestable.sol` exige ordem crescente de
endereço recuperado (previne duplicata) e todos precisam estar na
allowlist de `enabledAttesters`. Nenhuma falha de lógica encontrada — é
código de produção já em uso há anos (ponte oficial de USDC), esperado que
esteja bem auditado. Nenhuma entrada nova adicionada à fila.

### Addendum (rodada separada, mesmo dia) — 3 arquivos extras, sem sobreposição
Rodando a mesma investigação de forma independente, também rastreei a
cadeia de autorização do achado `delegatecall_risk` (item 6 acima) até a
ponta e aproveitei pra ler 3 arquivos de auth ainda não cobertos no
`deep-read-log.json` (sem sobrepor os do `evm-cctp-contracts` acima):
- `buidl-wallet-contracts/src/msca/6900/v0.7/plugins/v1_0_0/acl/SingleOwnerPlugin.sol`
  — fecha o loop de autorização do delegatecall: confirma que
  `installPlugin`/`uninstallPlugin`/`execute`/`executeBatch`/
  `upgradeToAndCall` estão todos listados no `pluginManifest()` (linhas
  200-209) como protegidos por `runtimeValidationFunctions`, e que
  `runtimeValidationFunction` (linha 144-159) exige
  `sender == owner || sender == self` antes de qualquer efeito. Verificação
  de assinatura via `SignatureChecker.isValidSignatureNow` (ecrecover ou
  EIP-1271), sem comparação insegura/timing. Sem achado.
- `evm-gateway-contracts/src/modules/common/Denylist.sol` e
  `evm-gateway-contracts/src/modules/wallet/ContractSignersAllowlist.sol`
  — ambos `Ownable2StepUpgradeable` + storage EIP-7201, modifiers
  `onlyDenylister`/`onlyContractSignersAllowlister` corretos, sem gap de
  ordem de checagem. Sem achado.

Ponto em aberto pra próxima rodada (não confirmado, fora do orçamento
desta): verificar se `notDenylisted` é de fato aplicado em todos os
caminhos de transferência/depósito/saque de `GatewayWallet.sol`/
`GatewayMinter.sol` (ainda não lidos) — se algum caminho de movimentação
de fundos esquecer o modifier, um endereço denylistado poderia continuar
operando.

## Rodada 2026-08-29 — leitura profunda proativa (WebAuthnLib.sol)

Sem itens `pending` na fila. Leitura profunda desta rodada incluiu
`buidl-wallet-contracts/src/libs/WebAuthnLib.sol` (verificação de
assinatura WebAuthn/passkey secp256r1, usada pelo `WeightedWebauthnMultisigPlugin`).
É um fork declarado do webauthn-sol da Coinbase e do p256-verifier do
Daimo, ambos já extensivamente auditados. Revisão da função `verify()`:
guarda de maleabilidade de assinatura presente (`s > n/2` rejeitado),
checagem de tipo `"webauthn.get"` e do challenge via slice+hash, checagem
da flag "User Present" (e "User Verified" quando exigido), fallback correto
entre o precompile RIP-7212 e a lib FCL_ecdsa. As omissões de verificação
(origin, rpIdHash, contador de assinatura, extensões, backup state) são
documentadas explicitamente no NatSpec como decisões de design assumidas,
não lacunas acidentais. Nenhuma falha de lógica nova encontrada — sem
achado.

`deep-read-log.json` atualizado. Ponto em aberto da rodada anterior
(cobertura de `notDenylisted` em `GatewayWallet.sol`/`GatewayMinter.sol`,
ainda não lidos) continua válido pra próxima rodada.

## Rodada seguinte (2026-08-29, mesmo dia) — achado novo: gap de denylist em `Withdrawals.sol`

Persegui o ponto em aberto deixado acima. Lendo `Withdrawals.sol`,
`Deposits.sol`, `Delegation.sol`, `Burns.sol`, `Mints.sol`,
`GatewayCommon.sol` e `GatewayWallet.sol` (todos de
`circlefin/evm-gateway-contracts`, branch `master`) e cruzando com
`grep -rln "notDenylisted" src/` no clone completo:

**Achado (`ai_deep_read_finding`, já investigado e revisado nesta mesma
rodada — verdict `confirmado`, confidence `média`):**
`Withdrawals.sol::initiateWithdrawal` e `Withdrawals.sol::withdraw` não
têm `notDenylisted` em nenhuma das duas, enquanto TODO o resto do
contrato aplica esse modifier a qualquer operação relacionada a fundos —
inclusive `Delegation.sol::addDelegate/removeDelegate`, que nem move
fundos diretamente. `Mints.sol::gatewayMint` (o pagamento simétrico do
lado mint) checa denylist tanto do chamador quanto do destinatário do
mint. `withdraw()` paga tokens ERC-20 reais direto pro `msg.sender`
(`safeTransfer`, linha 113) sem nenhuma checagem de denylist em todo o
caminho. Ou seja: um endereço denylistado depois de já ter depositado
consegue sacar seu saldo `available` livremente, contornando o
congelamento de compliance. Confidence `média` (não `alta`) porque não
tenho como confirmar 100% que isso não é uma exceção deliberada de design
(ex.: "sempre permitir reaver saldo já depositado mesmo denylistado
depois") sem acesso à documentação/issue tracker interno da Circle — mas
o padrão consistente no resto do contrato (inclusive delegação, que não
move fundos) torna essa hipótese pouco provável.

Isso É elegível para relatório: é uma falha real de controle de acesso
em contrato de produção que move fundos, não metadado/cosmético — bate
com o critério geral (tratar como achado de segurança de verdade, nunca
cosmético) aplicado aos outros programas HackerOne/Bugcrowd desta missão.
Rascunho salvo em
`research/bugbounty/reports/circle-bbp-withdrawals-denylist.md`.

Burns.sol também não tem `notDenylisted`, mas isso é defensável: é
chamado pelo operador pra reduzir saldo/queimar tokens já
comprometidos por um mint em outra chain (débito, não paga fundos pro
usuário) — não abri achado pra esse.

## Rodada 2026-08-29 (rotina semanal automática) — fila vazia, leitura profunda nos dois alvos ainda intocados

Fila (`queue.jsonl`) sem itens `pending` no início desta rodada (todos os
33 itens já `reviewed`, incluindo o achado de denylist acima). Leitura
profunda proativa cobriu os dois únicos alvos de `targets-solidity.mjs`
que ainda não tinham nenhuma entrada em `deep-read-log.json`:
`circlefin/evm-xreserve-contracts` e `circlefin/evm-cpn-contracts`
(clonados publicamente via `git clone`, sem conta/token).

Arquivos lidos (3, priorizando movimentação de fundos e controle de
acesso, já que nenhum tem "auth/session/crypto/token/login/password"
literalmente no nome):
- `evm-xreserve-contracts/src/modules/x-reserve/Withdrawal.sol` — função
  `withdraw()` pública (sem role própria, o controle de acesso real está
  na verificação de assinatura do attestor dentro de `gatewayMint`,
  padrão já validado em `Attestable.sol`). Rastreei a validação de hook
  data (`_validateAndProcessHookData`): checa pausa global, domínio
  remoto registrado/não pausado, `_ensureNotBlocklisted` do depositante
  remoto, token remoto registrado, e restringe `forwardingContract` a um
  allowlist fixo de 3 endereços (`tokenMessenger`, `tokenMessengerV2`,
  `address(this)`) antes de qualquer forwarding. No caminho de
  "xReserve forwarding" (`_processXReserveForwarding`), o parâmetro
  `from` do `depositToRemote` é hardcoded para `address(this)` (não vem
  do calldata decodificado) — não há como desviar fundos de terceiros
  por aí. Nenhum problema encontrado.
- `evm-xreserve-contracts/src/modules/x-reserve/Blocklistable.sol` —
  mesmo padrão de `Denylist.sol` já revisado em `evm-gateway-contracts`
  (role `blocklister` separada, `onlyBlocklister`/`onlyOwner`,
  `_ensureNotBlocklisted` chamado de fato dentro de `Withdrawal.sol`
  antes de processar o saque, ao contrário do gap encontrado em
  `Withdrawals.sol` do gateway). Nenhum problema.
- `evm-cpn-contracts/src/PaymentSettlementV2.sol` (Circle Payments
  Network — não estava na lista de alvos do dashboard/`targets-*.mjs`
  antes, mas é o mesmo repo `circlefin/evm-cpn-contracts` já listado em
  `targets-solidity.mjs`) — contrato grande e cuidadosamente desenhado:
  ciclo de vida de nonce (`Unused → Executed → Refunded` ou
  `→ Cancelled`) impede replay, `onlyAttester` + checagem extra
  `_msgSender() != intent.attester` amarra o chamador ao attester
  assinado no intent, valores pull via Permit2 witness transfer (o
  próprio Permit2 verifica a assinatura do dono dos fundos amarrada ao
  hash do intent específico — não há caminho de mover fundos de alguém
  que não assinou), tetos de reembolso cumulativo (`payerCap`/
  `incentiveCap`) checados antes de qualquer transferência. Não achei
  nenhuma falha de autorização/corrida/validação faltando numa primeira
  leitura cuidadosa. Nenhum problema encontrado — mas é um contrato
  denso o bastante que vale uma segunda leitura futura mais focada nos
  fluxos de `refund()` com múltiplas assinaturas condicionais
  (`requireDestinationRefundSig`), que não dei tanta atenção quanto
  `execute()`.

`deep-read-log.json` atualizado com os 3 arquivos. Nenhum item novo
adicionado à fila nesta rodada — resultado normal.

## Rodada 2026-08-29 (push automático seguinte) — fila vazia, `evm-cctp-contracts` (attestation V2 + proxy admin)

`queue.jsonl` sem itens `pending` no disparo desta rodada. Leitura
profunda cobriu 2 dos 3 arquivos do orçamento desta rodada (o terceiro foi
`misk-jdbc/TraditionalSchemaMigrator.kt`, ver NOTES.md do Block Open
Source), ambos em `circlefin/evm-cctp-contracts`, ainda não cobertos no
`deep-read-log.json`:

- `src/roles/v2/AttestableV2.sol` — contrato trivial: só adiciona um
  storage gap (`uint256[20] private __gap`, padrão OpenZeppelin de
  upgradeable contracts) e repassa o construtor pra `Attestable`, sem
  lógica própria nova. Nada a auditar além do que `Attestable.sol` já
  cobriu em rodada anterior. Sem achado.
- `src/proxy/AdminUpgradableProxy.sol` — fork declarado do
  `TransparentUpgradeableProxy` da OpenZeppelin (padrão EIP-1967, slot de
  admin fixo/validado no constructor). Modificações documentadas no
  próprio NatSpec do fork (remoção do modifier `ifAdmin` em `admin()`/
  `implementation()`, tornando-os `view` puros) só afetam quem pode LER
  o endereço do admin/implementação — não afetam quem pode ESCREVER
  (`changeAdmin`/`upgradeTo`/`upgradeToAndCall` continuam com `ifAdmin`
  intacto). Padrão de proxy administrativo extremamente batido e já
  auditado por terceiros (é literalmente um fork do contrato mais usado
  do espaço). Sem achado.

Nenhum item novo adicionado à fila. `deep-read-log.json` atualizado com
os 2 arquivos acima.

## Rodada 2026-08-29 (disparo por push no repo, fila vazia) — `ColdStorageAddressBookPlugin` + multisig v0.7/v0.8

`queue.jsonl` sem itens `pending` (33/33 já `reviewed`) no disparo desta
rodada. Leitura profunda proativa cobriu 4 arquivos novos de
`circlefin/buidl-wallet-contracts`, escolhidos por serem os pontos de
controle de acesso/autorização mais valiosos ainda não lidos (autorização
de destinatário de fundos e verificação de assinatura multisig):

- `src/msca/6900/v0.7/plugins/v1_0_0/addressbook/ColdStorageAddressBookPlugin.sol`
  — hook de pré-validação que restringe `execute`/`executeBatch` a uma
  allowlist de destinatários (`_allowedRecipients`, por conta). Segui a
  cadeia até `src/libs/RecipientAddressLib.sol` (não estava no orçamento
  de 3, mas foi necessário pra fechar o raciocínio — decodifica o
  "recipient" da calldata pra ERC20/721/1155). Ponto que investiguei a
  fundo por suspeita de bypass: `approve`/`increaseAllowance`/
  `setApprovalForAll` são decodificados e o **spender** é tratado como se
  fosse o "recipient" e validado contra a mesma allowlist — a princípio
  parecia poder ser um jeito de dar approve pra um spender arbitrário sem
  checagem, mas não é: `RecipientAddressLib.getERC20TokenRecipient` (e as
  variantes ERC721/1155) tratam explicitamente `approve`/
  `increaseAllowance`/`setApprovalForAll` com o mesmo offset de endereço
  do "recipient", ou seja, o spender de uma aprovação TAMBÉM precisa estar
  na allowlist — design correto (impede dar approve pra endereço não
  autorizado como forma de desviar fundos depois). `target` (o contrato
  chamado) não é ele mesmo restrito à allowlist, só o "recipient"/spender
  decodificado da calldata — isso é uma limitação de design assumida (a
  proteção é sobre para onde valor/allowance pode ir, não sobre quais
  contratos a conta pode chamar), não uma falha nova; qualquer bypass via
  contrato malicioso em `target` exigiria que a conta já tivesse allowance
  prévia concedida a esse contrato pra outro token, o que não é algo que
  este plugin introduz. Sem achado (confidence não chegou a um nível que
  justificasse abrir item na fila — ceticismo aplicado, hipótese de bypass
  refutada).
- `src/msca/6900/v0.7/plugins/v1_0_0/multisig/WeightedWebauthnMultisigPlugin.sol`
  e `src/msca/6900/v0.8/modules/multisig/WeightedMultisigValidationModule.sol`
  (a versão v0.8 mais nova do mesmo mecanismo) — revisei `checkNSignatures`
  em ambos: o loop `while (accumulatedWeight < thresholdWeight)` acumula
  peso mesmo de assinaturas inválidas/fora de ordem, mas isso é seguro
  porque `success`/`firstFailure` só são setados uma vez (guard
  `if (response.success)`) e nunca desfeitos — ou seja, qualquer falha
  individual invalida o lote inteiro no retorno final, independente de
  quanto peso foi acumulado. Sem loop infinito (cada iteração consome 65
  bytes da assinatura, limitado pelo tamanho do calldata). Sem
  reentrância (`view`/`pure`, sem chamada externa mutável). Nenhuma falha
  de lógica encontrada em nenhum dos dois.

`deep-read-log.json` atualizado com os 4 arquivos acima (mais
`RecipientAddressLib.sol`, lido por necessidade de rastreio de cadeia).
Nenhum item novo adicionado à fila — resultado normal desta rodada.

## Rodada 2026-08-29 (push automático) — fila vazia, `evm-cpn-contracts` (PaymentSettlement V1 + Rescuable)

`queue.jsonl` sem itens `pending` (33 revisados, 0 pendentes). Clone raso
de `circlefin/evm-cpn-contracts` via `add_repo`+`git clone` pra cobrir 2
dos 3 arquivos do orçamento desta rodada (o terceiro foi
`afterpay/sdk-ios/.../CheckoutV3ViewController.swift`, ver NOTES.md do
Block Open Source):

- `src/PaymentSettlement.sol` (V1, nunca lido — só a V2 tinha sido
  auditada em rodada anterior) — comparei linha a linha contra o padrão já
  validado de `PaymentSettlementV2.sol`: ciclo de nonce
  `_validateAndMarkNonce` marca o nonce como usado ANTES de validar
  `validAfter`/`validBefore`/`payee`/`fee`/`amount`, mas isso é seguro
  porque qualquer `revert()` subsequente desfaz TODA a transação
  (incluindo o nonce marcado) — semântica atômica do EVM, não uma corrida
  real. Verifiquei com atenção o valor aprovado via Permit2: `execute()`
  exige `payerData.permit.permitted.amount == intent.value + intent.maxFee`
  (o teto assinado pelo payer) mas só puxa `intent.value + fee` de fato
  (`_pullViaPermit2` usa `requestedAmount: intent.value + fee` como
  `SignatureTransferDetails`) — isso é o padrão correto de "aprovar o
  teto, puxar o valor real" do Permit2 (o próprio Permit2 garante
  `requestedAmount <= permitted.amount`), e o teto (`intent.maxFee`) já
  está amarrado criptograficamente dentro do hash witness assinado pelo
  payer (`_hashPayerPaymentIntent`), então não há como o attester substituir
  esse valor depois do fato. `onlyAttester` + checagem redundante
  `_msgSender() != intent.attester` (o attester specifico assinado no
  intent, não qualquer attester da allowlist) — mesmo padrão já validado
  na V2. Nenhuma falha de autorização/corrida/validação encontrada — é
  essencialmente a mesma lógica seguramente desenhada da V2, sem gap novo
  introduzido na V1.
- `src/utils/Rescuable.sol` — padrão clássico de "rescue" de tokens presos
  (mesmo padrão já usado em outros contratos ERC20 da própria Circle,
  ex. USDC): `onlyRescuer` modifier bem implementado
  (`_msgSender() != _rescuer`), `updateRescuer`/`removeRescuer` restritos a
  `onlyOwner` (via `Ownable2Step`, troca de dono em duas etapas, resistente
  a erro de digitação de endereço). `rescueERC20`/`rescueNative` só movem o
  saldo que estiver PARADO no contrato entre transações — rastreei
  `PaymentSettlement.execute()`/`cancel()`: todo valor puxado via Permit2
  é distribuído integralmente na mesma transação (puxa `value+fee`,
  distribui `fee` pro beneficiary e `value` pro payee, sem sobra
  matemática), então não há fundo "em trânsito" de usuário que o rescuer
  possa desviar em condições normais de operação — o rescue só alcança
  tokens enviados por engano/diretamente ao contrato. Nenhuma falha de
  lógica encontrada.

Comparação adicional (mesmo orçamento, arquivo do outro programa): a
leitura de `CheckoutV3ViewController.swift` (Afterpay iOS, ver NOTES.md do
Block Open Source) foi puxada por comparação direta com um achado
`inconclusivo` já registrado nessa missão no lado Android
(`AfterpayCheckoutV2Activity.kt` — ponte JS sem checagem de host em
navegações subsequentes). A V3 do iOS usa o mesmo padrão que já tinha sido
identificado como "mais seguro" na análise Android (confirmação
server-to-server via `performConfirmationRequest`/`ppaConfirmToken` antes
de finalizar) — não é um gap novo, é consistente com o padrão já
estabelecido como mitigação.

`deep-read-log.json` atualizado (agora 3 arquivos lidos em
`circlefin/evm-cpn-contracts`: `PaymentSettlementV2.sol`,
`PaymentSettlement.sol`, `Rescuable.sol`). Nenhum item novo adicionado à
fila — resultado normal. Sugestão pra próxima rodada: `src/utils/
Configurable.sol`/`src/utils/Pausable.sol` (mesmo repo, ainda não lidos) ou
voltar ao refund flow multi-assinatura (`requireDestinationRefundSig`) de
`PaymentSettlementV2.sol`, que a rodada anterior já tinha sinalizado como
merecendo uma segunda leitura mais focada.

## Rodada 2026-08-29 (push automático seguinte) — fila vazia, `evm-cctp-contracts` (TokenMinter + TokenController)

`queue.jsonl` sem itens `pending` (33 revisados, 0 pendentes). 2 dos 3
arquivos do orçamento desta rodada foram aqui (o terceiro foi
`cashapp/misk/.../HibernateSessionLocks.kt`, ver NOTES.md do Block Open
Source):

- `src/TokenMinter.sol` + `src/roles/TokenController.sol` (nunca lidos —
  única peça do CCTP "core" ainda não coberta: mint/burn de USDC ponte).
  `mint()`/`burn()` só aceitam chamada de `localTokenMessenger`
  (`onlyLocalTokenMessenger`, comparação direta de `msg.sender`), e esse
  endereço só pode ser setado uma vez por `onlyOwner`
  (`addLocalTokenMessenger` reverte se já setado; precisa
  `removeLocalTokenMessenger` antes de trocar — sem race de
  front-running que importe, ambas são `onlyOwner`). O docstring de
  `mint()` menciona "minterAllowance", mas não existe esse mapping dentro
  deste arquivo — confirmado que essa checagem vive no próprio contrato
  do token (USDC/FiatTokenV2 tem seu sistema próprio de `minterAllowance`
  quando concede o papel de "minter" pro `TokenMinter`), não é uma
  omissão deste código, é responsabilidade de outro contrato fora deste
  repo. `TokenController` (linkTokenPair/unlinkTokenPair/
  setMaxBurnAmountPerMessage) é só acessível por `onlyTokenController`
  (endereço separado do `owner`, setado via construtor/`_setTokenController`,
  sempre validado não-zero). Nenhuma falha de autorização encontrada —
  este é o contrato "core" do CCTP, o mais auditado/exposto de todo o
  programa (é a ponte oficial de USDC), então esse resultado negativo é
  esperado, não é evidência fraca.

`deep-read-log.json` atualizado (agora 7 arquivos em
`circlefin/evm-cctp-contracts`). Nenhum item novo adicionado à fila —
resultado normal. Sugestão pra próxima rodada: `src/utils/Configurable.sol`/
`src/utils/Pausable.sol` de `evm-cpn-contracts` (sugestão já pendente da
rodada anterior) ou `GatewayMinter.sol` de `evm-gateway-contracts`
(também já sinalizado, ainda não lido).

## Rodada 2026-08-29 (push automático seguinte) — fila vazia, `evm-cpn-contracts` (Configurable/Pausable) + `evm-gateway-contracts` (GatewayMinter)

`queue.jsonl` sem itens `pending` (0 pendentes). 3 arquivos do orçamento
desta rodada foram aqui (o 4º foi `afterpay/sdk-ios/ApiV3.swift`, ver
NOTES.md do Block Open Source), seguindo as sugestões pendentes das
rodadas anteriores:

- `src/utils/Configurable.sol` e `src/utils/Pausable.sol`
  (`evm-cpn-contracts`, nunca lidos) — dois roles administrativos
  (`configurator`/`pauser`) desenhados como abstract contracts genéricos,
  herdados por `PaymentSettlement*`. Ambos seguem o mesmo padrão já
  validado em `Rescuable.sol`: role dedicado só pode ser trocado por
  `onlyOwner` (via `Ownable2Step`, troca de dono em duas etapas), o
  modifier de cada role (`onlyConfigurator`/`onlyPauser`) compara
  `_msgSender()` direto contra o endereço armazenado, sem desvio.
  `_setPauser`/`_setConfigurator` revertem em `SamePauser`/
  `SameConfigurator` se o novo endereço for igual ao atual (evita evento
  redundante, não é uma falha). `pause()`/`unpause()` só mudam estado
  quando `whenNotPaused`/`whenPaused` bate, sem caminho pra ficar preso
  num estado inconsistente. Nenhuma falha de autorização encontrada — é
  boilerplate de controle de acesso correto, mesmo padrão do resto do
  programa.
- `src/GatewayMinter.sol` (`evm-gateway-contracts`, nunca lido) — contrato
  fino que só orquestra `initialize()` (via `reinitializer(2)`,
  `_disableInitializers()` no constructor pra bloquear inicialização
  direta da implementação, só a proxy pode inicializar) chamando
  `__GatewayCommon_init`/`__Mints_init`. Toda a lógica de mint de verdade
  já vive em `Mints.sol`, que já tinha sido lida numa rodada anterior
  (registrado em `deep-read-log.json` antes desta rodada) — não há lógica
  nova aqui além da checagem de tamanho de array
  (`MismatchedLengthTokenAndTokenMintAuthorities`) entre
  `supportedTokens_` e `tokenMintAuthorities_`, que está correta. Nenhuma
  falha encontrada.

`deep-read-log.json` atualizado (agora 5 arquivos em `evm-cpn-contracts`,
10 em `evm-gateway-contracts`). Nenhum item novo adicionado à fila —
resultado normal desta rodada. Sugestão pra próxima rodada: `src/lib/
AttestationLib.sol`/`src/lib/BurnIntentLib.sol` de `evm-gateway-contracts`
(verificação de assinatura EIP-712 dos intents de burn/mint — nunca lidos,
é onde uma falha de verificação de assinatura teria mais impacto) ou
`evm-xreserve-contracts` (só 2 arquivos lidos até agora, superfície ainda
pouco coberta).

## Rodada 2026-08-29 (push automático seguinte) — fila vazia, seguindo a sugestão da rodada anterior (`NoValidationAttestationLib` + `AttestationLib`)

Fila sem itens `pending` no início. Puxei o fio deixado pela rodada
anterior: `evm-xreserve-contracts/src/lib/NoValidationAttestationLib.sol`
(nunca lida como arquivo isolado, embora seu uso dentro de `Withdrawal.sol`
já tivesse sido comentado de passagem antes) chamou atenção justamente
pelo nome/comentário — "Identical to Gateway's AttestationLib but skips
validation for gas optimization... Only use this when the attestation
payload has already been validated (e.g., by gatewayMint)". Uma lib que
pula validação estrutural/assinatura sob uma suposição implícita é
exatamente o tipo de coisa que merece ceticismo genuíno, não aceitar o
comentário de cara. Virou item novo em `queue.jsonl`
(`ai_deep_read_finding`) e investiguei na mesma rodada.

Arquivos lidos (2 novos, clonados publicamente via `git clone` — um em
cada um dos dois repositórios do programa):
- `evm-xreserve-contracts/src/lib/NoValidationAttestationLib.sol`
- `evm-gateway-contracts/src/lib/AttestationLib.sol` (a versão validada,
  pra comparar campo a campo)

Rastreei a cadeia cruzando os dois repositórios: `Withdrawal.sol::withdraw()`
passa a MESMA variável `attestationPayload` (bytes calldata, não mutada)
primeiro pra `gatewayMint()` (que chama `_verifyAttestationSignature` —
assinatura ECDSA sobre `keccak256(attestation)` dos bytes brutos completos,
não uma reencodificação — e só depois `AttestationLib.cursor()`, que
reverte se a estrutura/magic number não bater) e só DEPOIS reparseia os
mesmos bytes com `NoValidationAttestationLib`. Comparei os offsets/lógica
de slicing das duas libs: idênticos (mesmas constantes de
`Attestations.sol`), a única diferença é que a versão sem validação não
rejeita magic number desconhecido — inofensivo aqui porque o payload já
passou pela checagem estrita antes de chegar nesse ponto. Confirmei também
(grep) que `NoValidationAttestationLib` só é usada por `Withdrawal.sol`,
não há caminho alternativo que a chame sem passar por `gatewayMint` antes.
**Verdict: falso_positivo, confidence alta** — suspeita legítima pelo
nome/comentário do arquivo, mas a precondição que o próprio comentário
exige é genuinamente garantida pelo único call site existente. Reforça
(com verificação byte-a-byte desta vez, não só inferência) a conclusão já
registrada sobre `Withdrawal.sol` numa rodada anterior.

`deep-read-log.json` atualizado (`evm-xreserve-contracts` agora com 3
arquivos, `evm-gateway-contracts` com 11). Nenhum relatório escrito
(verdict falso_positivo). `BurnIntentLib.sol` (verificação EIP-712 de burn
intents) segue como sugestão pendente pra uma rodada futura — não coberta
ainda.

## Rodada — fila vazia, leitura profunda no BurnIntentLib pendente (2026-08-29)
`queue.jsonl` sem `pending` (35/35 revisados). Cobri a sugestão deixada na
rodada anterior: cloneu `circlefin/evm-gateway-contracts` (branch master)
e `circlefin/evm-cpn-contracts` (branch main) via `git clone` público pra
localizar `BurnIntentLib.sol` (estava em `evm-gateway-contracts/src/lib/`,
não em `evm-cpn-contracts`).

Lidos (3 novos, todos crypto/EIP-712, escopo `evm-gateway-contracts`):
1. `src/lib/BurnIntentLib.sol` — encode/validate/hash de `BurnIntent` e
   `BurnIntentSet`. Validação estrutural (magic number, comprimento
   declarado vs real, bounds por elemento em sets) segue o mesmo padrão já
   auditado em `AttestationLib.sol`. `getTypedDataHash`/
   `_getBurnIntentTypedDataHash` montam o hash EIP-712 via assembly
   (`BURN_INTENT_TYPEHASH` + campos + hash do `TransferSpec` aninhado).
2. `src/lib/BurnIntents.sol` — definição de struct/typehash/offsets. Os
   typehashes (`BURN_INTENT_TYPEHASH`, `BURN_INTENT_SET_TYPEHASH`) batem
   com a assinatura de campos comentada no arquivo (conferi a ordem dos
   campos manualmente, sem recomputar o keccak256 — não executei nada).
3. `src/lib/TransferSpecLib.sol` — a lib de mais baixo nível, usada tanto
   por `AttestationLib` quanto por `BurnIntentLib`. `getTypedDataHash`
   usa assembly com `staticcall` ao precompile de identidade (endereço
   `4`) pra copiar 320 bytes de campos contíguos da view de memória
   direto pro buffer de hash — eficiente, mas incomum o bastante pra
   merecer ceticismo. Verifiquei: o ponteiro de memória livre
   (`mload(0x40)`) nunca é avançado após os `mstore`/`staticcall`, mas
   isso é seguro aqui porque o buffer é consumido pelo `keccak256` dentro
   do mesmo bloco assembly, antes de qualquer outro código Solidity rodar
   — não há corrupção de estado porque nada mais reutiliza essa região de
   memória "não reservada" antes do hash já ter sido calculado e copiado
   pro retorno.

Também conferi (grep em `Burns.sol`, já lido antes) que `maxBlockHeight`
do burn intent É checado contra `block.number` antes de honrar o burn
(`IntentExpiredAtIndex` se expirado) — não há brecha de replay óbvia por
esse ângulo.

Nenhum achado. `deep-read-log.json` atualizado com os 3 arquivos novos de
`evm-gateway-contracts` (agora 14 arquivos cobertos nesse alvo).

## Rodada 2026-08-29 (rotina automática seguinte) — fila vazia, 3 arquivos novos, sem achado

Fila (`queue.jsonl`) sem itens `pending`. Leitura profunda proativa desta
rodada: 3 arquivos ainda não cobertos em `deep-read-log.json`, priorizando
os que faltavam nos alvos Solidity de `targets-solidity.mjs` (contrato real,
não interface):

1. `evm-gateway-contracts/src/modules/common/TokenSupport.sol` — módulo de
   lista de tokens suportados. `addSupportedToken` é `onlyOwner`,
   irreversível por design (documentado no próprio comentário — "once
   supported, tokens cannot be un-supported"). Sem gap de controle de
   acesso.
2. `evm-cctp-contracts/src/v2/TokenMinterV2.sol` — a versão V2 de `mint()`
   divide o mint entre dois destinatários (`recipientOne`/`recipientTwo`,
   padrão de fee split do CCTP V2). Comparei com `TokenMinter.sol` (v1,
   já lido antes): nem v1 nem v2 aplicam rate-limit (`onlyWithinBurnLimit`)
   no mint — só `burn()` tem esse limite. Isso é consistente entre as
   duas versões, não é uma regressão introduzida pela V2: o modelo de
   confiança é `onlyLocalTokenMessenger` (só o TokenMessenger, depois de
   validar a mensagem cross-chain assinada, pode chamar mint). Não
   persegui mais fundo se `TokenMessengerV2`/`BaseTokenMessenger` derivam
   `amountOne`/`amountTwo` corretamente da mensagem atestada — isso fica
   como ponto em aberto pra rodada futura (esses dois arquivos já estão
   em `deep-read-log.json`, mas vale reler com este ângulo específico:
   "o split de valor é derivado só de dado assinado, ou existe algum
   argumento não-atestado que influencia `amountOne+amountTwo`?").
3. `buidl-wallet-contracts/src/paymaster/v1/permissioned/SponsorPaymaster.sol`
   — paymaster ERC-4337 que exige assinatura de um "verifying signer"
   (offchain, controlado pela Circle) autorizado via `EnumerableSet`
   gerenciado por `onlyOwner`. `getHash` inclui `block.chainid` e
   `address(this)` (domain separation correta), `parsePaymasterAndData`
   faz slicing de calldata com offsets fixos consistentes com o comentário
   do formato. Usa `ECDSA.tryRecover` (não reverte em assinatura
   inválida, retorna `SIG_VALIDATION_FAILED` corretamente em vez de
   travar). Sem achado.

Nenhum achado novo nesta rodada. `deep-read-log.json` atualizado com os 3
arquivos.

## Rodada 2026-08-29 (follow-up do ponto em aberto da rodada anterior) — fila vazia, sem achado

Fila (`queue.jsonl`) sem itens `pending`. Esta rodada fechou o ponto que a
rodada anterior deixou explicitamente em aberto: "o split de valor
(`amountOne`/`amountTwo`) em `TokenMinterV2.mint()` é derivado só de dado
atestado, ou existe algum argumento não-atestado que influencia o total
mintado?"

Rastreei a cadeia completa a partir de `TokenMessengerV2.handleReceive*Message`
(únicos pontos de entrada de mint, gated por `onlyLocalMessageTransmitter` +
`onlyRemoteTokenMessenger`, ambos exigindo que a mensagem já tenha passado
pela verificação de atestação no `MessageTransmitter`):

1. `src/v2/TokenMessengerV2.sol` — `_handleReceiveMessage` chama
   `_validatedReceivedMessage(_msg)`, que extrai `_amount` e `_fee`
   exclusivamente via `_msg._getAmount()` / `_msg._getFeeExecuted()` — campos
   do próprio `BurnMessageV2` já atestado (assinado off-chain e verificado
   pelo `MessageTransmitter` antes de chegar aqui). Valida
   `_fee < _amount` e `_fee <= _msg._getMaxFee()` (maxFee também é campo
   atestado, fixado pelo depositante no domínio de origem em
   `depositForBurn`/`depositForBurnWithHook`). Em seguida chama
   `_mintAndWithdraw(_remoteDomain, _burnToken, _mintRecipient, _amount - _fee, _fee)`
   — `_mintRecipient` também vem só do campo atestado da mensagem
   (`_getMintRecipient().toAddress()`), nunca de um argumento de chamada
   separado controlável por quem invoca `handleReceiveFinalizedMessage`.
2. `src/v2/BaseTokenMessenger.sol` — `_mintAndWithdraw` passa
   `_amount` (destinatário: `_mintRecipient`, do campo atestado) e `_fee`
   (destinatário: `feeRecipient`, endereço de governança setado via
   `onlyOwner`, nunca vindo da mensagem) direto pro `ITokenMinterV2.mint(...)`
   já lido na rodada anterior. Nenhum dos dois "lados" do split é derivado de
   dado não-atestado — `amountOne = amount - fee` e `amountTwo = fee`, ambos
   funções puras dos campos assinados da mensagem.
3. `src/messages/v2/BurnMessageV2.sol` — confirma o layout de bytes fixo do
   formato (`amount` no índice 68, `maxFee` no 132, `feeExecuted` no 164),
   sem campo dinâmico antes desses que pudesse deslocar a leitura.

Conclusão: **sem achado** — o ponto em aberto está fechado. O split de mint
em `TokenMinterV2`/`TokenMessengerV2` não introduz superfície de ataque nova
em relação ao v1; `feeRecipient` é confiável por design (governança), e
`amount`/`fee`/`mintRecipient` são todos campos atestados, verificados contra
`maxFee` também atestado. `deep-read-log.json` atualizado com os 3 arquivos
novos (`TokenMessengerV2.sol`, `BaseTokenMessenger.sol`, `BurnMessageV2.sol`)
em `circlefin/evm-cctp-contracts`.

## Rodada 2026-08-29 (leitura profunda em TokenMessenger v1, Denylistable e SingleOwnerMSCA) — fila vazia, sem achado

`queue.jsonl` sem `pending` (35/35 revisados). Leitura profunda proativa:
listei via `git ls-tree` (clone raso local) os arquivos `.sol` de todos os
alvos `targets-solidity.mjs` ainda não lidos com auth/owner/role/access/
admin/permission/control no caminho, e escolhi os 3 mais relevantes por
serem código de produção (não `test/`) ainda em aberto:

1. `evm-cctp-contracts/src/TokenMessenger.sol` — o `TokenMessenger` v1
   (a versão v2 já tinha sido lida em rodada anterior, mas o v1 nunca
   tinha sido aberto diretamente, só citado por comparação). Mesmo padrão
   de controle de acesso do v2: `handleReceiveMessage` gated por
   `onlyLocalMessageTransmitter` + `onlyRemoteTokenMessenger`;
   `addRemoteTokenMessenger`/`removeRemoteTokenMessenger`/`addLocalMinter`/
   `removeLocalMinter` são `onlyOwner`. Único ponto que vale nota:
   `replaceDepositForBurn` deriva `_originalMsgSender` diretamente dos
   bytes de `originalMessage` fornecidos pelo chamador (não de storage) e
   exige `msg.sender == _originalMsgSender` — à primeira vista pareceria
   forjável (qualquer um poderia montar um `originalMessage` com o próprio
   endereço como sender), mas a segurança real vem de
   `localMessageTransmitter.replaceMessage(originalMessage, originalAttestation, ...)`
   exigir uma attestation válida (assinatura off-chain dos signers da
   Circle) sobre esse exato `originalMessage` — sem attestation real
   não há como passar. Padrão já confiável, documentado, não é bug novo.
2. `evm-cctp-contracts/src/roles/v2/Denylistable.sol` — controle de
   denylist padrão (`onlyDenylister` separado de `onlyOwner`, que só o
   Owner pode trocar via `updateDenylister`). `notDenylistedCallers`
   checa `msg.sender` e, se diferente, `tx.origin` — padrão idêntico ao
   usado no FiatToken real da Circle. Sem gap.
3. `buidl-wallet-contracts/src/msca/6900/v0.7/account/semi/SingleOwnerMSCA.sol`
   — a carteira ERC-4337 de dono único. Rastreei
   `_authenticateAndAuthorizeUserOp` (o validador de UserOperation, o
   ponto mais crítico de autorização — controla quem pode mover fundos
   da carteira): quando `owner != address(0)`, a validação ignora
   completamente o `userOpValidationFunction` configurado por seletor e
   valida só a assinatura do `owner` sobre `userOpHash` (via
   `SignatureChecker.isValidSignatureNow`) — isso é intencional (dono
   único assina qualquer chamada, independente do seletor), documentado
   pelo próprio padrão de outras carteiras 6900 já lidas nesta missão
   (`SponsorPaymaster`, `WeightedWebauthnMultisigPlugin`). Os pre-hooks
   por seletor (`_processPreUserOpValidationHooks`) continuam rodando
   independente do modo de validação, então não há bypass de hook.
   `_processPreRuntimeHooksAndValidation` (caminho de chamada direta, não
   via EntryPoint) exige `msg.sender == owner || msg.sender ==
   address(this)` — sem gap. `isValidSignature` (EIP-1271) usa
   `getReplaySafeMessageHash` (domain separation por `address(this)`)
   antes de checar a assinatura — protege contra replay cross-account.
   Sem achado.

Conclusão: nenhum achado novo. `deep-read-log.json` atualizado com os 3
arquivos (2 em `circlefin/evm-cctp-contracts`, 1 em
`circlefin/buidl-wallet-contracts`). Resultado normal — a maioria das
rodadas não acha nada.

## Rodada (2026-08-29, disparada por push) — fila vazia, leitura profunda em
   buidl-wallet-contracts (núcleo de conta ERC-4337/6900, não-MSCA e MSCA)
Fila com 0 pendentes (35/35 revisados). Escolhi 3 arquivos ainda não lidos
do `buidl-wallet-contracts`, priorizando o núcleo de autenticação/execução
que ainda faltava (`account/`, `managers/`) em vez de mais plugins:
1. `src/account/v1/ECDSAAccount.sol` — conta não-MSCA de dono único
   (EOA). `_validateSignature` (caminho ERC-4337 via EntryPoint) e
   `isValidSignature` (EIP-1271, com `getReplaySafeMessageHash` pra evitar
   replay cross-account) checam a assinatura contra `owner()` via
   `SignatureChecker.isValidSignatureNow` — sem gap. `_authorizeUpgrade`
   (UUPS) tem `onlyOwner`. Sem achado.
2. `src/msca/6900/v0.7/account/BaseMSCA.sol` — o contrato-base de toda
   conta MSCA (6900), o coração do roteamento de autorização: `fallback`
   só pula `_processPreRuntimeHooksAndValidation` quando
   `msg.sender == address(ENTRY_POINT)` (correto — EntryPoint já validou
   via `validateUserOp`/`userOpValidationFunction` antes de chamar);
   chamada direta de qualquer outro endereço (inclusive self-call) sempre
   passa pelos hooks de runtime validation. `onlyFromEntryPointOrSelf`
   (usado em `withdrawDepositTo`) checa `msg.sender` contra
   `address(ENTRY_POINT)` ou `address(this)` — sem gap.
   `_authenticateAndAuthorizeUserOp` roda os pre-hooks antes da função de
   validação principal e reverte se `unpackedValidationData.authorizer`
   vier fora de `{address(0), address(1)}` — sem bypass óbvio.
3. `src/msca/6900/v0.7/managers/PluginExecutor.sol` — a lib que implementa
   `executeFromPlugin`/`executeFromPluginToExternal`, os dois pontos que
   `BaseMSCA` expõe SEM nenhum modifier de acesso próprio (a função
   externa em si não tem `onlyPlugin` ou equivalente). Confirmei que o
   controle de acesso real está dentro da lib: `executeFromPlugin` checa
   `walletStorage.permittedPluginCalls[msg.sender][selector]` — como
   `msg.sender` aqui é necessariamente quem chamou a função externa
   diretamente (não é spoofável via delegatecall, a MSCA não faz
   delegatecall pra dentro dessas funções), só um plugin já instalado E
   explicitamente permitido pra aquele seletor passa. Mesmo padrão em
   `executeFromPluginToExternal` (`permittedExternalCalls[callingPlugin][target]`
   + bloqueio de chamar `address(this)` ou outro plugin via
   `ERC165Checker.supportsInterface(target, type(IPlugin).interfaceId)`).
   Não verifiquei se `uninstallPlugin` (em `PluginManager.sol`, ainda não
   lido) de fato limpa `permittedPluginCalls`/`permittedExternalCalls` ao
   desinstalar — ponto em aberto pra próxima rodada, mas não é evidência
   de bug, só um gap de cobertura de leitura.

Conclusão: nenhum achado novo. Código consistente com o padrão de

## Rodada 2026-08-29 (máquina de estados v2, push automático) — fila vazia, sem candidato novo em Circle BBP

`queue.jsonl` sem itens `pending`. `corroborated_static::Withdrawals.sol`
(denylist gap) foi revisitado: nova tentativa de PoC Foundry, mesmo
bloqueio de rede já documentado (`foundry.paradigm.xyz` e RPC público
ambos 403 no agent-proxy desta sessão) — `record-validation` com
`not_applicable` e reasoning atualizado; transição pra `reproduced_local`
recusada corretamente pela máquina de estados, achado permanece
`corroborated_static`.

Leitura profunda proativa desta rodada fechou o ponto em aberto deixado há
várias rodadas em `buidl-wallet-contracts` (sugestão da rodada de
`PluginExecutor.sol`): "não verifiquei se `uninstallPlugin` (em
`PluginManager.sol`) de fato limpa `permittedPluginCalls`/
`permittedExternalCalls` ao desinstalar". Cloneado `circlefin/buidl-wallet-contracts`
via `git clone --depth 1` e lido `src/msca/6900/v0.7/managers/PluginManager.sol`
por completo — **confirmado que sim**: a função `uninstall()` (linha 310)
limpa explicitamente `permittedExternalCalls[plugin][...].addressPermitted`/
`.anySelector`/`.selectors[...]` (linhas 350-365) e
`permittedPluginCalls[plugin][selector] = false` para cada seletor do
manifest (linhas 371-374), na ordem inversa da instalação, antes de
`delete storageLayout.pluginDetails[plugin]`. Sem gap — ponto em aberto
fechado, sem achado novo.

`deep-read-log.json` atualizado (`circlefin/buidl-wallet-contracts` ganhou
`PluginManager.sol`). Nenhum item novo adicionado à fila nesta rodada.
referência ERC-6900 já visto nos outros contratos deste repo
(`SingleOwnerMSCA`, `SponsorPaymaster`, etc.) — controle de acesso via
`msg.sender` direto em todos os pontos checados, sem inconsistência entre
checagem e efeito. `deep-read-log.json` atualizado com os 3 arquivos.

## Rodada 2026-08-29 (push automático seguinte) — fila vazia, fechando o ponto em aberto de `PluginManager.sol`

`queue.jsonl` sem `pending`. Li `buidl-wallet-contracts/src/msca/6900/
v0.7/managers/PluginManager.sol` (nunca lido isoladamente antes),
justamente pra fechar o ponto que a rodada anterior deixou em aberto:
"`uninstallPlugin` de fato limpa `permittedPluginCalls`/
`permittedExternalCalls` ao desinstalar?".

Confirmado que sim: `uninstall()` reconstrói o `pluginManifest` (do
parâmetro `config` ou, se vazio, chamando `IPlugin(plugin).pluginManifest()`
de novo) e primeiro valida que `keccak256(abi.encode(pluginManifest))`
bate com o hash gravado no install — ou seja, não dá pra passar um
manifest diferente/menor pra escapar de limpar alguma permissão que foi
concedida de fato. Com o hash validado, o loop de uninstall zera
`permittedPluginCalls[plugin][selector]` pra cada seletor do manifest e
`permittedExternalCalls[plugin][addr].addressPermitted`/`.anySelector`/
`.selectors[...]` pra cada external call permitido, espelhando exatamente
o que o `install()` setou. Sem gap — ponto fechado, sem achado.

`install()`/`uninstall()` em si só têm o modifier `onlyDelegated` (exige
`address(this) != SELF`, i.e., só roda via delegatecall a partir da conta,
nunca chamando a lib diretamente) — a autorização de QUEM pode disparar
esse delegatecall (dono/self) já tinha sido validada em rodada anterior
dentro de `BaseMSCA`/`SingleOwnerMSCA` (`_authenticateAndAuthorizeUserOp`,
`onlyFromEntryPointOrSelf`), então a cadeia de autorização completa (quem
pode instalar/desinstalar → o que fica limpo ao desinstalar) está fechada
sem lacuna encontrada.

Também li, no mesmo orçamento de 3 arquivos, dois pontos de
`vercel/flags` sem relação com este programa (`sdk-keys.ts` — só parsing
de string, `isValidSdkKey` nem é usado em lugar nenhum além da própria
função irmã; `spec-extension/cookies.ts` — re-export puro de
`@edge-runtime/cookies`, zero lógica própria); ver NOTES.md do Vercel
Open Source. `deep-read-log.json` atualizado com o arquivo de
`buidl-wallet-contracts`. Nenhum item novo na fila — resultado normal.

## Rodada 2026-08-29 (rotina automática, fila vazia) — `Attestable.sol`/`DomainManageable.sol` de `evm-xreserve-contracts`

`queue.jsonl` sem itens `pending` no início desta rodada. Clonado
`circlefin/evm-xreserve-contracts` via `git clone --depth 1` (público, sem
conta/token) — alvo com poucos arquivos cobertos em `deep-read-log.json`
até agora (só `Withdrawal.sol`/`Blocklistable.sol`/
`NoValidationAttestationLib.sol`/`TokenSupport.sol`). Escolhi o módulo de
verificação multi-assinatura de attesters (`Attestable.sol`, nunca lido
neste repo — diferente do `Attestable.sol` já auditado em
`evm-cctp-contracts`, é uma implementação própria e mais sofisticada,
com transição gradual de threshold/attesters), por ser a superfície de
maior valor (verificação de assinatura ERC-1271) ainda não coberta neste
alvo especificamente.

2 arquivos lidos por completo:
- `src/modules/remote-domain-depositor/Attestable.sol` — multisig
  m-de-n de attesters com "dual-validity" durante transição de
  configuração (threshold ou remoção de attester tem um delay em blocos
  onde config antiga E nova continuam válidas). Rastreei
  `_isValidSignatureHelper` com ceticismo específico sobre 3 pontos
  clássicos de bug em verificação multi-assinatura: (1) contagem exata de
  assinaturas — `numSignatures` deve bater EXATAMENTE com o threshold
  ativo (corrente ou anterior durante o delay), não `>=`, então não dá
  pra inflar o número de assinaturas pra colar num dos dois thresholds
  válidos por acidente; (2) ordem estritamente crescente de endereço
  recuperado (`_recoveredAttester <= _latestAttesterAddress` rejeita),
  que previne duplicata de assinatura da mesma chave contando como dois
  attesters distintos — inclusive o caso de `ECDSA.recover` retornar
  `address(0)` em assinatura malformada é pego por essa mesma checagem
  (0 <= 0); (3) o "grace period" de attester sendo desabilitado
  (`attestersValidUntilBlock`) é limpo corretamente por `_enableAttester`
  se o mesmo attester for reabilitado antes do delay expirar (`delete`
  explícito). `_validateSignatureThreshold` impede threshold acima do
  número de attesters persistentes E abaixo do mínimo (`MIN_SIGNATURE_THRESHOLD
  = 2`). Nenhuma falha de lógica encontrada — design bem comentado e
  consistente com o padrão já validado em outras libs de attestation
  desta missão.
- `src/modules/remote-domain-depositor/DomainManageable.sol` — lido como
  suporte, porque `Attestable` herda dele para os modifiers
  `onlyDomainManager`/`onlyOwner` usados em `enableAttester`/
  `disableAttester`/`setSignatureThreshold`. `domainManager` só é
  alterável via `onlyOwner` (`updateDomainManager`); `domainPauser` via
  `onlyDomainManager` (`updateDomainPauser`) — hierarquia de papéis
  consistente (owner > domainManager > domainPauser), sem inversão. Sem
  achado.

Nenhum achado novo. `deep-read-log.json` atualizado (`evm-xreserve-contracts`
ganhou 2 arquivos, agora 6 no total). Sugestão pra próxima rodada:
`src/RemoteDomainDepositor.sol` (o contrato principal que orquestra
depósito cross-chain, ainda não lido neste alvo) ou revisitar o refund
flow multi-assinatura de `PaymentSettlementV2.sol` (`requireDestinationRefundSig`),
sinalizado há várias rodadas como merecendo uma segunda leitura mais
focada.

## Rodada 2026-08-29 (push automático seguinte, fila vazia) — fecha o ponto em aberto de `RemoteDomainDepositor.sol`/`DepositToRemote.sol` + `WithdrawalDelay.sol` + `Create2Factory.sol`

`queue.jsonl` sem `pending`. Segui a sugestão explícita deixada na rodada
anterior e li 4 arquivos (orçamento de 3 + 1 trivial de bônus):

- `evm-xreserve-contracts/src/RemoteDomainDepositor.sol` — o contrato
  principal, mas é só casca fina: `initialize()` (chama os inicializadores
  de `Attestable`/`DomainManageable`/`Ownable2Step`/`UUPSUpgradeable`) e
  `_authorizeUpgrade` com `onlyOwner`. Nenhuma lógica de negócio própria.
- `evm-xreserve-contracts/src/modules/x-reserve/DepositToRemote.sol` — a
  função `depositToRemote` de fato (`nonReentrant`, valida inputs —
  pausado global/por domínio, domínio remoto registrado, token suportado,
  blocklist, remote token registrado — depois `safeTransferFrom`, emite
  `DepositedToRemote` ANTES do external call, deposita no `GatewayWallet`,
  e só então dispara `IRemoteDomainHookExecutor.executeHook` se um
  executor estiver configurado pro domínio). Cadeia rastreada com foco em
  reentrância: `nonReentrant` cobre a função externa inteira, e tanto
  `remoteDomainDepositor` quanto `remoteDomainHookExecutor` só podem ser
  configurados por endereços administrativos (não são passados pelo
  chamador do depósito), então não há vetor de hook executor arbitrário
  controlado por atacante. Sem achado.
- `evm-gateway-contracts/src/modules/wallet/WithdrawalDelay.sol` — módulo
  isolado de delay de saque (storage EIP-7201). `updateWithdrawalDelay` é
  `onlyOwner` e é um parâmetro GLOBAL (não por usuário); testei a hipótese
  de uma corrida entre mudar o delay e uma retirada já iniciada — não
  existe, porque `withdrawableAtBlocks[token][depositor]` é gravado como
  um block number absoluto no momento do `initiate` (em `Withdrawals.sol`,
  já lido em rodada anterior), não recalculado dinamicamente a partir do
  delay atual em `_ensureWithdrawable`. Sem achado.
- `evm-cpn-contracts/src/factory/Create2Factory.sol` (bônus, fechava o
  último `.sol` não-teste do repo) — `deploy`/`deployAndMultiCall` ambos
  `onlyOwner` (`Ownable2Step`); `deployAndMultiCall` faz múltiplas
  chamadas ao contrato recém-implantado no mesmo tx, mas só o owner pode
  disparar, e falha de qualquer call individual reverte a transação
  inteira (bubble do erro original via assembly). Sem achado.

Nenhum achado novo nesta rodada. `deep-read-log.json` atualizado (`evm-xreserve-contracts`
agora 8 arquivos, `evm-gateway-contracts` agora 16, `evm-cpn-contracts`
agora 6 — todos os `.sol` não-teste desse repo estão lidos). Sugestão pra
próxima rodada: revisitar o refund flow multi-assinatura de
`PaymentSettlementV2.sol` (`requireDestinationRefundSig`, ainda pendente
de segunda leitura focada há várias rodadas) ou `evm-gateway-contracts/
src/modules/wallet/Balances.sol`/`Batches.sol` (núcleo de contabilidade
da wallet, ainda não lidos isoladamente).

## Rodada seguinte (fila vazia) — sem achado
Fila continuava em 0 pendentes. Leitura profunda proativa em 3 arquivos
não lidos ainda, priorizando contratos principais/controle de acesso
ainda não cobertos isoladamente:
- `evm-xreserve-contracts/src/xReserve.sol` — contrato principal do
  x-reserve (herda `Withdrawal`+`Domain`, cuja lógica de fundo já tinha
  sido lida em rodadas anteriores). É bem fino: `initialize` só encadeia
  os inicializadores dos módulos; `_authorizeUpgrade` é `onlyOwner`
  (padrão UUPS correto); `updateDomainManager`/
  `setPersistentSignatureBufferDelay` são `onlyOwner`;
  `setUnlimitedAllowances` é deliberadamente pública (comentário no
  próprio código admite isso) mas só reaprova o `GatewayWallet` a gastar
  tokens PRÓPRIOS do próprio contrato — não move fundos de terceiros nem
  eleva privilégio. Sem achado.
- `evm-gateway-contracts/src/GatewayMinter.sol` — já constava no log
  (lido em rodada anterior); reli pra conferir: é só o `initialize` que
  encadeia `GatewayCommon`+`Mints` (ambos já auditados isoladamente, com
  o achado confirmado de denylist em `Withdrawals.sol` sendo do lado
  wallet, não minter). Sem achado novo.
- `evm-cctp-contracts/src/roles/Ownable.sol` +
  `src/roles/Ownable2Step.sol` — fork direto do OpenZeppelin (só mudou a
  versão do Solidity de 0.8→0.7.6 e removeu `renounceOwnership`); padrão
  two-step de transferência de ownership implementado corretamente
  (`_pendingOwner` é limpo em `_transferOwnership`, `acceptOwnership`
  confere `pendingOwner() == msg.sender`). Sem desvio do upstream, sem
  achado.

A sugestão da rodada anterior (refund flow de `PaymentSettlementV2.sol` e
`Balances.sol`/`Batches.sol` de `evm-gateway-contracts`) ainda não foi
atendida — continua como prioridade pra próxima rodada de leitura
profunda neste programa.

## Rodada 2026-08-29 (disparada por push, fila vazia) — `Balances.sol` (gateway), `MessageTransmitterV2.sol` (cctp), `StandardExecutor.sol` (buidl-wallet) — sem achado

`queue.jsonl` sem itens `pending` (36/36 revisados). Segui parte da
sugestão pendente da rodada anterior (`Balances.sol` do
`evm-gateway-contracts`) e completei o orçamento de 3 com dois arquivos
"núcleo" de alto valor ainda não lidos isoladamente em outros dois alvos
do mesmo programa (nenhum dos três tem auth/session/crypto/token/login/
password/admin/permission/access literalmente no nome, então priorizei
por criticidade real: contabilidade de fundos, verificação de attestation
cross-chain, e execução arbitrária de conta):

- `evm-gateway-contracts/src/modules/wallet/Balances.sol` — a lib de
  contabilidade interna (`availableBalances`/`withdrawingBalances`, EIP-7201)
  usada por `Deposits`/`Withdrawals`/`Burns`/`Mints`, todos já auditados
  antes. Ceticismo aplicado especificamente em `_moveBalanceToWithdrawing`
  (subtrai de `available` sem checagem explícita `value <= available` antes
  de subtrair) e `_reduceBalance` (prioriza `available` antes de
  `withdrawing`): ambas seguras porque Solidity `^0.8.29` reverte
  automaticamente em underflow (panic 0x11) — não há como um valor maior
  que o saldo disponível silenciosamente virar um número gigante. Nenhuma
  das duas tem gap de controle de acesso próprio (são `internal`, só
  chamadas pelos módulos que já fazem a checagem de autorização/denylist
  na função externa — exceto o gap já confirmado e reportado em
  `Withdrawals.sol`, que é anterior a esta lib, não nela). Sem achado novo.
- `evm-cctp-contracts/src/v2/MessageTransmitterV2.sol` — o contrato
  concreto (não só a base `BaseMessageTransmitter` já lida antes) que
  implementa `sendMessage`/`receiveMessage`/`_validateReceivedMessage` pro
  CCTP V2. Confirmei a mesma ordem de checagens já validada na V1
  (`Attestable`/`MessageTransmitter`): assinaturas → formato → domínio de
  destino → `destinationCaller` (só exige `msg.sender` bater se o campo for
  não-zero, comportamento documentado, não um gap) → versão → nonce não
  usado, e o nonce é marcado como usado (`usedNonces[_nonce] = NONCE_USED`)
  ANTES de chamar `IMessageHandlerV2(_recipient).handleReceive*Message`
  (padrão CEI correto, sem reentrância de replay de nonce). `initialize()`
  reivindica o nonce zero (`usedNonces[bytes32(0)] = NONCE_USED`) de
  propósito, consistente com o padrão da V1. Sem achado.
- `buidl-wallet-contracts/src/msca/6900/v0.7/managers/StandardExecutor.sol`
  — a lib que implementa de fato `execute`/`executeBatch` (chamada
  arbitrária a partir da conta MSCA). Não tem controle de acesso próprio
  (é `internal`, sem modifier) — confirma o design já validado em rodada
  anterior (`BaseMSCA.sol`): a autorização de quem pode disparar `execute`
  vive inteiramente na função externa que embrulha esta lib (via
  `_authenticateAndAuthorizeUserOp`/`onlyFromEntryPointOrSelf`), não aqui.
  O único controle nesta lib é `TargetIsPlugin` — reverte se `target`
  responde `supportsInterface(IPlugin)` como true, forçando chamadas a
  plugins a passar pelo caminho `PluginExecutor` (com checagem de
  `permittedExternalCalls`) em vez de `execute` direto. Considerei se um
  plugin malicioso que não implementa ERC165 corretamente poderia escapar
  dessa checagem e ser chamado via `execute` sem hooks — sim, tecnicamente,
  mas só instalar esse plugin já exige autorização de owner/self (mesma
  cadeia de autorização de instalação já validada em rodada anterior via
  `PluginManager.sol`), então não é um vetor de escalada pra um atacante
  sem essa autorização prévia. Sem achado.

`deep-read-log.json` atualizado com os 3 arquivos. Nenhum item novo
adicionado à fila — resultado normal. A sugestão restante da rodada
anterior (refund flow multi-assinatura de `PaymentSettlementV2.sol`,
`requireDestinationRefundSig`) continua pendente — já sinalizada há várias
rodadas, candidata forte pra próxima.

## Rodada 2026-08-29 (push automático, máquina de estados v2) — refund flow revisitado, sem achado; Withdrawals.sol continua bloqueado por rede

Migração pro schema v2 (`system/bugbounty-scanner/state-machine.mjs` +
SQLite local) trouxe 3 findings herdados em `corroborated_static` e 1 em
`inconclusive` do schema antigo. Processados nesta rodada:

- **`set-token-uri` (StackingDAO, não deste programa)** — fechado como
  `false_positive` no novo schema (mesma conclusão já registrada há
  várias rodadas: inconsistência de código real, mas sem impacto
  financeiro elegível). Ver NOTES.md do StackingDAO.
- **`Withdrawals.sol::initiateWithdrawal/withdraw` (ausência de
  `notDenylisted`)** — tentei montar a PoC executável exigida pelo fluxo
  Solidity: `forge` não estava instalado, e tanto
  `curl -L https://foundry.paradigm.xyz` quanto o fork RPC público
  (`ethereum.publicnode.com`) retornaram CONNECT 403 do agent-proxy
  deste ambiente (bloqueio de política de egress desta sessão
  específica, mesmo padrão já visto antes com `api.hiro.so` no
  StackingDAO — confirmado via `$HTTPS_PROXY/__agentproxy/status`).
  Registrei a validação como `not_applicable` com o motivo real (não é
  limitação do tipo de achado — Solidity TEM validador definido no
  sistema — é limitação de rede desta sessão). A transição pra
  `reproduced_local` foi recusada corretamente pela máquina de estados;
  o finding permanece em `corroborated_static`, achado ainda válido e
  pendente de PoC real numa sessão com acesso de rede liberado.

**Revisitei a sugestão pendente há várias rodadas**: o fluxo de refund
multi-assinatura de `PaymentSettlementV2.sol` (`requireDestinationRefundSig`).
Desta vez consegui baixar o arquivo certo (branch `main`, não `master` —
o `raw.githubusercontent.com` com `master` devolvia 404; `git ls-remote`
confirmou que o branch padrão é `main`). Li `refund()` (linha 529),
`_validateRefund` (812), `_checkAndComputeCumulativeRefund` (929) e
`_applyRefundStateAndEmit` (949) linha a linha, com ceticismo ativo em
duas hipóteses:

1. **Será que dá pra pular a assinatura do incentive provider quando
   `requireDestinationRefundSig=true` mas o caso não é de incentivo
   (`isIncentiveCase=false`)?** Não — `incentiveCap` é sempre
   `payeeSettlementAmount - payerAmount`; se `isIncentiveCase` é falso,
   `incentiveCap` é 0, e `_checkAndComputeCumulativeRefund` reverte
   (`RefundExceedsCeiling`) se `incentiveProviderRefundAmount > 0`. Não
   há como extrair valor de incentivo sem que `isIncentiveCase` seja
   verdadeiro, então a checagem de assinatura correspondente sempre
   dispara quando há valor real em jogo.
2. **Os caps (`payerCap`/`incentiveCap`) usados pra validar o refund são
   recalculados a partir do `intent` passado pelo chamador — dá pra
   inflar artificialmente passando `payerAmount`/`payeeSettlementAmount`
   maiores que o pagamento original?** Não — `_validateRefund` (linha
   821-829) recalcula `recordHash` a partir dos campos do `intent` e
   exige que bata exatamente com `_paymentRecordHashes[nonce]` (gravado
   no `execute()` original, fora deste arquivo mas já confirmado em
   rodada anterior). Qualquer valor divergente do que foi de fato
   executado reverte com `InvalidPaymentRecord`.

`refund()` tem `nonReentrant` e usa Permit2 (`_pullViaPermit2`) com
checagem de saldo antes/depois (`InvalidAmount` se o valor recebido não
bater), então sem superfície de reentrância nem de "pull" que credite
menos do que o esperado. `onlyAttester` + `intent.attester ==
_msgSender()` mantém o attester como parte confiável do modelo (papel
permissionado, não atacante externo) — a ausência de assinatura do
payer quando `requireDestinationRefundSig=false` é decisão de design
explícita do protocolo, não uma falha de autorização.

**Sem achado.** Considero esta sugestão pendente FECHADA — não vou
mais sinalizá-la como prioridade pra próximas rodadas, a menos que
surja um ângulo novo. `deep-read-log.json` não precisou de entrada nova
(o arquivo já constava da rodada anterior; esta foi uma releitura mais
profunda e cética do mesmo arquivo, focada especificamente no fluxo que
tinha ficado pendente).
