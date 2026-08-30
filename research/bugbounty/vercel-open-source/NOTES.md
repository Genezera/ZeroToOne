---
programa: Vercel Open Source (HackerOne), JavaScript/TypeScript
status: pipeline automatizado criado e testado; primeira rodada real: 0 achados
data: 2026-08-26
---

# Vercel Open Source — cobertura automatizada

## Por que este programa e este repo
Descoberto via `arkadiyt/bounty-targets-data` (dataset público, não requer
login na HackerOne): programa `vercel-open-source` tem 19 alvos em escopo,
todos rated `severity: critical`, `eligible_for_bounty: true`. Lista
completa: `nitrojs/nitro`, `nuxt/nuxt`, `sveltejs/svelte`,
`vercel-labs/agent-skills`, `vercel-labs/skills`, `vercel/ai`,
`vercel/async-sema`, `vercel/chat`, `vercel/eve`, `vercel/flags`,
`vercel/ms`, `vercel/next.js`, `vercel/swr`, `vercel/turborepo`,
`vercel/vercel`, `vercel/workflow`, + 3 entradas genéricas "Tier 1/2/3 OSS".
Há também um programa menor separado, `vercel_sandbox` (1 alvo, ainda não
examinado).

Escolhi `vercel/flags` (SDK de feature flags) como primeiro alvo porque:
- Tamanho administrável (repo ~20MB, 121 arquivos-fonte JS/TS relevantes
  depois de filtrar `apps/`/`examples/`/testes — ver abaixo).
- Popularidade moderada (617 estrelas) — provavelmente menos escrutinado
  que `next.js`/`turborepo`/`vercel` (o CLI principal), que têm anos de
  revisão por uma comunidade enorme.
- Superfície de segurança real e concentrada: `packages/flags/src/lib/
  crypto.ts`, `verify-access.ts`, e `packages/vercel-flags-core/src/
  controller/auth.ts` lidam com verificação de acesso e criptografia —
  exatamente o tipo de código onde um bug tem impacto real (bypass de
  controle de acesso, não só cosmético).
- Ativamente mantido (push no dia em que este pipeline foi criado).

`vercel/ms` e `vercel/async-sema` foram descartados como primeiro alvo por
serem minúsculos e extremamente conhecidos (usados por milhões de projetos,
já escrutinados por anos) — chance marginal de achar algo novo é baixa.
`next.js`, `vercel/vercel`, `turborepo`, `eve`, `workflow` são grandes
demais para uma primeira varredura automatizada. `Square Open Source` não
apareceu no dataset sob o termo "square" — não resolvido ainda.

## Escopo do scanner
Só `packages/` (as bibliotecas publicadas de verdade) — exclui `apps/`
(site de docs, playground) e `examples/` (código de demonstração, não é o
que usuários instalam em produção). Isso corta de 313 arquivos-fonte
rastreáveis no repo inteiro para 121 dentro de `packages/`.

Diferente do scanner Clarity (StackingDAO), **o código-fonte JS/TS não é
persistido neste repositório git** — os repos são grandes demais para isso
sem inchar desnecessariamente um projeto que é sobre crescer US$200, não
sobre guardar cópias de bibliotecas de terceiros. Só o texto de cada achado
(com um trecho curto de contexto ao redor da linha) vai para a fila.

## Heurísticas (v1 — deliberadamente pequeno)
Três heurísticas, cada uma correspondendo a uma regra real e conhecida de
analisadores estáticos JS (mesmo espírito do `eslint-plugin-security`):
1. `eval_usage` — `eval(...)` / `new Function(...)`.
2. `command_injection_risk` — `exec`/`execSync` com argumento montado por
   template literal interpolado ou concatenação de string (não sinaliza
   `execFile`/`spawn` com array de argumentos, que é o padrão seguro).
3. `redos_risk` — regex com quantificador aninhado (`(x+)+`, `(x*)*`),
   padrão clássico de ReDoS.

Deliberadamente NÃO incluí um heurístico de "prototype pollution" nesta v1
— exigiria um parser de verdade (ou uma heurística de janela de linhas
muito frágil/ruidosa) para ficar confiável sem gerar excesso de ruído.
Pode entrar numa v2 se valer a pena depois de ver como a v1 se sai.

15 testes automatizados (`test/heuristics-js.test.mjs`), incluindo um teste
específico para não confundir divisão matemática (`a / b / c`) com literal
de regex — essa é a armadilha mais comum de heurísticas ingênuas nesse
tipo de detecção.

## Primeira rodada real (2026-08-26)
121 arquivos de `packages/` buscados via API pública do GitHub (sem
conta/token), varridos com as 3 heurísticas: **0 candidatos**. Resultado
honesto, não um problema — é o esperado para uma biblioteca pequena e bem
mantida na primeira passada com heurísticas propositalmente conservadoras
(preferem menos ruído a mais falso-positivo). Cache de SHA de blob por
arquivo (`scanner-seen-js-shas.json`) salvo — rodadas futuras só rebuscam
arquivos que realmente mudaram.

## Automação
Integrado ao MESMO scanner diário já agendado (`ZeroToOne_BugBountyScanner`,
7h15) — não criei uma quarta tarefa agendada separada. Quando achar algo
novo, cai na mesma fila (`queue.jsonl`) e dispara o mesmo agente de nuvem
via webhook de push, que já está configurado para qualquer push neste
repositório (não específico de Clarity).

## O que falta
- Resolver o escopo do Square Open Source (busca por "square" no dataset
  não achou nada — tentar outro termo/handle).
