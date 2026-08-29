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
