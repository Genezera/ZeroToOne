---
programa: Block Open Source (Bugcrowd), Kotlin/Java + Go + Swift/ObjC
status: pipeline automatizado criado e testado; primeira rodada real: 0 achados
data: 2026-08-26
---

# Block Open Source — cobertura automatizada

## Por que "Square Open Source" não aparecia
Square virou **Block, Inc.** em dezembro de 2021 — o nome antigo não existe
mais como programa de bug bounty. Buscar por "square"/"cashapp"/"afterpay"
na HackerOne não achava nada porque **o programa não está na HackerOne,
está na Bugcrowd**: `Block Open Source`
(https://bugcrowd.com/engagements/blockopensource), teto de **US$5.000**
por achado — bem abaixo do Immunefi (US$100.000, StackingDAO) e do Vercel
na HackerOne (severidade "critical" sem teto publicado). Descoberto via o
mesmo dataset público `arkadiyt/bounty-targets-data` usado para achar o
escopo do Vercel, mas no arquivo `bugcrowd_data.json` em vez de
`hackerone_data.json`.

## Escopo real (7 repositórios, confirmado via API pública do GitHub)
| Repo | Linguagem | Módulo do bounty |
|---|---|---|
| `afterpay/sdk-ios` | Swift | SDK iOS do Afterpay |
| `afterpay/sdk-android` | Kotlin | SDK Android do Afterpay |
| `cashapp/cash-app-pay-ios-sdk` | Swift | SDK iOS do Cash App Pay |
| `cashapp/cash-app-pay-android-sdk` | Kotlin | SDK Android do Cash App Pay |
| `cashapp/hermit` | Go | Gerenciador de ambiente de dev/CI |
| `cashapp/misk` | Kotlin | Framework de microsserviços interno |
| `square/wire` | Kotlin/Java/Swift | Codegen + runtime de Protocol Buffers |

Nenhum é JavaScript/TypeScript — por isso precisou de heurísticas novas em
3 linguagens, não reaproveitar o scanner do Vercel.

## Escopo do scanner por repo
`misk` (2537 arquivos no repo inteiro) e `wire` (1592) são monorepos
grandes demais para varrer por completo — restringi aos módulos centrais/
mais relevantes para segurança:
- `misk`: `misk/` (core), `misk-core/`, `misk-crypto/` (literalmente
  "crypto" no nome — prioridade óbvia), `misk-inject/` (injeção de
  dependência), `misk-hibernate/` e `misk-jdbc/` (acesso a banco, onde
  SQL injection viveria). ~723 arquivos Kotlin/Java depois do filtro (soma
  com os outros 3 alvos JVM).
- `wire`: `wire-runtime/` (onde mensagens protobuf não confiáveis são
  desserializadas — a superfície mais sensível), `wire-schema/`,
  `wire-compiler/`.
- `afterpay/sdk-android`: só `afterpay/` (exclui `sample/`, o app de
  demonstração).
- `cashapp/cash-app-pay-android-sdk`, `hermit`, `afterpay/sdk-ios`,
  `cash-app-pay-ios-sdk`: pequenos o bastante (160-439 arquivos brutos) pra
  varrer quase por completo, só excluindo testes/exemplos/demos.

## Heurísticas novas (uma por linguagem + uma compartilhada)
Mesmo espírito das heurísticas JS (v1 pequeno e deliberado, baseado em
classes de bug REAIS e conhecidas, não inventadas):

**Go** (`heuristics-go.mjs`, baseado nas checagens do `gosec`):
- `command_injection_risk` — `exec.Command("sh","-c", ...)` com comando
  montado por `Sprintf`/concatenação.
- `insecure_tls` — `InsecureSkipVerify: true`.
- `weak_random_for_secret` — `math/rand` usado perto de uma variável
  chamada token/secret/password/nonce (deveria ser `crypto/rand`).

**Kotlin/Java** (`heuristics-jvm.mjs`, classes de bug Android já pagas em
programas reais):
- `tls_validation_bypass` — `TrustManager`/`HostnameVerifier` que aceita
  qualquer certificado (achado clássico de bug bounty mobile).
- `webview_js_bridge_exposure` — `addJavascriptInterface` com JavaScript
  habilitado no WebView (classe de CVE Android bem documentada).
- `command_injection_risk` — `Runtime.exec`/`ProcessBuilder` com comando
  concatenado.

**Swift/ObjC** (`heuristics-swift.mjs`):
- `tls_validation_bypass` — `didReceiveChallenge` que aceita qualquer
  certificado incondicionalmente via `URLCredential(trust:)`.
- `webview_js_bridge_exposure` — `WKUserContentController.add` (ponte
  JS->nativo) no mesmo arquivo que carrega URL/HTML a partir de uma
  variável (não um recurso local fixo).

**Compartilhada entre as 4 linguagens** (`heuristics-shared.mjs`):
- `hardcoded_secret` — valor literal atribuído a um campo chamado
  api_key/secret/password/token/etc., filtrando placeholders óbvios
  (`changeme`, `your_api_key_here`, `xxxxxxxx`, etc.).

15 testes automatizados novos (Go: 7, JVM: 7, Swift: 5, compartilhada: 3 —
alguns heurísticos aparecem em mais de um arquivo de teste porque
`scanXxxSource` combina todas).

## Primeira rodada real (2026-08-26)
1.049 arquivos buscados via API pública do GitHub (sem conta/token) em
JS/TS+Go+Kotlin/Java+Swift, 0 erros de busca, **0 candidatos**. Divisão
por linguagem: JS/TS 121 (Vercel), Go 107 (hermit), JVM 723 (misk+wire+
2 SDKs Android), Swift 98 (2 SDKs iOS). Resultado honesto — esperado numa
primeira passada conservadora contra SDKs corporativos maduros e já
razoavelmente revisados. Cache de SHA de blob por arquivo
(`scanner-seen-repo-shas.json`, compartilhado entre todas as linguagens
agora) salvo — rodadas futuras só rebuscam arquivos que mudaram.

## Conta na Bugcrowd
Usuário já tem conta na Bugcrowd (diferente da HackerOne, onde a
verificação de identidade via Veriff ainda está em andamento). Ainda não
verificado se a Bugcrowd exige verificação de identidade separada antes de
enviar relatório pagável — só relevante se/quando o scanner achar algo
elegível de verdade.

## O que falta
- Se quiser ampliar depois: `wire-kotlin-generator`/`wire-java-generator`/
  `wire-swift-generator` (codegen, não runtime) ficaram de fora do escopo
  do `wire` por serem menos sensíveis (rodam em build-time, não em
  produção com input de rede não confiável) — podem entrar numa v2 se
  valer a pena.

## Rodada 2026-08-28 — 6 candidatos de `dep-scanner.mjs` (novo, cross-ref OSV.dev)
Primeiros achados reais do programa — todos **falso_positivo**, em duas
famílias de causa raiz.

**1) `cashapp/hermit/go.mod`: circl@v1.3.8 (GHSA-2x5j-vhc8-9cwm) e
x/crypto@v0.54.0 (GO-2026-5932).** O `dep-scanner.mjs` só faz cross-
referência de versão exata contra o OSV.dev — não verifica se o código
vulnerável é de fato alcançável a partir do que o alvo realmente chama.
Para checar isso cloneiei `cashapp/hermit` e `sassoftware/go-rpmutils`
(`git clone` público, sem conta/token) e segui a cadeia de import
manualmente: as duas dependências entram como indiretas via
`github.com/ProtonMail/go-crypto`, exigido só por `go-rpmutils`
(`go.mod:7`) e usado apenas nos arquivos `verify*.go`/`signatures.go`
desse pacote (verificação de assinatura PGP de RPM, função exportada
`rpmutils.Verify`). O hermit (`archive/archive.go:615`) só chama
`rpmutils.ReadRpm` + `PayloadReader` para extrair conteúdo do RPM — nunca
`rpmutils.Verify` — e `ReadRpm` vive em `rpmutils.go`, que não importa
nada de cripto. Confirmado por grep completo no repo do hermit: nenhuma
chamada a `rpmutils.Verify` em lugar nenhum. Ou seja: o código vulnerável
é compilado no binário (Go compila por pacote), mas não é exercido por
nenhum fluxo do hermit — sem input de atacante alcançando a função
vulnerável, não há exploração via uso normal da ferramenta.