- Se a v1 (0 achados) continuar assim por várias rodadas, considerar
  ampliar para outro alvo da lista (`vercel/chat` ou `vercel-labs/skills`
  são os próximos candidatos naturais por tamanho/novidade) ou adicionar
  mais heurísticas (prototype pollution, SSRF em chamadas fetch/axios).
- Verificação de identidade da HackerOne (Veriff) ainda em andamento pelo
  usuário — nenhum relatório pode ser enviado de verdade até isso resolver,
  independente do que o scanner encontrar.

## Rodada de revisão (2026-08-29) — 15 achados de ssrf_risk/prototype_pollution_risk, todos falso_positivo
O scanner foi ampliado (heurísticas v2, ver commit anterior) com
`ssrf_risk` (fetch com URL interpolada) e `prototype_pollution_risk`
(`for...in` + atribuição indexada sem checagem de `__proto__`). Rodou
sobre os adapters de terceiros em `packages/adapter-*` e sobre
`vercel-flags-core`, gerando 15 candidatos — 13 SSRF + 2 prototype
pollution. Todos revisados individualmente com leitura do código real
(via `raw.githubusercontent.com`, repo não persistido localmente) e
rastreamento da cadeia de chamada; nenhum sobreviveu:

- **SSRF (13 achados, 11 arquivos):** em `adapter-flagsmith`,
  `adapter-launchdarkly`, `adapter-optimizely`, `adapter-split`,
  `adapter-statsig` o host do `fetch()` é uma string fixa hardcoded (API
  oficial de cada provedor) — só path/query são interpolados, com IDs de
  configuração do desenvolvedor ou valores de paginação retornados pela
  própria API oficial. Sem controle de host, não há SSRF.
  Em `adapter-growthbook` e `adapter-posthog` o host *é* configurável
  (`appApiHost`/`appHost`), mas isso é uma feature documentada e
  intencional para suportar instâncias self-hosted desses provedores —
  o valor é passado explicitamente pelo desenvolvedor que integra o SDK
  (tipicamente de uma env var no código dele), não de uma requisição de
  usuário não confiável dentro deste pacote. Marcado confiança 'média'
  (não 'alta') por esses dois, porque a exploração dependeria de um mau
  uso do integrador, não de um bug no `vercel/flags`.
  Em `vercel-flags-core` (`fetch-datafile.ts`, `ingest.ts`) o host é
  `this.options.host`, com default hardcoded `https://flags.vercel.com`
  (`normalized-options.ts:139`), só sobrescrito por opções de construção
  do client definidas pelo integrador — mesmo raciocínio.
- **Prototype pollution (2 achados):** em `adapter-vercel/src/index.ts`
  e `vercel-flags-core/src/evaluate.ts`, o `for...in`/`for` itera sobre
  objetos cujas chaves são identificadores de flags declarados pelo
  desenvolvedor no próprio código-fonte (via `flag()`), nunca JSON
  desserializado de entrada externa. Mesmo hipoteticamente, a atribuição
  é flat/single-level sobre um objeto `{}` recém-criado — não é o padrão
  de merge recursivo que causa poluição real do `Object.prototype`
  global.

Conclusão prática: a heurística v2 de SSRF tem taxa de falso-positivo
alta quando aplicada a bibliotecas cliente que chamam APIs de terceiros
com host fixo ou host configurável por design (padrão comum em SDKs de
feature flag) — vale considerar restringir a heurística para só marcar
quando o host (não só o path) é claramente derivado de uma fonte de
entrada de usuário final (request headers, query params, body), não de
qualquer variável.

## Leitura profunda proativa (2026-08-29)
3 arquivos novos lidos (nenhum lido antes, registrados em
`deep-read-log.json`), priorizando auth/crypto: `vercel-flags-core/src/
controller/auth.ts` (resolução de token SDK key / OIDC), `flags/src/lib/
verify-access.ts` e `flags/src/lib/crypto.ts` (JWE de acesso/overrides,
usado para proteger o endpoint `.well-known/vercel/flags`). Nenhum
problema encontrado: `crypto.ts` separa claims de propósito (`pur`) por
tipo de token para evitar confusão entre encrypt/decrypt de finalidades
diferentes (já documentado no topo do arquivo), usa AEAD (JWE
`A256GCM` via `jose`) — decriptação autenticada, sem superfície óbvia de
timing attack. Nenhum achado novo adicionado à fila nesta rodada.

## Rodada — fila vazia, leitura profunda completando o fluxo de auth (2026-08-29)
Sem `pending` na fila. Nenhum arquivo com auth/session/crypto/token/
login/password/admin/permission/access no nome ficou sem ler em
`packages/`. Como continuação de julgamento da rodada anterior (que leu
`crypto.ts`/`verify-access.ts` isoladamente), li os dois pontos que
efetivamente CONSOMEM essas funções, pra fechar a cadeia de chamada
completa: `flags/src/next/create-flags-discovery-endpoint.ts` (o handler
real do endpoint `.well-known/vercel/flags` — confirma que `verifyAccess`
é chamado ANTES de montar/retornar `apiData`, com `return` imediato em
401, sem vazamento parcial de dado antes da checagem) e `flags/src/next/
overrides.ts` (decripta o cookie de override de flags via
`decryptOverrides`, que reusa o mesmo `crypto.ts` já auditado — sem
lógica de confiança implícita no valor do cookie antes da decriptação
autenticada). Nenhum achado. `deep-read-log.json` atualizado com os 2
arquivos novos.

## Rodada 2026-08-29 (push automático seguinte) — 2 arquivos triviais, sem achado

