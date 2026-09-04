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
