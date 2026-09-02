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

## Nota 2026-08-31 (revisão local, claude-local-review) — fecha a pendência de exploração dos 6 `mcp.ts`: refutado por documentação oficial

Sessão local (não-cloud) revisitou os 6 achados `corroborated_static`
acima especificamente para resolver a pergunta que a rodada que os
corroborou deixou em aberto ("não consegui confirmar... se o backend
da Vercel proíbe aspas simples/metacaracteres de shell em nome de
projeto/slug"). `is-valid-name.ts` (client-side, fluxo errado) não
respondia isso — a resposta certa está na documentação pública da
própria Vercel, não no código do CLI:
**vercel.com/docs/project-configuration/general-settings**, seção
"Project name", confirma que nomes de projeto são restritos a
minúsculas, dígitos e os caracteres `.`/`_`/`-` (sem a sequência `---`),
até 100 caracteres — sem exceção documentada. Isso elimina aspas,
ponto-e-vírgula, `&`, `|`, crase e espaço do valor que `serverName`
carrega em todos os 6 pontos (`vercel-${projectName}`,
`getLinkedProject → getProjectByIdOrName`, uma chamada autenticada à
API, nunca um arquivo local editável). Sem forma documentada/observada
de fazer esse valor carregar metacaractere de shell, os 6 pontos
continuam um anti-padrão de código real (deveria usar `execFileSync`
com array de argumentos) mas não são exploráveis com o input que de
fato os alcança hoje. Não testei criar um projeto real na Vercel com
nome malicioso para tentar burlar a validação server-side — esta
conclusão se apoia na documentação oficial, não em teste direto de
bypass. Transicionados os 6 para `false_positive` (na base local desta
sessão; a base da sessão cloud que os corroborou originalmente segue
com seu próprio estado local, por design — ver comentário em
`.gitignore` sobre `zerotoone.db` ser local a cada ambiente).

## Rodada 2026-08-31 (push automático, sessão cloud) — aplica a refutação dos 6 `mcp.ts` ao estado compartilhado; leitura profunda em `nitrojs/nitro`

`list-pending` global veio vazio. Antes da leitura profunda proativa,
reconstrui a base local a partir do `queue.jsonl` mais recente de
`origin/master` (esta sessão havia commitado em cima de um HEAD
desatualizado; ver histórico) e notei que a nota acima — revisão local
do usuário citando a documentação oficial da Vercel para fechar a
pergunta de exploração dos 6 `command_injection_risk` de `mcp.ts` —
concluía "transicionados para `false_positive`" mas só na base SQLite
*local daquela sessão*, que não é commitada (`.gitignore`); o
`queue.jsonl` compartilhado ainda trazia os 6 em `corroborated_static`.
Repeti a transição de fato no CLI (`update-finding` com o mesmo
reasoning/fonte + `transition ... false_positive`) pra que ela chegasse
ao estado compartilhado desta vez — os 6 aparecem agora como
`false_positive` neste `queue.jsonl`. Nenhuma decisão nova da minha
parte aqui: só executei a conclusão já validada pelo usuário via CLI,
que é o único jeito de fazer uma transição de estado persistir.

Leitura profunda proativa: `nitrojs/nitro` tinha só 3 arquivos no log,
nenhum relacionado a auth/acesso. Busquei por
`x-forwarded|trust proxy|getRequestIP|remoteAddress` e encontrei
`src/dev/_request.ts::isLocalDevRequest` — gate explícito de IP usado
pra restringir dois endpoints de debug do dev server (`/_vfs/**` e
`/_nitro/tasks/**`, este último documentado no próprio código como
executando "server tasks with caller-supplied payload").

Rastreei a cadeia completa (3 arquivos, todos novos):
- `src/dev/_request.ts` — `isLocalDevRequest` só confia no header
  `X-Forwarded-For` quando uma heurística (`isUnixSocket`) detecta que
  a conexão TCP real não tem `socket.remoteAddress`/`remotePort` (i.e.,
  o dev server está atrás de um Unix domain socket, cenário clássico de
  reverse proxy no mesmo host). Em qualquer conexão TCP normal (o modo
  default do `nitro dev`, que faz bind em todas as interfaces),
  `remoteAddress` vem sempre preenchido pelo Node, `isUnixSocket` fica
  `false`, e o código passa `xForwardedFor: false` pro `getRequestIP` —
  ou seja, ignora o header e usa o endereço real do socket, não
  spoofável por um atacante remoto via header.
- `src/dev/app.ts` — confirmei que `/_vfs/**` e `/_nitro/tasks/**` são
  registrados nesta mesma camada H3 que recebe o evento com o socket
  real (não atrás de um proxy interno via worker — o roteamento pro
  worker via `RunnerManager.fetch` só acontece no catch-all, depois
  desses dois gates), então o `isLocalDevRequest` desta camada vê a
  conexão de verdade, não uma reencaminhada.
- `src/dev/vfs.ts` — endpoint gateado só expõe `nitro.vfs` (arquivos
  virtuais já construídos, `id` precisa existir em `nitro.vfs.has(id)`),
  não o filesystem real — mesmo se o gate falhasse, não seria path
  traversal de disco.

Não encontrei bypass: o único jeito de fazer `isUnixSocket` virar
`true` remotamente exigiria já estar na posição de proxy de confiança
(falando com o dev server via Unix socket), não um atacante de rede
externo falando TCP normal. Padrão correto e deliberado (comentário no
próprio código já documenta a motivação e o raciocínio de ameaça) — bom
sinal de segurança pensada, mesmo em ferramenta só de dev. Sem achado.

`deep-read-log.json` atualizado (`nitrojs/nitro` 3→6: `_request.ts`,
`vfs.ts`, `app.ts`).

`Vercel Open Source` fila agora: 0 `candidate`, 0 `corroborated_static`
(era 6).

### Addendum (mesma janela, outra sessão cloud em paralelo — commit sequencial, sem conflito de decisão)

Uma segunda sessão cloud, disparada por um push quase simultâneo, chegou
à mesma conclusão de forma independente (ainda não tinha visto este
commit quando começou) e tentou reaplicar a mesma transição — inofensivo
por já ser idempotente (as 6 já estavam `false_positive` quando o push
dela chegou ao repositório remoto, então a transição dela nesta base
compartilhada foi um no-op de fato; o merge do commit dela ficou restrito
à ledger/queue locais daquela sessão, resolvidos a favor desta versão por
já refletir o estado final correto). Contribuição nova e não-duplicada
daquela rodada: baixou `npm pack vercel@59.10.0` (versão publicada mais
recente, dist-tag `latest`) e confirmou que o padrão `execSync` com
interpolação de string não escapada continua no bundle real
`dist/commands-bulk.js` (fluxos Cursor ~linha 59380 / VS Code ~linha
59470) — não só no branch de desenvolvimento. Tentou reverificar a
citação da documentação oficial da Vercel sobre restrição de caracteres
em nome de projeto via `WebFetch` nesta janela — bloqueado
(`EGRESS_BLOCKED`, `vercel.com` fora do allowlist do proxy daquela
sessão) — então a conclusão de não-explorabilidade continua apoiada na
citação já registrada acima, não em verificação de primeira mão
adicional. Registro aqui só para constar a evidência de deploy npm real
como reforço; não muda o veredito `false_positive` já fechado.

## Nota 2026-08-31 (revisão local, claude-local-review) — reforça (sem fechar) o achado `inconclusive` da SSO com busca de código autenticada; rascunho de relatório criado

O achado `packages/cli-auth/sso.ts::waitForVerification` (`inconclusive`)
ficou travado numa pergunta que várias rodadas anteriores não
conseguiram resolver por falta de acesso: "algum consumidor real (do
GitHub público) chama `reauthorizeTeam`/`waitForVerification`?" — a
sessão cloud original tinha isso explicitamente bloqueado ("GitHub code
search via API: bloqueado (requer autenticação)"). Com `GITHUB_TOKEN`
configurado nesta sessão, rodei a mesma pergunta pela primeira vez com
autenticação real, contra **todo o GitHub público**, não só
`vercel/vercel`:
- `"reauthorizeTeam"` — 16 resultados totais; os únicos 3 que batem com
  o arquivo real (`packages/cli-auth/sso.ts`) são o próprio
  `vercel/vercel` e 2 forks pessoais do mesmo monorepo (mesmo path,
  não um consumidor separado via import do pacote). Os outros 13 são
  coincidência de nome em projetos completamente não relacionados
  (Dropbox SDK, etc.).
- `"waitForVerification"` — 2872 resultados, mas o único relacionado ao
  arquivo real é o próprio `vercel/vercel`; todo o resto é função
  homônima em bases de código sem nenhuma relação (Firefox, projetos
  aleatórios).
- `"cli-auth/sso"` e `"@vercel/cli-auth/sso.js"` (string de import
  literal) — 0 resultados em qualquer lugar do GitHub público.

Isso é o resultado mais forte possível vindo de busca de código pública
— reforça bastante a conclusão já registrada (nenhum consumidor
confirmado), mas **não** é prova absoluta o suficiente para fechar como
`false_positive` (uma ferramenta interna da Vercel nunca publicada
publicamente continua, por definição, fora do alcance de qualquer busca
pública). Estado mantido em `inconclusive` — não existe (nem deveria
existir) uma aresta `inconclusive -> corroborated_static` no
`state-machine.mjs` que tornasse isso uma "confirmação"; isso é reforço
de evidência, não mudança de veredito.

Dado que este é, no momento desta nota, o único achado não-terminal e
não bloqueado por política em todo o pipeline (Circle BBP com fila
zerada, Vercel com fila zerada, OKG resolvido, Block Open Source
banido para pesquisa), redigi um rascunho de relatório em
`research/bugbounty/reports/vercel-cli-auth-sso-loopback-missing-state.md`
com um aviso de confiança explícito no topo (baixa confiança de
exploração, recomendado como achado de hardening, não como
vulnerabilidade confirmada) — decisão de enviar ou não fica com o
usuário, não uma conclusão automática desta rodada.

## Rodada 2026-09-01 (push automático, sessão cloud) — fila vazia, leitura profunda em `vercel/flags`, sem achado

`list-pending` global = 0. Leitura profunda proativa em
`packages/vercel-flags-core/src/controller/stream-connection.ts` +
`stream-source.ts` (conexão SSE de streaming de flags, com backoff e
timeout de ping) e `packages/vercel-flags-core/src/utils/ingest.ts`
(telemetria de uso) — todas as chamadas de rede usam o token resolvido
via `Auth.resolveToken()` só no header `Authorization: Bearer`, nunca em
querystring/URL (não vaza em logs de acesso). `packages/flags/src/lib/
serialization.ts` (assinatura/verificação HS256 via `jose`
`CompactSign`/`compactVerify`, usado por `verify-access.ts` já auditado
em rodada anterior) — comentário `// TODO what happens when verification
fails?` chamou atenção, mas `compactVerify` do `jose` lança exceção em
falha de verificação (não retorna silenciosamente um payload inválido),
então o TODO é só falta de comentário explicativo, não uma lacuna de
tratamento de erro real. Sem achado novo. `deep-read-log.json`
atualizado com os 4 arquivos.

## Rodada 2026-09-01 (push automático, sessão cloud) — fila vazia, leitura profunda em `vercel/vercel`, sem achado

`list-pending` global = 0. Leitura profunda proativa em dois arquivos
novos de `vercel/vercel` ainda não lidos, sparse-checkout de
`packages/cli-auth`, `packages/oidc`, `packages/connect`,
`packages/cli-config` pra achar candidatos não cobertos por rodadas
anteriores (que já tinham auditado exaustivamente `cli-auth/oauth.ts`,
`cli-auth/sso.ts`, `oidc/verify-vercel-oidc-token.ts`,
`connect/authorization.ts`, `connect/token.ts` etc.):

- `packages/connect/src/chat/webhook-verifier.ts` — verificador de
  webhook para os adapters do Chat SDK (Slack/GitHub/Linear). Em vez de
  validar o segredo de assinatura nativo do provedor, extrai um Bearer
  token do header `Authorization` e delega para `verifyVercelOidcToken`
  (já auditado em rodada anterior) com `issuer` fixado em
  `https://oidc.vercel.com` e `project_id`/`environment` derivados do
  deployment atual — falha fechado (lança exceção) se o token estiver
  ausente ou a verificação falhar; a doc do próprio arquivo já registra
  corretamente o trust boundary (qualquer token OIDC válido para esse
  projeto+ambiente, não pinado a um conector específico). Implementação
  consistente com o design documentado. Sem achado.
- `packages/cli-config/src/cred-storage.ts` — resolve modo de storage de
  credencial (`file` vs `keyring`) por precedência
  `VERCEL_TOKEN_STORAGE` env > config global > heurística "auto" (usa
  `file` só se já existe token utilizável em `auth.json`, senão
  `keyring`). Não é o código que de fato grava o token (isso é
  `credentials-store.ts`, coberto em rodada anterior) — é só resolução
  de política. Notei que o modo "auto" preserva `file` (menos seguro que
  `keyring`) quando já há token ali, em vez de migrar — comportamento de
  compatibilidade deliberado, não uma superfície de ataque nova (mesmo
  arquivo em disco, mesma permissão de FS de sempre). Sem achado.

`deep-read-log.json` atualizado (2 arquivos novos). Esta rodada não
tocou `Block Open Source` — banido para pesquisa com IA.

## Rodada 2026-09-01 (push automático, sessão cloud) — fila vazia, fechando leitura pendente de `vercel/workflow`, sem achado

`list-pending` global = 0. `program-policy.json` conferido primeiro
(passo 0): só `Block Open Source` segue banido para pesquisa com IA.
`check-scope "Vercel Open Source" "vercel/workflow"` confirmado
`allowed:true`/`bountyEligible:true` (tier 1) antes de tocar o repo.

Fechei a leitura marcada como parcial em rodada anterior:
`packages/world-vercel/src/http-core.ts` (linhas 391-658, restante do
arquivo — L1-390 já lido antes). Ponto verificado com ceticismo:
`instrumentedFetch` chama `logCurlRepro(method, url, headers)` numa
resposta não-2xx para imprimir um `curl` reproduzível em modo debug —
padrão que classicamente vaza credenciais em log. Confirmado que não é
o caso aqui: `logCurlRepro` (linha 174-187) filtra explicitamente
qualquer header `authorization` (case-insensitive, linha 181) antes de
montar a string do curl, e a função inteira só roda quando
`process.env.DEBUG` está setado (uso local de desenvolvedor, não em
produção) — não há vazamento de token nem por essa via nem por
`httpLog` (que só loga status/timing, nunca headers). Resto do arquivo
(`withHttpClientSpan`, `recordClientSpanStatus`, `instrumentedFetch`)
é instrumentação OTEL + wrapper de timeout/erro sobre `fetch`/
`node:http`, sem lógica de autenticação própria. Sem achado.
`deep-read-log.json` atualizado (entrada do arquivo marcada como
completa).

Verifiquei também os outros 2 programas sem restrição de IA antes de
fechar a rodada: StackingDAO (15 arquivos já lidos, cobertura completa
dos contratos ativos, ver NOTES.md próprio) e Circle BBP (Solidity
ativo — `evm-cctp-contracts`, `evm-gateway-contracts`,
`buidl-wallet-contracts`, `evm-xreserve-contracts`, `evm-cpn-contracts`
— com deep-read-log já cobrindo praticamente todos os arquivos com
lógica real, ver NOTES.md próprio) não tinham candidato óbvio de baixo
esforço para esta rodada além do que já foi coberto exaustivamente em
rodadas anteriores do mesmo dia. Nenhum achado novo em nenhum dos 3
programas nesta rodada — resultado normal.

## Rodada 2026-09-01 (push automático, sessão cloud, 4) — fila vazia, leitura profunda em `vercel-labs/skills`, hipótese de argument injection investigada e refutada

`list-pending` global = 0. `program-policy.json` conferido primeiro (passo
0, antes de qualquer clone): só `Block Open Source` segue banido para
pesquisa com IA. `vercel-labs/skills` (11 arquivos já lidos em rodadas
anteriores, cobrindo o núcleo de download/instalação —
`download-source.ts`, `install.ts`, `installer.ts`, `sanitize.ts`,
`archive.ts`) tinha 3 arquivos de superfície de segurança real ainda não
lidos: `src/git.ts`, `src/source-parser.ts`, `src/plugin-manifest.ts`.

- `src/git.ts` (`cloneRepo`) — hipótese séria levantada e investigada a
  fundo: o `url`/`ref` de um source string (`skills add <source>`) chega
  em `cloneRepo(url, ref)`, que monta `createGitClient().clone(url,
  tempDir, ['--depth','1','--branch', ref])` via `simple-git@^3.36.0`.
  Preocupação: se `url` (caminho "fallback: treat as direct git URL" em
  `source-parser.ts`, que aceita QUALQUER string não reconhecida como
  URL de git literal, sem validação de prefixo) começar com `-` (ex.
  `--upload-pack=touch$IFS/tmp/pwned`), isso é o padrão clássico de
  argument injection em wrappers de `git clone` (mesma classe de bug de
  CVEs conhecidas em ferramentas que passam URL de repo direto pro CLI
  do git sem terminador `--`). Refutação via leitura do código-fonte
  publicado do próprio `simple-git@3.36.0` (pacote baixado via `npm
  pack`, não é código do programa-alvo, é dependência pública de
  terceiros): a task `cloneTask` em `src/lib/tasks/clone.ts` envolve
  tanto `repo` quanto `directory` em `pathspec(...)` (de
  `@simple-git/args-pathspec`), e o plugin `suffixPathsPlugin` (`src/lib/
  plugins/suffix-paths.plugin.ts`) move qualquer argumento marcado como
  pathspec pro final do array de args, precedido por um separador `--`
  literal, no momento de montar o `spawn.args` real. Ou seja, o comando
  de fato executado é `git clone --depth 1 --branch <ref> -- <url>
  <tempDir>` — o `--` impede o git de interpretar `<url>` como opção
  mesmo que comece com `-`. Confirmado isso lendo o JS compilado
  (`dist/cjs/index.js`) da versão exata pinada (`^3.36.0` resolve pra
  `3.36.0` via `npm pack`). Quanto ao `ref` (não envolvido em
  `pathspec()`, fica antes do `--`): como é consumido como valor
  obrigatório de `--branch <valor>` (semântica padrão de long option do
  `git`/`getopt_long`, o próximo argv é sempre o valor, mesmo que comece
  com `-`), não há como o `ref` injetar uma flag adicional nesse ponto —
  ele vira literalmente o nome de branch buscado (que falhará como "not
  found" se malicioso, não executa nada). `getGitTreeHash` (mesma
  arquivo) também usa `--end-of-options` antes do revision string, outra
  camada de defesa contra a mesma classe de bug. **Hipótese refutada**:
  o mecanismo de proteção existe e está ativo na versão pinada — não é
  uma lacuna de validação própria do `skills`, é mitigado pela
  dependência. O comentário do código-fonte ("the clone URL and ref
  cannot configure them", referindo-se às opções `unsafe.allowUnsafe*`)
  é sobre a config `filter.lfs.*` hard-coded, não sobre isso — mas a
  conclusão de que não há injection continua correta, só por um
  mecanismo diferente do que o comentário sugere. Documentando aqui o
  raciocínio completo pra próxima rodada não reinvestigar do zero.
- `src/source-parser.ts` — revisado no mesmo processo acima (é a origem
  do `url`/`ref` que chegam em `git.ts`). `sanitizeSubpath` rejeita
  segmentos `..` corretamente. Nenhuma outra lacuna nova encontrada além
  da hipótese já refutada acima. Sem achado.
- `src/plugin-manifest.ts` — leitura de `marketplace.json`/`plugin.json`
  de um plugin clonado, usado só pra descobrir diretórios de skills.
  `isContainedIn` (resolve + normalize + prefixo com `sep`) barra
  qualquer path resolvido fora de `basePath`, aplicado depois de montar
  o path com `join`, então mesmo um `skillPath`/`source` como
  `./../../etc` (passa em `isValidRelativePath` por começar com `./`) é
  barrado pelo containment check subsequente. Só leitura, nunca
  escrita/execução a partir desses caminhos. Sem achado.

`deep-read-log.json` atualizado (3 arquivos novos em `vercel-labs/skills`).
Também confirmados sem candidato novo de baixo esforço: StackingDAO (15/15
arquivos, cobertura completa) e Circle BBP (alvos EVM ativos já
exaustivamente cobertos em rodadas anteriores). Esta rodada não tocou
`Block Open Source` (`aiResearchBanned: true`, conferido antes de
qualquer clone). Nenhum achado novo nesta rodada — resultado normal.

## Rodada 2026-09-01 (push automático, sessão cloud) — fila global vazia, leitura profunda proativa em `vercel/vercel`

`list-pending` global = 0. Confirmei `program-policy.json` inteiro antes
de tocar qualquer arquivo (checagem de bloqueio de IA aplicada a todos os
programas, não só ao alvo da vez). `vercel/vercel` já tinha 21 arquivos
lidos em rodadas anteriores, quase todos em torno de auth/OAuth/OIDC/
credenciais (`cli-auth`, `cli-config`, `packages/connect`, `packages/oidc`).
Sparse-checkout (`packages/connect/src`, `packages/oidc/src`,
`packages/cli-auth`, `packages/cli/src/commands/login`,
`packages/cli/src/commands/teams`, `packages/cli/src/util/login`,
`packages/cli-config/src`) pra achar os 3 arquivos ainda não cobertos
mais próximos do critério de prioridade (auth/token/permission):

- `packages/connect/src/eve/provision-oauth-connector.ts` (147 linhas,
  completo) — provisiona um "managed OAuth connector" via POST autenticado
  por Bearer (`getVercelOidcToken()`) a `api.vercel.com`. Validação de
  `connector` (uid) rejeita chars de controle/espaço/`%`/`#` e prefixos
  reservados (`vc/`, `*.vercel.com/`, `scl_`/`sca_`/`store_`/`ir_`), com
  única exceção deliberada `mcp.vercel.com/`. Cache de provisionamento em
  memória por processo, chaveado por hash do token — usa SHA-256 quando
  `crypto.subtle` existe, e cai pra um FNV-1a não-criptográfico só como
  fallback de chave de cache (nunca usado como segredo/autenticação em si,
  o token real vai só no header `Authorization`), então a debilidade do
  fallback não é uma vulnerabilidade — na pior hipótese, colisão de chave
  de cache faria reusar/reprovisionar a promise errada, não vazar nada.
  Sem achado.
- `packages/oidc/src/exchange-vercel-oidc-token.ts` (219 linhas, completo)
  — troca token OIDC por token com audience customizada via POST a
  `oidc.vercel.com/~token`. Cache LRU em memória, limitado a 1000
  entradas, chaveado por SHA-256 de `[token, audience, jti]` (nunca guarda
  o token bruto como chave), só cacheia quando a API devolve `expiry` no
  futuro, e checa expiração no `get()` antes de reusar. Sem achado.
- `packages/connect/src/authorization-details.ts` (15 linhas, completo) —
  só tipos (`ConnectAuthorizationDetail`), sem lógica. Sem achado.

`deep-read-log.json` atualizado (+3 arquivos em `vercel/vercel`, agora
24). Clone sparse temporário apagado do scratchpad ao fim da rodada.
Nenhum achado novo nesta rodada — resultado normal.

## Rodada 2026-09-01 (push automático, sessão cloud) — fila global vazia, leitura profunda proativa em `vercel/eve`

`list-pending` global = 0. Antes de tocar qualquer arquivo, conferi
`program-policy.json` inteiro (não só o NOTES.md do programa da vez) —
confirma `aiResearchBanned: true` só para "Block Open Source"; os outros
3 programas (StackingDAO, Vercel Open Source, Circle BBP) seguem
liberados. StackingDAO revisitado primeiro: os 15 arquivos curados em
`targets.mjs` já estão todos lidos, sem contrato novo candidato.

Sparse-checkout de `vercel/eve` (`packages/eve/src`, já com 7 arquivos
lidos em rodadas anteriores, quase todos em `channel/auth/*`). Rastreei
a cadeia real de resolução/cache de token por chamador, que ainda não
tinha sido lida ponta a ponta:

- `packages/eve/src/execution/tool-auth.ts` (419 linhas, completo) —
  adaptador fino que expõe `ctx.getToken`/`ctx.requireAuth` a tools
  autoradas, delegando toda a lógica de cache/park-resume para
  `scoped-authorization.ts`. Guarda de loop explícita: um token
  recém-autorizado nesta mesma turn que ainda é rejeitado falha
  terminalmente (`token_rejected_after_authorization`) em vez de
  re-desafiar infinitamente. Sem achado.
- `packages/eve/src/runtime/connections/scoped-authorization.ts` (259
  linhas, completo) — cache de bearer por escopo, chaveado por
  `(instanceId ?? scope, principalKey(principal))`; leitura/escrita
  passam por `authorization-tokens.ts` (já indiretamente coberto).
  Eviction em duas camadas (cache do eve + hook opcional
  `authorization.evict` da própria estratégia, ex. `@vercel/connect`) —
  best-effort, nunca mascara o erro de autorização original que a
  disparou. Sem achado.
- `packages/eve/src/runtime/connections/principal.ts` (159 linhas,
  completo, não estava na lista de leitura mas é dependência direta da
  cadeia de cache acima — a fronteira de segurança real: se a resolução
  de principal puder ser falsificada/colidir, o cache de token cruza
  usuários) — `principalKey` prefixa por `issuer` para evitar colisão
  entre provedores de identidade diferentes com o mesmo `id`
  (ex. Slack `U123` vs Google `U123`). Único ramo que produz uma chave
  **sem** prefixo de issuer é `isVercelDevelopmentUser` (token OIDC da
  Vercel com `authenticator==="oidc"`, issuer OIDC da própria Vercel,
  `attributes.environment==="development"` e `subject===attributes.user_id`)
  — carve-out documentado e restrito a ambiente de desenvolvimento local,
  não alcançável com credencial de produção. Sem achado (mas registrado
  aqui porque é o tipo de detalhe que merece releitura se `principal.ts`
  ou o schema de attributes do OIDC dev mudar em rodada futura).
- `packages/eve/src/shared/session-auth.ts` (40 linhas, completo) — só
  tipos/schema Zod (`RuntimeSessionAuthContext`), sem lógica. Sem achado.

`deep-read-log.json` atualizado (+4 arquivos em `vercel/eve`, agora 11).
Clone sparse temporário apagado do scratchpad ao fim da rodada. Circle
BBP e Block Open Source (banido para pesquisa por IA) não tocados nesta
rodada. Nenhum achado novo — resultado normal.

## Rodada 2026-09-01 (sessão local) — command injection real em `utils/update-remix-run-dev.js`, achado novo (`corroborated_static`)

Usuário pediu pra priorizar achado com alta confiança de ser inédito ou
em programa novo. Triei 160+ achados `candidate` da rodada de
descoberta anterior (Slither/OSV-Scanner/Semgrep) primeiro — a maioria
se confirmou falso positivo real (não só "não investigado"): `eval_usage`
em `vercel-labs/skills/src/frontmatter.ts:5` era a palavra "eval()"
dentro de um COMENTÁRIO explicando que o código foi escrito pra EVITAR
essa classe de bug (nenhum eval() real no arquivo); `redos_risk` em 3
arquivos de `vercel-labs/agent-skills` tinha regex genuinamente sem
ambiguidade de backtracking num caso e, nos outros dois, só processa
conteúdo do próprio repositório em build-time; ~20 achados de
`semgrep_detect_child_process` em `vercel/vercel` usam `spawn(cmd,
args[])` com array (padrão seguro, sem shell) ou processam nome de
pacote fixo/hardcoded (nunca input externo) — todos marcados
`false_positive` no banco com o motivo específico de cada um.

**Achado real, fora da lista do Semgrep** (achado por leitura manual
seguindo a pista de `execSync` com template string, não por ferramenta):
`utils/update-remix-run-dev.js` (86 linhas, lido por completo) +
`.github/workflows/update-remix-run-dev.yml` (30 linhas, lido por
completo). O workflow dispara via `workflow_dispatch` com um input de
STRING LIVRE (`new-version`, sem `pattern` nem validação nenhuma no
schema) que vai direto pro script sem sanitização. Dentro do script,
`newVersion` só passa por `.trim()`, vira `branch =
\`vercel-remix-run-dev-${newVersion.replaceAll('.', '-')}\`` (só troca
"." por "-", preserva qualquer outro caractere), e `branch` entra
INTERPOLADO numa template string passada pra `execSync` (roda via shell
real, `/bin/sh -c`) em 3 lugares (linhas 32, 64, 66) — diferente do
padrão seguro (`spawn` com array de argumentos) usado em ~20 outros
lugares do mesmo repositório. Quem tiver permissão "write" pra disparar
o workflow consegue injetar comando arbitrário no runner do GitHub
Actions.

Verificação de duplicata: 116 issues/PRs mencionando o nome do arquivo,
todos PRs automáticos de rotina, nenhum sobre segurança. Histórico real
via API do GitHub (não o clone raso): script criado em 01/03/2023,
única mudança de lógica desde então foi remover uma dependência
(17/12/2024) — o padrão de injeção nunca foi tocado por revisão de
segurança em 3+ anos, apesar do .yml ter passado por 2 trocas de token
recentes (2026-03-11, 2026-04-20) que mexeram em credencial mas não no
script. Zero security advisory do repositório cobre isto. Escopo
confirmado via `cli.mjs check-scope`: allowed=true, eligibleForBounty=true,
maxSeverity=critical, tier 1.

**Decisão consciente de não tentar PoC ao vivo**: diferente de todo
outro achado desta missão com reprodução real (Foundry local, LiteSVM
local, servidor gRPC efêmero local), testar isto de verdade exigiria
disparar o workflow_dispatch REAL no repositório de produção do
Vercel — não uma cópia local/sandbox. Isso seria uma ação ativa contra
infraestrutura de CI de terceiro sem autorização prévia especificamente
pra este tipo de teste. Fica em `corroborated_static` (transição pra
`reproduced_local` tentada e corretamente recusada pelo state machine:
"nenhum validador local existe ainda para este tipo de achado" —
mesma categoria de teto estrutural já documentada pro achado Solana
antes do LiteSVM existir).

**Limitação honesta**: exige que o atacante já tenha "write" no
repositório — não é RCE não-autenticado. O valor é a escalação:
"write" não deveria equivaler a controle sobre segredo/ambiente de CI
que um colaborador comum não tem acesso direto (o secret referenciado
no workflow, `VERCEL_CLI_RELEASE_BOT_TOKEN`, tem um comentário "TODO:
this secret is deleted" — mas isso não neutraliza o achado, já que o
runner ainda tem o GITHUB_TOKEN padrão do job e a injeção via execSync
roda antes de qualquer uso do token deletado). Fica a critério do
triage do programa se esse modelo de ameaça é aceito como dentro do
escopo de recompensa.

Achado gravado no banco:
`Vercel Open Source::vercel/vercel/utils/update-remix-run-dev.js::module.exports::command_injection_risk`,
estado `corroborated_static`, confidence "média".

## Rodada 2026-09-01 (cloud agent, disparada por push) — sync pós-migração v2 + leitura profunda sem achado novo

`migrate-to-v2.mjs` rodou limpo (133 findings migrados). `list-pending`
vazio (fila `candidate` zerada). Achado `command_injection_risk` de
`utils/update-remix-run-dev.js` recorroborado nesta rodada: reli o
arquivo e o workflow direto do branch `main` atual (via
`raw.githubusercontent.com` + `git ls-remote`, HEAD=`e06cc643`) —
padrão perigoso ainda presente, nada mudou. Registrei
`record-deployment-evidence` (confidence="medium", commit real citado)
e tentei `scope_verified` — recusado pela state machine porque o
caminho exige passar por `reproduced_local` primeiro, mesmo pra
achados sem validador local (a leitura do prompt operacional sugeria
um atalho direto `corroborated_static → scope_verified` pra esse caso,
mas o código real da state machine não tem essa transição definida;
segui o CLI, não o que eu esperava que ele fizesse). Registrei validação
`not_applicable` formalmente (antes só estava documentado em prosa) e
tentei `reproduced_local` — recusado como esperado ("nenhum validador
local existe ainda"), mesmo teto estrutural já conhecido. Achado
permanece em `corroborated_static`, sem mudança de estado real, mas
agora com o rastro de validação/deployment evidence persistido no
banco (antes só existia como texto em `reasoning`).

**Leitura profunda proativa** (3 arquivos novos, `vercel/vercel`,
clone sparso temporário — `packages/oidc`, `packages/connect`,
`packages/cli-auth` etc. — apagado ao fim):
- `packages/connect/src/authjs/connect-provider.ts` (141 linhas,
  completo) — adapter Auth.js pro OAuth non-standard da Vercel Connect
  (client secret = token OIDC per-request, injetado via `customFetch`).
  Ponto investigado com ceticismo: `checks: ['pkce']` sem `'state'`
  explícito — Auth.js por padrão usa `['pkce','state']` pra type
  `oauth`, então isso é uma remoção deliberada. Refutado: o cookie de
  `code_verifier` do PKCE (assinado, `SameSite=Lax`) já fornece o mesmo
  vínculo requisição-iniciadora↔callback que o cookie de `state`
  forneceria — é um padrão documentado do próprio Auth.js (PKCE
  cookie-based substitui state pra CSRF/login-CSRF), não uma lacuna.
  Sem achado.
- `packages/connect/src/betterauth/connect-provider.ts` (162 linhas,
  completo) — mesmo padrão via Better Auth (`pkce: true`,
  `getToken`/`getUserInfo` customizados pro mesmo client-secret
  non-standard). Confirma que o design é consistente entre os dois
  adapters, reforça a refutação acima. Sem achado.
- `packages/oidc/src/token-io.ts` (41 linhas, completo) — nome sugeria
  I/O de token, mas só resolve diretórios (`findRootDir` procura `.vercel/`
  subindo a árvore; `getUserDataDir` retorna path padrão do SO). Não
  lê/escreve conteúdo de token nenhum. Sem achado.

`deep-read-log.json` atualizado (+3 em `vercel/vercel`). Nenhum achado
novo nesta rodada — resultado normal.

## Rodada 2026-09-01 (push automático, sessão cloud) — fila global vazia

`list-pending` = 0 (nenhum finding em `candidate` em nenhum programa).
Leitura profunda proativa direcionada a `vercel/vercel`, sparse-checkout
de `packages/` (main, sem depth extra), filtrando por palavras-chave
auth/session/crypto/token/login/password/admin/permission/access nos
caminhos ainda não lidos (`deep-read-log.json` já tinha 29 arquivos
cobertos neste repo). 4 arquivos novos lidos por completo:

- `packages/cli/src/commands/curl/bypass-token.ts` — nome soou suspeito
  (isolado, "bypass"), mas é feature legítima e documentada: gera/reusa
  um "Protection Bypass for Automation" token via API autenticada
  (`client.authConfig.token` do próprio usuário logado) para permitir que
  `vercel curl` acesse deployments protegidos por Deployment Protection
  em fluxos de automação/CI. Sem escalonamento de privilégio — exige
  sessão já autenticada do dono do projeto. Sem achado.
- `packages/cli/src/commands/curl/trace-session-token-provider.ts` (linha
  a linha) — cache de cookie de sessão de trace em
  `~/.vercel/cache/traces/<sha256(teamId:host)>.json`. Ponto investigado:
  permissão do arquivo — `writeFile` já usa `mode: 0o600`, e reforça com
  `chmod` explícito pós-escrita (comentário no código explica que o
  `mode` do `writeFile` só vale na criação, não em overwrite — proteção
  correta contra world/group-readable em overwrite). Nome do arquivo de
  cache é hash do `teamId:host`, evitando colisão entre deployments/times
  diferentes. Sem achado.
- `packages/cli/src/util/env/refresh-oidc-token.ts` — usa
  `decodeJwt` (jose) sem verificar assinatura para ler apenas o claim
  `exp` do próprio token OIDC que o CLI já puxou de forma autenticada de
  `pullEnvRecords` — não decodifica token de origem não confiável, então
  ausência de verificação de assinatura aqui não é problema (só é usado
  como "quando devo re-pedir", nunca como decisão de autorização). Sem
  achado.
- `packages/cli/src/util/env/update-oidc-token-contents.ts` — escreve
  `VERCEL_OIDC_TOKEN="<valor>"` em `.env.local`. `escapeValue` só escapa
  `\n`/`\r`, não aspas duplas — em teoria um valor de token com `"` dentro
  quebraria a string e poderia injetar conteúdo extra no arquivo. Rastreada
  a origem do valor: sempre um JWT retornado pela própria API da Vercel
  (alfabeto base64url + pontos, nunca contém aspas), nunca input de
  usuário nem de terceiro. Risco teórico sem caminho de exploração real
  hoje. Sem achado, mas registrado para não reinvestigar do zero numa
  rodada futura caso o formato do token mude.

`deep-read-log.json` atualizado (+4 em `vercel/vercel`, agora 33
arquivos). Nenhum achado novo nesta rodada — resultado normal.

## Rodada 2026-09-01 (push automático, sessão cloud, segunda passada)

`list-pending` vazio de novo, mas havia um achado recuperado da rodada
anterior ainda em `corroborated_static`: `command_injection_risk` em
`utils/update-remix-run-dev.js` (workflow_dispatch input `new-version`
interpolado sem sanitização em 3 chamadas `execSync` — ver reasoning
completo no finding). Reverifiquei o código-fonte de verdade nesta rodada
(`raw.githubusercontent.com/vercel/vercel/main/...`, não só confiando no
reasoning já salvo) e o padrão vulnerável ainda está lá, idêntico ao
descrito. `git ls-remote` confirmou HEAD atual de `main`:
`e06cc643cec6a47bd9344af7f4589c736d95ed15`.

`check-scope "Vercel Open Source" "vercel/vercel"` → `allowed=true`,
`bountyEligible=true`, `maxSeverity=critical`, tier 1 (mesmo resultado de
antes). `record-deployment-evidence` registrado com `confidence="high"`
(commit real confirmado no HEAD do branch default, não é código morto/
deletado). Adicionei ao reasoning uma ressalva de severidade que faltava:
`workflow_dispatch` só pode ser disparado por quem já tem permissão
*write* no repo, então o ganho real de um atacante é RCE no runner de
Actions (exfiltração de segredo do job / pivot lateral), não escalada de
privilégio a partir de zero — e o comentário no YAML indica que o secret
`VERCEL_CLI_RELEASE_BOT_TOKEN` foi deletado, então o impacto prático de
exfiltração hoje pode ser nulo até o secret ser recriado. A vulnerabilidade
de injeção em si continua real e vale reportar, mas a severidade no
rascunho de relatório (quando chegar lá) deve refletir essa ressalva, não
"critical" automático só porque o programa aceita até critical.

Tentei `transition ... scope_verified` mas a máquina de estados recusou
corretamente: não existe transição `corroborated_static->scope_verified`
no `state-machine.mjs`, só `reproduced_local->scope_verified`. Para chegar
em `reproduced_local` a partir de `corroborated_static` a precondição
exige `validations` com `result="pass"` — e não existe validador local
para `command_injection_risk` em JS hoje (só haveria PoC pra Solidity via
Foundry). `not_applicable` é tratado explicitamente como falha, não como
bypass. Ou seja: **este achado está genuinamente travado em
`corroborated_static`** até o sistema ganhar um validador de verdade pra
findings JS/TS (ou até uma sessão futura decidir que o reasoning por si
só + deployment evidence bastam e isso for adicionado como nova
precondição válida no state machine — decisão de design, não algo pra
uma sessão individual forçar). Isso bate com o que o passo 3g do prompt
da rotina já antecipava ("limitação real do sistema, não invente um
validador") — deployment evidence registrada mesmo assim, porque
documentar o gap tem valor por si só e deixa a próxima rodada sem
precisar reinvestigar do zero.

**Gap de persistência notado nesta rodada:** `exportFindingsToQueueLines`
(`db.mjs`) só serializa `state/confidence/reasoning/filesRead/pocRun/
pocResult` pra `queue.jsonl` — `deployment_evidence`, `validations`,
`duplicateCheck` e `report` ficam só no SQLite local (`zerotoone.db`,
no `.gitignore`, efêmero por design). Ou seja, o `record-deployment-
evidence` desta rodada é real e consultável enquanto este container
viver, mas ao rodar `migrate-to-v2.mjs` numa rodada futura (container
novo, banco reconstruído do zero a partir de `queue.jsonl`) essa
evidência específica desaparece do banco — só sobra o resumo que eu
coloquei aqui no NOTES.md em prosa. Não é um bug que eu deva corrigir
sozinho agora (mudar o formato de export é decisão de design que afeta
todo o pipeline), só um gap real a registrar — mesma categoria do gap de
`aiResearchBanned` já documentado no NOTES.md do Block Open Source.

## Rodada 2026-09-01 (push automático, sessão cloud, 2ª rodada do dia)

`list-pending` global vazia — nenhum candidato deste programa a revisar
nesta rodada (o achado `command_injection_risk` em
`utils/update-remix-run-dev.js` segue travado em `corroborated_static`
pelo motivo já documentado na rodada anterior: sem validador local pra
JS/TS, não há caminho válido pra `reproduced_local`/`scope_verified`
sem contornar a máquina de estados).

Leitura profunda proativa: 1 arquivo novo em `vercel/vercel` —
`packages/oidc/src/token-util.ts`. `getTokenPayload()` faz decode de
JWT (base64url do segundo segmento) SEM checar assinatura — mas rastreei
os dois call sites (`get-vercel-oidc-token-with-refresh.ts`, `token.ts`)
e o uso é só local: decide se o token do CLI local está perto de
expirar pra disparar refresh proativo. A decisão de autorização de
verdade acontece no servidor (`api.vercel.com`), que valida a assinatura
de forma independente quando o token é enviado como Bearer — o client
nunca usa o payload decodificado aqui pra conceder acesso a nada. Sem
caminho de exploração (não é o mesmo código que `verify-vercel-oidc-
token.ts`, que já foi lido em rodada anterior e faz verificação de
assinatura de verdade do lado que importa). Sem achado.
`deep-read-log.json` atualizado (+1 em `vercel/vercel`, agora 34
arquivos).

## Rodada 2026-09-01 (push automático, sessão cloud, 3ª rodada do dia)

`list-pending` global = 0 (confirmado via `migrate-to-v2.mjs` +
`cli.mjs list-pending`). O achado `command_injection_risk` em
`utils/update-remix-run-dev.js` segue travado em `corroborated_static`
pelo mesmo motivo já documentado (sem validador local pra JS/TS).

Leitura profunda proativa: sparse-clone raso (`--filter=blob:none`) de
`vercel/vercel` só para listar árvore de arquivos (sem baixar blobs
desnecessários), filtrando por palavras-chave auth/session/token/login/
password/admin/permission/access/oidc/oauth/crypto/secret e comparando
contra `deep-read-log.json` — 220 caminhos batem o filtro, dos quais a
maioria é teste/fixture/doc/changelog já sem valor de auditoria. Escolhi
3 arquivos de lógica real ainda não lidos:

- `packages/cli/src/util/validate-cron-secret.ts` — só valida que
  `CRON_SECRET` contém caracteres válidos de header HTTP (RFC 7230) em
  build-time; não faz comparação do secret em si (isso acontece em
  runtime, em outro lugar não coberto por este arquivo). Sem lógica de
  autenticação aqui, não é comparação insegura nem tem caminho de bypass
  — é puro linting de formato. Sem achado.
- `packages/oidc/src/oauth.ts` — descobre `token_endpoint` via
  `${VERCEL_ISSUER}/.well-known/openid-configuration` com `VERCEL_ISSUER`
  hardcoded (`https://vercel.com`, sem influência de input externo) e
  usa esse endpoint pra `refreshTokenRequest`/`processTokenResponse`.
  Sem SSRF (destino fixo, não vem de parâmetro do usuário). Validação de
  `access_token`/`token_type`/`expires_in` no `processTokenResponse` é
  só sanity-check de shape, não é o ponto de verificação de assinatura
  (isso é responsabilidade do servidor OAuth remoto). Sem achado.
- `packages/functions/src/oidc/aws-credentials-provider.ts` — wrapper
  fino sobre `fromWebToken` do AWS SDK oficial, repassando o token OIDC
  da Vercel (`getVercelOidcTokenSync()`) como `webIdentityToken` pro STS
  `AssumeRoleWithWebIdentity`. Os campos de `init` (incluindo `roleArn`)
  vêm do próprio código do usuário que integra a lib — ele só pode
  assumir os roles que a *trust policy* AWS do lado dele permitir; não
  há elevação de privilégio introduzida por este wrapper. Nenhuma
  validação adicional é necessária aqui porque a fronteira de segurança
  real é a trust policy no IAM (fora do escopo deste código) e a
  assinatura do token OIDC (verificada pelo STS/AWS, não por este
  arquivo). Sem achado.

`deep-read-log.json` atualizado (+3 em `vercel/vercel`, agora 37
arquivos). Sem achado novo, sem mudança de estado.

## Rodada 2026-09-01 (push automático, sessão cloud, 4ª rodada do dia)

`list-pending` global vazia. Revisitado o achado `command_injection_risk`
em `utils/update-remix-run-dev.js` (estado `corroborated_static`): clonei
`vercel/vercel` (raso, main, HEAD=`e06cc643cec6a47bd9344af7f4589c736d95ed15`)
e confirmei que o script e o workflow `.github/workflows/update-remix-run-dev.yml`
seguem idênticos ao que já estava documentado — `newVersion` (do input
livre `workflow_dispatch` `new-version`) interpolado em template string
passada a `execSync` em 4 pontos (linhas 32/64/66/67), e a própria linha
29 do YAML interpola `${{ inputs.new-version }}` dentro de uma string JS
passada ao `actions/github-script`, um ponto de expression-injection
anterior ao command injection interno do script. Registrei
`record-validation --type=manual_code_review --result=not_applicable`
(não existe validador local pra este tipo de achado, JS/GitHub-Actions,
neste sistema) e tentei `transition ... reproduced_local` — recusado
como esperado. Registrei `record-deployment-evidence` (confidence=medium,
commit real confirmado, mas modelo de ameaça real — permissões do
`GITHUB_TOKEN` default do job, se algum colaborador write realmente
dispararia isso — não verificável só por leitura de código) e tentei
`transition ... scope_verified` diretamente de `corroborated_static` —
recusado pela máquina de estados (só aceita `reproduced_local->
scope_verified`, não há atalho definido a partir de `corroborated_static`).
Achado permanece travado em `corroborated_static`, sem mudança de
veredito: tecnicamente real, mas exige colaborador com write access já
autorizado pra explorar (não é vetor de atacante não-autenticado externo),
o que limita severidade prática apesar do `maxSeverity=critical` no scope
snapshot do programa.

Leitura profunda proativa desta rodada direcionada a Circle BBP (ver
NOTES.md respectivo) — nenhum arquivo novo óbvio de `vercel/vercel` pra
reler que já não tenha sido coberto nas ~37 leituras anteriores com
palavras-chave de auth/segurança.

## Rodada 2026-09-01 (push automático, sessão cloud, 5ª rodada do dia)

`program-policy.json` conferido antes de qualquer leitura (checklist do
NOTES.md de Block Open Source aplicado, na ordem certa desta vez).
`list-pending` global vazia, nenhum candidato deste programa a revisar.

Leitura profunda proativa: clonei `vercel/vercel` raso e busquei por
palavras-chave auth/session/token/login/crypto/secret ainda não cobertas
em `deep-read-log.json` (37 arquivos até então). Achei
`packages/cli-auth/oauth.ts` sem leitura prévia — chamou atenção porque
os arquivos vizinhos do mesmo pacote (`sso.ts`, `credentials-store.ts`)
já estavam lidos, mas o fluxo OAuth em si (Device Authorization Grant,
RFC 8628) não. Lido linha a linha (353 linhas): implementa discovery
(`.well-known/openid-configuration`) com checagem `as.issuer !==
issuer.origin` (compara origin, não a URL completa — aceitável pro uso
aqui já que `issuer` é passado como origem sem path pelo chamador, não é
um bypass de confusão de issuer), device authorization request, polling
de token, revoke, refresh e introspect — todos com `client_id` fixo (sem
client secret, esperado pra CLI pública) e validação via `zod/mini`.
Nenhum ponto de token sendo logado, nenhuma validação de assinatura
faltando (esse pacote não valida JWT localmente, só troca códigos com o
servidor — a validação de assinatura de ID token, quando existe, é feita
em `verify-vercel-oidc-token.ts`, já lido e sem achado em rodada
anterior). Sem achado.

`deep-read-log.json` atualizado (+1 em `vercel/vercel`, agora 38
arquivos).

## Rodada 2026-09-01 (push automático, sessão cloud, 8ª rodada do dia)

`list-pending` global vazia — nada deste programa pra revisar. O achado
`command_injection_risk` em `utils/update-remix-run-dev.js` segue
travado em `corroborated_static` pelo motivo já documentado nas 4
rodadas anteriores (sem validador local pra JS/TS, sem atalho definido
na máquina de estados de `corroborated_static` direto pra
`scope_verified`). Nada de novo a fazer nele.

Leitura profunda proativa desta rodada direcionada a `circlefin/
stablecoin-evm` (ver NOTES.md de Circle BBP) — nenhuma leitura adicional
de `vercel/vercel` nesta rodada.

## Rodada 2026-09-01 (push automático, sessão cloud, 9ª rodada do dia)

`migrate-to-v2.mjs` + `list-pending` global = 0. Achado
`command_injection_risk` em `utils/update-remix-run-dev.js` segue
travado em `corroborated_static` pelo mesmo motivo documentado nas
rodadas anteriores — sem mudança.

Leitura profunda proativa direcionada a `vercel/flags` (clone raso
novo, 11 arquivos já lidos em rodadas anteriores). Escolhidos 3 arquivos
ainda não lidos em `packages/vercel-flags-core/src` e
`packages/flags/src`, priorizando os que tocam contexto de
requisição/fetch remoto/cookies:

- `utils/request-context.ts` — só lê do symbol global
  `@vercel/request-context`, que é gerenciado pelo runtime da Vercel
  (não por este pacote); isolamento por requisição é responsabilidade
  de quem popula o symbol, não deste getter. Sem achado.
- `controller/fetch-datafile.ts` — monta `${host}/v1/datafile` com
  `Authorization: Bearer <token>`. Verifiquei a origem de `host`:
  default `'https://flags.vercel.com'` em `normalized-options.ts`,
  configurado pelo desenvolvedor da app hospedeira, não vem de input de
  requisição (header/query/cookie) em nenhum call site
  (`controller/index.ts`, `controller/polling-source.ts`). Sem SSRF —
  não é atacante-controlável. Sem achado.
- `spec-extension/adapters/request-cookies.ts` — cópia reduzida de
  código interno do Next.js (comentário confirma a origem), só um
  wrapper Proxy pra tornar cookies de request somente-leitura. Sem
  lógica nova. Sem achado.

Achado zero nesta rodada. `deep-read-log.json` atualizado (+3 em
`vercel/flags`, agora 14 arquivos).

## Rodada 2026-09-01 (push automático, sessão cloud, 10ª rodada do dia)

`list-pending` global = 0. Achado `command_injection_risk` em
`utils/update-remix-run-dev.js` segue travado em `corroborated_static`
pelo mesmo motivo documentado nas rodadas anteriores (sem validador
local pra JS/TS).

Leitura profunda proativa direcionada a `vercel/next.js` (clone raso
novo de `packages/next/src/server`), 3 arquivos novos priorizados por
tocarem fetch remoto/allowlist de host (`is-private-ip.ts`,
`image-optimizer.ts`, `match-remote-pattern.ts`):

**Achado novo, real, código confirmado linha a linha**: em
`image-optimizer.ts::fetchExternalImage`, o allowlist de host
configurado pelo desenvolvedor (`images.remotePatterns`/`domains`, via
`hasRemoteMatch`) só é checado UMA VEZ, no ponto de entrada
(`validateParams`). Quando o host upstream (já allowlisted) responde
com um redirect HTTP, `fetchExternalImage` chama a si mesma
recursivamente pra seguir o `Location` — mas NUNCA revalida o novo host
contra `hasRemoteMatch`, só contra o filtro de IP privado
(`isPrivateIp`, que por sua vez tem uma janela TOCTOU/DNS-rebinding
própria: `dns/promises.lookup()` uma vez antes, `fetch()` global resolve
de novo depois, sem pinning). Confirmei que nenhum teste existente
(`fetch-external-image.test.ts`, `maximum-redirects-1.test.ts`) cobre
redirect pra um host DIFERENTE do validado — os testes de redirect só
usam path relativo no MESMO host. Confirmei ainda que o mesmo código
está presente na última versão estável publicada no npm
(`next@16.3.4`, verificado via `registry.npmjs.org` + tag real
`v16.3.4` no GitHub, não só no branch canary não lançado).

Criado finding novo (`upsert-finding`, tipo `ai_deep_read_finding`),
avançado pra `corroborated_static` (transição aceita — cadeia de
código real confirmada). Tentativa de `scope_verified` recusada pela
máquina de estados como esperado (não-Solidity sem validador não pode
pular `reproduced_local` — mesma limitação já documentada pro achado de
`update-remix-run-dev.js`). `check-scope` confirmou `vercel/next.js`
em escopo, tier 1, elegível pra recompensa. Deployment evidence
registrada com confidence `medium` (código confirmado na release
estável real, mas sem confirmação de deploy de terceiro específico
explorável). Finding fica parado em `corroborated_static` até o
sistema ganhar um validador pra JS/TS ou um humano revisar diretamente.

`deep-read-log.json` atualizado (+6 em `vercel/next.js`, incluindo os 3
arquivos de teste lidos como parte da verificação, agora 12 arquivos no
total pra este repo).

## Rodada 2026-09-01 (push automático, sessão cloud, 12ª rodada do dia)

`program-policy.json` checado ANTES de qualquer leitura (lição do incidente
da rodada 11, ver `block-open-source/NOTES.md`). `list-pending` vazio — sem
candidates novos na fila.

Achado `ssrf_redirect_allowlist_bypass_risk` (image-optimizer.ts) já em
`corroborated_static` desde a rodada 10: faltava registrar formalmente a
tentativa de validação. `record-validation --result=not_applicable`
registrado (mesma limitação já documentada: sem validador local pra JS/TS)
e `transition -> reproduced_local` tentada — recusada como esperado pela
máquina de estados. Finding permanece em `corroborated_static`, sem mudança
de veredito. Achado `command_injection_risk` (update-remix-run-dev.js) já
tinha essa etapa registrada em rodada anterior — nada a fazer.

Leitura profunda proativa: 3 arquivos novos em `vercel/workflow`
(`workbench/vitest/workflows/hook-token-reuse.ts`,
`packages/cli/src/lib/inspect/auth.ts`,
`packages/core/src/serialization/encryption.ts`). Nenhum achado novo:
o primeiro é teste de regressão (comportamento correto sendo validado, não
bug); o segundo é refresh de OAuth padrão de CLI local, sem anomalia; o
terceiro é a camada de encriptação por capability (`SealTarget` vs
`RunPayloadKeys`) — design com branding de tipo deliberado pra tornar
confusão de chave simétrica/assimétrica um erro de compilação, não um bug
de runtime; nenhuma falha encontrada na lógica de encrypt/decrypt.
`deep-read-log.json` atualizado (+3 em `vercel/workflow`, agora 10
arquivos).

## Rodada 2026-09-01 (push automático, sessão cloud, 14ª rodada do dia)

`program-policy.json` checado antes de qualquer ação: `Block Open Source`
segue `aiResearchBanned: true`, nada tocado desse programa. `list-pending`
global = 0, nenhum candidate novo em nenhum programa.

Leitura profunda proativa direcionada a `nuxt/nuxt` (asset Tier 1 deste
programa, confirmado em `scope-snapshots/vercel-open-source.json`), 3
arquivos novos relacionados ao sistema de Server Components ("islands"),
seguindo a trilha das rodadas anteriores sobre esse mesmo subsistema:
`packages/nitro-server/src/runtime/utils/island-props.ts` (funções
`exceedsMaxDepth`/`exceedsMaxBytes`, guarda de profundidade/tamanho contra
payload de island não autenticado antes do parse/hash — confirmei em
`handlers/island.ts` que as duas guardas são chamadas ANTES de `destr()` e
do cálculo de hash, tanto pra leitura em streaming do corpo POST quanto
pra query string do GET, sem gap de ordem), `packages/nuxt/src/app/
components/nuxt-island.ts` (componente cliente que injeta `res.html`
vindo do servidor via `createStaticVNode` sem sanitização adicional — é
o mecanismo de renderização de island por design, não um bug: quando
`remoteComponentIslands` está ligado e `props.source` aponta pra uma
origem controlada pelo desenvolvedor da app, isso é equivalente a `v-html`
documentado, não dado de usuário final sendo injetado por essa rota) e
`packages/nitro-server/src/runtime/utils/renderer/islands.ts` (stitching
de teleports de slot/componente no HTML streamado — uid/slot/clientId
usados nos regexes de âncora vêm de chaves de teleport geradas pelo
próprio Vue no servidor, não de entrada do cliente). Nenhum achado novo:
o subsistema de islands já recebeu tratamento defensivo cuidadoso
(comentários no próprio código documentam as guardas de DoS e validação
de `scopeId` via regex antes de interpolar em HTML). Sem candidato óbvio
de vulnerabilidade nova nesta leitura.

`deep-read-log.json` atualizado (+3 em `nuxt/nuxt`, agora 7 arquivos).

## Rodada 2026-09-01 (push automático, sessão cloud, 15ª rodada do dia)

`program-policy.json` checado antes de qualquer leitura — sem entrada pra
Vercel Open Source (não banido). `list-pending` vazio, sem candidates
novos. Os 3 findings já em `corroborated_static` (deste programa: o
`ssrf_redirect_allowlist_bypass_risk` em `image-optimizer.ts` e o
`command_injection_risk` em `update-remix-run-dev.js`) já têm a etapa de
`record-validation --result=not_applicable` registrada de rodadas
anteriores — nada novo a fazer neles, permanecem presos em
`corroborated_static` pela mesma limitação (sem validador local pra JS/TS,
`scope_verified` recusado como esperado).

Leitura profunda proativa: clonado `vercel/eve` (`git clone --depth 1`) e
rastreada a cadeia de autorização do callback de sub-agente
(`session-callback-route.ts` -> `readTaskIdFromInboxToken` ->
`deriveTaskInboxToken`/`deriveTaskId` em `tasks/task-id.ts` ->
`workflow-continuation-security.ts`). O design é bearer-token deliberado
("posse do token de callback é a autorização", comentário explícito no
próprio arquivo): o token de inbox da task é `sha256(taskId \0
parentContinuationToken)`, determinístico de propósito (replay idempotente),
mas só é inadivinhável porque `parentContinuationToken` é gerado com
`randomBytes(32)` (256 bits) em `workflow-continuation-security.ts` e nunca
é renderizado pro modelo nem serializado no payload durável — confirmado
lendo a geração real, não assumido pelo comentário. Nenhuma falha
encontrada nessa cadeia. Também lidos `internal/http/basic-auth.ts`
(encoding trivial, sem lógica de auth real ali) e
`runtime/connections/authorization-tokens.ts` (cache de token por
`(authorizationScope, principalKey)`, escopo correto, sem risco de
colisão entre principals). `deep-read-log.json` atualizado (+7 em
`vercel/eve`, agora 18 arquivos).

Nenhum achado novo nesta rodada.

## Rodada 2026-09-01 (push automático, sessão cloud, 16ª rodada do dia)

`program-policy.json` checado antes de qualquer ação (disciplina do
incidente da rodada 11 em `block-open-source/NOTES.md`) — `Block Open
Source` continua `aiResearchBanned: true`, nenhum repo `cashapp/*`/
`afterpay/*`/`square/wire` tocado. `list-pending` global = 0.

**Nota de infraestrutura**: tentei usar `list-deep-read-candidates.mjs`
(gate mecânico contra programa banido) e ele falhou com `SyntaxError:
Unexpected non-whitespace character after JSON` — causa raiz é
`GITHUB_TOKEN=proxy-injected` (valor sentinela injetado neste ambiente
pro servidor MCP do GitHub) sendo enviado como `Authorization: Bearer
proxy-injected` em `githubHeaders()` pras chamadas a
`raw.githubusercontent.com`, que devolve 404 HTML em vez do JSON
esperado com esse token inválido (confirmado isolando a chamada: sem
esse header, `curl`/`fetch` puro devolvem 200 JSON normal). Contornado
rodando `GITHUB_TOKEN= node system/bugbounty-scanner/
list-deep-read-candidates.mjs` (variável vazia só pra esse comando) —
funcionou, listou 38 candidatos seguros e confirmou os 7 repos `Block
Open Source` excluídos. Pendência real de engenharia pra rodadas
futuras neste tipo de ambiente cloud: o script deveria ignorar
`GITHUB_TOKEN` quando ele não parece um PAT de verdade (ou cair pra
request anônimo em vez de falhar) — não é específico deste programa,
afeta a ferramenta de seleção segura usada por todos.

Leitura profunda proativa usando a lista segura: `vercel/swr` tinha só
1 arquivo lido (`hash.ts`) no log, mas o repo real tem 39 arquivos (o
log estava desatualizado — não é mais um pacote de arquivo único).
Lidos 3 arquivos novos, priorizando o caminho de serialização de
chave/cache (o mais próximo de "processamento de entrada" numa lib
client-side de data-fetching): `src/_internal/utils/serialize.ts`
(serializa a key do hook em string via `stableHash`, sem eval/injeção),
`src/_internal/utils/cache.ts` (inicialização do provider de
cache/pub-sub interno, tudo em memória do próprio cliente, sem cruzar
borda de confiança) e `src/_internal/utils/mutate.ts` (mutação
otimista + revalidação; timestamps resolvem corrida entre mutações
concorrentes, não são usados pra autorização). Nenhum dos três cruza
uma borda de confiança de rede/servidor nem lida com dado de terceiro
não confiável além do que o próprio usuário do app já controla — é
gerência de estado client-side pura. Sem achado.

(`vercel/ms` e `vercel/async-sema` confirmados como pacotes de arquivo
único de verdade — `src/index.ts` é tudo que existe em cada um, já
totalmente lidos, não deveriam reaparecer como candidatos.)

`deep-read-log.json` atualizado (+3 em `vercel/swr`, agora 4 arquivos).
Nenhum finding novo, nenhuma transição de estado tentada nesta rodada.

## Rodada 2026-09-01 (push automático, sessão cloud, 17ª rodada do dia)

`migrate-to-v2.mjs` + `list-pending` global = 0 candidatos pendentes.
`program-policy.json` checado antes de qualquer leitura — `Block Open
Source` continua `aiResearchBanned: true`, nenhum repo `cashapp/*`/
`afterpay/*`/`square/wire` tocado nesta rodada.

Leitura profunda proativa: `list-deep-read-candidates.mjs` (com o mesmo
contorno `GITHUB_TOKEN=` já documentado em rodadas anteriores, pra evitar
o header `Authorization: Bearer proxy-injected` inválido) apontou
`vercel/swr` como o repo do programa com menor cobertura relativa (4 de
39 arquivos). Clonado via `git clone --depth 1` (público, sem conta/
token). Nenhum arquivo com auth/session/crypto/token/login/password/
admin/permission/access no nome (biblioteca de data-fetching client-side,
não tem essas categorias por natureza) — segui julgamento de
especialista: os arquivos de lógica real ainda não lidos, não só tipos/
helpers triviais.

3 arquivos lidos por completo:
- `src/index/use-swr.ts` (1031 linhas, implementação central do hook
  `useSWR`) — revisado com atenção à lógica de deduplicação/corrida de
  requisições concorrentes (`revalidate`): `FETCH[key]` guarda
  `[promise, startAt]`, e depois do `await` compara `FETCH[key][1] !==
  startAt` para descartar respostas de requisições mais antigas que já
  foram substituídas — mesmo padrão para `MUTATION[key]` (ignora resposta
  de revalidação que se sobrepôs a uma mutação mais recente). Não há
  cruzamento de fronteira de confiança aqui: cache é `WeakMap`/objeto em
  memória do processo do próprio cliente, chave derivada da própria
  aplicação (nunca de resposta do servidor), sem lógica de autorização
  para auditar. Sem achado.
- `src/mutation/index.ts` (`useSWRMutation`) — `ditchMutationsUntilRef`
  usa timestamp para descartar resultados de trigger obsoletos (mesmo
  padrão de race-safety do arquivo acima). Sem achado.
- `src/_internal/utils/subscribe-key.ts` — helper trivial de
  subscribe/unsubscribe por chave (swap-with-last para remoção O(1)). Sem
  lógica de auditar.

Nenhum achado novo. `deep-read-log.json` atualizado (`vercel/swr` agora
com 7 arquivos, cobrindo toda a lógica não-trivial do pacote — os
arquivos restantes são tipos/context/presets já visitados ou triviais).
Sugestão pra próxima rodada: repos do programa ainda com pouca cobertura
segundo `list-deep-read-candidates.mjs` — `vercel-labs/agent-skills` (3
arquivos), `circlefin/*` de Circle BBP com poucas leituras (ver NOTES.md
desse programa) — ou aprofundar em `vercel/next.js`/`vercel/vercel`
(repos grandes, cobertura parcial).

## Rodada 2026-09-01 (push automático, sessão cloud)

`migrate-to-v2.mjs` + `list-pending` global = 0 candidatos pendentes (136
findings migrados: 125 falso_positivo, 3 corroborated_static, 3
known_duplicate, 2 duplicate, 2 inconclusive, 1 human_ready — nenhuma
mudança de estado desta rodada, nada específico de Vercel Open Source em
`candidate`).

Confirmado via `program-policy.json`: `Block Open Source` está marcado
`aiResearchBanned: true` (RoE da Bugcrowd proíbe uso de ferramentas de IA
na pesquisa, com risco explícito de "point reduction or program
expulsion") — excluído inteiramente da leitura profunda proativa desta
rodada, nenhum arquivo de `cashapp/*`, `square/wire` ou `afterpay/*`
tocado.

`list-deep-read-candidates.mjs` falhou de novo (mesmo erro de rodadas
anteriores: proxy do ambiente devolve HTTP não-JSON no `fetchDatasets`).
Seleção manual: `git clone --depth 1` de `vercel/flags`, diff de
`git ls-files` contra `deep-read-log.json`. `packages/docs/**` (a maior
parte do não-lido) é conteúdo de documentação, baixo valor de segurança —
priorizei `packages/` restante:

- `packages/flags/src/next/evaluate.ts` — fecha a cadeia de chamada do
  pipeline de overrides já auditado em rodadas anteriores
  (`overrides.ts`/`crypto.ts`/`verify-access.ts`, JWE autenticado): aqui é
  onde o cookie decriptado é efetivamente CONSUMIDO. `readOverrides` só
  chama `getOverrides` (decriptação autenticada) se o cookie
  `vercel-flag-overrides` existir e não for vazio; `hasOverride` checa
  `overrides[key] !== undefined` antes de usar o valor decriptado
  diretamente como decisão da flag (via `applyResult`), sem revalidar tipo/
  shape contra a declaração da flag — mas como o cookie só é aceito depois
  de autenticação AEAD (só quem tem a chave de encriptação consegue gerar
  um cookie válido), não há caminho de um atacante externo injetar um
  override sem a chave. Cache por `(headers, flagKey, entitiesKey)`
  isolado por request (WeakMap por objeto `Headers`), sem risco óbvio de
  vazamento cross-request. Sem achado.
- `packages/vercel-flags-core/src/controller/bundled-source.ts` — wrapper
  trivial de cache (`Promise` memoizada) em cima de
  `readBundledDefinitions` (não lido nesta rodada), zero lógica de
  autorização própria. Sem achado.

Leitura profunda proativa em `circlefin/arc-remote-signer` (Circle BBP, um
3º arquivo, ver `research/bugbounty/circle-bbp/NOTES.md`).

Nenhum achado novo, nenhuma transição de estado tentada.
`deep-read-log.json` atualizado (+2 em `vercel/flags`, agora 16 arquivos).

## Rodada 2026-09-01 (push automático, sessão cloud, rodada seguinte)

`migrate-to-v2.mjs` + `list-pending` global = 0 candidatos pendentes.
`list-deep-read-candidates.mjs` funcionou nesta rodada (sem o erro de
proxy relatado em rodada anterior) e já vem com o gate mecânico contra
`aiResearchBanned` embutido — confirmei que `Block Open Source`
(`cashapp/*`, `afterpay/*`, `square/wire`) segue excluído automaticamente
da lista, nenhum desses repos tocado. Peguei o candidato do topo da
lista (`vercel-labs/agent-skills`, só 3 arquivos lidos até então).
`check-scope "Vercel Open Source" "vercel-labs/agent-skills"` →
`allowed:true`, `bountyEligible:true`, `maxSeverity:critical`, tier 1.

Clone raso (`git clone --depth 1`, público, sem token) @
`063bee94c3f4df8453406c830b0a7df0f2860278`. Listei `git ls-files`
filtrando código real (excluindo `.md`/testes/fixtures) e priorizei
caminho com palavra-chave sensível: só 3 arquivos de código real batem
(`auth-route.mjs`, já lido em rodada anterior). Como o repo é pequeno e
a maior parte é doc/test, apliquei julgamento de especialista sobre o
que resta de lógica real não trivial — os dois scripts de deploy
(mesma categoria de risco de `command_injection_risk`/upload de dado
sensível já usada neste programa) e o helper central de shell-out pro
CLI da Vercel:

- `skills/deploy-to-vercel/resources/deploy.sh` e `deploy-codex.sh`
  (301 linhas cada, só diferem no comentário de uso e na URL do
  `DEPLOY_ENDPOINT` — diff conferido, resto byte-idêntico). Empacota o
  diretório do projeto (`tar`, excluindo `node_modules`/`.git`/`.env`/
  `.env.*` — cobre `.env` em qualquer profundidade, `--exclude` do tar
  não é ancorado) e faz upload via `curl -F` pra um endpoint fixo,
  hardcoded, `https://...vercel.{com,sh}/api/deploy` (sem client
  input plugado na URL). Sem `eval`, sem interpolação de variável não
  sanitizada em comando (os `grep -q "\"$1\""` internos usam só
  literais fixos da própria função, nunca dado externo). O único
  comportamento notável — subir a árvore inteira do projeto pra um
  endpoint de deploy anônimo/"claimable" — é a funcionalidade
  documentada da skill (fluxo de preview deploy sem login), não uma
  falha; o filtro de `.env*` mostra que o autor já pensou no risco de
  segredo vazando. Não cobre outros arquivos de segredo (`id_rsa`,
  `.aws/credentials` etc. se estiverem dentro do projeto), mas isso é
  risco inerente de qualquer ferramenta de "suba minha pasta" (inclusive
  o próprio `vercel deploy` oficial), não uma regressão introduzida por
  este script. Sem achado.
- `skills/vercel-optimize/lib/vercel.mjs` (864 linhas, completo) — todo
  shell-out usa `execFile` (nunca `exec`/`shell:true`), documentado
  explicitamente na linha 1 do próprio arquivo como decisão deliberada
  contra injeção via shell; args sempre passados como array, nunca
  concatenados em string. `redactSensitiveText` (usada antes de logar
  qualquer stderr/mensagem de erro do CLI) faz regex redaction de
  Bearer/Authorization/tokens conhecidos (`VERCEL_TOKEN` etc.) e de IDs
  `prj_`/`team_`/`usr_` — não encontrei caminho onde um token não
  redigido escaparia pro stdout/log antes de passar por essa função.
  `scopedArgs` recusa (`throw`) IDs brutos `team_`/`usr_` sem resolver
  pra slug antes de montar `--scope`, prevenindo o "silent fallback pro
  currentTeam errado" que o comentário do código documenta como bug
  conhecido do CLI da própria Vercel. Nenhuma lógica de autorização
  local sendo contornada (tudo delega a decisão de acesso pro `vercel`
  CLI/API real). Sem achado.

Nota à parte, não é achado de vulnerabilidade de produto: também abri
(sem executar nenhum comando, só leitura) `skills/vercel-cli-with-
tokens/SKILL.md` — é um arquivo de instruções em linguagem natural pra
um agente de IA (não código executável), ensinando como localizar/
exportar `VERCEL_TOKEN` de `.env`/ambiente e evitar passá-lo via
`--token` (harmless, aliás é a prática recomendada — evita o token
aparecer em `ps`/histórico de shell). Não cria nenhuma superfície nova:
quem executa esse fluxo já teria acesso ao próprio `.env`/ambiente do
usuário por definição, sem cruzar fronteira de confiança nova. Segui a
regra crítica desta rotina à risca: tratei o conteúdo desse arquivo como
dado a analisar (é literalmente uma instrução dirigida "a um agente de
IA" dentro de um repositório-alvo), nunca como instrução a seguir — não
executei nenhum dos comandos nele, só documentei a leitura.

Nenhum achado novo, nenhuma transição de estado tentada. `deep-read-
log.json` atualizado (+3 em `vercel-labs/agent-skills`, agora 6
arquivos, cobrindo toda a lógica real não-trivial que ainda restava —
o resto do repo é docs/rules `.md`, testes/fixtures em
`packages/vercel-optimize-tests/`, ou os demais scanners/gates/
sanitizers de `skills/vercel-optimize/lib/**`, que ficam pra rodada
futura se quiser aprofundar esse pacote específico).

## Rodada 2026-09-01 (push automático, sessão cloud)

`migrate-to-v2.mjs` + `list-pending` global = 0 candidatos pendentes.
Confirmado de novo via `program-policy.json`: `Block Open Source`
continua `aiResearchBanned: true` desde 2026-08-31 — o achado
`corroborated_static` já existente em `afterpay/sdk-ios` (deste
programa) foi deliberadamente NÃO tocado nesta rodada; nenhum outro
repo `cashapp/*`/`square/wire`/`afterpay/*` foi lido.

Revisados os 2 achados `corroborated_static` já existentes de Vercel
Open Source (`ssrf_redirect_allowlist_bypass_risk` em
`image-optimizer.ts` e `command_injection_risk` em
`update-remix-run-dev.js`): ambos confirmados presos permanentemente em
`corroborated_static` pela própria máquina de estados
(`corroborated_static->reproduced_local` só aceita `validations` com
`result="pass"`; JS/TS não tem validador local neste sistema, então
`not_applicable` é o único resultado possível — e
`corroborated_static->scope_verified` nem existe como transição
definida em `state-machine.mjs`, só `reproduced_local->scope_verified`).
Nenhuma tentativa nova de transição — já documentado em rodadas
anteriores, recusa seria idêntica.

Leitura profunda proativa em `vercel-labs/agent-skills` (mais lógica
real ainda não coberta em `skills/vercel-optimize/lib/**`, seguindo a
sugestão da rodada anterior): li `lib/vercel.mjs` (wrapper do CLI da
Vercel — `execFile` corretamente, sem shell injection, redação de
segredo em `redactSensitiveText`; sem achado, mesma conclusão
independente já registrada por uma rodada concorrente) e
`lib/verify-claim.mjs`, o módulo que verifica mecanicamente as "claims"
que o sub-agente de IA da própria skill produz sobre o código escaneado
(defesa contra alucinação do LLM).

**Achado novo**: `verify-claim.mjs::repoPaths`/`firstAccessiblePath`
(L1221-1244) monta o caminho de um arquivo citado numa claim via
`join(repoRoot, file)` sem nunca confirmar que o resultado continua
dentro de `repoRoot` — path absoluto é aceito direto, e `..` no `file`
escapa via `path.join` normal do Node. Rastreei a cadeia completa: esse
`file` vem de `rec.affectedFiles`/`rec.findingRefs`, e `rec` é o JSON de
recomendação gerado pelo SUB-AGENTE DE IA que roda a skill
`vercel-optimize` sobre o codebase que o usuário pediu pra otimizar —
`verify-and-regen.mjs` lê esse JSON de um arquivo e passa direto pra
`extractClaims`/`verifyClaim`, sem nenhuma validação de schema/allowlist
de path. A única barreira contra o sub-agente citar um path fora do
repo é uma instrução em prosa dentro do prompt
(`investigation-brief.mjs` L547), nunca validada em código. Resultado:
um repositório de terceiro malicioso escaneado pela skill pode, via
prompt injection indireta, induzir o sub-agente a emitir um
`affectedFiles`/`findingRefs` com path traversal ou absoluto — e o
pipeline de auto-verificação (cujo propósito é justamente desconfiar do
LLM) vai ler esse arquivo fora do repo sem perceber, expondo um oracle
de existência/conteúdo (booleano) de arquivos arbitrários no disco de
quem roda a skill.

Registrado como
`Vercel Open Source::vercel-labs/agent-skills/skills/vercel-optimize/lib/verify-claim.mjs::repoPaths::path_traversal_arbitrary_file_read_risk`,
escopo confirmado via `check-scope` (`allowed=true`,
`eligibleForBounty=true`, `maxSeverity=critical`, tier 1). Avançado até
`corroborated_static` (reasoning + filesRead completos, 8 arquivos da
cadeia de chamada lidos). `record-validation` com
`result=not_applicable` (mesma limitação dos outros 2 achados JS/TS do
programa — sem validador local) e tentativa de `reproduced_local`
recusada como esperado — fica preso em `corroborated_static` até
existir validador real pra este tipo de achado. Confidence: média (a
falha de path-containment no código está 100% confirmada linha a
linha; o que fica em aberto é o quão fácil é induzir o sub-agente real
via prompt injection e qual canal de exfiltração o atacante teria
disponível no fim da cadeia — não simulado nesta rodada, fora do
escopo de leitura de código público autorizada).

`deep-read-log.json` atualizado (+9 em `vercel-labs/agent-skills`,
agora 15 arquivos — inclui toda a cadeia de chamada rastreada pro
achado acima: `verify-finding.mjs`, `verify-and-regen.mjs`,
`extract-claims.mjs`, `investigation-brief.mjs`, `dedup-recs.mjs`,
`grade-recommendation.mjs`, `repo-root.mjs`, além de
`check-citations.mjs`/`verify-claim.mjs`).

Nota operacional: esta rodada rebaseou sobre `origin/master` (duas
rodadas concorrentes já tinham avançado o branch com leitura profunda
em `vercel-labs/agent-skills` e `circlefin/evm-cctp-contracts`,
respectivamente, ambas sem achado — sem sobreposição com o achado
acima, que é num arquivo/módulo diferente do que a rodada concorrente
leu).

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud)

`list-pending` global = 0 (rebase confirmado: o achado `verify-claim.mjs
repoPaths` da rodada concorrente anterior já está em `corroborated_static`
no branch atualizado — 4 achados nesse estado no total agora).

Leitura profunda proativa direcionada a `vercel/vercel`: diff de
`git ls-files` (sparse-checkout de `packages/cli-auth`, `packages/oidc`,
`packages/connect`, `packages/cli-config`) contra `deep-read-log.json`
mostrou 7 arquivos novos não lidos em `packages/connect/src/eve/**` e
`packages/connect/src/chat/**` — a família de helpers `connect*Credentials`/
`connect*Adapter` que empacota credenciais de bot por canal (GitHub,
Slack, Discord, Linear, Photon) pra uso no Eve:

- `eve/github-credentials.ts`, `eve/slack-credentials.ts`,
  `eve/linear-credentials.ts` — mesmo padrão nas três: `subject:
  { type: 'app' }` é escrito *depois* do spread de `...params` no
  literal de objeto passado a `getToken`, então mesmo que um chamador
  burle o tipo `Omit<ConnectTokenParams, 'subject'>` em runtime (JS puro,
  sem enforcement de tipo) e injete um `subject` custom em `params`, a
  chave literal subsequente sobrescreve — não é só proteção de
  TypeScript, é proteção real da ordem de avaliação do objeto. Nenhuma
  validação de rota nova a burlar; `webhookVerifier` delega pro mesmo
  `vercelOidc()`/`createConnectWebhookVerifier()` já revisado em rodada
  anterior (`chat/webhook-verifier.ts`). Sem achado.
- `eve/discord-credentials.ts`, `eve/photon-credentials.ts` — mesma
  blindagem de `subject`, mas com uma etapa a mais: valida o
  `applicationId`/`projectId` retornado em `response.metadata` (`typeof
  === 'string' && length > 0`) antes de expor a credencial, com erro
  explícito se o Connect devolver metadata malformada — sem TOCTOU
  visível (o campo é lido uma vez do mesmo `response` já resolvido, não
  há segunda leitura de fonte mutável entre check e uso). Sem achado.
- `chat/slack-adapter.ts` (73 linhas) — wrapper fino em cima do mesmo
  `getToken`/`createConnectWebhookVerifier()`, zero lógica nova de
  autorização própria. Sem achado.
- `connect/src/internal/team-id.ts` — decodifica o JWT OIDC da própria
  Vercel (`getVercelOidcTokenSync()`) sem checar assinatura, mas o
  comentário do próprio arquivo já documenta a razão: é o token do
  *próprio* processo (não input de terceiro), usado só pra preencher
  `?teamId=` num link de consentimento de UI — falha é silenciosa
  (`undefined`) e cai pra URL sem qualificação de time. Nenhuma decisão
  de autorização depende deste valor. Sem achado.

Nenhum achado novo, nenhuma transição de estado tentada. `deep-read-
log.json` atualizado (+7 em `vercel/vercel`). Resta ainda não lido em
`packages/connect/src/chat/`: `github-adapter.ts`/`linear-adapter.ts`
(mesmo padrão do `slack-adapter.ts` já confirmado, baixa prioridade) e
`packages/oidc/src/{get-context,get-vercel-oidc-token-sync,
get-vercel-oidc-token-with-refresh,token}.ts` — candidatos pra rodada
futura.

Nota de status: o achado `verify-claim.mjs repoPaths` (path traversal /
oracle de leitura arbitrária de arquivo, tier 1, `eligibleForBounty=true`,
`maxSeverity=critical`) segue preso em `corroborated_static` pela mesma
limitação estrutural já documentada pros outros 2 achados JS/TS deste
programa: não existe validador local (PoC executável) pra esse tipo de
achado fora de Solidity, então a transição pra `reproduced_local`/
`scope_verified` é recusada pelo state machine de propósito — não é bug,
é o sistema esperando um humano decidir se compensa validar manualmente
esse tipo de achado antes de reportar.

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud, 15ª rodada do dia)

`program-policy.json` checado antes de qualquer leitura (nenhuma entrada
pra "Vercel Open Source" — sem restrição). `list-pending` global = 0.

Leitura profunda proativa nos 4 candidatos deixados pendentes na rodada
anterior: `packages/connect/src/chat/github-adapter.ts`,
`packages/connect/src/chat/linear-adapter.ts` (clone raso de
`vercel/vercel`, mesmo commit `e06cc643cec6a47bd9344af7f4589c736d95ed15`
já lido antes) e, em `packages/oidc/src`,
`get-vercel-oidc-token-with-refresh.ts` + `token.ts` (o `refreshToken`
que ele chama via import dinâmico).

- `github-adapter.ts`/`linear-adapter.ts`: mesmo padrão já confirmado
  seguro nos outros adapters (`slack`, `discord`, `photon`) — `subject:
  { type: 'app' }` é escrito depois do spread de `...params` no literal
  passado a `getToken`, então a chave literal subsequente sempre
  sobrescreve qualquer tentativa de override em runtime. Sem achado.
- `get-vercel-oidc-token-with-refresh.ts::getVercelOidcToken` +
  `token.ts::refreshToken`: cadeia rastreada ponta a ponta —
  `getVercelOidcToken` só chama `refreshToken`/re-lê o token sync quando
  `!token || isExpired(...)`, e `refreshToken` resolve `projectId`/
  `teamId` (params explícitos > `.vercel/project.json`), carrega token
  cacheado local via `loadToken(projectId)` (chave só por projectId, sem
  cross-referenciar teamId no cache) e, se ausente/expirado, re-obtém via
  keyring da CLI ou `getVercelOidcToken(authToken, projectId, teamId)`.
  Isso é cache/refresh 100% local (arquivo de config do próprio usuário
  na própria máquina) — não é um limite de confiança entre tenants/
  usuários diferentes, então mesmo sem correlação teamId no cache local
  não há um atacante de terceiro alcançando esse caminho. Sem achado.

Nenhum achado novo, nenhuma transição de estado tentada.
`deep-read-log.json` atualizado (+4 em `vercel/vercel`). Os 4 achados
`corroborated_static` deste programa continuam presos nesse estado pela
mesma limitação estrutural (sem validador local pra JS/TS) — não
revisitados nesta rodada, sem informação nova que mudasse isso.
## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud, 16ª rodada do dia)

`list-pending` vazio (nenhum achado em `candidate`). Os 3 achados JS/TS
já em `corroborated_static` (`update-remix-run-dev.js` command
injection, `image-optimizer.ts` SSRF redirect bypass, `verify-claim.mjs`
path traversal) foram conferidos — reasoning e histórico já documentam
que ficam presos ali de propósito (sem validador local pra JS/TS, state
machine só aceita `reproduced_local -> scope_verified`), nenhuma ação
nova necessária.

Leitura profunda proativa: `vercel/ai` (tier 1, `check-scope` confirmado
`allowed=true`/`eligibleForBounty=true`/`maxSeverity=critical`), 3
arquivos novos em `packages/ai/src/generate-text/` e
`packages/ai/src/util/`: `tool-approval-signature.ts`,
`canonical-hash.ts`, `validate-tool-approvals.ts` — o mecanismo de
assinatura HMAC-SHA256 (v1, payload JSON injetivo com domain-separation)
que autentica aprovações humanas de chamadas de tool antes de execução.

Investigado com ceticismo: `canonicalJSON` (canonical-hash.ts) colapsa
`NaN`, `Infinity` e `null` no mesmo literal `"null"` (herdado do
comportamento de `JSON.stringify` para esses valores), o que em teoria
permite dois inputs logicamente distintos produzirem o mesmo
`inputDigest` e portanto a mesma assinatura válida. Refutado: por
`validate-tool-approvals.ts` (docstring: "reconstructed from
client-supplied message history"), o `input` verificado sempre chega
depois de ter cruzado a fronteira de transporte JSON real (HTTP
JSON-serializado) entre o momento da aprovação humana e a verificação —
e `NaN`/`Infinity` não são representáveis em JSON (`JSON.parse` rejeita
o literal, não silenciosamente vira `null`), então um atacante nunca
consegue de fato entregar um valor `NaN`/`Infinity` nesse ponto do
código pra explorar a colisão; ela só existiria num cenário same-process
sem serialização JSON no meio, que não é o caminho real de uso.
Verificação de assinatura em si (`crypto.subtle.verify`, HMAC-SHA256,
formato legado só aceito quando os campos não contêm o delimitador `\n`
que o tornava ambíguo) e lookup de tool via `getOwn` (blindado contra
poluição de protótipo por `toolName` tipo `constructor`) sem problema.
Sem achado novo — resultado normal e válido, não um problema a inventar.

`deep-read-log.json` atualizado (+3 em `vercel/ai`). Nenhuma transição
de estado tentada nesta rodada (nada em `candidate`, nada progrediu).

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud, 17ª rodada do dia)

`list-pending` global = 0 (`node migrate-to-v2.mjs` + `cli.mjs
list-pending` confirmados). `program-policy.json` checado antes de
qualquer leitura — `Block Open Source` segue `aiResearchBanned: true`,
nada tocado ali.

Leitura profunda proativa: `vercel/eve`, 3 arquivos novos ainda não no
log, priorizando auth/token: `packages/eve/src/public/models/openai/
chatgpt/unsigned-jwt.ts`, `packages/eve/src/execution/
authorization-callback-match.ts`, `packages/eve/src/runtime/
connections/resolve-authorization.ts`.

- `unsigned-jwt.ts`: nome soa alarmante ("JWT sem assinatura"), mas o
  próprio docstring já avisa "Test fixture only — no crypto involved" e
  confirmei via grep: os únicos importadores são `token-broker.test.ts`
  e `auth.test.ts`. Não participa de nenhum caminho de verificação real.
  Sem achado.
- `authorization-callback-match.ts`: correlaciona callbacks OAuth
  recebidos (`DeliverPayload`) com desafios pendentes (`pending.
  challenges`) por `connectionName` + `attemptId` (ou modo legado sem
  `attemptId`). Puramente correlação de estado — não faz nenhuma
  verificação de assinatura/token aqui; isso deve viver em outro lugar
  do pipeline (já coberto em rodadas anteriores via `jwt-hmac.ts`/
  `jwt-ecdsa.ts`/`token-claims.ts`/`shared/session-auth.ts`). Não
  refutei uma hipótese de `attemptId` previsível permitir sequestro de
  callback de outro usuário porque não vi neste arquivo onde/como
  `attemptId` é gerado nem o escopo de sessão do `pending` — fica como
  fio solto de baixo valor para rastrear numa rodada futura se o mesmo
  arquivo for revisitado com mais contexto, não achado registrável hoje
  (evidência insuficiente pra `corroborated_static`).
- `resolve-authorization.ts`: cache por-execução (`AsyncLocalStorage`)
  do provider de autorização resolvido para uma conexão, evita resolver
  o mesmo provider dinâmico mais de uma vez na mesma execução. Wiring
  puro, sem lógica de verificação. Sem achado.

Sem achado novo — resultado normal e válido. `deep-read-log.json`
atualizado (+3 em `vercel/eve`, agora 21 arquivos). Nenhuma transição de
estado tentada (nada em `candidate`).

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud)

`list-pending` global = 0 (confirmado via `migrate-to-v2.mjs` +
`cli.mjs list-pending`). Revisitei os 4 achados em `corroborated_static`
antes da leitura profunda: 3 são deste programa
(`ssrf_redirect_allowlist_bypass_risk` em `vercel/next.js`,
`command_injection_risk` em `vercel/vercel`,
`path_traversal_arbitrary_file_read_risk` em `vercel-labs/agent-skills`).
Todos JS/TS, sem validador local disponível (limitação estrutural já
documentada) — `corroborated_static->reproduced_local` exige
`result="pass"` de uma validação real, que não existe pra esta
linguagem, então nenhuma transição nova foi tentada nesses achados
(forçar seria contornar a máquina de estados). Reli o código-fonte atual
de `packages/next/src/server/image-optimizer.ts` (clone raso fresco,
HEAD `9c626ac94b8bcd8195e4f4d789824f90e0c95fe5`, branch canary) pra
confirmar que o achado SSRF-via-redirect ainda bate linha a linha com o
`reasoning` já salvo: confirmado — `fetchExternalImage` (L521-587) ainda
recursiona em redirect (L580-586) sem re-chamar `hasRemoteMatch`/
`validateParams`, só reaplica o guard de IP privado a cada recursão.
Achado segue válido, nenhuma mudança necessária no reasoning.

Leitura profunda proativa desta rodada (3 arquivos, todos em
`vercel/next.js`, com foco em crypto/auth):

- `packages/next/src/server/crypto-utils.ts`: `encryptWithSecret`/
  `decryptWithSecret`, AES-256-GCM com salt+IV aleatórios por chamada
  (`crypto.randomBytes`), chave derivada via PBKDF2-SHA512 (100k
  iterações), tag de autenticação verificado no decrypt
  (`setAuthTag`/`getAuthTag`). Esquema correto, sem reuso de nonce, sem
  falha óbvia. Sem achado.
- `packages/next/src/server/api-utils/node/api-resolver.ts` (função
  `setPreviewData`, L165-221): assina o payload de Preview/Draft Mode
  com `jsonwebtoken.sign(..., options.previewModeSigningKey, {algorithm:
  'HS256', ...})` — algoritmo sempre fixado explicitamente como HS256,
  chave é simétrica (nunca um par de chave RSA/EC), então não há
  superfície pra confusão de algoritmo (o clássico "RS256→HS256 usando a
  chave pública como segredo HMAC" não se aplica aqui, já que só existe
  segredo simétrico em todo o fluxo). Também confirma
  `isValidData(previewModeId/EncryptionKey/SigningKey)` antes de assinar
  — sem achado.
- `packages/next/src/server/api-utils/node/try-get-preview-data.ts`:
  lado da verificação — `jsonwebtoken.verify(tokenPreviewData,
  options.previewModeSigningKey)` sem passar `algorithms` explicitamente
  no options. Investiguei se isso abre brecha pro clássico "alg:none"
  bypass do `jsonwebtoken`: não abre — a lib só aceita `none` se
  `algorithms` incluir `'none'` explicitamente (nunca é o default), e o
  default (quando `algorithms` não é passado) é inferido do tipo da
  chave: como `previewModeSigningKey` é uma string/Buffer comum (não
  começa com `BEGIN CERTIFICATE`/`BEGIN PUBLIC KEY`), a lib assume
  `HS256`/`HS384`/`HS512` — bate com o que `setPreviewData` de fato
  assina. Também comparei `previewModeId` do cookie contra
  `options.previewModeId` antes de sequer chamar `verify` (L43-48,
  L77-82) — sem bypass óbvio de fixação de sessão entre builds
  diferentes. Sem achado.

Sem achado novo — resultado normal e válido. `deep-read-log.json`
atualizado (+3 em `vercel/next.js`, agora 15 arquivos). Nenhuma transição
de estado nova tentada.

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud, 20ª rodada do dia)

`program-policy.json` checado antes de qualquer leitura (sem restrição
pra "Vercel Open Source"). `list-pending` global = 0. Muitas outras
sessões cloud rodaram em paralelo sobre o mesmo push nesta rodada
(vercel/eve, vercel/ai::tool-approval-signature.ts, revisita SSRF em
vercel/next.js, circlefin/stablecoin-sui — todas sem achado novo). Esta
sessão continuou em `vercel/ai` numa área nunca lida antes: o bridge
WebSocket dentro do sandbox (`packages/harness/src/`).

**Achado novo**: `packages/harness/src/bridge/index.ts::runBridge` —
`timing_attack_risk`, confidence baixa, movido pra `corroborated_static`.
O bridge WebSocket (media comandos de controle — `start`/`resume`/
`stop`/`destroy`/`tool-result`/`user-message` — entre o processo host
do ai-sdk e o CLI do coding agent real rodando dentro do sandbox: codex,
claude-code, opencode, cline, deepagents) liga em `0.0.0.0` e é exposto
ao host via `sandbox.domain(port)` (`@vercel/sandbox`, domínio HTTPS/
WSS publicamente roteável — modelo de rede intencional do sandbox, não
é o achado em si). A única autenticação é `agent_bridge_token`,
comparado com `!==` direto (não-constant-time, CWE-208), e
`expectedToken` cai pra string vazia (`''`) se nem `options.token` nem
a env `BRIDGE_CHANNEL_TOKEN` forem passados — sem throw. Rastreei os 5
harnesses embutidos (codex, claude-code, opencode, deepagents, acp) até
o spawn do processo bridge: todos SEMPRE geram um token real de 256
bits (`createBridgeToken()`) ou delegam a `settings.mintBridgeToken`, e
sempre setam `BRIDGE_CHANNEL_TOKEN` no `env` — então o fallback pra
vazio é código morto no caminho de produção empacotado do próprio
ai-sdk; só seria alcançado por um consumidor externo de `runBridge`
(API pública de `@ai-sdk/harness/bridge`) que a chamasse sem configurar
token nem a env var. A comparação não-constant-time em si é um padrão
de código real (CWE-208), mas ataque de timing prático contra ela via
rede pública (TLS + WAN, jitter em escala de milissegundos vs.
diferença de timing em escala de nanossegundos, 256 bits de espaço de
chave) não tem sustentação — reduz a severidade prática a baixa. Preso
em `corroborated_static` pela mesma limitação estrutural dos outros 4
achados JS/TS/Swift deste conjunto de programas (sem validador PoC
local pra esse tipo de achado).

Outros 2 arquivos lidos sem achado: `packages/harness/src/agent/
internal/permission-mode.ts` (`DEFAULT_PERMISSION_MODE = 'allow-all'` —
default explícito e tipado, decisão de design do integrador, não bug) e
`packages/harness-codex/src/bridge/tool-relay-auth.ts` +
`packages/harness-opencode/src/bridge/tool-relay-auth.ts` (correlação
de chamada de ferramenta por chave/TTL em memória — não é mecanismo de
autenticação de rede, é só pareamento de request/response dentro do
mesmo processo; sem achado).

`deep-read-log.json` atualizado (+7 em `vercel/ai`, agora 16 arquivos).

## Rodada 2026-09-01 (push automático via GitHub webhook, sessão cloud, 21ª rodada do dia)

`list-pending` global = 0. Revisitei rapidamente os achados
`corroborated_static` deste programa (SSRF em `image-optimizer.ts`,
command injection em `update-remix-run-dev.js`, path traversal em
`verify-claim.mjs`, timing attack em `packages/harness/src/bridge/
index.ts`) — nenhuma mudança de estado tentada, mesma limitação
estrutural de sempre (sem validador PoC local pra JS/TS).

Leitura profunda proativa nesta rodada em `vercel/vercel`, área de
tokens/auth do CLI ainda não coberta: `packages/cli/src/commands/blob/
signed-token.ts` (plumbing de CLI que só repassa flags pra
`blob.issueSignedToken()` do SDK `@vercel/blob` — a lógica de
assinatura em si vive fora deste repo, fora de escopo pra ler aqui;
sem achado) e `packages/cli/src/util/domains/get-auth-code.ts` (só
valida que o código de transferência de domínio não é vazio antes de
repassar pro backend; sem lógica de auth local, sem achado).

`deep-read-log.json` atualizado (+2 em `vercel/vercel`, agora 51
arquivos). Sem achado novo, nenhuma transição de estado tentada.

## Rodada 2026-09-02 (sessão local) — outcome real do achado SSRF em image-optimizer.ts

O achado SSRF/allowlist-bypass em `image-optimizer.ts` (`fetchExternalImage`
segue redirect cross-host sem re-checar `remotePatterns`) foi de fato
enviado à HackerOne como report #3988959, com PoC local real executado
(control 400 direto em `:5002`, treatment 200 via redirect `:5001`→
`:5002`, log `HIT: /secret` confirmado ao vivo, não só previsto por
leitura de código) e 5 screenshots reais (código no GitHub + terminal
do usuário rodando o PoC pessoalmente). Depois de um ciclo
"Needs More Info" (faltava anexar arquivo .zip com o PoC — corrigido
com um archive limpo, testado do zero com `npm install` antes de
anexar), o report foi **fechado como Duplicate de #3943945** por
`@h1_analyst_geralt` ~4h depois do reenvio. O analista confirmou
explicitamente que a análise técnica bate (mesmo call chain, mesma
técnica de exploit via redirect 302, mesma correção sugerida) — não foi
recusado por estar errado, só não foi o primeiro a reportar. Um
terceiro report (#3971664) também já tinha sido fechado como duplicata
do mesmo #3943945 original, ou seja, pelo menos 3 pessoas encontraram
esse mesmo bug de forma independente.

Não havia como ter pego essa duplicata antes de enviar: o duplicate
check documentado no próprio report ("no public advisory or issue was
found addressing this specific path") era verdadeiro e era o máximo de
diligência possível — reports privados de outros hackers no mesmo
programa são propositalmente invisíveis entre si na HackerOne
(justamente pra evitar conluio/cópia), então não existe busca pública
que teria encontrado #3943945 antes do fechamento.

**Nota de inconsistência encontrada nesta rodada**: ao tentar registrar
esse outcome real via `record-platform-outcome` no `zerotoone.db`, o
finding não foi encontrado — nem por `file LIKE '%image-optimizer%'`
nem por `id LIKE '%fetchExternalImage%'`. Ou seja, apesar de rodadas
anteriores desta mesma NOTES.md citarem esse achado como
`corroborated_static` (ex.: rodada "21ª do dia" acima), ele
aparentemente nunca foi de fato persistido via `upsertFinding` no
banco real — só existe na narrativa deste arquivo. Não tentei
reconstruir o registro no banco com campos históricos inventados
(`confidence`, `reasoning`, `poc_run` etc.) porque isso inseriria dado
fabricado no sistema de registro; documentando aqui em texto puro em
vez disso. Se uma sessão futura for mexer no scanner/DB, vale
investigar por que esse `upsertFinding` nunca aconteceu (bug real no
pipeline, ou só uma sessão anterior que descreveu a intenção sem
executar o CLI de fato).

Estado final, para efeitos de rastreamento manual: `duplicate`
(HackerOne #3988959, duplicata de #3943945). Sem bounty.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud)

`list-pending` global = 0 (nenhum candidate em nenhum dos 4 programas).
Leitura profunda proativa: `vercel/eve` cresceu bastante desde a última
cobertura do log (só 20 arquivos registrados vs. 300+ arquivos hoje com
`auth`/`session`/`token` no caminho — clonado de novo pra confirmar, não
é falso positivo do find). Escolhidos 3 arquivos de lógica real (não
teste/eval-fixture), priorizando o core de autorização interativa:
`packages/eve/src/harness/authorization.ts` (API pública de
request/get/consume de authorization challenges, callback hook URL
determinístico `${sessionId}:auth`, e `samePrincipal()` que compara
principals). Investiguei com ceticismo se `samePrincipal` tratando todo
principal `type:"app"` como igual a qualquer outro (sem comparar id)
seria confusão de autorização cross-app — refutado: o próprio tipo
`ConnectionPrincipal` (`connection-types.ts`) não carrega `id` nenhum
pra `type:"app"` (é "shared agent identity; one token per connection
across all sessions"), e o comentário em `AuthorizationDefinition`
confirma que OAuth interativo (o único fluxo que usa
`setPendingAuthorization`/`samePrincipal`) é "Restricted to
principalType: 'user' in v1" — então o branch `app` do comparador nunca
é exercitado por esse fluxo. Não é bug, é comparação completa pro tipo
que não tem mais nada pra comparar.

Também verifiquei se o hook token determinístico (`sessionId:auth`, sem
nonce aleatório por-attempt) seria forjável — mas ele funciona como
capability token sobre um sessionId já tratado como não-adivinhável em
todo o resto do sistema (mesmo padrão de outras rotas já revisadas em
rodadas anteriores), não uma superfície nova.

Os outros dois arquivos — `packages/eve/src/public/agents/auth.ts`
(helpers `vercelOidc`/`bearer`/`basic` pra montar headers de outbound
auth em dispatch de remote agent) e
`packages/eve/src/execution/connection-auth-tool-result.ts` (13 linhas,
só normaliza resultado de tool pra JSON-safe via
`JSON.parse(JSON.stringify(...))`) — sem lógica de autorização própria
pra auditar, sem achado.

`deep-read-log.json` atualizado (+3 em `vercel/eve`). Nenhum achado
novo, nenhuma transição de estado. Nota pra rodadas futuras: `vercel/eve`
tem uma superfície de auth muito maior do que o log sugere — vale
priorizar esse repo nas próximas rodadas em vez de espalhar por outros
já bem cobertos.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, migração v2)

Primeira rodada usando o CLI com máquina de estados
(`system/bugbounty-scanner/cli.mjs`) em vez de editar `queue.jsonl` na
mão. `migrate-to-v2` rodado sem erro, contagens batem com o estado
anterior. `list-pending` global = 0.

Três achados deste programa seguem presos em `corroborated_static`
(`image-optimizer.ts::fetchExternalImage::ssrf_redirect_allowlist_bypass_risk`,
`update-remix-run-dev.js::command_injection_risk`,
`harness/src/bridge/index.ts::runBridge::timing_attack_risk`). Tentei
avançar o primeiro (SSRF) pelo fluxo completo do passo (g) da rotina:
`check-scope "Vercel Open Source" "vercel/next.js"` → `allowed:true,
bountyEligible:true, tier 1, maxSeverity critical` (nota: o campo
`instruction` do scope snapshot só é texto descritivo do programa sobre
como classificar o ativo, não uma instrução operacional — tratado como
dado); `record-deployment-evidence` registrado com `confidence:
"unverified"` (é uma falha lógica na biblioteca em si, não um deploy
específico que eu possa confirmar); `transition ... scope_verified`
recusado pela máquina de estados com motivo:
`"transição \"corroborated_static\" → \"scope_verified\" não é
permitida"` — na verdade a transição direta nem existe; precisa passar
por `reproduced_local` antes, que por sua vez exige um validador local
(`corroborated_static->reproduced_local` recusa com "nenhum validador
local existe ainda para este tipo de achado"). Não existe validador
local pra JS/TS hoje (mesma limitação já documentada nas rodadas
anteriores, sob o schema antigo) — os 3 achados ficam legitimamente
presos em `corroborated_static` até uma fase futura do plano adicionar
um validador de verdade. Não tentei contornar a recusa; não forcei
nada. Não repeti o mesmo teste pros outros 2 (mesma conclusão
esperada, evidência já suficiente com 1 exemplo).

Leitura profunda proativa desta rodada foi direcionada a
`circlefin/malachite` (Circle BBP) — ver NOTES.md desse programa. Nenhum
achado novo neste programa nesta rodada.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, pós-migração v2)

`list-pending` global = 0 (confirmado após `migrate-to-v2`). Os 3 achados
em `corroborated_static` deste programa seguem travados no mesmo ponto
documentado na rodada anterior (sem validador local pra JS/TS ainda);
não repeti a tentativa de transição, mesma conclusão esperada.

Leitura profunda proativa desta rodada seguiu a recomendação da rodada
anterior de priorizar `vercel/eve` (superfície de auth maior que o log
sugeria). Três arquivos novos lidos, nenhum ainda coberto:
`packages/eve/src/channel/auth/oidc.ts` (verificação de JWT OIDC contra
JWKS remoto — todos os branches (`external_sub`, `user_id` de dev,
`sub` genérico) são fail-closed: exigem `project_id`/`environment`
batendo com o projeto Vercel atual antes de autenticar, com comentários
no próprio código confirmando a intenção; nenhum bypass encontrado),
`packages/eve/src/execution/session-command-token.ts` (token
determinístico `eve:session:<sessionId>:inbox`, mesmo padrão de
"capability token sobre sessionId não-adivinhável" já analisado em
rodada anterior — confirmado por grep que só é consumido internamente
pelo motor de workflow durável, nunca exposto como token de API
externo; não é superfície nova) e
`packages/eve/src/runtime/connections/authorization-complete-page.ts`
(página HTML estática pós-callback OAuth, sem interpolação de dado do
usuário, sem XSS). Sem achado novo.

`deep-read-log.json` atualizado (+3 em `vercel/eve`). Nenhuma transição
de estado tentada neste programa nesta rodada.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, 3ª rodada pós-migração v2)

`list-pending` global = 0 (todos os 4 programas). Os 3 achados em
`corroborated_static` deste programa continuam travados no mesmo ponto
já documentado (sem validador local para JS/TS); não repeti a tentativa.

Leitura profunda proativa: mais 3 arquivos novos de `vercel/eve` em
`packages/eve/src/channel/auth/` e `channel/`, únicos deste
subdiretório ainda não cobertos: `http-basic.ts` (Basic Auth — usuário
comparado com `!==` após normalizar NFC, mas senha comparada via
SHA-256 + `timingSafeEqual`, evitando side-channel de tempo/tamanho;
sem bypass), `schedule-auth.ts` (constante `SCHEDULE_APP_AUTH` +
predicado `isScheduleAppAuth` — confirmei via grep que o predicado não
é usado em lugar nenhum como gate de autorização, só a constante é
atribuída diretamente em `schedule.ts` como o auth context interno do
motor de agendamento; não é um bypass, é código morto/defensivo sem
efeito prático) e `vercel-oidc-project.ts` (binding de projeto Vercel
atual por request via `WeakMap<Request, resolver>` com símbolo global
— escopo correto por instância de `Request`, sem risco de vazamento
entre requisições concorrentes). Sem achado novo.

`deep-read-log.json` atualizado (+3 em `vercel/eve`, subdiretório
`channel/auth/` e `channel/` agora 100% cobertos). Nenhuma transição
de estado tentada neste programa nesta rodada.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud — mais uma do mesmo push trigger)

O mesmo push disparou várias sessões cloud concorrentes hoje; `git
push` rejeitado duas vezes por fast-forward (`fetch first`) antes deste
commit — sinal de que pelo menos 4-5 rodadas irmãs rodaram em paralelo.
`list-pending` global seguiu vazio em todas.

**Outcome real persistido**: o achado `ssrf_redirect_allowlist_bypass_risk`
(`image-optimizer.ts`) já tinha outcome real conhecido há várias
rodadas (Duplicate de #3943945, HackerOne #3988959, sem bounty — ver
rodada "21ª do dia" acima), mas `record-platform-outcome` falhava antes
com "finding não encontrado". Rodei de novo nesta sessão (pós-migração
v2) e o comando funcionou — mas ao inspecionar
`exportFindingsToQueueLines` (`system/bugbounty-scanner/db.mjs:365-385`)
confirmei que o outcome gravado **não sobrevive ao `export-queue`**: só
a tabela `findings` é lida pra montar `queue.jsonl`; as tabelas
`platform_outcomes`/`deployment_evidence`/`validations`/`reports` nunca
são consultadas, e só `recordTransition` (campo `state`) anexa evento
no ledger commitado. Ou seja, o outcome gravado por
`record-platform-outcome` só existe no `zerotoone.db` efêmero desta
sessão — some quando o container reciclar. Documentado em detalhe, com
correção recomendada, em `docs/zerotoone-v2/IMPLEMENTATION_STATE.md`
("Bug real encontrado — export-queue descarta
platform_outcomes/..."). Não tentei consertar a máquina de
estados/persistência nesta rodada autônoma (mudança estrutural, merece
revisão supervisionada). Mitigação real: o outcome fica registrado
aqui em prosa, que É commitada — nenhum dado se perde de fato, só o
registro estruturado no banco.

Leitura profunda proativa: mais 2 arquivos em `vercel/eve`
(`packages/eve/src/public/channels/telegram/authorization-callback.ts`
+ `authorization.ts`, fluxo de "Authorize" via botão inline do
Telegram em chat de grupo). Verificado com ceticismo se qualquer membro
do grupo que clicar no botão (visível pro grupo inteiro, não só pro
solicitante) poderia sequestrar a autorização de outro usuário —
refutado: `renderTelegramAuthorizationStatus` embute o
`requesterUserId` original no `callback_data` (`eve_auth:<id>`), e
`dispatchTelegramAuthorizationCallback` compara esse valor contra
`query.from.id` (ambos tipados `string` no parser de update do
Telegram, sem coerção que pudesse quebrar a comparação) antes de
prosseguir; qualquer clicador que não seja o solicitante recebe "Only
the requester can authorize this connection." e a função retorna sem
tocar a sessão. Design correto, sem achado.

`deep-read-log.json` atualizado (+2 em `vercel/eve`, total 32 arquivos
cobertos ali entre as sessões de hoje). Nenhuma transição de estado
nova tentada neste programa nesta rodada (os 3 achados JS/TS em
`corroborated_static` seguem no mesmo ponto já documentado — sem
validador local ainda).

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, 4ª rodada pós-migração v2)

`migrate-to-v2` rodado sem erro (138 findings, contagens batendo:
5 `corroborated_static`, 1 `human_ready`, resto `false_positive`/
`duplicate`/`inconclusive`). `list-pending` global = 0 em todos os 4
programas. Os achados em `corroborated_static` deste programa não
foram retocados nesta rodada — mesma limitação documentada (sem
validador local pra JS/TS/Kotlin/Swift), repetir a tentativa não muda
o resultado.

Leitura profunda proativa: como `vercel/eve` (`channel/auth/` e
`channel/`) já estava marcado como 100% coberto nas últimas rodadas,
mudei de alvo. Cheguei a considerar `circlefin/arc-remote-signer` e
`circlefin/buidl-wallet-contracts` (Circle BBP) mas confirmei antes de
ler que os arquivos não lidos ali são só telemetria/métricas/lifecycle
(arc-remote-signer, sem relação com auth/crypto) ou interfaces/structs/
scripts de deploy sem lógica própria (buidl-wallet-contracts) -- não
vale gastar o orçamento de leitura nisso, julgamento próprio.

Fui então pra `vercel/next.js` (`packages/next/src/server/`, clone
sparse `--filter=blob:none` pra não baixar o monorepo inteiro), 3
arquivos novos relacionados a cookies (nome bate com padrão
auth/session): `api-utils/get-cookie-parser.ts` (parsing delega 100%
pro pacote `cookie` compilado, `require('next/dist/compiled/cookie')`
-- sem lógica própria, sem risco de injection custom),
`server/request/cookies.ts` (a função pública `cookies()` -- toda a
complexidade aqui é sobre em qual fase de renderização/cache
(`prerender`, `action`, `request`, `private-cache` etc.) o objeto pode
ou não ser acessado/mutado, não sobre autenticação; `CachedCookies` é
um `WeakMap` chaveado por instância de `workUnitStore`/
`prerenderStore`, então não há risco óbvio de vazamento entre
requisições concorrentes) e
`server/web/spec-extension/adapters/request-cookies.ts`
(`RequestCookiesAdapter.seal`/`MutableRequestCookiesAdapter.wrap` --
usa `Proxy` pra bloquear `set`/`delete`/`clear` fora da fase `action`,
`areCookiesMutableInCurrentPhase` checa `requestStore.phase ===
'action'` de forma consistente antes de qualquer mutação; nenhuma
instância de cookie é compartilhada entre requests, cada uma nasce de
um `RequestStore` novo). `server/web/spec-extension/cookies.ts` só
reexporta do pacote vendored `@edge-runtime/cookies`, sem lógica
própria -- não conta como código de primeira parte pra achado. Sem
achado novo.

`deep-read-log.json` atualizado (+3 em `vercel/next.js`, agora 18
arquivos). Nenhuma transição de estado tentada neste programa nesta
rodada.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, mais uma rodada do mesmo push)

`list-pending` global = 0 (todos os 3 programas ativos; `Block Open
Source` continua fora de qualquer análise deste agente por
`aiResearchBanned: true` em `program-policy.json`, confirmado antes de
escolher alvo). Os achados em `corroborated_static` deste programa
continuam travados no mesmo ponto já documentado (sem validador local
pra JS/TS); não repeti a tentativa de transição.

Leitura profunda proativa em `vercel/eve`, subdiretório
`public/channels/` (webhooks inbound por canal). Uma sessão irmã
concorrente já tinha coberto `telegram/authorization-callback.ts` e
`authorization.ts` neste mesmo push — conferido `deep-read-log.json`
antes de escolher arquivo pra evitar duplicar trabalho. 3 arquivos
genuinamente novos lidos:

- `public/channels/discord/verify.ts` + `verifyInbound.ts` (24 linhas
  triviais, lido como contexto direto de chamada) — verificação de
  assinatura Ed25519 de chave pública sobre `X-Signature-Ed25519`/
  `X-Signature-Timestamp`: checa `publicKeyBytes.length !== 32` e
  `signatureBytes.length !== 64` antes de montar a SPKI DER (evita
  prefixo/DER malformado sendo aceito), janela de clock-skew
  (`maxSkewSeconds`, default 300s), tudo em `try/catch` retornando
  `false` em input malformado (fail-closed). Como é verificação de
  chave pública (não HMAC/segredo compartilhado), não há problema de
  comparação non-constant-time. Sem achado.
- `public/channels/telegram/verify.ts` — segredo do header
  `X-Telegram-Bot-Api-Secret-Token` comparado via
  `constantTimeCompare`: checagem de tamanho primeiro (leak aceitável
  de tamanho, padrão da indústria) seguida de `crypto.timingSafeEqual`
  dentro de `try/catch`. Sem segredo configurado → lança erro
  (fail-closed). Sem achado.

Também conferido rapidamente `packages/eve/src/tools/auth.ts` —
só declarações de tipo TypeScript, zero código de runtime, nada a
auditar.

Sem achado novo. `deep-read-log.json` atualizado (+4 em `vercel/eve`).
Sugestão pra próxima rodada: `public/channels/github/verify.ts`,
`public/channels/slack/verify.ts`, `public/channels/linear/verify.ts`,
`public/models/openai/chatgpt/token-broker.ts` e
`services/dev-client/credential-gate.ts` (mesmo subdiretório
`public/channels/`, ainda não cobertos). Nenhuma transição de estado
tentada neste programa nesta rodada.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, migração v2 pro CLI de máquina de estados)

`node system/bugbounty-scanner/migrate-to-v2.mjs` rodado (Passo 0). `cli.mjs
list-pending` global = 0 (todos os programas ativos). Antes de qualquer
leitura, `program-policy.json` conferido — `aiResearchBanned: true` ainda
vigente para "Block Open Source"; nenhum repo `cashapp/*`/`afterpay/*`/
`square/wire` tocado nesta rodada.

Leitura profunda proativa: as 3 sugestões pendentes da rodada anterior em
`vercel/eve`, subdiretório `public/channels/` (webhooks inbound por canal):

- `public/channels/github/verify.ts` — HMAC-SHA256 sobre
  `X-Hub-Signature-256` (`sha256=<hex>`), comparação via
  `constantTimeCompare` (checagem de tamanho antes de `timingSafeEqual`,
  mesmo padrão já visto nos outros canais — leak de tamanho aceitável,
  não de segredo). Header ausente → rejeita antes de comparar
  (fail-closed). Suporta `webhookVerifier` custom (ex.: Connect via OIDC)
  como alternativa ao HMAC — contrato documentado no próprio arquivo
  (throw/falsy → 401; string → substitui o body). Sem timestamp/replay
  window (GitHub não assina timestamp neste esquema), consistente com o
  design real do webhook do GitHub. Sem achado.
- `public/channels/slack/verify.ts` — delega a verificação de verdade pro
  pacote vendored `#compiled/@chat-adapter/slack/webhook.js` (fora do
  escopo deste arquivo/repo); este arquivo só normaliza erros e exige
  `signingSecret` OU `webhookVerifier` configurado, senão lança antes de
  chamar o SDK (fail-closed). Nada de HMAC/comparação acontece aqui
  diretamente — sem achado neste arquivo (lógica de crypto real está no
  SDK do Chat Adapter, pacote separado, não auditado nesta rodada).
- `public/channels/linear/verify.ts` — HMAC-SHA256 sobre
  `Linear-Signature`, mesma `constantTimeCompare` de sempre. Importante:
  a ordem é correta — assinatura verificada ANTES de checar o
  `webhookTimestamp` embutido no corpo (`verifyWebhookTimestamp` só roda
  depois do `constantTimeCompare` passar), então um atacante sem o
  segredo não consegue forjar corpo+timestamp pra passar a checagem de
  skew. Skew default 60s (replay dentro da janela é risco aceito,
  documentado, mesmo padrão dos outros canais). Sem achado.

Todos os 3 arquivos seguem o mesmo padrão robusto (fail-closed,
constant-time compare, verificação de assinatura antes de qualquer
outra checagem) já visto no resto de `packages/eve/src/public/channels/`
e `packages/eve/src/channel/auth/`. `deep-read-log.json` atualizado (+3
em `vercel/eve`, total 39 arquivos cobertos ali). Sugestão pra próxima
rodada: `public/models/openai/chatgpt/token-broker.ts` e
`services/dev-client/credential-gate.ts` (ainda não cobertos, citados há
2 rodadas). Nenhuma transição de estado tentada neste programa nesta
rodada — os 3 achados JS/TS em `corroborated_static` seguem no mesmo
ponto de sempre (sem validador local pra JS/TS, limitação conhecida do
sistema).

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud — leitura profunda em solana-cctp-contracts)