Fila sem `pending`. Completando o orçamento de leitura profunda desta
rodada (o 3º arquivo foi em Circle BBP, ver NOTES.md correspondente),
li 2 arquivos pequenos ainda não cobertos:
- `packages/vercel-flags-core/src/utils/sdk-keys.ts` — regex simples de
  formato de SDK key (`^vf_(?:server|client)_`) e um parser de connection
  string. `isValidSdkKey` não é chamada em nenhum outro lugar do repo
  (aparenta ser vestigial/só pra uso externo do pacote);
  `parseSdkKeyFromFlagsConnectionString` (usada em `auth.ts`, já auditado)
  só extrai a substring — a validação real da key acontece no backend
  quando ela é de fato usada como credencial, não aqui. Sem lógica de
  autorização neste arquivo, nada a auditar além do parsing.
- `packages/flags/src/spec-extension/cookies.ts` — re-export puro de
  `@edge-runtime/cookies` (`RequestCookies`/`ResponseCookies`/
  `stringifyCookie`), zero código próprio.

Nenhum achado novo. `deep-read-log.json` atualizado com os 2 arquivos.

## Rodada 2026-08-29 (push automático) — leitura profunda em `vercel/chat` (repo novo), sem achado

Fila sem `pending` (migração pro novo state machine v2 não trouxe nenhum
finding pendente pra este programa especificamente). Ampliei a leitura
profunda pra um alvo novo dentro do escopo real do programa (confirmado
no scope snapshot: `vercel/chat`, tier 2, `eligibleForBounty: true`) —
sugestão que já constava aqui há algumas rodadas. `vercel/chat` é uma
lib de adapters pra plataformas de chat (Slack, Discord, Twilio/WhatsApp,
Messenger, Instagram, Telegram, GChat, etc.) — a superfície mais crítica
de segurança são os verificadores de assinatura de webhook (é ali que um
atacante externo tentaria forjar eventos como se viessem da plataforma
real). Priorizei os arquivos de verificação de assinatura em vez de
regex por nome de arquivo (poucos batiam literalmente com auth/token/
session):

- `packages/adapter-slack/src/webhook/verify.ts` — HMAC-SHA256 via
  WebCrypto (`crypto.subtle.verify`, comparação constant-time nativa),
  checa janela de skew de timestamp (replay), parsing de hex do
  `v0=<hex>` correto. Sem achado.
- `packages/adapter-twilio/src/webhook/verify.ts` — recomputa a
  assinatura HMAC-SHA1 sobre URL+params ordenados (mesmo algoritmo
  documentado da Twilio) e compara via `constantTimeEqual` própria
  (sem early-return, soma diferenças em vez de comparar byte a byte com
  curto-circuito — implementação correta de constant-time). Considerei
  se um Host/URL diferente do que a Twilio realmente usou (proxy/CDN)
  poderia ser abusado — não: só causaria falha de verificação (fail
  closed), nunca bypass, porque o atacante ainda precisaria do
  `authToken` secreto pra forjar uma assinatura que bata com a URL
  manipulada. Sem achado.
- `packages/adapter-messenger/src/index.ts` (`verifySignature`,
  `handleWebhook`) — `X-Hub-Signature-256` HMAC-SHA256 sobre o body cru
  (capturado via `request.text()` antes do `JSON.parse`, então não há
  risco de bypass por reserialização), comparado com
  `crypto.timingSafeEqual` do Node dentro de `try/catch` (lida
  corretamente com o `RangeError` que o Node lança quando os buffers têm
  tamanho diferente — cai no `catch`, retorna `false`, não crasha nem
  aceita por engano). O handshake de verificação do webhook
  (`handleVerification`, comparação `token === this.verifyToken`) usa
  `===` simples, não constant-time — mas é só o GET de confirmação de
  URL na configuração inicial do webhook (não protege nenhuma ação
  subsequente; o `verifyToken` não é usado pra autorizar mensagens, só
  pra confirmar posse da URL no setup), então o risco de um ataque de
  timing prático aqui é bem baixo — nota registrada, não elevada a
  achado.
- `examples/nextjs-chat/src/app/api/modal-callback/[token]/route.ts` —
  código de exemplo (não é o que consumidores instalam), chama
  `resumeHook(token, payload)` de `workflow/api` (pacote externo,
  `vercel/workflow`, também em escopo mas não investigado nesta rodada).
  Sem lógica própria pra auditar aqui além de repassar o token da URL.

Nenhum achado novo. `deep-read-log.json` ganhou entrada `vercel/chat`
com os 4 arquivos. Sugestão pra próxima rodada: os adapters restantes de
`vercel/chat` que usam o mesmo padrão de assinatura (Discord, GitHub,
WhatsApp, Instagram, Linear, Notion — ainda não lidos individualmente) ou
começar `vercel/workflow` (também tier 1, ainda sem nenhuma leitura).

## Rodada 2026-08-29 (push automático, máquina de estados v2) — continuando os adapters de `vercel/chat`

Fila sem `pending`. Segui a sugestão da rodada anterior: `adapter-discord`
não tem verificação de webhook própria (usa Gateway/WebSocket com bot
token, modelo de autenticação diferente de HMAC — não se aplica aqui, sem
arquivo `verify.ts`/`webhook.ts` nesse pacote). Troquei para os dois
adapters restantes que de fato implementam verificação HTTP de assinatura
inline no próprio `index.ts` (sem arquivo `verify.ts` separado, por isso a
busca por nome de arquivo em rodadas anteriores não os pegou):

