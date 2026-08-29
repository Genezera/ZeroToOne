// Repositórios Solidity do programa Circle BBP (Bug Bounty Program da
// Circle, emissora do USDC) — descoberto pelo módulo de descoberta
// automática de alvo (discover-targets.mjs), não curadoria manual do
// zero. Escolhidos entre os 15 repos do programa por serem contrato de
// verdade (Solidity), tamanho administrável, e cobrirem infraestrutura
// real de valor alto: CCTP (Cross-Chain Transfer Protocol, a ponte oficial
// de USDC entre chains), gateway, wallet, reserva cross-chain. Ver
// research/bugbounty/circle-bbp/NOTES.md.

export const SOLIDITY_TARGETS = [
  {
    program: 'Circle BBP',
    platform: 'HackerOne',
    owner: 'circlefin',
    repo: 'evm-cctp-contracts',
    branch: 'master',
    maxBountyUsd: null,
  },
  {
    program: 'Circle BBP',
    platform: 'HackerOne',
    owner: 'circlefin',
    repo: 'evm-gateway-contracts',
    branch: 'master',
    maxBountyUsd: null,
  },
  {
    program: 'Circle BBP',
    platform: 'HackerOne',
    owner: 'circlefin',
    repo: 'buidl-wallet-contracts',
    branch: 'master',
    maxBountyUsd: null,
  },
  {
    program: 'Circle BBP',
    platform: 'HackerOne',
    owner: 'circlefin',
    repo: 'evm-xreserve-contracts',
    branch: 'master',
    maxBountyUsd: null,
  },
  {
    program: 'Circle BBP',
    platform: 'HackerOne',
    owner: 'circlefin',
    repo: 'evm-cpn-contracts',
    branch: 'main',
    maxBountyUsd: null,
  },
];
