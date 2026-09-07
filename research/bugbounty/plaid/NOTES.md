# Plaid (HackerOne) — notas de pesquisa

## Rodada 2026-09-05 (push automático via GitHub webhook, sessão cloud)

Passo 0 confirmado (`program-policy.json` checado antes de qualquer
clone): `Block Open Source`/`Circle BBP`/`Auth0 by Okta` bloqueados,
nenhum repo desses tocado. `migrate-to-v2.mjs` + `list-pending`
global = 34 candidatos, 100% em programas bloqueados (30 Auth0 by
Okta, 4 Circle BBP) — nenhum tocado.

Leitura profunda proativa: `plaid/react-plaid-link` (ativo em
`STATUS.md`, nunca lido antes — 0 entradas em `deep-read-log.json`),
clone raso público. Priorizei os arquivos que de fato lidam com o
token OAuth/link (`usePlaidLink.ts`, `factory.ts`,
`PlaidEmbeddedLink.tsx`) e o hook de carregamento de script
(`react-script-hook/index.tsx`). Ceticismo genuíno, refutação
tentada: o wrapper é fino — todo o handling real de token/iframe/
postMessage vive no script proprietário da Plaid
(`cdn.plaid.com/link/v2/stable/link-initialize.js`, fora deste
repositório open-source e fora do meu escopo de leitura). Dentro
deste repo: `src` do `<script>` é sempre a constante
`PLAID_LINK_STABLE_URL` hardcoded (nunca input do consumidor/rede);
`renameKeyInObject` só copia chaves planas fixas (`publicKey`->`key`),
sem risco de prototype pollution; nenhum `dangerouslySetInnerHTML`/
`eval`/`Function()`. Nenhum achado — 4 arquivos fechados em
`deep-read-log.json`.

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

## Rodada 2026-09-03 (agente de nuvem, sessão 2) — fila vazia neste programa; leitura profunda proativa em `plaid-ruby`, sem achado novo

Nenhum `candidate` novo apareceu para Plaid nesta rodada (a fila geral
só tinha Slack/Mattermost, ver `research/bugbounty/slack/NOTES.md` e
`research/bugbounty/mattermost/NOTES.md`, já triados por uma sessão
paralela). Escolhido `plaid/plaid-ruby` para leitura profunda proativa
por ser o único repo Plaid com lógica de cliente real e hand-written
(os repos de mobile são só o wrapper fino do SDK fechado, ver abaixo).

Lido `lib/plaid/api_client.rb` (cliente HTTP Faraday) e
`lib/plaid/configuration.rb` inteiros — nenhum achado. Pontos
verificados especificamente e descartados:
- Credenciais (`PLAID-CLIENT-ID`/`PLAID-SECRET`/`Authorization:
  Bearer`) sempre injetadas via header (`update_params_for_auth!`),
  nunca em query string.
- `ssl_verify` default `true`, sem downgrade de TLS em nenhum caminho
  do código.
- Log de debug (`@config.logger.debug` do corpo de request/response)
  só executa quando `@config.debugging` é explicitamente `true` —
  opt-in documentado, não comportamento padrão; padrão comum e aceito
  em SDKs de API (mesmo padrão do stripe-ruby/aws-sdk).
- `prepare_file`/`sanitize_filename`: nome de arquivo de download vem
  do header `Content-Disposition` da própria resposta da API Plaid
  (`production.plaid.com`/`sandbox.plaid.com`, first-party, não
  terceiro não confiável) e já passa por `gsub(/.*[\/\\]/, '')` antes
  de virar prefixo de `Tempfile.open` — sem vetor de path traversal
  com essa origem de dado.

`plaid/plaid-link-android` também clonado e inspecionado: o
repositório contém **só o app de exemplo** (`app/src/...`) — o SDK em
si (`com.plaid.link`) é distribuído como artefato Maven fechado, não
existe módulo de biblioteca com código-fonte real neste repo. Não há
lógica de negócio pra auditar aqui além do app de demonstração;
registrado para não repetir a tentativa numa rodada futura.

`deep-read-log.json` atualizado com `plaid/plaid-ruby`. `plaid-link-android`
não adicionado ao log (nada de substância foi de fato lido além do
app de exemplo, que não é o alvo relevante).

**Mesma lacuna de RoE documentada em `slack/NOTES.md`/`mattermost/NOTES.md`
por uma sessão paralela nesta mesma rodada**: Plaid também foi
promovido pro scanner ativo via descoberta automática
(`discovery-metadata-seen.json`) sem revisão de RoE da HackerOne
quanto a pesquisa assistida por IA — percebido só depois de já ter
lido/triado achados deste programa em duas rodadas. Registrado em
`program-policy.json` (`"roeReviewNeeded": true`) como advertência pro
usuário revisar a RoE real do programa Plaid antes de qualquer
pesquisa futura aqui.