- `packages/adapter-github/src/index.ts` (`handleWebhook`/`verifySignature`)
  — HMAC-SHA256 sobre `X-Hub-Signature-256`, `timingSafeEqual` dentro de
  `try/catch` (mesmo padrão já validado no Messenger). Ponto extra
  investigado com ceticismo: existe um `webhookVerifier` customizável que
  "toma precedência" sobre a checagem HMAC (comentário explícito no
  código, usado para Vercel Connect OIDC) — se esse verifier lançar
  exceção, o catch retorna 401 (fail closed, não fail open); se retornar
  valor falsy, também 401. Sem bypass: um verifier customizado ausente
  (`undefined`) cai no `else if` normal da checagem HMAC, nunca pula a
  verificação silenciosamente.
- `packages/adapter-whatsapp/src/index.ts` (`handleVerificationChallenge`/
  `verifySignature`) — mesmo padrão HMAC-SHA256 sobre `X-Hub-Signature-256`
  com `try/catch` ao redor do `timingSafeEqual`. O handshake de verificação
  inicial (`hub.verify_token`) usa `===` simples (não constant-time), mas é
  o mesmo caso já registrado como "risco de timing baixo" pro Messenger
  (só confirma posse da URL no setup do webhook, não autoriza mensagens
  subsequentes).

Nenhum achado novo — os dois seguem exatamente o padrão seguro já
estabelecido em `adapter-slack`/`adapter-twilio`/`adapter-messenger`.
`deep-read-log.json` atualizado (`vercel/chat` ganhou os 2 arquivos).
Restam por ler individualmente: Instagram, Linear, Notion, Teams, X
(adapters do mesmo pacote) e `vercel/workflow` (tier 1, ainda intocado).

## Rodada 2026-08-29 (push automático, máquina de estados v2) — fila vazia, leitura profunda em Teams/Linear/X

Sem `pending` na fila. Leitura profunda proativa (clone raso de
`vercel/chat`), continuando a lista de adapters pendentes:

- `packages/adapter-teams/src/webhook/parse.ts` + `index.ts` (adapter
  principal): `parseTeamsWebhookBody` só faz parsing de JSON, **sem**
  nenhuma verificação de assinatura/JWT — investiguei com ceticismo se
  isso é uma falha de autenticação. Não é: `parseTeamsWebhookBody` só é
  chamado nos testes; o fluxo real passa por `new App({...})` do SDK
  oficial `@microsoft/teams.apps` (linha 144 de `index.ts`), que monta
  sua própria rota HTTP e valida o token Bearer do Bot Framework contra
  o Azure AD antes de qualquer coisa chegar aos handlers deste adapter
  (confirmado também pela seção de autenticação do `README.md` do
  pacote — `appPassword`/`federated`). Verificação delegada a SDK
  vetada da própria Microsoft, não reimplementada aqui — sem achado.
- `packages/adapter-linear/src/index.ts` (`handleWebhook` /
  `handleVerifiedWebhook`, linha ~1263): mesmo padrão de
  `webhookVerifier` customizável com precedência sobre a assinatura
  nativa (`LinearWebhookClient` do SDK oficial `@linear/sdk`) já
  validado em GitHub/WhatsApp — throw ou retorno falsy do verifier
  sempre vira 401, nunca bypass. Sem achado novo, só reconfirma o
  padrão.
- `packages/adapter-x/src/index.ts` (`handleWebhook` / `verifySignature`
  / `handleCrcChallenge`): HMAC-SHA256 sobre o corpo bruto, comparação
  por `timingSafeEqual` com checagem de tamanho antes (evita exceção por
  buffers de tamanho diferente), tudo em `try/catch` fail-closed. O
  `GET` (challenge-response CRC do X) não exige assinatura — mas isso é
  o handshake público de posse da URL definido pela própria API do X,
  não uma rota que processa dados de usuário. Sem achado.

Nenhum achado novo nesta rodada. `deep-read-log.json` atualizado
(`vercel/chat` ganhou os 4 arquivos/trechos acima). Restam por ler
individualmente: Instagram, Notion (adapters do mesmo pacote) e
`vercel/workflow` (tier 1, ainda intocado).

## Rodada 2026-08-30 — fila vazia, primeira leitura profunda em vercel/workflow (tier 1)

Fila (`queue.jsonl`) sem itens `pending` no início desta rodada. Confirmado
via `cli.mjs check-scope "Vercel Open Source" "vercel/workflow"` que o repo
está em escopo (`allowed: true`, `SOURCE_CODE`, `eligibleForBounty: true`,
`maxSeverity: critical`, marcado "tier 1" — maior prioridade que `vercel/chat`,
que é tier 2). Ainda não tinha nenhuma entrada em `deep-read-log.json` apesar
de já mencionado como pendência em rodadas anteriores. Clonado via
`git clone --depth 1` (público, sem conta/token).

`vercel/workflow` é o framework "Workflow SDK" — funções duráveis para
JS/TS que persistem progresso como event log e fazem replay determinístico
do código após cold start/falha/scale. Arquitetura relevante: funções
`"use workflow"` rodam numa VM sandboxed (QuickJS) sem acesso completo ao
Node.js, funções `"use step"` rodam com runtime Node completo — o limite
entre as duas é a superfície mais crítica do repo (sandbox escape teria
severidade alta), mas o arquivo do runtime QuickJS
(`packages/core/src/runtime/quickjs-runtime.ts`, 2816 linhas) é grande
demais para uma leitura completa nesta rodada — fica para uma rodada futura
dedicada só a ele. Priorizei nesta rodada os 2 arquivos de criptografia do
`packages/core` (nome mais óbvio de risco) + 1 arquivo de roteamento/guard:

