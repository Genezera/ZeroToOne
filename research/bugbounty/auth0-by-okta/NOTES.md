---
programa: Auth0 by Okta (Bugcrowd), JVM — auth0/auth0-java
status: primeiro toque deste pipeline; alvo auto-descoberto (visto em STATUS.md), sem achado ainda
data: 2026-09-04
---

# Auth0 by Okta (auth0/auth0-java) — notas de pesquisa

## Contexto
Programa fora dos 4 alvos originais desta pesquisa (StackingDAO,
Vercel Open Source, Block Open Source, Circle BBP), já visto como
alvo ativo em `STATUS.md` (jvm, `auth0/auth0-java`) mas ainda sem
arquivo próprio de notas nem entrada em `deep-read-log.json` até esta
rodada. `check-scope "Auth0 by Okta" "auth0/auth0-java"` confirma
`allowed:true`, mas `eligibleForBounty: null` — a fonte de scope não
informa elegibilidade de recompensa, precisa confirmação manual antes
de qualquer `human_ready`.

## Rodada 2026-09-04 — leitura profunda proativa (1 arquivo)
`list-pending` vazio (0 `candidate` em todo o sistema). Leitura
profunda proativa priorizando caminho com `auth`/`sign` no nome:
- `src/main/java/com/auth0/client/auth/RSAClientAssertionSigner.java`
  — assina JWT de client assertion (RFC 7523) com chave RSA privada
  do cliente. `Algorithm.RSA256(null, assertionSigningKey)` passa
  `null` no parâmetro de chave pública de propósito — é a API do
  `com.auth0:java-jwt` pra "só assinar, não verificar", correto pra
  este uso (o assertion é assinado aqui, verificado do lado do
  Auth0). `jti` usa `UUID.randomUUID()` (proteção contra replay),
  expiração fixa de 180s. Nenhum algoritmo fraco, nenhuma confusão de
  algoritmo (`alg` não vem de input externo — é fixado por enum
  `RSASigningAlgorithm` escolhido no código do consumidor da SDK).
  Sem achado.

Nenhum achado novo criado nesta rodada. `deep-read-log.json`
atualizado com o arquivo acima. Ainda restam bastante superfície não
lida (`AuthAPI.java`, `AuthorizeUrlBuilder.java`,
`LogoutUrlBuilder.java`, `ClientAssertionSigner.java` base) pra
próximas rodadas.

