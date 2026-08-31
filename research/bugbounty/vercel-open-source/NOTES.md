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

Rodada 2026-08-30 (leitura profunda proativa, fila vazia): primeira
leitura de `vercel/next.js` (nunca coberto nesta missão), priorizando
o subsistema de criptografia de Server Actions por nome (auth/crypto):
`packages/next/src/server/app-render/encryption.ts` (encode/decode dos
bound args de Server Actions com AES-GCM, IV aleatório de 16 bytes por
chamada, checagem de prefixo `actionId` como validação de integridade
pós-decrypt), `encryption-utils.ts` (`getActionEncryptionKey` — lê a
chave de `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` ou do manifest de build,
nunca hardcoded) e `encryption-utils-server.ts` (`generateEncryptionKeyBase64`
— gera a chave via `crypto.subtle.generateKey` AES-256-GCM real quando
não fornecida por env, persiste em `.rscinfo` dentro do cache dir do
servidor — não exposto ao client —, com rotação a cada 14 dias em
build). Esta é exatamente a área que teve o CVE histórico de chave de
criptografia de Server Actions previsível/reaproveitada em versões
antigas do Next.js; a implementação atual usa geração de chave
aleatória de verdade (não uma constante/seed fraca) e o padrão bate com
a correção documentada publicamente para aquele problema antigo. Sem
achado novo nestes 3 arquivos.

`deep-read-log.json` atualizado com a nova chave `vercel/next.js` (3
arquivos). Repos ainda intocados: `vercel/turborepo`, `vercel/ai`,
`vercel/swr`, `vercel/eve`, `vercel/ms`, `vercel/async-sema`,
`nitrojs/nitro`, `nuxt/nuxt`, `sveltejs/svelte`,
`vercel-labs/agent-skills`; dentro de `vercel/next.js` (repo enorme,
só 3 arquivos cobertos até agora) valeria continuar por
`packages/next/src/server/lib/router-server.ts`,
`packages/next/src/server/web/spec-extension/adapters/*`, e o
middleware runtime (`packages/next/src/server/next-server.ts` /
`packages/next/src/build/webpack/loaders/next-middleware-loader.ts`)
em rodadas futuras.

## Rodada 2026-08-30 (push automático seguinte) — verificação direcionada da classe CVE-2025-29927 (bypass de middleware), sem achado

Fila vazia (`list-pending` retornou `[]`; os 4 achados `corroborated_static`
de rodadas anteriores continuam corretamente travados nesse estado — a
máquina de estados não tem transição direta `corroborated_static→
scope_verified`, confirmado lendo `state-machine.mjs` diretamente nesta
rodada, mesma conclusão já documentada). Continuando a sugestão pendente em
`vercel/next.js`, mas com objetivo específico em vez de leitura sequencial:
esse repo teve um CVE real e conhecido publicamente (bypass de middleware via
o header `x-middleware-subrequest` controlável pelo cliente, permitindo pular
middleware de auth) — vale checar deliberadamente se a classe voltou a
aparecer no código atual, não só ler arquivos por nome.

Buscados via `raw.githubusercontent.com` (branch `canary`, sem clone
completo — repo grande demais): `packages/next/src/server/next-server.ts`,
`packages/next/src/server/lib/router-utils/resolve-routes.ts` e
`packages/next/src/server/web/spec-extension/adapters/next-request.ts`.
`grep` por `x-middleware-subrequest`/`x-middleware` confirma que o header
**não é mais lido do request do cliente** para decidir se o middleware deve
rodar: `handleCatchallMiddlewareRequest` (`next-server.ts:1897`) decide via
`getRequestMeta(req, 'middlewareInvoke')`, que é metadado interno setado
pelo próprio server-side router (`addRequestMeta`), nunca por um header HTTP
que o cliente controla — consistente com a correção pública documentada para
aquele CVE (a versão vulnerável antiga confiava diretamente no header do
cliente). `resolve-routes.ts` usa `x-middleware-*` só como *headers de
resposta* que o próprio middleware do usuário pode setar (`rewrite`/
`redirect`/`refresh`/`set-cookie`), não como sinal de controle vindo do
cliente. `next-request.ts` só adapta `NodeNextRequest`/`WebNextRequest` para
`NextRequest`, repassando headers sem lógica de auth própria (filtragem, se
existir, é responsabilidade de código mais acima, já lido). **Sem achado** —
checagem negativa direcionada, não leitura genérica: confirma que a classe
de vulnerabilidade específica não está presente na versão atual do código.

`deep-read-log.json` atualizado (`vercel/next.js` ganhou os 3 arquivos,
total agora 6). Repos ainda intocados continuam os mesmos da rodada
anterior: `vercel/turborepo`, `vercel/ai`, `vercel/swr`, `vercel/eve`,
`vercel/ms`, `vercel/async-sema`, `nitrojs/nitro`, `nuxt/nuxt`,
`sveltejs/svelte`, `vercel-labs/agent-skills`. Dentro de `vercel/next.js`
ainda falta a maior parte do repo (middleware loader de build,
`app-render` fora de encryption, roteamento de app router, etc.) —
próxima rodada pode continuar por `packages/next/src/build/webpack/
loaders/next-middleware-loader.ts` (fila de build do middleware, ainda
não lido) ou trocar de repo pra `vercel/turborepo` (nunca tocado).

## Rodada 2026-08-30 (push automático) — primeira leitura de `vercel/turborepo` (device flow + resolução de token local)

Fila vazia de novo. Troquei pra `vercel/turborepo` (nunca coberto),
sparse-clone de `crates/turborepo-auth`. Objetivo específico (não leitura
genérica): esse crate implementa OAuth 2.0 Device Authorization Grant
(RFC 8628) e resolução de `login_url`/`api_url` que, em teoria, podem vir
de config *do próprio repositório* (`turbo.json`) — procurei
deliberadamente por um jeito de um `turbo.json` malicioso redirecionar o
fluxo de login/token pra um servidor controlado pelo atacante quando a
vítima roda `turbo login` dentro do repo.

- `crates/turborepo-auth/src/device_flow.rs` (RFC 8628 completo): emissor
  derivado de `login_url` via `issuer_from_login_url`, mas
  `validate_endpoint_origins` valida que TODOS os endpoints do documento
  de discovery (`device_authorization_endpoint`/`token_endpoint`/
  `revocation_endpoint`/`introspection_endpoint`) estão no mesmo
  host-ou-subdomínio do issuer com o MESMO scheme, com checagem de
  fronteira de domínio correta (usa `.{issuer_host}` como sufixo, não
  substring simples — testes próprios do arquivo confirmam que
  `notvercel.com`/`evil-vercel.com`/`el.com` são rejeitados pra issuer
  `vercel.com`). `TokenSet` tem `Debug` customizado que redige
  `access_token`/`refresh_token` (testado). Scheme não-https é rejeitado
  exceto localhost. Sem achado — mitigação de SSRF/exfiltração de token
  via discovery document comprometido está implementada corretamente.
- `crates/turborepo-auth/src/auth/mod.rs`: aqui está o controle real que
  eu esperava encontrar quebrado — `ensure_non_vercel_redirect_allowed`
  exige que `login_url_source` seja `Cli`/`Environment`/`GlobalConfig`
  (`is_user_controlled_url_source`), explicitamente EXCLUINDO
  `ConfigurationSource::TurboJson`. Ou seja, um `login_url` nãovercel
  vindo de `turbo.json` (config do próprio repositório, portanto
  potencialmente hostil se a vítima clona um repo malicioso) é
  **rejeitado antes de qualquer redirect de login acontecer** — só
  origem explicitamente controlada pelo usuário (flag de CLI, env var,
  ou config global fora do repo) pode apontar o fluxo de auth pra um
  domínio não-Vercel. Confirmado por teste próprio do arquivo,
  `test_non_vercel_login_rejects_repo_controlled_login_url`. Também
  bloqueia credenciais embutidas na URL (`login_url.username()`/
  `.password()`) e exige https (exceto localhost). **Sem achado** —
  exatamente o vetor de ataque que eu estava procurando (repo malicioso
  sequestrando `turbo login`) já está mitigado de propósito, com teste
  cobrindo o caso.

`deep-read-log.json` atualizado com a nova chave `vercel/turborepo` (2
arquivos). Repo grande, resto do crate (`login.rs`/`sso.rs`/`logout.rs`,
~2.300 linhas) e o resto do monorepo (`crates/turborepo-lib`, etc.) seguem
não lidos — próxima rodada pode continuar ali, ou seguir em
`vercel/next.js` (repos ainda intocados: `vercel/ai`, `vercel/swr`,
`vercel/eve`, `vercel/ms`, `vercel/async-sema`, `nitrojs/nitro`,
`nuxt/nuxt`, `sveltejs/svelte`, `vercel-labs/agent-skills`,
`vercel-labs/skills`, `vercel/vercel`, `vercel/chat`, `vercel/workflow`).

## Rodada 2026-08-30 (push automático) — resto do crate `turborepo-auth`: `login.rs`, `sso.rs`, `logout.rs`, sem achado