- `packages/core/src/encryption.ts` — AES-256-GCM via Web Crypto API
  (`globalThis.crypto.subtle`), nonce aleatório de 12 bytes por chamada
  (`getRandomValues`), AAD opcional coberto pela tag GCM. Falhas do Web
  Crypto (incluindo tag GCM inválida) são recapturadas como
  `RuntimeDecryptionError` com contexto, nunca engolidas silenciosamente.
  Sem falha encontrada — implementação padrão e correta.
- `packages/core/src/sealed-box.ts` — construção estilo HPKE (RFC 9180)
  para writes cross-run: ECDH X25519 efêmero + HKDF-SHA256 + AES-256-GCM,
  chave por run derivada de `HKDF(VERCEL_DEPLOYMENT_KEY, "projectId|runId")`.
  Verifiquei com ceticismo os pontos clássicos de falha desse tipo de
  construção: (1) binding do `kem_context` — `info` do HKDF inclui
  `ephemeralPublicKey ‖ recipientPublicKey`, prevenindo key-substitution/
  unknown-key-share attack; (2) disciplina de nonce — nonce sempre aleatório
  via `aesGcmEncrypt` mesmo quando a `contentKey` é amortizada entre frames
  de um stream (`createSealSession`), nunca contador; (3) ponto de baixa
  ordem X25519 — rejeitado pelo próprio Web Crypto (`OperationError` em
  segredo compartilhado zerado), tratado como erro explícito, não como
  segredo fraco silencioso; (4) decodificação de chave pública recebida de
  storage/wire (`decodeRunPublicKey`/`base64ToBytes`) é estrita (rejeita
  caracteres fora do alfabeto, padding malformado, bits de sobra não-zero)
  e falha fechado (degrada pra `undefined` → caminho simétrico, nunca aceita
  um valor truncado como se fosse uma chave válida). Construção sólida, bem
  documentada, sem desvio do padrão HPKE que introduza fraqueza. Sem achado.
- `packages/core/src/runtime/deployment-guard.ts` — `guardDeploymentAffinity`
  garante que um run só executa na deployment a que está pinado (evita
  decrypt com a master key errada). Fail-safe por padrão
  (`world.capabilities?.deploymentAffinity !== true` → `CONTINUE` sem
  guarda), re-enfileira pra deployment correta com backoff exponencial
  limitado, falha definitivamente só após esgotar
  `WORKFLOW_DEPLOYMENT_MISMATCH_MAX_RETRIES` ou receber classificação
  explícita de "deployment indisponível". É lógica de roteamento/robustez,
  não um limite de autorização entre tenants — sem falha encontrada.

Nenhum achado novo nesta rodada. `deep-read-log.json` atualizado
(`vercel/workflow` criado com os 3 arquivos acima). Sugestão pra próxima
rodada: `packages/core/src/runtime/quickjs-runtime.ts` (fronteira do
sandbox VM — arquivo grande, ler em partes) e/ou
`packages/world-vercel/src/encryption.ts` (par do `encryption.ts` já lido,
mas do lado do backend de produção Vercel) — ambos ainda intocados neste
repo tier 1.

## Rodada 2026-08-30 (leitura profunda proativa, continuação)

Fila `list-pending` vazia de novo. Segui a sugestão da rodada anterior.
Clonado `vercel/workflow` fresco via `git clone --depth 1` (público, sem
conta/token) no scratchpad.

- `packages/world-vercel/src/encryption.ts` (232 linhas, completo) — par
  server-side do `packages/core/src/encryption.ts` já revisado. Deriva a
  chave por-run via HKDF-SHA256 (`webcrypto.subtle`, salt zero + `info =
  projectId|runId`, aceitável per RFC 5869 §3.1 dado que a
  `VERCEL_DEPLOYMENT_KEY` de entrada já tem entropia alta). Dois caminhos:
  (1) dentro do runtime serverless (`VERCEL=1`) com a run pertencendo à
  deployment local, deriva localmente; (2) qualquer outro caso (CLI, e2e,
  cross-deployment) busca a chave já derivada via API
  `api.vercel.com/v1/workflow/run-key/:deploymentId`, autenticada por
  token explícito → `VERCEL_TOKEN` → OIDC (nessa ordem,
  `resolveVercelApiToken`), nunca expondo a deployment key crua fora do
  boundary da API. Investiguei com ceticismo o branch
  `!deploymentId || deploymentId === process.env.VERCEL_DEPLOYMENT_ID` →
  usa chave local mesmo quando `deploymentId` vem `undefined`: isso não é
  bypass de autorização por si só (a função é um helper interno de
  derivação de chave, não um endpoint exposto — quem quer que a chame já
  precisa ter acesso ao `runId`/contexto da run; a superfície de auth real
  é de quem invoca esta função, fora deste arquivo). Sem achado.
- `packages/core/src/runtime/quickjs-runtime.ts` (2816 linhas — não é
  viável ler linha a linha numa rodada; li com grep direcionado +
  Read nas seções relevantes: bootstrap de globals injetado na VM
  (L250-1050), criação da VM e host-bridge (`vm.newFunction`/`vm.setProp`,
  L1200-1350), e a bomba de mensagens/resolvers que processa steps/hooks
  pendentes (L1600-2800)). Ponto que investiguei especificamente por
  suspeita de injeção: vários `vm.evalCode(...)` fazem interpolação de
  template string com `${cidJs}` (o correlationId) — confirmei que
  `cidJs = JSON.stringify(cid)` (linha 1865), então é serialização segura
  como literal JS, não concatenação crua — sem injeção. Busquei também
  qualquer exposição direta de `fs`/`child_process`/`net`/`http` ao
  bootstrap da VM (`grep` por essas APIs no arquivo inteiro) — zero
  ocorrências: a única ponte host↔VM é via fila de correlationId
  (`__pending`/`__resolvers`), nunca uma referência direta a uma função ou
  objeto Node real, o que é o desenho correto pra evitar vazamento de
  capability. `Math.random`/`__generateNanoid`/`__generateUlid` são
  sobrescritos por funções host determinísticas (replay), consistente com
  a arquitetura documentada. Cobertura parcial apenas — arquivo grande
  demais pra fechar nesta rodada; fica pendência pra rodada futura cobrir
  o restante (particularmente L1350-1600, ainda não lida).