`list-pending` global = 0. Os 3 achados JS/TS em `corroborated_static`
deste programa seguem travados no mesmo ponto já documentado (sem
validador local); não repeti a tentativa. Leitura profunda proativa
desta rodada direcionada a `circlefin/solana-cctp-contracts` (Circle
BBP, achado novo criado e refutado — ver NOTES.md desse programa) — sem
arquivo novo lido de Vercel Open Source nesta rodada.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, mais uma rodada do mesmo push, deep-read chatgpt/dev-client)

`list-pending` global = 0. Leitura profunda proativa continuando as
sugestões pendentes: `public/models/openai/chatgpt/token-broker.ts` e
`services/dev-client/credential-gate.ts` (ambos citados há 2 rodadas),
mais `services/dev-client/request-headers.ts` (dependência direta do
credential-gate, mesma área).

- `token-broker.ts` — cache em memória do token ChatGPT/Codex local,
  delega toda a autenticação real pro `CodexAppServerClient` (processo
  local do Codex CLI). Decodifica claims do próprio JWT só pra extrair
  `accountId`/`accountLabel`/`expiresAt` (exibição/cache), nunca pra
  decisão de autorização — quem decide se o token é válido é o app
  server local. Janela de refresh de 5min antes de expirar. Sem
  bypass encontrado; superfície é local (localhost dev tool), não
  network-reachable por terceiros.
