// Repositórios Solidity do programa Circle BBP (Bug Bounty Program da
// Circle, emissora do USDC) — descoberto pelo módulo de descoberta
// automática de alvo (discover-targets.mjs), não curadoria manual do
// zero. Escolhidos entre os 15 repos do programa por serem contrato de
// verdade (Solidity), tamanho administrável, e cobrirem infraestrutura
// real de valor alto: CCTP (Cross-Chain Transfer Protocol, a ponte oficial
// de USDC entre chains), gateway, wallet, reserva cross-chain. Ver
// research/bugbounty/circle-bbp/NOTES.md.
//
// A partir de 31/08/2026, some com o que promote-targets.mjs promoveu
// automaticamente de OUTROS programas Solidity (ver targets-auto-promoted.mjs)
// — a lista abaixo continua 100% curada à mão, nunca misturada com a
// automática na mesma constante escrita aqui.

import { AUTO_PROMOTED_TARGETS } from './targets-auto-promoted.mjs';

// Exportado (era privado até 02/09/2026) -- ver o mesmo comentário em
// targets-js.mjs sobre discovery-runner.mjs precisar recombinar isto
// com uma leitura fresca de AUTO_PROMOTED_TARGETS pós-promoção.
export const SOLIDITY_TARGETS_MANUAL = [
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

export const SOLIDITY_TARGETS = [...SOLIDITY_TARGETS_MANUAL, ...AUTO_PROMOTED_TARGETS.filter((t) => t.language === 'solidity')];
