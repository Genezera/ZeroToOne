// Lista de repositórios JS/TS acompanhados (programas hospedados na
// HackerOne). Começou pequeno e deliberado (um repo só), depois curado a
// partir da lista OFICIAL de escopo do programa Vercel Open Source (lida
// direto de hackerone.com/vercel-open-source, seção "Scope" — não do
// dataset heurístico de discover-targets.mjs, que só sugere candidato,
// nunca decide). Ver research/bugbounty/vercel-open-source/NOTES.md.
//
// A partir de 31/08/2026, some com o que promote-targets.mjs promoveu
// automaticamente de OUTROS programas JS/TS (ver targets-auto-promoted.mjs)
// — a lista abaixo continua 100% curada à mão, nunca misturada com a
// automática na mesma constante escrita aqui.

import { AUTO_PROMOTED_TARGETS } from './targets-auto-promoted.mjs';

// Exportado (era privado até 02/09/2026) -- discovery-runner.mjs precisa
// recombinar isto com uma leitura FRESCA de AUTO_PROMOTED_TARGETS depois
// da promoção da própria rodada (ver comentário grande em
// discovery-runner.mjs sobre por que os imports estáticos JS_TARGETS/
// GO_TARGETS/JVM_TARGETS ficam desatualizados dentro da mesma execução).
export const JS_TARGETS_MANUAL = [
  {
    program: 'Vercel Open Source',
    platform: 'HackerOne',
    owner: 'vercel',
    repo: 'flags',
    branch: 'main',
    maxBountyUsd: null, // escopo "critical" sem teto fixo publicado no dataset público
    // só o código da(s) biblioteca(s) publicada(s) (packages/) — exclui
    // apps/ (site de docs, playground) e examples/ (código de demonstração,
    // não é o que os usuários instalam/rodam em produção).
    pathPrefixes: ['packages/'],
  },
  {
    program: 'Vercel Open Source',
    platform: 'HackerOne',
    owner: 'vercel',
    repo: 'vercel',
    branch: 'main',
    maxBountyUsd: 10000, // Tier 1, Critical $5,250-$10,000 (lido ao vivo do programa)
    // Curadoria 2026-08-31: este é o alvo "Vercel CLI" formal do programa
    // (Tier 1) — GAP real que existia até agora: o repo nunca esteve no
    // JS_TARGETS, apesar de ser onde o achado manual do SSO
    // (packages/cli-auth/sso.ts) foi encontrado nesta mesma missão.
    // pathPrefixes restrito aos pacotes que são de fato "Vercel CLI" (o
    // foco declarado do programa: exposição de credencial/token, RCE via
    // config de projeto, path traversal em build/deploy, escalação entre
    // escopos de time/projeto) — exclui os dezenas de outros pacotes do
    // monorepo (adapters de framework como next/nuxt/remix/etc., que
    // pertencem a outras categorias de escopo do mesmo programa, não à
    // "Vercel CLI").
    pathPrefixes: ['packages/cli/', 'packages/cli-auth/', 'packages/cli-config/', 'packages/cli-exec/', 'packages/client/', 'packages/vc-native/'],
  },
  {
    program: 'Vercel Open Source',
    platform: 'HackerOne',
    owner: 'vercel-labs',
    repo: 'agent-skills',
    branch: 'main',
    maxBountyUsd: 10000, // Tier 1
    // Repo pequeno e de propósito único (skills oficiais da Vercel pra
    // Claude/outros agentes) — sem necessidade de pathPrefixes.
    pathPrefixes: [],
  },
  {
    program: 'Vercel Open Source',
    platform: 'HackerOne',
    owner: 'vercel-labs',
    repo: 'skills',
    branch: 'main',
    maxBountyUsd: 10000, // Tier 1 (CLI + registro de skills — foco declarado do programa: path traversal na instalação, injeção de escape de terminal via metadado, prompt injection em SKILL.md)
    pathPrefixes: [],
  },
];

export const JS_TARGETS = [...JS_TARGETS_MANUAL, ...AUTO_PROMOTED_TARGETS.filter((t) => t.language === 'js')];
