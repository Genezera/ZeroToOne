// Lista de repositórios JS/TS acompanhados (programas hospedados na
// HackerOne). Começando pequeno e deliberado: um repo só, escolhido por
// ser real, ativo, de tamanho administrável e com popularidade moderada
// (menos escrutinado que next.js/turborepo/vercel-cli, que já têm anos de
// revisão por uma comunidade enorme). Ver research/bugbounty/vercel-open-source/NOTES.md.

export const JS_TARGETS = [
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
];
