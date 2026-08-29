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