Fila (`list-pending`) vazia no início desta rodada. Antes de sair para um
repositório novo, tentei primeiro brevemente `nitrojs/nitro` (sparse
clone) e `vercel-labs/agent-skills` (clone raso) — nenhum dos dois tem
superfície de auth/sessão própria digna de nota: `nitro` delega
gerenciamento de sessão/cookie para o pacote externo `h3` (fora deste
repositório, sem lógica de sessão vendorizada em `nitrojs/nitro` em si);
`vercel-labs/agent-skills` só tem um script de build local
(`packages/react-best-practices-build/src/build.ts`) que lê arquivos de
regras do próprio repositório em tempo de build, sem input de rede/
usuário externo. Voltei então para a sugestão pendente mais concreta:
terminar o crate `crates/turborepo-auth` do `vercel/turborepo`, que a
rodada anterior tinha deixado pela metade (só `device_flow.rs` e
`auth/mod.rs` lidos).

3 arquivos lidos por completo (sparse-clone de `crates/turborepo-auth` +
`crates/turborepo-paths`):

- `crates/turborepo-auth/src/auth/login.rs` (fluxo `login_redirect`/
  `wait_for_login_redirect` para self-hosted remote caches, e o
  wrapper do device flow para Vercel) — o servidor de callback local
  (`TcpListener` em `127.0.0.1:{port}`, nunca `0.0.0.0`) exige que o
  parâmetro `state` da query string bata exatamente com o CSRF state
  gerado (`generate_csrf_state`, 32 caracteres alfanuméricos via
  `rand::rng()` — CSPRNG do crate `rand`, ~190 bits de entropia,
  inviável de adivinhar por força bruta na janela de 5 minutos do
  timeout) antes de aceitar qualquer `token` — path clássico de bug
  neste tipo de fluxo (CLI OAuth local redirect sem checagem de state,
  vulnerável a um processo local malicioso "roubar" o próximo token que
  chegar) está mitigado corretamente, com teste próprio cobrindo
  rejeição de state ausente/divergente
  (`test_wait_for_login_redirect_rejects_missing_state`).
- `crates/turborepo-auth/src/auth/sso.rs` (mesmo padrão para o fluxo
  SSO self-hosted, `wait_for_sso_redirect`) — mesma proteção de CSRF
  state, mesma vinculação a `127.0.0.1`. Investiguei especificamente um
  possível open redirect: a função monta `redirect_location` reanexando
  TODOS os query params recebidos do callback local numa URL de
  notificação, mas o host dessa URL é sempre uma constante hardcoded
  (`https://vercel.com/notifications/cli-login-*`), nunca derivado de
  input do callback — reanexar params não permite trocar o host, então
  não haveria redirect para domínio arbitrário. Sem achado.
- `crates/turborepo-auth/src/auth/logout.rs` — fluxo de invalidação/
  remoção de token local. Único ponto observado sem ser um bug de
  segurança explorável: se a chamada de rede para invalidar o token no
  servidor (`token.invalidate`) falhar, `try_remove_token` propaga o
  erro via `?` **antes** de limpar o arquivo local — ou seja, um
  `turbo logout` que falha por erro de rede deixa o token ainda válido
  no disco (local, permissão 0600, não é uma exposição a terceiro).
  Comportamento defensável (não silenciosamente finge sucesso), mas
  vale nota de UX/qualidade, não é uma vulnerabilidade real (não há
  atacante externo capaz de explorar isso — exige já ter acesso de
  leitura ao arquivo, que já teria acesso ao token de qualquer forma).
  Não abri item na fila por isso.
- Verificação complementar em `crates/turborepo-paths/src/absolute_system_path.rs::create_with_contents_secret`
  (usada por `write_to_auth_file`/`write_to_config_file` em `lib.rs`
  para persistir o token em disco): no Unix, abre o arquivo já com
  `mode(0o600)` na criação E reafirma a permissão explicitamente depois
  (comentário do próprio código documenta o motivo: evitar janela de
  permissão permissiva se o arquivo já existisse antes com modo mais
  aberto). Sem achado.

Conclusão: crate `turborepo-auth` completo (todos os arquivos `.rs` de
`src/` e `src/auth/`, exceto testes/mensagens de UI triviais) agora
coberto nesta missão, sem nenhuma vulnerabilidade encontrada — é um
fluxo de autenticação CLI bem desenhado, com proteção deliberada contra
as classes de bug mais comuns desse tipo de fluxo (CSRF de callback
local, redirect de login sequestrado por `turbo.json` malicioso já
achado seguro em rodada anterior, permissão de arquivo de token).

`deep-read-log.json` atualizado (`vercel/turborepo` ganhou `login.rs`,
`sso.rs`, `logout.rs`, total agora 5 arquivos). Nenhum item novo
adicionado à fila — resultado normal. Repos do programa ainda
totalmente intocados: `vercel/ai`, `vercel/swr`, `vercel/eve`,
`vercel/ms`, `vercel/async-sema`, `nuxt/nuxt`, `sveltejs/svelte`,
`vercel-labs/skills` (parcial), `vercel/vercel` (parcial), `vercel/chat`
(parcial), `vercel/workflow` (parcial). `nitrojs/nitro` e
`vercel-labs/agent-skills` foram espiados nesta rodada mas não geraram
achado nem entrada de log formal (sem superfície de auth própria digna
de leitura linha-a-linha completa ainda).

## Rodada 2026-08-30 (v2 state machine, sessão cloud automática)

`list-pending` vazio. Revisitei o único `corroborated_static` do
programa (`sso.ts::waitForVerification`, loopback OAuth sem
state/nonce, RFC 8252 §8.3) sob a state machine nova. Confirmei via
`raw.githubusercontent.com/vercel/vercel/main/packages/cli-auth/
package.json` que o pacote `@vercel/cli-auth` é público
(`private:false`, `publishConfig.access:public`), sem `exports`
restringindo subpaths — `sso.js` é de fato importável por qualquer
consumidor npm, reforçando a descrição "used by Vercel's CLIs" (plural)
do pacote: é plausível que outra ferramenta CLI da Vercel (fora deste
monorepo) use esse caminho, mesmo sem uso confirmado dentro de
`packages/cli/src`. Não é dead code esquecido, é superfície pública
compartilhada com reachability não confirmada dentro do repo auditado.
Tentei `corroborated_static -> scope_verified` direto (achado não-Solidity,
sem validador disponível): recusado — a transição não existe sem passar
por `reproduced_local`, que por sua vez exige uma validação `pass`, hoje
só disponível pra Solidity (`foundry_poc`). Limitação real do sistema,
documentada em detalhe no NOTES.md do Circle BBP desta mesma rodada — não
forcei nem contornei. Fica em `corroborated_static`: achado real,
reportável com ressalva explícita de alcançabilidade, aguardando um
validador pra TS/JS que ainda não existe.

## Verificação independente (30/08/2026) — mesma conclusão, confirmada de novo por revisão humana assistida

Revisão humana assistida chegou à mesma conclusão da rodada acima, de
forma independente: reproduzi a busca de alcançabilidade (clone raso +
grep em todo `packages/cli` e `packages/cli-auth`) e confirmei, também
de forma independente, a ausência de campo `exports` no `package.json`
de `cli-auth` — os dois lados bateram na mesma evidência sem saber do
achado um do outro. Diferente dos precedentes desta missão
(`VitessQueryHintHandler`, `hermit+circl`) onde a não-alcançabilidade
dentro do repositório foi decisiva o bastante pra fechar como
falso-positivo, aqui a pergunta central (algum CLI real da Vercel, fora
deste monorepo público, chama isso?) não está resolvida em nenhuma
direção — confirmado duas vezes agora. Mantido em `corroborated_static`,
sem forçar um veredito terminal sem base.

## Rodada 2026-08-30 (push trigger seguinte) — `vercel/ai` (repo até então intocado) auditado; único achado `corroborated_static` do programa revisado sem transição

`list-pending` vazio de novo. Revisei o único `corroborated_static` do
programa (`packages/cli-auth/sso.ts::waitForVerification`, achado de
rodada anterior): reasoning já documenta com clareza que o código
vulnerável (callback loopback sem state/nonce, classe RFC 8252 §8.3)
não é alcançável pelo binário `vercel` publicado deste monorepo — só
`credentials-store.js` do pacote `@vercel/cli-auth` é importado por
`packages/cli/src`, nunca `sso.js`/`oauth.js`. Sem cadeia de chamada
fechada, correto ficar em `corroborated_static` — não tentei forçar
`reproduced_local` (achado TS sem exploit de rede real aplicável, e a
alcançabilidade em si já é o gap, não algo que uma PoC resolveria).