- `credential-gate.ts` — `authorize()` rejeita o grant se
  `grant.target.origin !== serverOrigin` (checagem de origem exata
  antes de instalar qualquer credencial), e `resolveBypassHeaders()`
  só emite `x-vercel-protection-bypass` quando `state.kind !==
  "anonymous"` (ou seja, só depois da origem verificada). Rollback
  (`authorize` retorna função que restaura estado anterior) usa
  comparação de identidade de objeto (`state === next`), então uma
  autorização mais nova nunca é desfeita por um rollback antigo em
  race. Sem achado.
- `request-headers.ts` — `decodeOidcPayload` faz parse do JWT sem
  verificar assinatura, mas isso é deliberado e documentado no
  comentário: "does not authorize a destination; callers must verify
  the exact origin first" -- decisão de autorização real acontece no
  backend Vercel quando o token é de fato usado como bearer; aqui é
  só sanity-check de claims (`owner_id`/`project_id`) casando com o
  alvo local antes de instalar via `credential-gate`. Nenhuma
  verificação de segurança real depende deste decode não-assinado.
  Sem achado.

Sem achado novo. `deep-read-log.json` atualizado (+3 em `vercel/eve`,
total 42 arquivos cobertos ali). Nenhuma transição de estado tentada
neste programa nesta rodada.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, migração v2 pro CLI, findings/state-machine.mjs)

