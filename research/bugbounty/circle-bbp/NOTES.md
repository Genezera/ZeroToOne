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