Leitura profunda proativa: abri `vercel/ai` pela primeira vez nesta
missão (estava na lista de "totalmente intocados" da rodada anterior).
Prioridade auth: `packages/gateway/src/gateway-realtime-auth.ts`, o
contrato compartilhado cliente/servidor que carrega o bearer token do
AI Gateway dentro do handshake `Sec-WebSocket-Protocol` (workaround
padrão da indústria pra WebSocket não suportar header `Authorization`
no browser — o próprio comentário do arquivo cita o precedente da
OpenAI, `openai-insecure-api-key.<token>`). Lido por completo: o
módulo só faz *encode/decode* do token e do team-scope
(base64url) pra dentro/fora da string de subprotocolo — não faz
nenhuma validação de autenticação ele mesmo; o comentário do cabeçalho
diz explicitamente que "the Gateway upgrade handler turns this into
an `Authorization: Bearer <token>` before its normal auth path", ou
seja a validação real acontece no caminho de auth normal depois da
extração, reaproveitado 1:1. Não encontrei um handler de servidor
real dentro do repo `vercel/ai` que consuma
`getGatewayRealtimeAuthToken`/`getGatewayRealtimeTeamIdOrSlug` (grep
`-r` por essas duas funções só retorna a própria definição, os
testes do pacote `gateway`, e o `getGatewayRealtimeProtocols` client-side
usado em `packages/react`) — o servidor de upgrade WebSocket em si
provavelmente vive no serviço AI Gateway hospedado (fora deste repo
open-source), então não dá pra confirmar aqui se o "normal auth path"
de fato aplica os mesmos controles a um token vindo de subprotocolo
vs. de header — mesma limitação estrutural de alcançabilidade já
documentada pra `cli-auth/sso.ts`. Sem achado nesta leitura (nem
sequer virou candidate: a lógica lida é só transporte, sem decisão de
autorização própria).

`deep-read-log.json` atualizado (`vercel/ai` — repo novo, 1 arquivo:
`packages/gateway/src/gateway-realtime-auth.ts`). Repos do programa
ainda totalmente intocados: `vercel/swr`, `vercel/eve`, `vercel/ms`,
`vercel/async-sema`, `nuxt/nuxt`, `sveltejs/svelte`. Nenhum item
elegível pra relatório nesta rodada.

## Rodada 2026-08-30 (push webhook, v2 state machine)

`list-pending` vazio (nenhum candidate novo do scanner automático).
Leitura profunda proativa: abri `vercel/eve` pela primeira vez (estava
na lista de intocados acima). Foco na superfície de autenticação de
canal/conector: `channel/auth/jwt-hmac.ts`, `channel/auth/jwt-ecdsa.ts`,
`channel/auth/token-claims.ts`, `shared/validate-authorization.ts`.

Rastreei a cadeia completa de verificação de JWT nas duas estratégias
(HMAC e ECDSA): ambas chamam `jwtVerify` da lib `jose` com o array
`algorithms` explicitamente restrito à estratégia resolvida (nunca
derivado do header do token) — sem risco de confusão de algoritmo
(`alg: none` ou HS/RS swap). `token-claims.ts::areTokenClaimMatchersSatisfied`
(usado por ambas as estratégias pra checar `sub`/claims extras depois
da verificação de assinatura) usa `matchesWildcardPattern`, que escapa
corretamente os metacaracteres de regex antes de converter `*` em
`.*` e ancora com `^...$` — sem bypass óbvio de wildcard nem risco de
ReDoS (o padrão vem de config autorada pelo dono da conexão, não do
token do chamador). `shared/validate-authorization.ts` é só validação
estrutural de schema pro `auth` autorado por quem define uma conexão
(não é ele mesmo um boundary de autorização em runtime). Sem achado
nesta leitura — nem virou candidate.

`deep-read-log.json` atualizado (`vercel/eve`, 4 arquivos, ver acima).
Repos do programa ainda totalmente intocados: `vercel/swr`, `vercel/ms`,
`vercel/async-sema`, `nuxt/nuxt`, `sveltejs/svelte`. Nenhum item
elegível pra relatório nesta rodada.

## Rodada 2026-08-30 (push webhook, segunda passada)

`list-pending` vazio de novo. Os 2 achados em `corroborated_static`
(sso.ts do Vercel, initiate_withdrawal.rs do Circle Solana) já tinham
sido re-verificados de forma independente mais cedo hoje (mesmo
`updatedAt`) com bloqueios genuínos documentados no reasoning — nada
novo pra fazer neles sem acesso que não tenho.

Leitura profunda proativa: abri `nuxt/nuxt` pela primeira vez (estava
na lista de intocados acima, tier 1 confirmado no scope snapshot).
Sparse-checkout de `packages/nuxt/src`, `packages/kit/src`,
`packages/vite-server`, `packages/nitro-server`. Grep por
auth/session/token/password/secret/permission/access apontou pra
`app/island-props.ts` (`findUnsafeIslandPropKey` — detecta uma chave
`template` em qualquer profundidade dentro de props de island, que
seria compilada e EXECUTADA pelo Vue runtime compiler se alcançasse
resolução de componente — classe de vuln real, RCE via island prop
injection).

Rastreei a cadeia completa: a função existe mas não é chamada em
nenhum lugar dentro de `packages/nuxt/src` (só `findReservedRootIslandPropKey`,
o guard do prop `as`, é usado em `island-renderer.ts`). Isso pareceu
suspeito no início — código de segurança definido mas nunca invocado.
Expandindo o sparse-checkout pra `packages/nitro-server` (o handler
HTTP real de `/__nuxt_island/*`, que eu tinha perdido no primeiro
grep por estar fora de `packages/nuxt`), encontrei a chamada real em
`nitro-server/src/runtime/handlers/island.ts::getIslandContext`:
`findUnsafeIslandPropKey(parsedProps)` roda DEPOIS da validação de
tamanho/profundidade do body e da checagem de hash, ANTES do render,
gated corretamente por `runtimeCompiler` (flag opt-in, default false,
lido de `#internal/nuxt.config.mjs`), e não vaza no response de
produção se a runtime compiler está presente (só loga em
`import.meta.dev`) — exatamente pra não dar a um chamador não
autenticado um oráculo de qual build está rodando.

Verifiquei os componentes auxiliares em busca de bypass:
`filterIslandProps`/`getIslandHash` (`app/island-hash.ts`) só removem
atributos `data-v-*` e calculam um hash de conteúdo (`ohash`, sem
segredo do servidor — é consistência de cache/URL, não um boundary de
auth, então não substitui o guard). `slots`/`components` no contexto
retornado por `getIslandContext` são hardcoded pra `{}` nesse ponto do
fluxo (não vêm do request), fechando essa rota de injeção alternativa.
Não achei bypass. Código bem projetado, defesa em profundidade real —
sem achado, não virou candidate.

`deep-read-log.json` atualizado (`nuxt/nuxt`, 4 arquivos, ver acima).
Repos do programa ainda totalmente intocados: `vercel/swr`, `vercel/ms`,
`vercel/async-sema`, `sveltejs/svelte`. Nenhum item elegível pra
relatório nesta rodada.

## Rodada 2026-08-30 (leitura profunda proativa, passo 4 avulso) — `vercel/swr` (repo até então intocado) auditado, sem achado

`list-pending` vazio. Abri `vercel/swr` pela primeira vez nesta missão
(estava na lista de "totalmente intocados"). Como SWR é uma lib
client-side de data-fetching/cache sem superfície clássica de
auth/session, priorizei o componente mais sensível a bug de lógica com
impacto de segurança real: `src/_internal/utils/hash.ts::stableHash`, a
função que gera a chave de cache estável a partir dos argumentos de
`useSWR` (array/objeto/string). Um bug de colisão aqui teria impacto
concreto — duas chaves de request DIFERENTES colapsando na mesma chave
de cache podem levar a servir dado de um recurso para uma request de
outro recurso (confusão de cache), o tipo de bug que a documentação
oficial do SWR já alerta para não reusar globalmente entre requests
sem escopo por usuário.

Rastreei a lógica linha a linha: usa prefixos de tipo distintos por
formato (`@` para array, `#` para objeto plano, WeakMap+contador para
outros objetos/Map/Set/Function, string via `JSON.stringify` — portanto
sempre entre aspas, o que separa `"123"` de `123` sem aspas — número/
boolean/undefined via `''+arg`) — não encontrei par de entradas de tipo
diferente que produza a mesma string de saída (os prefixos e a
serialização de string via `JSON.stringify` evitam ambiguidade entre
tipos). Para objetos, as chaves são ordenadas (`Object.keys(arg).sort()`)
antes de concatenar, garantindo que `{a:1,b:2}` e `{b:2,a:1}` colidam
DE PROPÓSITO (mesma chave lógica, comportamento correto e documentado,
não bug). WeakMap identity-based cache evita reentrância infinita em
referência circular (grava o placeholder antes de recursar). Não achei
uso de `arg[index]` como sink de escrita (só leitura via
`Object.keys`), então sem risco de prototype pollution nessa função.
Sem achado — função pequena, mas already hardened; não abri mais
arquivos deste repo pra não gastar o orçamento desta rodada num só alvo
sem sinal concreto de problema.

`deep-read-log.json` ganhou chave nova `vercel/swr` (1 arquivo).
Repos do programa ainda totalmente intocados: `vercel/ms`,
`vercel/async-sema`, `sveltejs/svelte`. Nenhum item
elegível pra relatório nesta rodada.