`migrate-to-v2.mjs` rodado (Passo 0). `cli.mjs list-pending` global = 0
(todos os 4 programas ativos). `program-policy.json` conferido antes de
qualquer leitura — `aiResearchBanned: true` ainda vigente para "Block
Open Source"; nenhum repo `cashapp/*`/`afterpay/*`/`square/wire` clonado
ou lido nesta rodada. StackingDAO: os 15 contratos do escopo real
(`scope-snapshots/stackingdao.json`) já batem 1:1 com os 15 já cobertos
em `deep-read-log.json` — nada novo a ler lá nesta rodada.

Leitura profunda proativa continuando em `vercel/eve` (clone raso via
`add_repo`, hash `78fa9046`), 3 arquivos novos:

- `packages/eve/src/channel/session.ts` — handle de sessão exposto em
  `ctx.session`. `auth` é só leitura de `AuthKey`/`InitiatorAuthKey` do
  contexto (hidratado alhures); nada de decisão de autorização acontece
  aqui, é puro plumbing (`send`/`respond`/`cancel`/`compact`/`clear`/
  `reset` delegando pro `runtime.dispatchSession`). Sem achado.
- `packages/eve/src/public/channels/github/auth.ts` — mint de JWT RS256
  de GitHub App (`createSign("RSA-SHA256")`, `exp`/`iat` corretos com
  clock-skew de 60s) e troca por installation token via API oficial,
  cache em `Map` process-local chaveado por
  `apiBaseUrl:appId:installationId` com skew de refresh de 60s. Chave de
  cache inclui os 3 componentes certos (sem colisão entre instalações
  diferentes). Sem achado.