## Rodada 2026-09-04 (push automático via GitHub webhook, sessão cloud)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado
(inclusive `cashapp/*`/`afterpay/*`/`square/wire`, que aparecem no
histórico de `deep-read-log.json` de rodadas anteriores a essa regra —
confirmado que fazem parte do escopo de `Block Open Source` via
`scope-snapshots/block-open-source.json`, nenhum deles lido nesta
rodada). Nota lateral: a lacuna de RoE já foi fechada pra Plaid em
03/09 (`program-policy.json`: `roeReviewed:true`,
`aiResearchBanned:false`) — programa segue liberado.

`migrate-to-v2.mjs` + `list-pending` global = 0 candidatos. Leitura
profunda proativa: `plaid/plaid-ruby` de novo, fechando os últimos
arquivos hand-written do pacote ainda sem registro em
`deep-read-log.json` (`api_client.rb`/`configuration.rb` já cobertos
em rodada anterior; `lib/plaid.rb` é só `autoload`/`require`
gerado — 2226 linhas de boilerplate sem lógica, não conta como
leitura de substância):

- `lib/plaid/api_error.rb` — `ApiError#initialize` aceita um Hash e
  faz `instance_variable_set "@#{k}", v` pra cada chave. Em princípio
  isso permite setar ivar arbitrária, mas o Hash só é construído
  internamente por `api_client.rb` (chaves fixas: `:code`,
  `:response_headers`, `:response_body`, `:message`) — nenhum dado de
  rede/atacante controla o NOME das chaves, só os valores. Sem
  achado.
- `lib/plaid/version.rb` — só a constante `VERSION`. Sem achado.

Todos os arquivos hand-written de `lib/plaid/` (fora de
`api/`/`models/`, 100% gerados pelo `openapi-generator` e já
verificados como não tendo lógica de auth própria em rodada anterior)
agora estão cobertos em `deep-read-log.json`. Repositório
`plaid/plaid-ruby` está, na prática, esgotado como alvo de leitura
profunda proativa até que uma nova versão publique lógica hand-written
nova. Nenhum achado novo, nenhuma transição de estado neste programa
nesta rodada.

## Rodada 2026-09-07 #12 (rotina agendada, gatilho push)

`program-policy.json` conferido no passo 0: Plaid segue `roeReviewed:true`,
`aiResearchBanned:false`, liberado. `list-pending` global = 0 (só
`verify_scope` do Mattermost como `actionable`, sem novidade — ver
`mattermost/NOTES.md` desta mesma data). Leitura profunda proativa
direcionada a `plaid/plaid-ruby` e `plaid/react-plaid-link`, os dois
repositórios com menos arquivos lidos no ranking de
`list-deep-read-candidates.mjs` (4 cada).

- `plaid/plaid-ruby` — clone raso local pra confirmar por amostragem
  (em vez de só supor) que os dois arquivos hand-written ainda não
  registrados também não têm lógica: `lib/plaid/api/plaid_api.rb`
  (23887 linhas) é inteiramente gerado pelo `openapi-generator` — todo
  método segue o mesmo padrão mecânico (`verify required param` ->
  monta header/query/body -> `call_api`); grep por `jwt|JWT|Verify`
  só retorna nomes de endpoint (`/auth/verify` etc.) e comentários de
  doc, nenhum código de verificação criptográfica própria do SDK.
  `lib/plaid.rb` (2226 linhas) confirmado só `autoload`/`require`.
  Conclusão reforçada da rodada de 04/09: repositório esgotado —
  toda a lógica de negócio real (webhook signature verification, JWT/JWKS)
  fica do lado do consumidor da lib, documentada nos docs do Plaid, não
  implementada neste pacote.
- `plaid/react-plaid-link` — 3 arquivos que faltavam: `PlaidLink.tsx`
  (componente de botão, só repassa `className`/`style` como props React
  normais, sem `dangerouslySetInnerHTML`; `onClick` chama o `open()` já
  auditado do hook `usePlaidLink`), `constants.ts` (confirma
  `PLAID_LINK_STABLE_URL` hardcoded, nunca influenciado por input do
  consumidor — reforça a conclusão de `react-script-hook/index.tsx` já
  lido), `types/index.ts` (só interfaces TypeScript de metadados de
  callback, nenhuma lógica executável). Sem achado em nenhum. Todos os
  arquivos `.ts`/`.tsx` de `src/` (fora dos `.test.tsx`) agora cobertos —
  repositório também esgotado para leitura profunda proativa.

`deep-read-log.json` atualizado (edição programática via Python).
`export-queue` rodado ao final da rodada — nenhum achado novo, nenhuma
transição de estado neste programa nesta rodada.