## Rodada 2026-08-30 (fila vazia, leitura profunda proativa) — nitrojs/nitro

Fila de findings (`list-pending`) veio vazia nesta rodada, então segui
direto pra leitura profunda proativa. `nitrojs/nitro` (o motor de
servidor por trás do Nuxt, incluído no escopo do programa) nunca tinha
sido lido pelo sistema. Busquei por nomes de arquivo com
auth/session/token/admin/permission/access/cookie/csrf em todo
`src/` — só achei `examples/middleware/server/middleware/auth.ts`
(exemplo de documentação, não código de produção do framework, então
não conta como leitura útil).

Sem candidato óbvio de auth, apliquei julgamento de especialista: o
padrão de vulnerabilidade mais valioso num motor de servidor estático é
path traversal no serving de assets. Li os 3 arquivos que compõem esse
fluxo real:

- `src/runtime/internal/static.ts` — handler HTTP de `GET`/`HEAD` pra
  assets públicos. Decodifica o path da URL (`decodePath`) e usa como
  chave de lookup (`getAsset(id)`), nunca concatenado diretamente num
  path de filesystem.
- `src/build/virtual/public-assets.ts` — gera em BUILD TIME (não em
  runtime) um dicionário fixo `assets[assetId] = {..., path: relative(...)}`
  via glob sobre `publicDir`; o handler `readAsset(id)` do preset node
  faz `resolve(serverDir, assets[id].path)` — mas `assets[id].path` vem
  do dicionário pré-computado no build, nunca do `id` da request. Se o
  `id` da request não bate com nenhuma chave do dicionário, `assets[id]`
  é `undefined` e o `static.ts` já filtra isso antes de chamar
  `readAsset` (linha `if (!asset) { ... return }`).
- `src/runtime/internal/storage.ts` — wrapper trivial de `useStorage`/
  `prefixStorage` (unstorage), sem exposição HTTP direta nesse arquivo;
  não encontrei rota HTTP tipo devtools `/_storage` neste repo (deve
  estar em pacote separado do monorepo Nitro, não presente aqui).

Conclusão: mesmo padrão seguro de "lookup por chave num mapa
pré-computado" já visto no achado do `nuxt/nuxt` (island hash) —
o `id` vindo da request nunca chega a virar path de filesystem
diretamente, só serve de chave de objeto. Sem achado, não virou
candidate. `deep-read-log.json` atualizado (`nitrojs/nitro`, 3
arquivos). Repos ainda intocados no programa: `vercel/ms`,
`vercel/async-sema`, `sveltejs/svelte`, `vercel-labs/agent-skills`.


## Rodada 2026-08-30 (leitura profunda proativa, passo 4 avulso, rodada paralela) — `sveltejs/svelte` (repo até então intocado) auditado, sem achado

`list-pending` vazio. Sem achados novos pendentes de reavaliação nos
3 itens não-terminais existentes (`corroborated_static`/`inconclusive`
em Vercel/Circle/Block) — já tinham verificação independente completa
registrada mais cedo hoje, sem evidência nova pra mudar decisão nesta
rodada; não reabertos pra evitar retrabalho idêntico.

Abri `sveltejs/svelte` pela primeira vez (confirmado em escopo real via
`scope-snapshots/vercel-open-source.json`: listado explicitamente como
asset "Tier 1 OSS" — "Please assign this to any project involving the
svelte repo"). Como é um compilador/framework, priorizei a superfície
clássica de XSS server-side: a função central de escaping usada pelo
SSR (`packages/svelte/src/escaping.js::escape_html`), sua consumidora
de atributos (`internal/shared/attributes.js::attr`), a montagem de
atributos via spread no SSR (`internal/server/index.js::attributes()`,
que processa `{...obj}` em elementos) e os dois blocos `{@html ...}`
(server e client).

Rastreei a cadeia com ceticismo: `escape_html` escapa `&`/`<` (texto)
ou `&`/`"`/`<` (atributo) — não escapa `'` nem `>`, mas isso é seguro
porque todo atributo gerado é sempre entre aspas duplas (`="${...}"`,
`attributes.js:34`) e `>` solto em texto não inicia tag em HTML. Testei
a hipótese mais promissora — spread de atributos arbitrários vindo de
objeto controlado por dado (`<div {...userObj}>`) poderia injetar HTML
via NOME do atributo, já que só o VALOR passa por `escape_html` (nome
vai direto pra string sem escapar, `index.js:171`). Confirmei que existe
de fato uma defesa dedicada: `INVALID_ATTR_NAME_CHAR_REGEX`
(`internal/server/index.js:30-31`) rejeita qualquer nome contendo
espaço, `'`, `"`, `>`, `/`, `=` (cita a spec WHATWG de nomes de atributo
válidos como referência) — bloqueia exatamente o vetor que eu esperava
explorar. `{@html}` (ambos os lados) é intencionalmente não-escapado
por design documentado (equivalente ao `dangerouslySetInnerHTML` do
React), não é bug. `sanitize_template_string.js` (usado em geração de
template literal pelo compilador) escapa corretamente backtick/`${`/
backslash. Sem achado — superfície bem endurecida, com defesa
específica pro vetor que tentei refutar primeiro.

`deep-read-log.json` ganhou chave nova `sveltejs/svelte` (6 arquivos).
Nenhum item elegível pra relatório nesta rodada.

## Rodada 2026-08-31 (push automático) — `list-pending` vazio; leitura profunda em `vercel/vercel` (fluxo de login/reauth)

`list-pending` vazio (0 candidatos) e os 2 achados não-terminais restantes
no sistema (Circle BBP/Solana denylist em `corroborated_static`, Circle
BBP/stablecoin-evm em `inconclusive`) já tinham verificação independente
completa registrada em rodadas anteriores hoje mesmo — não reabertos sem
evidência nova, pra evitar retrabalho idêntico.

Varri os scope snapshots dos 4 programas em busca de assets de código-fonte
ainda sem nenhuma entrada em `deep-read-log.json`: `vercel-labs/agent-skills`
(pacote `react-best-practices-build`, clonado e inspecionado — só parser/
build/migrate de um linter de boas práticas React, sem superfície de auth/
rede/crypto) e `vercel/ms`/`vercel/async-sema` (utilitários triviais) — nenhum
continha caminho batendo com as palavras-chave prioritárias
(auth/session/crypto/token/login/...), então não abriram achado nem
consumiram uma das 3 vagas desta rodada.

Em vez disso, aprofundei dentro de `vercel/vercel` (já parcialmente coberto)
no pacote `packages/cli-auth` (esgotado: `oauth.ts`/`sso.ts`/
`credentials-store.ts` já lidos antes; `user-agent.ts` é só string de UA) e
achei 3 arquivos do fluxo de login/reautenticação ainda não lidos:
`packages/cli/src/commands/login/index.ts` (parsing de flags, delega pra
`future.ts` já auditado — sem lógica de auth própria),
`packages/cli/src/util/login/reauthenticate.ts` (dispara o mesmo device-code
flow de `future.ts` quando a API retorna erro SAML com `teamId`; testei a
hipótese de o CLI aceitar/gravar um token sem validação de escopo local —
não existe: o cliente só persiste o `access_token` devolvido pelo próprio
endpoint OAuth da Vercel após aprovação humana no browser, a imposição real
de escopo/SAML é 100% server-side, fora do que dá pra auditar por código-fonte)
e `packages/cli/src/util/login/update-current-team-after-login.ts` (seta
`currentTeam` a partir de `ssoTeamId` do próprio fluxo de login ou do
`defaultTeamId` do usuário já autenticado via `getUser` — sem tomada de
decisão de autorização local). Rastreei o chamador de `reauthenticate`
(`client.ts::Client.reauthenticate`, usado no interceptor de retry de
`fetch`) pra confirmar que não há reuso indevido do token antigo nem bypass
do fluxo de aprovação. Sem achado — mesmo padrão de "confiar no backend,
que é o ponto de aplicação real" já visto nas rodadas anteriores de
`oauth.ts`/`sso.ts`.

`deep-read-log.json` atualizado (`vercel/vercel` ganhou 3 arquivos:
`login/index.ts`, `login/reauthenticate.ts`,
`login/update-current-team-after-login.ts`). Nenhum achado novo nesta
rodada — resultado normal.

## Rodada 2026-08-31 (ZeroToOne v2, disparada por push automático)

`list-pending` vazio. Os 2 achados em `corroborated_static`/`inconclusive`
já tinham verificação independente completa registrada em rodadas
anteriores (Vercel `cli-auth/sso.ts` incluso) — não reabertos sem evidência
nova.

Leitura profunda focou em `vercel/turborepo` (já parcialmente coberto:
`turborepo-auth/src/{device_flow,auth/{mod,login,sso,logout}}.rs` lidos
antes). Hipótese testada desta rodada: será que um repositório malicioso
consegue, via `turbo.json` commitado (`remoteCache.apiUrl`/`loginUrl`),
redirecionar o fluxo de login/token da vítima para um servidor do
atacante — o mesmo padrão de "config de projeto não-confiável sobrescreve
endpoint de auth" que já rendeu achado em outras ferramentas de monorepo?

Rastreei a cadeia completa: `turborepo-config/src/lib.rs` e
`turbo_json.rs` (novos, não lidos antes) mostram que `apiUrl`/`loginUrl`
PODEM de fato vir de `turbo.json` (`ConfigurationSource::TurboJson`), e o
próprio código de config já rastreia a origem de cada valor
(`api_url_source`/`login_url_source`) — inclusive com um teste chamado
literalmente `test_turbo_json_url_sources_are_recorded` usando
`https://attacker.test/api` como valor de exemplo, sinal de que a equipe
já modelou esse cenário de ataque deliberadamente.

Segui o rastro até o ponto de uso real
(`turborepo-lib/src/commands/login/mod.rs`, novo) e daí para
`turborepo-auth/src/auth/mod.rs::ensure_non_vercel_redirect_allowed`
(função já existente, mas meu foco anterior nela era outro). Confirmado:
a) o fluxo Vercel real (`is_vercel_login`) só é escolhido se o host do
`login_url` bate exatamente com `vercel.com`/`*.vercel.com`
(`is_vercel_host`, comparação de sufixo correta — não `contains`, sem
brecha tipo `vercel.com.attacker.com`); b) nesse caso `ensure_trusted_vercel_api`
TAMBÉM exige que o `api_client.make_url("")` aponte pra um host Vercel
confiável antes de prosseguir — protege contra o caso de login_url
correto mas api_url separadamente sequestrado; c) no caminho não-Vercel
(`login_redirect`, pensado para remote-cache self-hosted legítimo),
`ensure_non_vercel_redirect_allowed` exige que TANTO `login_url_source`
quanto (quando `api_url` não é host Vercel) `api_url_source` sejam
`Cli`/`Environment`/`GlobalConfig` — `TurboJson` está deliberadamente
EXCLUÍDO dessa lista (`is_user_controlled_url_source`). Ou seja: um
`turbo.json` malicioso committado no repo NÃO consegue, sozinho,
redirecionar login/token pra fora do Vercel — a função retorna erro antes
de abrir o browser ou trocar qualquer token. Testes dedicados já cobrem
exatamente isso (`test_vercel_login_rejects_untrusted_api_url`,
`test_vercel_sso_rejects_untrusted_api_url`). Hipótese refutada — mitigação
real e testada, não uma lacuna.