- `packages/eve/src/public/channels/slack/auth.ts` — `buildSlackAuthContext`
  monta o `principalId` do responder Slack (`slack:<teamId>:<userId>`
  normalmente); quando `teamId` é `null`/`undefined` cai pra
  `slack:<userId>` sem namespace de time — confirmado em
  `interactions.ts` que isso acontece de verdade (`team_id` não é
  garantido em todo `view_submission` payload, comentário no próprio
  código). Investigado até `slackChannel.ts` (`approvalResponderUsers`,
  `approval.candidate`) pra ver se esse `principalId` sem team-scoping
  vira gate de autorização real (ex.: só o autor original pode
  aprovar) — não vira: é usado só como metadado de exibição (mapeia
  responder → Slack user id pra UI mostrar "aprovado por @fulano"), e
  a decisão real de quem pode responder a um `tool-approval` é
  delegada ao hook `onInputResponse` do app autor (a lib não impõe
  restrição própria — modelo é "qualquer um no canal/thread pode
  clicar", esperado pra bots Slack). Sem gate de segurança dependendo
  deste campo → sem achado, mas caso de referência anotado (nome
  parecido com `js_injection_unescaped_token_risk` de outro programa:
  se um dia aparecer um app-level `onInputResponse` que compara
  `principalId` direto sem levar em conta a ausência de `teamId`, essa
  colisão vira relevante — vale relembrar se aparecer candidate futuro
  tocando esse arquivo).

Sem achado novo. `deep-read-log.json` atualizado (+3 em `vercel/eve`,
total 45 arquivos cobertos ali). Nenhuma transição de estado tentada
neste programa nesta rodada.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, mais uma rodada do mesmo push)