- `packages/world-vercel/src/http-core.ts` (658 linhas, li L1-390 —
  a metade relevante a auth/erro/OTEL) — `resolveVercelApiToken` segue a
  mesma ordem de precedência de token documentada no `encryption.ts`
  (explícito → `VERCEL_TOKEN` → OIDC via `@vercel/oidc`, pacote externo
  fora do escopo desta leitura). `parseServer`/`httpClientSpanAttributes`
  são helpers de observabilidade sem superfície de auth. Sem achado.

Nenhum achado novo nesta rodada. Nenhum item chegou perto de virar
finding (nada digno de `upsert-finding`). `deep-read-log.json` atualizado.
Sugestão pra próxima rodada: fechar `quickjs-runtime.ts` (L1350-1600 e
L2450+ ainda não lidas) e considerar `packages/world-vercel/src/utils.ts`
(usa `getVercelOidcToken` diretamente, ainda intocado).

## Rodada 2026-08-30 (push automático, commit posterior) — `packages/world-vercel/src/utils.ts`

Fila vazia de novo. Segui a sugestão pendente: `packages/world-vercel/src/utils.ts`
(725 linhas, completo) — monta a config HTTP (`getHttpConfig`) que decide
entre dois caminhos de auth: (1) proxy `api.vercel.com/v1/workflow`
quando há `projectConfig` completo (`projectId`+`teamId`), autenticado
por `Bearer` com token explícito obrigatório (falha alto e cedo se
ausente, sem fallback silencioso); (2) `workflow-server` direto, ordem de
precedência `config.token` explícito → `getVercelOidcToken()` (falha
silenciosamente só quando fora de um contexto Vercel função, tratado
como "sem OIDC disponível", não como erro) — mesma ordem já documentada
em `packages/core/src/encryption.ts`/`world-vercel/src/encryption.ts`,
consistente entre os três arquivos. `resolveClientEnvironment` (usado
tanto pro header `x-vercel-environment` quanto, em outro arquivo já
revisto, pro guard cross-tenant) tem comentário extenso e correto
explicando por que retorna `undefined` em vez de adivinhar `'production'`
quando nenhuma fonte está disponível — evita fabricar um mismatch contra
um preview legítimo. Nada no arquivo autoriza uma requisição por si só
(é só montagem de headers/config do lado cliente); a fronteira de auth
real fica no servidor Vercel, fora do escopo deste repo. Sem achado —
arquivo bem documentado, mesma disciplina cuidadosa já vista no resto de
`vercel/workflow`.

Nenhum achado novo nesta rodada. `deep-read-log.json` atualizado
(`packages/world-vercel/src/utils.ts` adicionado à chave `vercel/workflow`).
Sugestão pra próxima rodada: ainda falta fechar `quickjs-runtime.ts`
(L1350-1600 e L2450+).

## Rodada 2026-08-30 (push automático seguinte) — fechamento de quickjs-runtime.ts

Fila vazia. Segui a pendência da rodada anterior: li as duas seções
restantes de `packages/core/src/runtime/quickjs-runtime.ts` (agora
completo, 2816 linhas):

- L1350-1600 (`startQuickJSWorkflow`/fase de init por execução): seed do
  PRNG determinístico derivado de `runId`+`workflowName`+`deploymentId`
  (não de `startedAt`, que diverge entre invocação turbo sintetizada e a
  execução durável — comentário explica o motivo), geração de
  nanoid/ULID seedados a partir do mesmo PRNG, `process.env` injetado
  via serde host-side (paridade documentada com o motor node:vm, cópia
  congelada, mesma decisão já vista em outros arquivos desta missão).
  Nada aqui expõe env/segredos a um caminho não confiável — é o próprio
  código do workflow do usuário quem roda dentro da VM, não input
  externo não confiável.
- L2450-2816 (fim do arquivo): coleta de "pending operations" para
  drain/suspensão (`dumpPendingOps`/`collectDrainOperations`),
  `checkWorkflowState` (detecta completed/failed/suspended lendo só
  globals internos da própria VM: `__workflowDone`, `__workflowError`,
  `__resolvers`, `__pending` — nenhum desses é controlável por um
  terceiro, só pelo próprio código do workflow que já roda dentro do
  sandbox) e helpers de extração de erro/interrupt budget. Puro
  bookkeeping determinístico, sem superfície de auth/crypto.

Sem achado — arquivo fechado por completo nesta missão, engenharia
cuidadosa de replay determinístico consistente com o resto do módulo já
revisado. `deep-read-log.json` atualizado (entrada de
`quickjs-runtime.ts` marcada como completa).