Nota lateral (não é achado, é observação de baixo risco só documentada):
`should_skip_existing_token_for_login`/`looks_like_vercel_substring` (em
`auth/mod.rs`) usa uma checagem fraca (`contains("vercel.com")`, não
`is_vercel_host`) — mas essa função só decide se um token JÁ EXISTENTE em
disco é reaproveitado ou se um login novo é forçado, não participa do
gate de segurança real (`ensure_non_vercel_redirect_allowed`, que usa a
checagem forte). Na pior hipótese o efeito de uma checagem fraca aqui é
forçar um login novo com mais frequência do que o necessário — não abre
caminho pra vazamento de token. Sem ação necessária.

`deep-read-log.json` atualizado (`vercel/turborepo` ganhou 5 arquivos:
`turborepo-auth/src/lib.rs`, `turborepo-api-client/src/lib.rs`,
`turborepo-config/src/lib.rs`, `turborepo-config/src/turbo_json.rs`,
`turborepo-lib/src/commands/login/mod.rs`). Nenhum achado novo nesta
rodada — resultado normal (hipótese de ataque real testada e refutada
por controle já existente no código, não por falta de tentativa).

## Rodada 2026-08-31 (push trigger seguinte) — sem candidatos novos, leitura profunda em `vercel/ai` (harness sandbox network policy)

`list-pending` vazio. Os 2 achados legados em `corroborated_static`
(Vercel `cli-auth/sso.ts` alcançabilidade, e Solana denylist do Circle
BBP) seguem sem insumo novo desde a última re-verificação exaustiva —
não reabertos.

Leitura profunda proativa em `vercel/ai` (só 1 arquivo coberto antes,
`packages/gateway/src/gateway-realtime-auth.ts`). Escolhi a superfície de
controle de acesso de rede do sandbox de execução de agente (`packages/harness`
+ `packages/sandbox-vercel`) — é onde código gerado/potencialmente não
confiável roda dentro de um sandbox, e a política de rede + injeção de
credencial em requisições de saída é exatamente o tipo de controle de
acesso que merece ceticismo (clone raso via `git clone` público):

- `packages/harness/src/utils/get-restricted-sandbox-session.ts` e
  `packages/harness/src/v1/harness-v1-network-sandbox-session.ts` —
  definição de tipos/interface da "visão restrita" da sessão de sandbox
  (`restricted()`: expõe só I/O de arquivo + exec, nunca `stop`/`destroy`/
  `setNetworkPolicy`). Confirmado explicitamente no próprio comentário do
  código que essa restrição é de superfície TypeScript (para o código
  interno do harness não chamar por engano os métodos de infraestrutura),
  não uma fronteira de segurança contra processo malicioso rodando DENTRO
  do sandbox — o enforcement real de rede acontece no lado do provedor
  (Vercel Sandbox), fora deste repositório.
- `packages/sandbox-vercel/src/vercel-sandbox-session.ts` e
  `vercel-network-sandbox-session.ts` — implementação concreta. `restricted()`
  retorna um novo `VercelSandboxSession` sobre o MESMO `Sandbox` subjacente
  (campera `protected readonly sandbox`) — em runtime JS puro isso não é uma
  barreira de reflexão, mas o consumidor legítimo (código do harness, não
  o processo dentro do sandbox) só enxerga os métodos do tipo `SandboxSession`
  — consistente com o design documentado, não um bug.
- `packages/sandbox-vercel/src/vercel-network-policy-manager.ts` (755
  linhas, leitura completa) — a peça mais sensível: compõe a política de
  rede (`allow-all`/`deny-all`/`custom` com CIDR allow/deny) E as regras de
  transformação de requisição (injeção de header de credencial fora do
  sandbox, nunca visível para o processo sandboxed) num único `NetworkPolicy`
  enviado a `sandbox.update()`. Ceticismo aplicado especificamente em
  `intersectHostPatterns`/`isHostPatternSubset` (a lógica que decide a quais
  padrões de host uma regra de transformação de credencial fica anexada):
  testei mentalmente casos de wildcard (`*`, `*.example.com` vs host
  concreto, vs wildcard mais específico) — em todos os casos testados a
  interseção retorna corretamente o padrão MAIS ESTREITO dos dois, nunca
  mais amplo que o host original da transformação nem mais amplo que o
  host permitido pela política de acesso. Único ponto residual notado (não
  é achado, é observação): `isHostPatternSubset` só reconhece limite de
  subdomínio quando o padrão wildcard tem literalmente um ponto após o
  `*` (ex. `*.example.com`); um padrão malformado tipo `*example.com` (sem
  ponto) casaria também com `evilexample.com` — mas `allowedHosts`/
  `ruleHost` vêm da configuração do desenvolvedor/harness que monta a
  sessão, não de conteúdo não confiável, então não é uma superfície
  explorável por um atacante — só um jeito de o desenvolvedor se
  configurar mal, já mitigável escrevendo `*.example.com` corretamente.
  Sem achado.

`deep-read-log.json` atualizado (`vercel/ai` ganhou 5 arquivos, agora 6 no
total). Nenhum achado novo nesta rodada — resultado normal.

## Rodada 2026-08-31 (push automático, máquina de estados v2) — fila vazia, leitura profunda em `vercel/vercel` (OIDC/Connect), sem achado

`list-pending` global = 0 (confirmado via `migrate-to-v2.mjs` + `list-pending`).
Revisitados os 2 achados legados em `corroborated_static` fora deste
programa (SSO Vercel `cli-auth/sso.ts::waitForVerification`, confidence
"baixa", e denylist Solana Circle) — ambos já exaustivamente
investigados em rodadas anteriores (checagem de duplicata, escopo,
alcançabilidade) sem evidência nova disponível nesta rodada; nenhuma
ação adicional tomada para não repetir esforço já esgotado. Achado
Circle/Solana especificamente: confirmado que o ambiente cloud atual
tem espaço em disco suficiente (30G livre) pro toolchain Solana/Anchor
que a rodada anterior tinha marcado como bloqueado por falta de disco —
mas construir esse validador está fora do escopo desta rodada (a regra
do sistema é clara: não inventar validador pra achado não-Solidity sem
pedido explícito do usuário para esse investimento específico).

Leitura profunda proativa — 3 arquivos novos em `vercel/vercel`
(clonado via `git clone` raso), priorizando superfície OIDC/OAuth:

- `packages/oidc/src/verify-vercel-oidc-token.ts` (184 linhas,
  completo) — wrapper de `jose.jwtVerify` contra o JWKS remoto de
  `oidc.vercel.com`. Ceticismo aplicado ao caso `projectId: '*'`: o
  código exige explicitamente `ownerId` OU `audience` quando
  `projectId` é wildcard (`hasAudienceVerification`), evitando que um
  wildcard descontrolado aceite QUALQUER token OIDC válido de QUALQUER
  projeto Vercel. `algorithms` default é `['RS256']` (não aceita
  `none`/HMAC por padrão); pode ser sobrescrito pelo chamador, mas isso
  é opção documentada do SDK, não uma falha da lib. Validação de
  `iss`/`project_id`/`environment`/`owner_id` todas corretas e com
  fallback seguro (lança erro se claim esperada não fornecida nem via
  opção nem via env var, nunca aceita silenciosamente). Sem achado.
- `packages/connect/src/mcp/connect-auth-provider.ts` (256 linhas,
  completo) — adapta o `OAuthClientProvider` do MCP pra Vercel Connect.
  `saveTokens`/`saveCodeVerifier` são no-ops documentados (Connect
  possui PKCE e persistência de token no lado do servidor); `tokens()`
  delega pra `getTokenResponse` (não lido nesta rodada, já citado como
  dependência). Nenhuma lógica de verificação de assinatura acontece
  aqui — é só orquestração de client, não achado.
- `packages/connect/src/eve/connect-oauth.ts` (301 linhas, completo)
  — `AuthFn` de gateway pra tokens OAuth do Connect. Ponto investigado
  a fundo: `decodeJwtPayload` faz um decode BASE64 SEM verificação de
  assinatura só pra escolher a lista de `audiences`/política de
  `connector` ANTES de chamar `verifyOidc` (verificação criptográfica
  real, em `eve/channels/auth`, lido via clone de `vercel/eve`). Testei
  se isso permite bypass: não permite — o decode não-verificado e a
  verificação real operam sobre os MESMOS bytes do token (mesma string
  JWT), então se `verifyOidc` aceita o token, o payload que o
  pre-check leu já era genuíno; se o token for forjado, `verifyOidc`
  rejeita (retorna `ok:false` → função retorna `null`) independente do
  que o pre-check "achou". Único ponto notado: a política de
  `connectors` (`clientId`/`clientUid`) só é aplicada no pre-check
  não-verificado, nunca incluída nos `claims` passados pra `verifyOidc`
  (`buildClaimMatchers` só adiciona `tenantId`/`installationId`/`typ`)
  — mas como estabelecido acima, isso não abre brecha real porque
  ambos os decodes leem o mesmo payload assinado. Confirmado lendo
  `verifyOidc`/`runOidcVerification` em `vercel/eve` (clone separado,
  `packages/eve/src/public/channels/auth.ts`) — delega a verificação
  de assinatura pra `authenticateOidcStrategy`, não reimplementada
  aqui. Sem achado.

`deep-read-log.json` atualizado (`vercel/vercel` ganhou 3 arquivos,
agora 15 no total). Nenhum achado novo nesta rodada — resultado normal.

## Rodada 2026-08-31 — fila vazia, leitura profunda em vercel-labs/agent-skills

Fila de `candidate` vazia (0 pendentes). Sem trabalho de máquina de
estados a fazer nesta rodada. Leitura profunda proativa: alvo novo
`vercel-labs/agent-skills` (ainda não tinha entrada em
`deep-read-log.json`), clonado publicamente via `git clone --depth 1`.
Repositório é majoritariamente conteúdo de skills em Markdown; a
superfície de código real fica nos dois workflows do GitHub Actions em
`.github/workflows/`:

- `agent-skills-discovery.yml` — job `validate` roda em `pull_request`
  (não `pull_request_target`), sem `secrets`, permissions
  `contents: read` — contexto seguro pra PR de fork, nada a explorar.
  Job `publish` só roda em `push` pra `main` (não em PR), usa
  `github.token` (`GH_TOKEN`) só pra `gh release`, e as únicas
  interpolações no `run:` são `github.sha`/`github.repository` — não
  são strings controláveis por um atacante externo nesse evento. Sem
  injeção de comando via campo de PR (title/body/branch) porque nada
  disso é interpolado em `run:`.
- `react-best-practices-ci.yml` — build/validate padrão com pnpm, sem
  segredos, sem interpolação de conteúdo externo em `run:`. Sem achado.

Nenhum achado novo. `deep-read-log.json` ganhou a chave
`vercel-labs/agent-skills` com os 2 arquivos lidos.

## Rodada 2026-08-31 — fila vazia, leitura profunda em vercel/ms e vercel/async-sema

Fila de `candidate` vazia. Sem trabalho de máquina de estados novo pro
achado já existente em `corroborated_static` (`packages/cli-auth/sso.ts`,
`waitForVerification`/`reauthorizeTeam`) — nenhuma fonte nova foi
encontrada nesta rodada sobre alcançabilidade externa (nenhuma
verificação adicional tentada, pra não repetir a mesma busca exaustiva
já feita duas vezes; fica como está, aguardando decisão humana).

Leitura profunda proativa: dois alvos do snapshot de escopo ainda sem
entrada em `deep-read-log.json` — `vercel/ms` e `vercel/async-sema`,
ambos repositórios pequenos (um único arquivo-fonte relevante cada).

- `vercel/ms` (`src/index.ts`): parser de string tipo "2h"/"1d" pra
  milissegundos. Já é a versão hardened pós-CVE-2015-8315 (limite
  explícito de 100 chars de entrada antes de rodar a regex, e a regex
  em si — `-?\d*\.?\d+ *(unit)?` — não tem quantificadores aninhados
  vulneráveis a ReDoS catastrófico). Sem achado.
- `vercel/async-sema` (`src/index.ts`): semáforo/rate-limiter genérico
  em cima de uma Deque circular. Não processa entrada não-confiável
  (é uma primitiva de controle de concorrência, não parser), sem lógica
  de auth/crypto. Sem achado.

`deep-read-log.json` atualizado com as duas chaves novas. Nenhum
achado nesta rodada — resultado normal.

## Rodada 2026-08-31 (2) — fila vazia, leitura profunda em vercel/vercel (`packages/connect`)

Fila de `candidate` vazia (também nada em `corroborated_static`/
`reproduced_local` com trabalho pendente nesta rodada — a única entrada em
`corroborated_static` continua `packages/cli-auth/sso.ts::waitForVerification`,
já documentada nas rodadas anteriores, sem fonte nova).

Leitura profunda proativa em `vercel/vercel`, pacote `@vercel/connect`
(cliente do Vercel Connect — provisiona/autoriza conectores OAuth de
terceiros pra agentes rodando em deployments Vercel). Arquivos ainda não
cobertos por `deep-read-log.json`, priorizados por nome (`authorization`,
`token`, `credentials`):

- `packages/connect/src/authorization.ts` (`startAuthorization`): valida
  `callbackUrl`/`webhook` via `internal/url-validation.ts` antes de
  montar o POST pra `api.vercel.com/v1/connect/authorize/:connector`.
- `packages/connect/src/internal/url-validation.ts`: `callbackUrl` exige
  `https:` ou `http://localhost`/`http://*.localhost`/`http://127.0.0.1`;
  `webhook` exige `https:` estrito. Sem bypass óbvio (não aceita
  `javascript:`, `data:`, IPs alternativos tipo `0.0.0.0`/octal/decimal não
  testados a fundo, mas o uso é registrar destino de redirect/webhook
  controlado pelo próprio operador do conector, não um input de
  atacante externo — risco residual baixo mesmo que houvesse um bypass
  de hostname).
- `packages/connect/src/eve/connection-authorization.ts` (`connect()`,
  helper que gera a `AuthorizationDefinition` do framework Eve): mapeia
  `principal` -> `ConnectTokenSubject` corretamente (`user` inclui
  `id`+`issuer`, nunca só `id`), `evict()` só derruba a entrada de cache
  do `principal` resolvido (não zera o cache inteiro, exceto quando
  `revoke:true`, que é o comportamento documentado/esperado). Sem
  confusão entre principals nem escalação de `app`->`user` visível.
- `packages/connect/src/token.ts` (`getTokenResponse`/`revokeToken`/cache
  em processo): chave de cache é `JSON.stringify({connector, ...params})`
  — inclui `subject` inteiro (tipo+id+issuer), então dois usuários
  distintos nunca colidem na mesma entrada. `revokeToken` dá
  `cache.clear()` (zera cache de *todos* os conectores/usuários no
  processo) — ineficiente mas falha fechado (força re-fetch, não vaza
  nem serve token errado), não é vulnerabilidade.

Nenhum achado novo — código de autorização bem cotovelado, sem confusão
de tenant/principal nem validação de URL claramente contornável a partir
de input de atacante externo. `deep-read-log.json` atualizado com os 4
arquivos acima sob a chave `vercel/vercel`.

## Rodada 2026-08-31 (push 3a7dabd) — fechamento do achado SSO como
inconclusive