`list-pending` global = 0. Revisão dos 5 findings pré-existentes em
`corroborated_static` deste programa (`timing_attack_risk` em
`vercel/ai`, `path_traversal_arbitrary_file_read_risk` em
`vercel-labs/agent-skills`, `command_injection_risk` em
`vercel/vercel`, `ssrf_redirect_allowlist_bypass_risk` em
`vercel/next.js`) — todos já documentados em rodadas anteriores como
travados permanentemente em `corroborated_static` por falta de
validador local (JS/TS não tem PoC neste sistema) e/ou por exigirem
condição externa não confirmável por leitura de código. Nenhuma ação
nova necessária, nenhuma mudança de veredito.

Leitura profunda proativa desta rodada direcionada a
`circlefin/stablecoin-starknet` (Circle BBP, ver NOTES.md desse
programa) — sem arquivo novo candidato em `vercel/eve` ou outro repo
deste programa nesta rodada. Nenhum achado, nenhuma transição de
estado neste programa.

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, mais uma rodada do mesmo push)

`list-pending` global = 0. Leitura profunda proativa continuando em
`vercel/eve` (clone raso), 3 arquivos novos, todos pequenos e sem
achado:

- `packages/eve/src/public/channels/linear/auth.ts` — apenas resolução
  de credenciais (access token / webhook secret) a partir de
  `credentials.*` ou variáveis de ambiente (`LINEAR_AGENT_ACCESS_TOKEN`
  etc.), lançando erro se ausente. Nenhuma decisão de autorização, puro
  plumbing de configuração. Sem achado.
