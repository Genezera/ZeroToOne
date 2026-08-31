import { AUTO_PROMOTED_TARGETS } from './targets-auto-promoted.mjs';

// Repositórios Go do programa Block Open Source (Bugcrowd). Ver
// research/bugbounty/block-open-source/NOTES.md para o porquê da escolha.
//
// PAUSADO (31/08/2026): mesmo motivo documentado em targets-jvm.mjs — as
// regras do programa proíbem pesquisa assistida por IA, o que torna
// qualquer achado deste pipeline não-enviável. Export ativo vazio até
// revisitar essa decisão. Reforçado desde então por program-policy.mjs
// (vale pra QUALQUER achado de "Block Open Source"). Isso é sobre esse
// programa, não sobre Go como linguagem — um programa Go novo e seguro
// continua entrando via AUTO_PROMOTED_TARGETS abaixo.
// Exportado (apesar do nome) só pra diffAgainstKnownTargets em
// discovery-runner.mjs saber que este repo já é conhecido e não
// sugeri-lo de novo toda semana — nunca entra em GO_TARGETS (scanning).
export const _PAUSED_GO_TARGETS_MANUAL = [
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'cashapp',
    repo: 'hermit',
    branch: 'master',
    maxBountyUsd: 5000,
  },
];

export const GO_TARGETS = AUTO_PROMOTED_TARGETS.filter((t) => t.language === 'go');