Fila de `candidate` vazia. Retomei o achado `corroborated_static`
(`packages/cli-auth/sso.ts`, `waitForVerification`/`reauthorizeTeam`,
`confidence="baixa"`) que rodadas anteriores deixaram em aberto após
busca exaustiva (API GitHub bloqueada por auth, registro npm inteiro
do escopo `@vercel/*` enumerado, socket.dev bloqueado por checkpoint).
Desta vez, em vez de mais uma busca via API/HTML, fiz `git clone
--sparse` real de `vercel/vercel` (`packages/cli/src` +
`packages/cli-auth`) e rodei `grep` direto no código-fonte: o único
import de `@vercel/cli-auth` em `packages/cli/src` é
`credentials-store.js` (sem relação); `waitForVerification`/
`reauthorizeTeam` não aparecem em nenhum arquivo fora do próprio
`sso.ts` que as declara. Isso é uma confirmação definitiva (leitura
direta do código real, não inferência de busca) de que não há
chamador dentro do monorepo público. O padrão de código (callback
loopback OAuth sem state/nonce, RFC 8252 §8.3) continua real e
tecnicamente correto de apontar, mas sem alcançabilidade demonstrável
dentro do escopo auditável — não dá pra decidir entre "vulnerabilidade
real" e "código morto/produto externo não verificável", então
transicionei pra `inconclusive` (não é `false_positive`: o padrão de
código é genuíno; não ficou preso pra sempre em `corroborated_static`
sem trabalho produtivo restante). `update-finding` + `transition ...
inconclusive` ambos com sucesso.

Nenhum achado novo nesta rodada.

## Rodada 2026-08-31 (push d0643e1) — achado novo em `vercel-labs/skills` (sanitização de terminal)

Fila de `candidate` vazia. Sem trabalho novo nos achados já existentes
em `corroborated_static`/`reproduced_local`/`inconclusive` (essa parte
já foi tratada em paralelo por outra execução desta mesma rotina sobre
o mesmo push, vista no histórico do Git como o commit imediatamente
anterior a este).

Leitura profunda proativa fechou os dois arquivos que estavam marcados
"(parcial)" em `deep-read-log.json` sob `vercel-labs/skills`
(`src/installer.ts` completo — `sanitizeName`/`isPathSafe`/
`writeSkillFiles` — e `src/update.ts` completo). Ambos seguem corretos:
`isPathSafe` usa `resolve()+normalize()` com checagem de prefixo com
separador (não vulnerável ao bug clássico de `startsWith` sem `sep`),
`sanitizeName` sobrevive a `..`/`../../etc` (o regex de strip de bordas
remove runs de `.`/`-` só no início/fim, e como não há `/` restante
após a sanitização não há como reconstruir travessia real), e
`update.ts` já documenta explicitamente (em comentário) por que usa
`shell: false` + `process.execPath` absoluto para não permitir injeção
de comando via `installUrl`/`ref` vindos do lock file. Sem achado nesses
dois arquivos.