- `packages/eve/src/public/models/openai/chatgpt/auth.ts` — usa
  `decodeJwt` (sem verificar assinatura) para extrair `exp`,
  `chatgpt_account_id` e email/label de um token ChatGPT/Codex. Decode
  sem verify soaria a alarme se o token viesse de terceiro, então
  rastreado o único chamador: `token-broker.ts:140` (`tokenFrom`),
  chamado a partir de `resolveToken`/`accept`, cujo `rawToken` vem
  exclusivamente de `appServer.getAuthStatus()` — o próprio token OAuth
  que este processo obteve de si mesmo via `codex login` (fluxo local,
  não input de rede de terceiro). Os campos extraídos
  (`accountId`/`accountLabel`/`expiresAt`) são usados só como metadado
  de exibição/cache local (`readyState`, cache do broker), nunca como
  base de uma decisão de autorização sobre uma requisição de outra
  parte. Sem achado.
- `packages/eve/src/public/channels/chat-sdk/authorization.ts` — só
  posta/edita mensagens de status ("Authorization required for X" /
  "X connected") no thread do Chat SDK quando eventos
  `authorization.required`/`authorization.completed` disparam; nenhuma
  lógica de decisão de autorização aqui, é só UI de status. Sem achado.

Sem achado novo. `deep-read-log.json` atualizado (+3 em `vercel/eve`,
total 48 arquivos cobertos ali). Nenhuma transição de estado tentada
neste programa nesta rodada. Os 5 achados pré-existentes em
`corroborated_static` seguem intocados (mesma limitação de sempre —
JS/TS sem validador local de PoC neste sistema).


