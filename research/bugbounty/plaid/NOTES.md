# Plaid (HackerOne) — notas de pesquisa

## Rodada 2026-09-03 (agente de nuvem) — primeira rodada, 48 candidatos refutados

Programa novo, descoberto pela rotação de discovery em 02/09/2026
(`discovery-metadata-seen.json`: `plaid/plaid-link-android`,
`plaid-link-ios`, `plaid-ruby`, `react-native-plaid-link-sdk`,
`react-plaid-link`). Ainda **sem scope snapshot capturado**
(`research/bugbounty/scope-snapshots/` não tem `plaid.json`) —
nenhum achado deste programa pode avançar até `scope_verified` ou
gerar rascunho de relatório enquanto isso não existir; `check-scope`
vai recusar. Próxima rodada: rodar
`capture-scope-snapshots.mjs`/`refresh-scope-live` pra Plaid antes de
tentar levar qualquer achado adiante.

Todos os 48 candidatos desta primeira rodada eram
`known_vulnerable_dependency` em `plaid/react-plaid-link/yarn.lock`
(um único componente React, `react-plaid-link`). Todos refutados como
falso-positivo com a mesma checagem objetiva: `package.json` real do
repo declara `"dependencies": {"prop-types": "^15.7.2"}` — **só isso**
é dependência de produção. Todos os 48 pacotes flagados (webpack-dev-
middleware, ws, uuid, @babel/traverse, etc.) estão exclusivamente em
`devDependencies` (Babel, Storybook, ESLint, Jest, Rollup, TypeScript —
ferramental de build/test/storybook). O campo `"files"` do pacote
publicado no npm (`dist`, `src`, `LICENSE`, `MIGRATION.md`) nunca
inclui `devDependencies`/`node_modules` — quem instala
`react-plaid-link` como consumidor nunca puxa essas dependências.
Padrão idêntico ao já visto antes neste sistema com
`kiwicom/js-iam-middleware` (yarn.lock com devDependency-only) —
mesma lição, mesma checagem via `package.json` real antes de
qualquer veredito.

Nenhuma leitura profunda proativa (fora da fila) foi feita neste
programa ainda — os outros repos Plaid descobertos (`plaid-link-
android`, `plaid-link-ios`, `plaid-ruby`, `react-native-plaid-link-
sdk`) não geraram candidato nesta rodada e não foram lidos.
