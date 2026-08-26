// Lista de contratos acompanhados. Adicionar mais programas/contratos
// aqui conforme o trabalho avançar — não precisa mexer no resto do
// scanner.

export const TARGETS = [
  {
    program: 'StackingDAO',
    platform: 'Immunefi',
    maxBountyUsd: 100000,
    deployer: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG',
    contracts: [
      'dao', 'stx-reserve-v2', 'stbtc-reserve', 'ststx-token', 'stbtc-token',
      'signer-admin-v1', 'data-stx-v2', 'data-stbtc-v1',
      'stacking-dao-core-btc-v3', 'stacking-dao-core-ststxbtc-v1',
      'stacker-1', 'stacker-2', 'stacker-3',
    ],
  },
];