## Rodada 2026-09-02 (sessão cloud — leitura profunda em vercel/eve, parte da mesma rodada de arc-node/misk)

Continuando a cobertura de `packages/eve/src/public/channels/`: li
`teams/verify.ts` (verificação de JWT Bot Connector via `jose`
`jwtVerify` com issuer/audience/JWKS dinâmico — analisado com ceticismo
quanto a confusão de algoritmo RS256↔HS256 via `protectedHeader.alg`
atacante-controlado passado a `importJWK`; `jose` roteia a importação
pelo `kty` do JWK antes de olhar `alg`, então um JWK `kty:RSA` não pode
virar chave HMAC mesmo com `alg` forjado — sem bug encontrado, mesmo
padrão seguro já visto em slack/discord/github/linear/telegram),
`twilio/verify.ts` (delega a verificação real para
`@chat-adapter/twilio/webhook.js`, cujo código-fonte já foi lido sob
`vercel/chat` — wrapper fino, sem lógica nova), `chat-sdk/authorization.ts`
(só texto de UI para prompts de autorização, sem decisão de acesso),
`execution/reconcile-session-continuation-token.ts` (13 linhas,
re-stamping trivial de sessão) e
`public/models/openai/chatgpt/token-broker.ts` (cache/refresh de token
OAuth local do Codex CLI, sem validação de assinatura — superfície de
cliente local, não servidor). Nenhum achado novo; nenhuma transição
tentada. `deep-read-log.json` atualizado (+5 em `vercel/eve`, agora 44
arquivos).

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud) — 113 achados novos na fila, 33 não-dependência triados

Nova leva grande apareceu (scanner Semgrep/dep-scanner rodou em
`vercel/vercel`, `vercel-labs/skills` e outros repos do programa): 77
`known_vulnerable_dependency` (não revisados nesta rodada — ver nota
sobre OSV abaixo) + 36 achados semgrep. Clonado `vercel/vercel` raso
(sparse, ~250MB) e `vercel-labs/skills`; todos os 33 achados
não-`known_vulnerable_dependency` revisados com leitura de código real
(3 dos 36 eram entradas duplicadas de import-only, tratadas junto):

- **27 `semgrep_detect_child_process` em código próprio da Vercel**:
  quase todos usam a forma array de `spawn(cmd, args, opts)` sem
  `{shell:true}` — padrão seguro recomendado pela própria documentação
  do Node.js (sem interpretação de shell, sem expansão de
  metacaracteres). **Exceção real encontrada**: em
  `packages/cli/src/commands/mcp/mcp.ts`, o fluxo "Cursor" de
  `vercel mcp --project` monta uma URL de deep-link concatenando
  `serverName` (derivado de `project.name`, obtido da API da Vercel
  via projeto vinculado localmente) **sem nenhum encoding** dentro da
  query string, e passa o resultado para `execSync` com interpolação
  de template string (macOS/Linux com aspas simples que um `'` no nome
  quebraria; Windows **sem nenhuma aspa**). Não consegui confirmar se
  a validação de nome de projeto no backend da Vercel (fora deste
  repo) permite caracteres de shell — **3 achados (linhas 345/347/349)
  ficaram em `corroborated_static`** para revisão humana em vez de
  falso_positivo ou confirmado.
- **9 achados em código vendored** (`python/vercel-runtime/.../
  _vendor/{click,werkzeug,wsproto}/`, confirmado via `vendor.txt` +
  `LICENSE.txt` por lib): bibliotecas Python de terceiros extremamente
  populares, comportamento intencional das próprias libs.
  **falso_positivo**.
- **4 `semgrep_detect_child_process` em scripts CI/utilitários**
  (`test-cursor-detection.js`, `get-affected-packages.js`) — strings
  literais fixas ou `baseSha`/`GITHUB_BASE_REF` provenientes de
  contexto de Action computado pelo GitHub (não texto arbitrário de
  contribuidor externo). **falso_positivo**.
- **4 achados em `utils/update-remix-run-dev.js`**: cadeia real de dois
  problemas empilhados — (1) `.github/workflows/update-remix-run-dev.yml`
  interpola `${{ inputs.new-version }}` DIRETO no texto do script antes
  de virar JS (padrão clássico de "GitHub Actions script injection"); (2)
  mesmo corrigindo isso, o valor resultante é interpolado sem escaping em
  4 chamadas `execSync` de template string (git ls-remote/checkout -b/
  commit -m/push). Só que o trigger é `workflow_dispatch` (exige
  permissão de disparar Actions já próxima de maintainer, não PR
  externo) e o comentário no YAML diz que o secret do bot já foi
  deletado — impacto prático baixo hoje, mas padrão genuinamente
  perigoso. **4 achados em `corroborated_static`** para triagem humana
  de elegibilidade real no programa.

Total: 27 falso_positivo + 6 corroborated_static nesta leva.

### `known_vulnerable_dependency` — 77 achados NÃO revisados nesta rodada
Mesma limitação de rede já documentada no OKG/Kubernetes: `api.osv.dev`
continua bloqueada pela política desta sessão cloud (confirmado via
`curl` → 403 no CONNECT). Cada achado já carrega o texto da
vulnerabilidade (GHSA/severidade) salvo numa rodada anterior; falta
confirmar alcançabilidade real por leitura de código (import + call
site), 77 é volume grande demais para esta rodada — fica para as
próximas. Ficam em `candidate`.

`queue.jsonl` sincronizado via `export-queue` (reconciliado com uma
sessão cloud paralela que triou Circle BBP e um achado real de
Kubernetes/cluster-bootstrap no mesmo intervalo — sem sobreposição de
id com o trabalho deste programa, confirmado por diff campo a campo
antes do commit).

## Adendo à rodada acima (sessão cloud concorrente no mesmo push, reconciliada nesta mesma rodada)

Esta sessão rodou em paralelo e chegou aos mesmos 27 `semgrep_detect_child_process`
+ 9 achados vendorizados independentemente, com o mesmo veredito em quase
tudo (23 `spawn(array)` seguro, 9 vendor inalcançável/protocolar). Duas
diferenças relevantes, registradas aqui pra não se perder:

1. **Achado NOVO, não coberto pela rodada acima:**
   `packages/cli/src/commands/mcp/mcp.ts::line:189` (ramo "Claude Code" do
   comando `vercel mcp add`) — `safeExecSync(\`claude mcp add --transport
   http ${mcpName} ${mcpUrl}\`)`, **sem nenhum escaping/quoting** (nem
   aspas simples como no ramo Cursor da linha 345). Mesma cadeia de dado
   (`project.name`/`org.slug` do projeto vinculado localmente), mas mais
   grave: qualquer metacaractere de shell no nome quebra, não só aspas
   simples. Registrado como achado novo
   (`ai_deep_read_command_injection`) e avançado pra `corroborated_static`,
   mesma limitação de verificação (validação server-side da Vercel não
   auditável a partir deste repo).

2. **Erro desta sessão sobre `utils/update-remix-run-dev.js` (linhas
   32/64/66/67, achados `semgrep_detect_child_process`) — corrigido
   parcialmente, documentado por completo:**
   esta sessão inicialmente classificou esses 4 achados como
   `false_positive`, analisando só a segurança do `execSync` dentro do
   próprio arquivo JS (achou que `newVersion` só vinha de operador Vercel
   confiável ou de dist-tag do próprio pacote `@vercel/remix-run-dev`) —
   **sem checar o workflow YAML que invoca o script**. A sessão concorrente
   (seção acima) leu `.github/workflows/update-remix-run-dev.yml` e
   encontrou o problema real: `${{ inputs.new-version }}` é interpolado
   DIRETO no texto do script `actions/github-script` antes de virar JS —
   GitHub Actions script injection clássico (CWE-94), independente de
   qualquer escaping dentro do `.js`. Confirmado por leitura direta do
   `.yml` nesta reconciliação: **a sessão concorrente está certa, o
   veredito `false_positive` desta sessão pra esses 4 ids estava errado.**

   Como consequência, o ledger (`ledger/ledger.research.jsonl`) tem uma
   bifurcação real nesses 4 ids: `candidate->false_positive` (esta sessão,
   incorreto) e `candidate->corroborated_static` (sessão concorrente,
   correto). `state-machine.mjs::deriveStatesFromLedger` resolveu essa
   bifurcação automaticamente pro ramo terminal (`false_positive`) por ser
   o único terminal entre os dois — confirmado ao reexportar `queue.jsonl`
   depois do merge: os 4 ids ficaram `false_positive`. **Isso é
   tecnicamente incorreto, mas de baixo risco real** — checagem adicional
   nesta reconciliação (`cli.mjs get`) mostrou que a vulnerabilidade em si
   já está corretamente registrada, há mais tempo e com investigação bem
   mais completa, num achado SEPARADO e mais antigo:
   `Vercel Open Source::vercel/vercel/utils/update-remix-run-dev.js::
   module.exports::command_injection_risk` (`createdAt` 2026-09-01, tipo
   `command_injection_risk`, não veio do semgrep) — `corroborated_static`,
   confidence média, escopo já confirmado (`allowed=true,
   eligibleForBounty=true, maxSeverity=critical, tier 1`), com reasoning
   detalhado citando a mesma cadeia (workflow_dispatch → template YAML →
   execSync) e já documentando por que fica permanentemente presa em
   `corroborated_static` (sem validador local pra GitHub Actions/JS neste
   sistema) e por que a severidade prática é menor do que o
   `maxSeverity=critical` do scope snapshot sugere (exige colaborador com
   write access já autorizado no repo, não é vetor de terceiro anônimo).
   **Essa é a entrada que qualquer rodada futura ou revisão humana deve
   usar como registro canônico deste achado** — os 4 ids
   `semgrep_detect_child_process` são duplicatas do scanner automático da
   mesma linha de código, e o `false_positive` incorreto neles é uma
   inconsistência de rotulagem residual (não uma perda do achado real),
   registrada aqui pra não confundir uma leitura futura que olhe só pra
   esses 4 ids isoladamente sem cruzar com `module.exports::
   command_injection_risk`.

## Refinamento dos 3 achados restantes semgrep_detect_child_process (branch VS Code de mcp.ts) -- 02/09/2026 (sessão cloud separada)

Reconciliação: sessão concorrente anterior já tinha triado 27
`semgrep_detect_child_process` + 9 vendored + 4 CI + 4
`update-remix-run-dev.js` desta mesma leva, deixando 3 pendentes
(linhas 467/469/471 de `packages/cli/src/commands/mcp/mcp.ts`, branch
"VS Code with Copilot" -- par gêmeo estrutural do branch "Cursor" já
marcado `corroborated_static` nas linhas 345/347/349).

Ao investigar, a conclusão diverge da do branch Cursor: aqui o objeto
`config` inteiro (incluindo `serverName`, mesma origem -- nome de
projeto Vercel vinculado localmente) passa por
`encodeURIComponent(JSON.stringify(config))` antes de virar query
string, ao contrário do Cursor que concatena `serverName` cru sem
nenhum encoding. `encodeURIComponent` percent-encoda todo
metacaractere de shell relevante; a única exceção no conjunto
"não-escapado" do ECMA-262 é o apóstrofo (`'`). Escrevi uma PoC local
(sem rede, sem tocar sistema real -- `node -e` replicando a lógica
exata de `mcp.ts` + `bash` de verdade) com um `serverName` malicioso
contendo `'; touch ...; echo '`: confirmei que o apóstrofo de fato
quebra o quoting do shell, mas como tudo depois dele já foi
percent-encoded, o texto fora das aspas é inerte (`%3B%20touch%20...`
literal) -- o `touch` **não executa** (arquivo-alvo não foi criado).
**Falso positivo para command injection**, mas com nota de robustez
sobre o apóstrofo não-escapado.

Fila Vercel Open Source: 0 `candidate` fora dos 77
`known_vulnerable_dependency` (ainda bloqueados por `api.osv.dev`
inacessível nesta sessão -- confirmado 403 de novo, mesma política
de egress).