**2) `square/wire`: kotlin-gradle-plugin em 4 versões antigas
(GHSA-r937-wjx7-w2jp / CVE-2026-53914), todas em
`wire-gradle-plugin/src/test/projects/*/build.gradle`.** São fixtures de
teste de integração do próprio wire-gradle-plugin (para validar
compatibilidade contra várias versões antigas do plugin Kotlin de
propósito) — nunca dependência runtime do que o Wire publica. Confirmei
o advisory (GitHub Advisory GHSA-r937-wjx7-w2jp): vetor CVSS
`AV:L/AC:H/PR:H` — exige acesso local, alta complexidade E privilégio
alto já concedido na máquina que roda o build. Nem no cenário mais
favorável há vetor remoto/de rede via este código, e ainda por cima é
código de teste nunca exposto a terceiros.

**Padrão a reter para próximos achados `known_vulnerable_dependency`**:
versão no manifesto batendo com CVE do OSV.dev não basta — sempre
verificar (a) se o import que carrega a dependência vulnerável é
efetivamente usado pelo código do alvo (clonar os repos envolvidos
quando necessário) e (b) se o arquivo do manifesto é código de teste/
fixture vs. dependência runtime real, e (c) os pré-requisitos de
exploração do próprio advisory (vetor CVSS) — não confiar só na
severidade "vulnerabilidade conhecida" sem checar alcançabilidade.