Isso levou a uma leitura nova: `src/sanitize.ts`
(`stripTerminalEscapes`/`sanitizeMetadata`), a função que o próprio
projeto usa para sanear nome/descrição de skill (dado não confiável —
vem de `SKILL.md` remoto ou da API `skills.sh`) antes de imprimir no
terminal do usuário, com defesa documentada contra CWE-150 (terminal
escape injection). **Achado novo**: as 6 regexes do arquivo têm uma
lacuna real — testei isso rodando o código real das regexes isolado
(sem rede, puramente determinístico) e confirmei que um ESC (`0x1b`)
que aparece (a) como último byte da string, ou (b) seguido de um byte
fora de `0x20-0x7e`, sobrevive intacto a `sanitizeMetadata()`, porque
`SIMPLE_ESC_RE` exige o próximo char em `0x20-0x7e` e `CONTROL_RE`
exclui `0x1b` de propósito (assumindo que as regexes de sequência já
cobrem todo ESC, o que não é verdade nesses 2 casos de borda). Isso
contradiz a garantia do próprio docblock ("Strips ALL terminal escape
sequences"). Rastreei os ~12 call-sites de `sanitizeMetadata` no repo
inteiro (`list.ts`, `find.ts`, `update.ts`, `blob.ts`, `skills.ts`,
`providers/wellknown.ts`) tentando refutar/avaliar impacto real: em
todo call-site encontrado, o valor saneado é sempre seguido, no
template literal, por um código ANSI hardcoded do próprio app (ex.
`${RESET}`, que começa com um novo ESC e por convenção de parser de
terminal cancela/absorve o ESC órfão anterior) ou por um separador
literal seguro (`", "`, espaço de `padEnd`) — não encontrei dois campos
vindos de fontes remotas encostados sem separador do app no meio, então
não montei uma sequência CSI/OSC completa controlada de ponta a ponta
pelo atacante hoje. Registrado como
`terminal_escape_injection_risk` (`sanitize.ts::stripTerminalEscapes`),
confidence "média" (defeito real e verificável na função, garantia
documentada é falsa nesses 2 casos de borda, mas impacto atual mitigado
pela forma como cada call-site existente envolve o valor — um reforço
de hardening a corrigir, não uma exploração completa demonstrada hoje).
Avançou `candidate` → `corroborated_static`. `check-scope "Vercel Open
Source" "vercel-labs/skills"` → `allowed=true`/`bountyEligible=true`;
deployment evidence registrada com `confidence="unverified"` (não
confirmei se o HEAD lido corresponde ao pacote publicado no npm/versão
exata do `npx skills`). Tentativa de `scope_verified` recusada pela
máquina de estados como esperado (mesmo caminho documentado nas notas
do Circle BBP — não existe aresta direta `corroborated_static` →
`scope_verified`; sem validador local para achados não-Solidity, o
achado fica em `corroborated_static` até decisão humana).

`deep-read-log.json` atualizado: `vercel-labs/skills` ganhou
`src/sanitize.ts`, `src/list.ts`, `src/find.ts`, e os dois arquivos
parciais viraram completos.

## Rodada 2026-08-31 (push automático, sessão cloud) — fila vazia, leitura profunda em `vercel/eve` (auth de canal HTTP)

`list-pending` global = 0. Revisitados os 2 achados legados fora deste
programa em estado intermediário (SSO `vercel/cli-auth` em
`corroborated_static`, denylist Solana Circle em `reproduced_local`) —
ambos já têm investigação exaustiva e recente (30-31/08) registrada no
próprio `reasoning`, nada de novo para acrescentar nesta rodada
(`api.hiro.so` também segue bloqueado nesta sessão cloud, mesmo
resultado já documentado no NOTES do StackingDAO).

Leitura profunda proativa: `vercel/eve` (pacote de canais/agentes,
área HTTP-auth ainda não coberta). Sparse-clone público (sem conta) e
leitura de 3 arquivos novos, priorizados por nome (auth/access/allow):

- `packages/eve/src/channel/forwarded-principal.ts` (completo) — gate
  de propagação de identidade entre deployments (`resolveForwardedPrincipal`).
  Design correto: só aceita o campo `forwardedPrincipal` do corpo quando
  o deployment opta explicitamente (`trustedForwarders !== undefined`,
  senão 403), valida o payload contra um schema Zod `.strict()`, decide
  confiança via um predicado explícito sobre o **principal de transporte
  já verificado** (`input.forwarder`, nunca a identidade autoafirmada no
  corpo), e sempre sobrescreve o atributo de auditoria
  `eve:forwarded-by` com o valor verificado (não o que o forwarder
  mandou). Sem achado.
- `packages/eve/src/channel/ip-allow-list.ts` (completo) — parsing de
  allowlist IP/CIDR via `node:net BlockList`. Rastreei o único call site
  real (`packages/eve/src/public/channels/auth.ts::isIpAllowed`): a
  função só recebe o IP já extraído pelo chamador (não lê
  `X-Forwarded-For` nem nenhum header por conta própria) — a
  responsabilidade de extrair o IP confiável (adapter-specific) fica
  fora deste módulo, então este arquivo isolado não tem superfície de
  spoofing. Sem achado.
- `packages/eve/src/public/channels/auth.ts` (completo, 1246 linhas) —
  o módulo central de autenticação HTTP do framework (Basic, JWT
  HMAC/ECDSA, OIDC genérico, OIDC do Vercel com bypass de
  "current-project", `routeAuth`, `oauthResource`). Ceticismo alto
  aplicado nos pontos clássicos de bug desta classe de código:
  - **Confusão de audience em OIDC do Vercel**: comentário no código já
    documenta e corrige exatamente o vetor óbvio (token mintado pro
    próprio projeto mas para uma audience federada externa, ex. AWS STS,
    sendo reproduzido contra o agente) — `VERCEL_OIDC_AUDIENCE_PREFIX`
    exige que pelo menos uma `aud` comece com `https://vercel.com/`
    antes de aceitar. Confirmado presente e correto.
  - **Bypass de ambiente via header**: `isLocalDevelopmentServer()`
    decide só por variável de ambiente do processo (`VERCEL_ENV`/
    `EVE_DEV`), nunca por header de request (`Host` citado
    explicitamente no comentário como o vetor que NÃO funciona) — não
    há como uma requisição externa forjar "sou local dev".
  - **Confusão de issuer**: `isVercelOidcIssuer` compara a string
    completa do issuer contra `https://oidc.vercel.com` (exato) ou
    prefixo `https://oidc.vercel.com/` — não é comparação de hostname
    (sem risco de bypass tipo `oidc.vercel.com.attacker.com`, que não
    bate o prefixo com `/`).
  - **`vercelSubject`**: `teamSlug`/`projectName` são explicitamente
    proibidos de conter `*`/`:` (`assertVercelSubjectSegment`) — não dá
    pra construir sem querer um matcher amplo demais via slug
    controlado.
  - **HTTP Basic**: comparação documentada como constant-time
    (delegada a `authenticateHttpBasicStrategy`, já auditado em rodada
    anterior).
  - **`decodeUnverifiedJwtClaims`**: usado só para decidir *qual*
    issuer/discovery usar antes da verificação completa de assinatura
    (padrão comum e seguro de OIDC — o claim não-verificado nunca é
    usado para decisão de autenticação, só de configuração), e para
    `verifyVercelOidc` o issuer decodificado passa por
    `isVercelOidcIssuer` antes de qualquer uso.
  Nenhum achado. Módulo com nível de documentação e cuidado defensivo
  incomum (vários comentários no próprio código já antecipam e
  descrevem por que o vetor óbvio foi fechado) — bom sinal de que já
  passou por revisão de segurança própria da Vercel.

`deep-read-log.json` atualizado (`vercel/eve` ganhou os 3 arquivos
acima). Nenhum achado novo nesta rodada — resultado normal e válido.

## Rodada 2026-08-31 (push automático, sessão cloud) — 14 candidatos processados

`list-pending` trouxe 14 achados heurísticos novos de Vercel Open
Source (8 `redos_risk`/`eval_usage` em `vercel-labs/skills`,
`vercel-labs/agent-skills` e `vercel/vercel/packages/cli/evals`, 2
`path_traversal_risk` em `vercel/vercel/packages/cli/scripts/build-binary.mjs`,
6 `command_injection_risk` em `vercel/vercel/packages/cli/src/commands/mcp/mcp.ts`).

**8 falsos positivos confirmados por leitura completa dos arquivos**:
- `frontmatter.ts:5` e os 2 `eval_usage` em `evals/`: heurística casou a
  substring "eval" dentro de comentário/identificador (`evals`,
  `getEvalsFromEnv`), zero `eval()`/`Function()`/`vm.*` real nos
  arquivos.
- 3 `redos_risk`: todos variantes do padrão kebab-case
  `^[a-z0-9]+(?:-[a-z0-9]+)*$` (ou equivalente com espaço) — classes de
  caractere disjuntas entre o grupo repetido e o separador, sem
  ambiguidade de particionamento, logo sem catastrophic backtracking
  possível (falso positivo clássico de heurística ReDoS ingênua que só
  olha a forma `(x+)*`).
- 2 `path_traversal_risk` em `build-binary.mjs`: script de BUILD
  (`packages/cli/scripts/`), path montado só a partir de
  `packageRoot`/target de build local, nenhum componente externo;
  também nunca é código do CLI publicado/alcançável por terceiros.

**6 corroborados (`corroborated_static`, confidence "média")**:
`mcp.ts` linhas 345/347/349 (fluxo `mcp add cursor`) e 467/469/471
(fluxo `mcp add vscode`) — `execSync(`open '${oneClickUrl}'`)` (e
variantes `xdg-open`/`start`) interpola `serverName`/`mcpUrl` sem
escaping, e esses valores vêm ao vivo da API da Vercel
(`org.slug`+`project.name`, via `getLinkedProject`) para o projeto
vinculado localmente — não são literais fixos. Defeito de código real
(uso de `execSync` com string interpolada em vez de `execFile`/`spawn`
com array de args), mas não consegui confirmar pela leitura do CLI se
o backend da Vercel proíbe aspas simples/metacaracteres de shell em
nome de projeto/slug — o único validator client-side achado no repo
(`is-valid-name.ts`) não cobre esses caracteres, mas é usado num fluxo
diferente (deployment id), então isso não prova nada sobre o
enforcement real do lado do projeto/org. `check-scope "Vercel Open
Source" "vercel/vercel"` → `allowed=true`/`bountyEligible=true`
(tier 1). Deployment evidence registrada com `confidence="unverified"`
(não confirmei se o HEAD clonado bate com a versão publicada no npm).
Tentativa de `scope_verified` recusada pela máquina de estados como
esperado — mesmo caminho já documentado nas rodadas anteriores (sem
aresta direta `corroborated_static → scope_verified` pra achado
não-Solidity sem validador local).

`Vercel Open Source` fila agora: 0 `candidate` (era 14).

## Rodada 2026-08-31 (push automático, sessão cloud) — leitura profunda em `vercel-labs/skills` e `vercel-labs/agent-skills`

`list-pending` global desta rodada veio vazio (0 candidatos em
qualquer programa — duas outras rodadas concorrentes já haviam
fechado, entre esta sessão começar e terminar, os 72 achados de OKG e
o achado de Kubernetes que estavam pendentes fora do escopo dos 4
programas desta missão, além de leituras profundas novas em Circle
BBP; ver `research/bugbounty/okg/NOTES.md` e `circle-bbp/NOTES.md`).
Os 6 achados `corroborated_static` de
`vercel/vercel/packages/cli/src/commands/mcp/mcp.ts` seguem no mesmo
lugar (sem aresta `corroborated_static -> scope_verified` pra achado
não-Solidity sem validador local — nada novo a fazer sem confirmar o
vínculo real de deploy).

Leitura profunda proativa priorizada pelo maior desequilíbrio de
cobertura relativo entre os alvos ativos: `vercel-labs/agent-skills`
tinha só 2 arquivos lidos (ambos workflow YAML, zero código-fonte
real, apesar de ser um repo com mais de 100 arquivos `.ts`/`.mjs`) e
`vercel-labs/skills` tinha `install.ts`/`download-source.ts`/`archive.ts`
— justamente os arquivos que implementam o foco declarado do programa
("path traversal na instalação") — ainda não lidos:

- `src/install.ts` (completo) — wrapper fino de `runInstallFromLock`,
  delega toda a lógica real pra `runAdd`/`runSync` (já auditados em
  rodadas anteriores). Sem lógica própria de risco. Sem achado.
- `src/download-source.ts` (completo) — baixa uma URL, detecta
  SKILL.md vs arquivo (zip/tar) por magic bytes, extrai com limite de
  tamanho de download (`SKILLS_DOWNLOAD_MAX_BYTES`, aplicado tanto por
  `content-length` quanto por contagem real via `TransformStream`
  durante o download, então não dá pra mentir o header) e limite de
  bytes/arquivos extraídos. Tanto `extractZip` quanto `extractTar`
  validam o path final resolvido (`isPathSafe`) contra o diretório de
  extração — a checagem usa `startsWith(base + sep)`, forma correta
  que evita o bug clássico de prefixo (`/tmp/extract-evil` casando
  `/tmp/extract`). `extractTar` roda com `preservePaths: false` e o
  filtro rejeita qualquer entrada que não seja `File`/`Directory`
  (bloqueia symlink/hardlink na filtragem de tipo). Sem achado.
- `src/archive.ts` (completo) — parser de ZIP feito à mão (lê o
  formato binário diretamente, sem lib externa, incluindo suporte a
  zip64). Ceticismo alto aplicado aqui por ser exatamente o tipo de
  código onde zip-slip/CVEs de parser costumam morar: `ensureRange` em
  toda leitura de offset/tamanho (sem out-of-bounds read), `fileType`
  da entrada checado contra o campo de atributos externos do Unix e
  **rejeita explicitamente qualquer coisa que não seja arquivo regular
  ou diretório** (bloqueia symlink no nível do parser, antes mesmo de
  chegar no `isPathSafe` do arquivo acima), `normalizeArchivePath`
  rejeita nome com `..`, path absoluto, drive letter Windows ou byte
  nulo, e cada entrada tem o `uncompressedSize` declarado usado como
  `maxOutputLength` do `inflateRawSync` — ou seja, mesmo que o central
  directory minta um tamanho pequeno pra tentar burlar o orçamento de
  bytes (`extractMaxBytes`), a descompressão real não consegue
  produzir mais que o declarado (checado depois via `crc32`/tamanho
  exato), fechando o vetor clássico de zip bomb por tamanho mentido.
  Não encontrei bypass. Sem achado — código bem escrito, bom sinal de
  auditoria própria prévia da Vercel.
- `skills/vercel-optimize/lib/auth-route.mjs` (completo, de
  `vercel-labs/agent-skills`) — nome sugeria relevância
  (auth/session), mas o conteúdo real é só um regex heurístico
  (`/(login|logout|auth|...)/`) usado por uma ferramenta de
  *otimização de performance* pra desqualificar rotas "parecidas com
  auth" de sugestões de cache de CDN — não é código de autenticação de
  verdade, é falso alarme de nome. Sem achado.

`deep-read-log.json` atualizado (`vercel-labs/skills` de 8 para 11
arquivos, `vercel-labs/agent-skills` de 2 para 3). Nenhum achado novo
nesta rodada — resultado normal e válido.
