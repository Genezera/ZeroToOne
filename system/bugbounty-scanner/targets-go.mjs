// Repositórios Go do programa Block Open Source (Bugcrowd). Ver
// research/bugbounty/block-open-source/NOTES.md para o porquê da escolha.
//
// PAUSADO (31/08/2026): mesmo motivo documentado em targets-jvm.mjs — as
// regras do programa proíbem pesquisa assistida por IA, o que torna
// qualquer achado deste pipeline não-enviável. Export ativo vazio até
// revisitar essa decisão.
const _PAUSED_GO_TARGETS = [
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'cashapp',
    repo: 'hermit',
    branch: 'master',
    maxBountyUsd: 5000,
  },
];

export const GO_TARGETS = [];