Observação lateral (não virou candidato, registrar para não esquecer):
o hermit extrai pacotes RPM (`extractRpmPackage`) sem chamar nenhuma
verificação de assinatura do go-rpmutils — não investiguei se há
checksum/assinatura verificada em outra camada (ex. no manifesto de
download). Não afirmo que seja uma falha; só é um ponto a olhar com mais
tempo antes de virar candidato de verdade.

Fila: 0 pendentes após esta rodada.

## Leitura profunda proativa (2026-08-29) — primeira rodada tocando Block, 0 achados
Fila estava com 0 pendentes (o push que disparou esta rodada era o próprio
commit de revisão anterior, do Vercel). `deep-read-log.json` só tinha
entradas de `vercel/flags` — nenhum repo do Block Open Source havia sido
lido na leitura profunda ainda. Cloneados via `git clone --depth 1`
(público, sem conta/token): `cashapp/misk`, `cashapp/cash-app-pay-android-sdk`,
`afterpay/sdk-android`, `cashapp/cash-app-pay-ios-sdk`, `afterpay/sdk-ios`
(só para listar arquivos por nome/keyword, não persistidos no repo).
3 arquivos lidos, priorizando auth/crypto em `cashapp/misk` (maior
superfície de segurança dos alvos JVM):
- `misk/src/main/kotlin/misk/security/authz/AccessInterceptor.kt` — lógica
  central de autorização do framework (`isAuthorized`). Revisada com
  ceticismo: nega por padrão quando não há requisito de serviço/capability
  configurado, `allowAnyService` respeita a lista de exclusão
  (`excludeFromAllowAnyService`), a factory recusa criar o interceptor sem
  anotação de acesso registrada (falha explícita, não fail-open). O flag
  `caller.allowAll` que dá bypass total é setado por quem implementa
  `MiskCallerAuthenticator` na aplicação consumidora, não pelo próprio
  misk — fora do escopo do que este repo controla. Sem falha de lógica
  encontrada.
