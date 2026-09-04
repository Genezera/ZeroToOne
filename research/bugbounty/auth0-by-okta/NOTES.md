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
