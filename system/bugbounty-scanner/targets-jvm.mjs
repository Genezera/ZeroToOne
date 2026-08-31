import { AUTO_PROMOTED_TARGETS } from './targets-auto-promoted.mjs';

// Repositórios Kotlin/Java do programa Block Open Source (Bugcrowd). Ver
// research/bugbounty/block-open-source/NOTES.md para o porquê da escolha.
// misk e wire são monorepos grandes — escopo restrito aos módulos
// principais/mais relevantes para segurança (core, crypto, injeção de
// dependência, acesso a banco, runtime/schema de protobuf), não o repo
// inteiro.
//
// PAUSADO (31/08/2026): as regras do programa Bugcrowd do Block Open
// Source proíbem explicitamente pesquisa assistida por IA ("Do not use
// ChatGPT, Claude, DeepSeek, Google Gemini or any AI tools during your
// research"), com risco de "point reduction or program expulsion". Todo
// achado deste pipeline é, por definição, pesquisa assistida por IA —
// nenhum relatório resultante pode ser responsavelmente enviado. Lista
// mantida abaixo (não apagada) só como registro; export ativo fica
// vazio até essa decisão ser revisitada. Reforçado desde então por
// program-policy.mjs (bloqueio que vale pra QUALQUER achado de "Block
// Open Source", não só o que está listado aqui) — mas a pausa por
// arquivo continua, defesa em profundidade.
//
// Isso é sobre Block Open Source especificamente, não sobre JVM/Kotlin
// como linguagem — por isso o merge com AUTO_PROMOTED_TARGETS abaixo
// continua ativo: um programa JVM novo e seguro deve poder entrar.
// Exportado (apesar do nome) só pra diffAgainstKnownTargets em
// discovery-runner.mjs saber que estes repos já são conhecidos e não
// sugeri-los de novo toda semana — nunca entra em JVM_TARGETS (scanning).
export const _PAUSED_JVM_TARGETS_MANUAL = [
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'cashapp',
    repo: 'misk',
    branch: 'master',
    maxBountyUsd: 5000,
    pathPrefixes: ['misk/', 'misk-core/', 'misk-crypto/', 'misk-inject/', 'misk-hibernate/', 'misk-jdbc/'],
  },
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'square',
    repo: 'wire',
    branch: 'master',
    maxBountyUsd: 5000,
    pathPrefixes: ['wire-runtime/', 'wire-schema/', 'wire-compiler/'],
  },
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'afterpay',
    repo: 'sdk-android',
    branch: 'master',
    maxBountyUsd: 5000,
    pathPrefixes: ['afterpay/'],
  },
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'cashapp',
    repo: 'cash-app-pay-android-sdk',
    branch: 'main',
    maxBountyUsd: 5000,
    pathPrefixes: ['core/', 'ui-views/', 'ui-compose/', 'analytics-core/', 'logging/'],
  },
];

export const JVM_TARGETS = AUTO_PROMOTED_TARGETS.filter((t) => t.language === 'jvm');