- `misk/src/main/kotlin/misk/security/authz/MiskCallerAuthenticator.kt` —
  só uma interface (`getAuthenticatedCaller(): MiskCaller?`), sem lógica
  para auditar.
- `misk-crypto/src/main/kotlin/misk/crypto/CiphertextFormat.kt` — formato
  de serialização de ciphertext+AAD do misk-crypto (Tink). `serialize`/
  `deserialize` estão `@Deprecated` (movidos para
  `squareup/cash-ciphertext-format`, fora do escopo deste repo).
  `deserialize` valida que o AAD serializado bate com o `context` esperado
  antes de aceitar — é checagem de consistência adicional, não substitui a
  autenticação real (Tink AEAD já autentica ciphertext+AAD juntos). Sem
  falha encontrada.

Nenhum achado novo adicionado à fila. Próxima rodada: continuar em
`cashapp/misk` (`misk-hibernate/`, `misk-jdbc/` para SQL injection via
Hibernate/JDBC) ou passar para os SDKs mobile (Afterpay/Cash App Pay —
ainda não tocados pela leitura profunda).

## Rodada 2026-08-29 — fila vazia, leitura profunda em cashapp/cash-app-pay-android-sdk

Fila (`queue.jsonl`) sem itens `pending` no início desta rodada — nenhuma
revisão de veredito necessária.

Leitura profunda: clonei via `git clone` (raso, sem conta) os 6 repos do
Block Open Source ainda não cobertos por leitura profunda
(`square/wire`, `afterpay/sdk-android`, `cashapp/cash-app-pay-android-sdk`,
`afterpay/sdk-ios`, `cashapp/cash-app-pay-ios-sdk`, `cashapp/hermit`) para
localizar arquivos com auth/session/crypto/token/login/password/admin/
permission/access no nome. Achados por nome de arquivo foram escassos
(`wire` e `hermit` não têm nenhum arquivo com essas palavras-chave) — optei
por julgamento de especialista sobre o fluxo mais sensível encontrado:
`cash-app-pay-android-sdk` tem um fluxo de autorização real (grant/OAuth-like
via redirect mobile) mesmo sem "auth" no nome do arquivo principal.

3+1 arquivos lidos por completo em `cash-app-pay-android-sdk`:
- `core/.../impl/CashAppPayImpl.kt` (606 linhas, orquestrador central do
  SDK) — `authorizeCustomerRequest` abre uma `Intent` com a URL de
  `customerData.authFlowTriggers.mobileUrl`. Essa URL vem inteiramente da
  resposta do backend da Cash App (via `networkManager`), nunca de input
  do app consumidor ou de deep link externo — não há superfície de
  open-redirect/deep-link-hijack controlável pelo lado cliente aqui.
  Gerenciamento de estado (`Authorizing`/`Refreshing`/polling) e
  verificação de expiração de token (`isAuthTokenExpired`) parecem
  consistentes, sem race óbvia (single-thread manager serializa as
  operações por `ThreadPurpose`).
- `core/.../network/adapters/PiiStringClearTextAdapter.kt` +
  `core/.../network/MoshiProvider.kt` — investiguei se o adapter "ClearText"
  (que deliberadamente NÃO redige PII) poderia vazar para logging/analytics
  por engano. Confirmado que não: `NetworkManagerImpl` usa
  `provideDefault()` (clear text, default `redactPii=false`) só para as
  chamadas reais à API — necessário, já que o PII precisa chegar ao
  backend sem redação — enquanto `PayKitAnalyticsEventDispatcherImpl` passa
  explicitamente `redactPii = true`. Separação correta, sem vazamento.
- `core/.../models/response/Grant.kt` — só um data class de modelo
  (id/status/type/action/expires_at), sem lógica para auditar.

Nenhum achado novo. `deep-read-log.json` atualizado. Próxima rodada:
`square/wire` (wire-runtime — desserialização de protobuf não confiável é
a superfície mais promissora ainda não lida) ou os SDKs iOS (Afterpay/Cash
App Pay).
