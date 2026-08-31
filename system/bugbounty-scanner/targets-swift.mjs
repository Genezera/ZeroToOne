import { AUTO_PROMOTED_TARGETS } from './targets-auto-promoted.mjs';

// Repositórios Swift/ObjC do programa Block Open Source (Bugcrowd). Ver
// research/bugbounty/block-open-source/NOTES.md para o porquê da escolha.
// Escopo restrito a Sources/ — exclui apps de demonstração/exemplo e
// testes, que não é código que roda no app de quem instala o SDK.
//
// PAUSADO (31/08/2026): mesmo motivo documentado em targets-jvm.mjs — as
// regras do programa proíbem pesquisa assistida por IA, o que torna
// qualquer achado deste pipeline não-enviável. Export ativo vazio até
// revisitar essa decisão. Reforçado desde então por program-policy.mjs
// (vale pra QUALQUER achado de "Block Open Source"). Isso é sobre esse
// programa, não sobre Swift como linguagem — um programa Swift novo e
// seguro continua entrando via AUTO_PROMOTED_TARGETS abaixo.
// Exportado (apesar do nome) só pra diffAgainstKnownTargets em
// discovery-runner.mjs saber que estes repos já são conhecidos e não
// sugeri-los de novo toda semana — nunca entra em SWIFT_TARGETS (scanning).
export const _PAUSED_SWIFT_TARGETS_MANUAL = [
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'afterpay',
    repo: 'sdk-ios',
    branch: 'master',
    maxBountyUsd: 5000,
    pathPrefixes: ['Sources/'],
  },
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'cashapp',
    repo: 'cash-app-pay-ios-sdk',
    branch: 'main',
    maxBountyUsd: 5000,
    pathPrefixes: ['Sources/'],
  },
];

export const SWIFT_TARGETS = AUTO_PROMOTED_TARGETS.filter((t) => t.language === 'swift');