## Rodada 2026-09-04 (push automático via GitHub webhook, sessão
cloud seguinte) — leitura profunda proativa (3 arquivos)
`program-policy.json` checado como passo zero (`Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado).
`list-pending` global = 0. Continuando a superfície apontada na
rodada anterior, priorizando `auth`/`sign` no caminho:
- `src/main/java/com/auth0/client/auth/ClientAssertionSigner.java`
  — só a interface base (`createSignedClientAssertion(issuer,
  audience, subject)`), sem lógica própria; `RSAClientAssertionSigner`
  (já revisado) é a única implementação vista até agora. Sem achado.
- `src/main/java/com/auth0/client/auth/LogoutUrlBuilder.java` —
  builder de URL de logout (`/v2/logout`). `returnTo` entra via
  `addEncodedQueryParameter` (não re-encoda — assume que o chamador já
  passou uma URL válida/codificada), `client_id` via
  `addQueryParameter` normal. Superfície de open-redirect existe em
  teoria (`returnTo` arbitrário), mas a proteção real é do lado do
  tenant Auth0 (Allowed Logout URLs), documentada explicitamente no
  Javadoc da própria classe — não é bug do SDK cliente, é o padrão
  esperado de builder que só monta a URL que o desenvolvedor consumidor
  decide pra onde apontar. Sem achado.
- `src/main/java/com/auth0/client/auth/AuthorizeUrlBuilder.java` —
  builder de URL `/authorize` (Authorization Code Flow, com suporte a
  PKCE via `withCodeChallenge`/`code_challenge_method=S256` fixo).
  Mesmo padrão: `redirect_uri` via `addEncodedQueryParameter`,
  protegido no tenant (Allowed Callback URLs), não no SDK. Nenhum
  parâmetro é gerado ou validado de forma insegura aqui — é só
  concatenação de query string. Sem achado.

Nenhum achado novo criado nesta rodada. `deep-read-log.json`
atualizado (+3 arquivos, agora 4 no total). Ainda não lido:
`AuthAPI.java` (1647 linhas — maior arquivo do pacote `auth`, fica pra
próxima rodada dedicada).

## Rodada 2026-09-04 #5 (push automático via GitHub webhook)

`program-policy.json` checado como passo zero: `Block Open
Source`/`Circle BBP` confirmados bloqueados, nenhum repo desses
tocado. `migrate-to-v2.mjs` + `list-pending` global = 0 (fila vazia).
Leitura profunda proativa desta rodada: clone raso de `auth0/auth0-java`
(mesma cópia local da rodada anterior), fechando a superfície pendente
apontada na rodada #1 (`AuthAPI.java`, 1648 linhas) mais dois arquivos
correlacionados de credencial:

- `src/main/java/com/auth0/client/auth/AuthAPI.java` — classe
  principal do cliente de Authentication API. Rastreei toda superfície
  relevante: todos os métodos de troca de token (`login`,
  `requestToken`, `exchangeCode`/`exchangeCodeWithVerifier`,
  `exchangeToken`, `getTokenForConnection` e variantes, `renewAuth`,
  `revokeToken`, fluxos MFA) delegam autenticação do cliente pro
  método privado único `addClientAuthentication` — que corretamente
  lança `IllegalStateException` quando `required=true` e nem
  `clientSecret` nem `clientAssertionSigner` estão configurados, e
  prefere assertion assinada sobre secret quando ambos presentes.
  Nenhum caminho encontrado onde client_secret vaza pra URL (todos os
  parâmetros sensíveis — senha, otp, secret — vão no corpo da
  requisição POST via `addParameter`, nunca em query string; os
  poucos métodos que usam query string —
  `authorizeUrlWithPAR`/`authorizeUrlWithJAR`/`authorizeUrl`/
  `logoutUrl` — só carregam `client_id`/`request_uri`/`redirect_uri`,
  não segredo). Senha e OTP são recebidos como `char[]` (não
  `String`), consistente com boa prática de não deixar cópia
  imutável do segredo na heap por mais tempo que o necessário.
  `getTokenForConnection` (Token Vault, feature nova) exige
  `addClientAuthentication(request, true)` — corretamente não permite
  cliente público. Sem achado.
- `src/main/java/com/auth0/net/TokenRequest.java` — só 3 setters
  triviais (`realm`/`audience`/`scope`) que delegam pra
  `BaseRequest.addParameter`, sem lógica própria. Sem achado.
- `src/main/java/com/auth0/json/auth/TokenHolder.java` — DTO de
  resposta do token endpoint (`accessToken`/`idToken`/`refreshToken`/
  etc.), sem `toString()` customizado (usa o padrão
  `Object.toString()`, não serializa os campos) — não há risco de
  vazamento de token via log acidental de `TokenHolder.toString()`
  como acontece em outras libs. Sem achado.

De caminho, confirmei em `BaseRequest.addParameter`/`createRequestBody`
que todo parâmetro (incluindo os sensíveis) vai serializado como corpo
JSON via Jackson (`Content-Type: application/json`), nunca em query
string nem em log — `createRequest()` só adiciona header
`Authorization: Bearer` quando presente, nunca loga o valor.

Nenhum achado novo criado nesta rodada. `deep-read-log.json`
atualizado (+3 arquivos, agora 7 no total). Superfície de
`auth0-java` core (`auth/`) agora coberta por completo; próximas
rodadas podem migrar pra `client/mgmt/` (Management API) ou outros
alvos JVM do programa.

## Rodada 2026-09-04 #6 (push automático) — ACHADO DE PROCESSO: lacuna de revisão de RoE nunca fechada pra este programa

Fila (`list-pending`) global vazia. Leitura profunda proativa migrou
pra `client/mgmt/core/` conforme sugerido na rodada anterior: 2
arquivos lidos (`LoggingInterceptor.java` — interceptor OkHttp que
loga request/response em debug com redação de headers sensíveis por
nome, sem vazamento de token pra log; `OAuthTokenSupplier.java` —
client_credentials flow com cache de token via double-checked locking
correto, mensagem de erro sem vazar response body). Ambos sem achado
de segurança de código.

Durante essa leitura, notei que este programa (Bugcrowd,
`https://bugcrowd.com/engagements/auth0-okta`) já acumulou dezenas de
rodadas de pesquisa neste pipeline (ver histórico completo acima)
SEM NUNCA ter passado pela revisão de RoE quanto a proibição de
ferramentas de IA — a mesma lacuna que já tinha sido identificada e
fechada pra Slack/Mattermost/Plaid (ver `program-policy.json`), mas
nunca aberta pra este programa. Agravante: este é Bugcrowd, a mesma
plataforma do `Block Open Source`, que TEM proibição explícita de IA
na RoE ("Do not use ChatGPT, Claude, DeepSeek, Google Gemini or any AI
tools during your research"). Tentei verificar a RoE real agora
(`WebFetch` pra `bugcrowd.com/engagements/auth0-okta` e, como
fallback, `web.archive.org`) — ambos bloqueados pelo proxy de egress
deste ambiente cloud (`EGRESS_BLOCKED`), não deu pra confirmar nem
descartar. Registrei `roeReviewNeeded:true` em `program-policy.json`
(campo informativo, não bloqueia nada sozinho, mesmo mecanismo usado
pros 3 programas já resolvidos) e notifiquei o usuário. Ação
necessária: usuário (ou sessão com acesso real de navegador) precisa
ler a página completa do engagement e, se proibir IA, promover pra
`aiResearchBanned:true`/`blocked:true` — até lá, tratar leitura
adicional deste repositório com cautela extra. Nenhum relatório foi
escrito nem enviado; nenhuma transição de estado deste tipo de achado
faz sentido (é achado de processo, não de código), por isso não virou
`ai_deep_read_finding` na fila.

`deep-read-log.json` atualizado (+2 arquivos em
`client/mgmt/core/`, agora 9 no total).
