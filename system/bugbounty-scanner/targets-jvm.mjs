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

// Curadoria manual ATIVA (02/09/2026) -- primeiro alvo JVM real desde a
// pausa do Block Open Source acima. JVM_TARGETS estava vazio (README.md/
// IMPLEMENTATION_STATE.md, achado nesta mesma sessão): os 4 alvos pausados
// são todos Block Open Source, e nenhum dos 13 alvos auto-promovidos até
// agora é JVM (todos Go -- a rotação semanal de discover-targets.mjs
// ainda não tinha chegado num candidato JVM elegível). Achado varrendo o
// dataset inteiro (195 candidatos) por heurística de nome de repo
// (android/kotlin/java/spring/gradle) em vez de esperar a rotação normal
// -- 3 candidatos novos genuínos apareceram (tronprotocol/java-tron,
// plaid/plaid-link-android, auth0/auth0-java); os outros 2 com nome
// sugestivo já eram conhecidos (afterpay/cashapp, Block Open Source,
// banidos). `tronprotocol/java-tron` descartado por tamanho (214MB,
// monorepo de nó de blockchain inteiro -- precisaria de pathPrefixes
// curados como misk/wire, não é ganho rápido). `auth0/auth0-java`
// escolhido: 10,4MB (cabe sem pathPrefix), 320 estrelas, push HOJE
// (manutenção ativa de verdade), programa Bugcrowd com maxPayoutUsd
// confirmado no dataset (US$50.000 — teto do PROGRAMA, não confirmado
// por ativo específico ainda). Confirmado ao vivo como alvo real:
// "Auth0 Java SDK (auth0-java)" é um dos 25 ativos listados em escopo
// (research/bugbounty/scope-snapshots/auth0-by-okta.json,
// confidence "low" -- Bugcrowd não expõe elegibilidade de bounty por
// ativo no dataset público, precisa confirmação manual na página oficial
// antes de qualquer achado real chegar a human_ready).
export const JVM_TARGETS_MANUAL = [
  {
    program: 'Auth0 by Okta',
    platform: 'Bugcrowd',
    owner: 'auth0',
    repo: 'auth0-java',
    branch: 'master',
    maxBountyUsd: 50000,
    pathPrefixes: [],
  },
];

export const JVM_TARGETS = [...JVM_TARGETS_MANUAL, ...AUTO_PROMOTED_TARGETS.filter((t) => t.language === 'jvm')];