Repos do escopo `Vercel Open Source` ainda nunca tocados por esta
missão (fora do repo `workflow`/`flags`/`chat` já cobertos):
`vercel/next.js`, `vercel/vercel`, `vercel/turborepo`, `vercel/ai`,
`vercel/swr`, `vercel/eve`, `vercel/ms`, `vercel/async-sema`,
`nitrojs/nitro`, `nuxt/nuxt`, `sveltejs/svelte`,
`vercel-labs/agent-skills`, `vercel-labs/skills` — a maioria são
monorepos grandes; próxima rodada pode escolher um arquivo específico
de auth/token dentro de `vercel/vercel` (ex. CLI login/token storage)
em vez de tentar cobrir o repo inteiro de uma vez.

## Rodada 2026-08-30 (push automático, máquina de estados v2) — fila vazia, primeira leitura em `vercel/vercel` (armazenamento de token do CLI)

`node system/bugbounty-scanner/cli.mjs list-pending` vazio. Peguei a
pendência explícita deixada na rodada anterior: `vercel/vercel` nunca
tinha sido tocado nesta missão apesar de `check-scope` confirmar
`allowed: true`/`maxSeverity: critical`/tier 1. Clone raso com sparse
checkout (`git clone --depth 1 --filter=blob:none --sparse`, público,
sem token) e segui a cadeia real de onde o token de autenticação do CLI
é persistido em disco, por ser a superfície mais sensível óbvia
(`login`/`token`/`credential` no path):

1. `packages/cli/src/util/config/files.ts` — `persistAuthConfig`/
   `readAuthConfigFile` delegam pra um pacote interno separado,
   `@vercel/cli-auth/credentials-store.js`.
2. `packages/cli-auth/credentials-store.ts` — `CredentialsStore` suporta
   3 modos (`file`/`keyring`/`auto`, este último tenta keyring do SO via
   `@napi-rs/keyring` primeiro e cai pra arquivo se indisponível), com
   migração automática nos dois sentidos quando o modo configurado muda.
   Escrita em arquivo delega pra `cliConfig.writeAuthConfigFile`.
3. `packages/cli-config/src/cli-config.ts` — `writeAuthConfigFile` chama
   `writeConfigFile(..., { mode: 0o600 })`, que por sua vez escreve num
   arquivo temporário (`.<nome>.<pid>.<timestamp>.tmp`) via
   `fs.writeFileSync(tempFilePath, content, { mode: options.mode })` e só
   depois `fs.renameSync(tempFilePath, filePath)` — padrão atômico
   write-then-rename, correto para evitar arquivo parcialmente escrito
   ficar visível com o nome final.
4. `packages/cli-config/src/paths.ts` — resolve o diretório via
   `XDGAppPaths('com.vercel.cli').dataDirs()` (com fallback pra
   `~/.now` legado), sempre dentro da árvore do `$HOME` do usuário, sem
   nenhum componente vindo de input externo/rede.

Investiguei especificamente 2 hipóteses de bypass antes de descartar:
- **Modo do arquivo ficar mundialmente legível**: não — `mode: 0o600` é
  passado direto pro `open()` na criação do arquivo temporário (não um
  `chmod` posterior), então não há janela de corrida onde o arquivo
  exista com permissão mais aberta; `rename()` no Linux preserva o modo
  do arquivo de origem, então o arquivo final herda `0o600`.
- **Symlink attack no arquivo temporário** (nome previsível por
  `pid`+`timestamp`): tecnicamente o `fs.writeFileSync` sem `O_EXCL`
  seguiria um symlink pré-plantado com esse nome exato, mas isso exige
  que outro usuário tenha permissão de ESCRITA no próprio diretório de
  config (`~/.local/share/com.vercel.cli` ou equivalente) — diretório
  esse criado dentro do `$HOME` do usuário sem modo restritivo explícito
  (`fs.mkdirSync(dir, { recursive: true })`, herda `0o755` do umask
  padrão), mas `0o755` não dá permissão de escrita pra outros usuários,
  só leitura/listagem — um atacante sem escrita nesse diretório não
  consegue plantar o symlink. Só seria explorável num sistema
  multi-usuário já mal configurado (ex. `$HOME` ou o diretório de config
  world-writable), o que é falha de configuração do SO/host, não do
  código do Vercel CLI.

**Sem achado** — o design é cuidadoso e correto no que depende só do
código deste repositório: modo de arquivo restritivo aplicado
atomicamente na criação, escrita atômica via rename, opção de keyring
do SO como alternativa mais forte que arquivo, sem input externo/rede
influenciando o path de resolução do diretório. `deep-read-log.json`
atualizado com a nova chave `vercel/vercel` (4 arquivos). Sugestão pra
próxima rodada: dentro do mesmo repo, o fluxo de OAuth/SSO em
`packages/cli-auth/oauth.ts`/`sso.ts` (ainda não lidos) — troca de code
por token, validação de `state`/PKCE — é superfície de auth mais rica
que o armazenamento local já fechado aqui.

## Rodada 2026-08-30 (push automático, máquina de estados v2) — novo achado `corroborated_static`: callback loopback sem state/nonce em `packages/cli-auth/sso.ts` + leitura sem achado em `vercel-labs/skills`

Fila vazia no início. Leitura profunda proativa, dois alvos:

**1. `vercel-labs/skills` (repo novo, nunca tocado) — sem achado.** Escolhido
por lidar com instalação de código de terceiros no disco do usuário
(superfície clássica de supply-chain). Lidos `src/github-host.ts`
(validação de `GH_HOST`, rejeita valores com userinfo/porta/path —
correto), `src/skill-lock.ts` (bookkeeping do lockfile + resolução de
token `GITHUB_TOKEN`/`GH_TOKEN`), `src/blob.ts` (Trees API do GitHub +
fallback de auth só quando rate-limited/401/404, nunca vaza token pra
host errado porque o host vem de `getGitHubHost()` local, não do
`ownerRepo` do achado) e trechos de `src/update.ts`/`src/installer.ts`
relevantes a escrita de arquivo em disco. Ponto investigado
especificamente por suspeita de path traversal/zip-slip na instalação
de skill (arquivos de um repo de terceiro escritos em
`.agents/skills/<nome>/<file.path>`): `isPathSafe()` usa
`normalize(resolve(...))` com checagem `startsWith(base + sep)` (padrão
correto, evita o bug clássico de `startsWith(base)` sem separador) e é
chamada tanto pra instalação via clone quanto via blob download — sem
brecha. Código consistentemente defensivo (comentários no próprio
código já documentam decisões de segurança passadas: pin de `GH_HOST`
pra `github.com` em updates, `shell:false` explícito contra command
injection no Windows). Sem achado novo.

**2. `vercel/vercel` — novo achado `corroborated_static`.** Segui a
sugestão pendente da rodada anterior: `packages/cli-auth/oauth.ts` e
`packages/cli-auth/sso.ts`. `oauth.ts` implementa Device Authorization
Grant (RFC 8628) com checagem de `issuer` mismatch e validação Zod em
toda resposta — sem achado (esse é o fluxo realmente usado pelo `vercel
login` ativo, confirmado depois lendo `packages/cli/src/commands/login/
future.ts` e `packages/cli/src/util/oauth.ts`, que reimplementam o
mesmo padrão localmente).

`sso.ts` é outra história: `reauthorizeTeam`/`waitForVerification` abre
um servidor HTTP local em `127.0.0.1:<porta efêmera aleatória>`, manda o
browser pra `vercel.com/sso/<team>?session_id=...&client_id=...&next=
http://localhost:<porta>`, e trata a **primeira requisição que chegar**
nesse servidor (`server.once('request', ...)`) como a resposta legítima
— extrai `token` da query string e usa direto num `fetch` pra
`api.vercel.com/registration/verify?token=...`. Não há nenhum
segredo/`state`/nonce gerado localmente e exigido de volta na resposta
pra amarrar o callback ao fluxo que foi de fato iniciado. Isso é
exatamente a classe "loopback interception" que a RFC 8252 (OAuth 2.0
for Native Apps) existe pra prevenir: como o servidor não emite headers
CORS e uma requisição GET simples não dispara preflight, uma página
maliciosa aberta em outra aba do mesmo navegador (durante a janela em
que o comando está esperando) pode mandar uma query forjada pra
`127.0.0.1:<porta>` — CORS bloqueia a LEITURA da resposta pelo JS da
página atacante, não o envio/processamento da requisição pelo servidor.
Cenário de impacto: atacante roda o próprio fluxo de SSO pra obter um
`token` de verificação válido (mas da conta/sessão DELE), corre uma
página que faz port-scan de localhost tentando essa query em várias
portas candidatas durante a janela da vítima — se ganhar a corrida antes
do redirect real do browser, o CLI da vítima completa
`registration/verify` com a sessão do atacante (confusão de
conta/session-fixation). Porta aleatória é mitigação parcial, não
suficiente (port-scan de localhost via `fetch()` é técnica conhecida,
não bloqueada por CORS).

**Ressalva que baixou a confiança pra "baixa" e travou o achado em
`corroborated_static`:** rastreei a cadeia de chamada real dentro de
`packages/cli/src` (o consumidor de fato do pacote `@vercel/cli-auth`,
declarado `workspace:*` no `package.json`) e **não encontrei nenhum
import** de `@vercel/cli-auth/oauth.js` ou `@vercel/cli-auth/sso.js` em
lugar nenhum — o único subpath do pacote realmente importado é
`@vercel/cli-auth/credentials-store.js` (já auditado, sem relação). O
comando `vercel teams sso` que existe de fato
(`packages/cli/src/commands/teams/sso.ts`) só lê status SAML via API,
não chama `reauthorizeTeam`. Ou seja: não consegui confirmar que esse
código está de fato alcançável pelo binário `vercel` publicado a partir
deste mesmo repositório — pode ser código em transição/não finalizado,
ou consumido por outro produto Vercel fora deste monorepo (o pacote é
publicado no npm, não-privado, README diz "used by Vercel's CLI tools"
no plural). `record-deployment-evidence` registrado com
`confidence: "unverified"` de propósito — a transição pra
`scope_verified` foi tentada e corretamente recusada pela máquina de
estados (na verdade nem existe transição direta `corroborated_static→
scope_verified`; exigiria passar por `reproduced_local`, que por sua vez
exige um validador local que não existe pra este tipo de achado —
mesma limitação real já documentada para os outros 3 achados
`corroborated_static` não-Solidity da fila). Achado fica registrado e
travado em `corroborated_static`, correto e honesto dado o estado atual
da evidência — não uma falha do sistema.

`deep-read-log.json` atualizado (`vercel/vercel` ganhou 5 arquivos
novos; `vercel-labs/skills` criado com 5 entradas). Sugestão pra próxima
rodada: se alguém quiser reforçar a confiança deste achado, valeria
buscar por outros consumidores do pacote `@vercel/cli-auth` publicado no
npm (fora deste repo) ou confirmar via changelog/histórico de commits
se `sso.ts` é código novo ainda não cortado para produção ou código
sendo removido; fora isso, os repos ainda intocados continuam:
`vercel/next.js`, `vercel/turborepo`, `vercel/ai`, `vercel/swr`,
`vercel/eve`, `vercel/ms`, `vercel/async-sema`, `nitrojs/nitro`,
`nuxt/nuxt`, `sveltejs/svelte`, `vercel-labs/agent-skills`.
