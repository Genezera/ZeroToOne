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

---

## Rodada (2026-08-29, disparada por push no repo)

Fila sem itens `pending` no início desta rodada — nenhuma revisão de
veredito necessária.

Leitura profunda: `mcp__github__search_code` não retornou nada para os
repos externos (o servidor GitHub MCP desta sessão está escopado só a
`Genezera/ZeroToOne` — buscas com `repo:` para outro dono/repo voltam
vazias, não é ausência real de arquivos). Troquei para clone raso local
(`git clone --depth 1`, sem conta) de `cashapp/hermit` e
`cashapp/cash-app-pay-ios-sdk`, os dois alvos do programa ainda com menos
cobertura de leitura profunda. `afterpay/sdk-ios` também foi clonado mas
não tinha candidato melhor que os mocks de teste (`URLSessionMock.swift`),
então não entrou nesta rodada.

4 arquivos lidos por completo (3 em `hermit` + 1 em `cash-app-pay-ios-sdk`,
`hermit` e `wire` não têm nenhum arquivo com auth/session/crypto/token/
login/password/admin/permission/access no nome, então a triagem foi por
julgamento de especialista sobre o fluxo mais sensível de cada repo):

- `hermit/redact/redact.go` — tipos `Secret`/`URL`/`Plain` para valores
  sensíveis (tokens, credenciais em URL) que exibem `[redacted]` por
  padrão e só revelam o valor real via `.Reveal()` explícito. Design
  correto: o `String()`/`GoString()` (usado por logging/`%v`/`%s`
  implícito) nunca vaza o segredo por acidente; só quem chama `.Reveal()`
  de propósito vê o valor cru.
- `hermit/github/api.go` + `hermit/github/http.go` — cliente HTTP da
  GitHub API do Hermit. `TokenAuthenticatedTransport.RoundTrip` só injeta
  o header `Authorization: token ...` quando `req.URL.Host` é
  exatamente `github.com` ou `api.github.com` (http.go:28). Isso importa
  porque `Client.Download`/`Client.ETag` seguem redirects do
  `http.Client` para baixar assets de release — e assets de release do
  GitHub tipicamente redirecionam para um host de terceiros
  (`objects.githubusercontent.com`, URL pré-assinada, sem necessidade de
  token). Como o `net/http` chama `RoundTrip` de novo pra cada request da
  cadeia de redirect com a URL nova, o check de host evita que o token do
  usuário vaze pro host de terceiro no redirect — é exatamente o tipo de
  bug (token leak via redirect) que uma ferramenta CLI descuidada
  cometeria, e aqui está tratado corretamente. Não é uma vulnerabilidade,
  é o oposto — mas valia a pena verificar porque o padrão "client GitHub +
  segue redirect de asset" é uma classe de bug real em ferramentas
  parecidas.
- `cash-app-pay-ios-sdk/Sources/PayKit/CashAppPay.swift` — fachada pública
  do SDK iOS (equivalente ao `CashAppPayImpl.kt` do Android já lido).
  É um coordenador fino que delega pra `StateMachine`/`NetworkManager`;
  `authorizeCustomerRequest` decide entre `.redirecting` (reusar auth flow
  existente) e `.refreshing` (buscar novo) checando
  `authFlowTriggers?.isExpired()` — mesma lógica client-side de UX que já
  foi validada no lado Android, a decisão de autorização real acontece no
  backend, não aqui. Sem lógica de segurança nova pra auditar neste
  arquivo; os arquivos que fariam a comparação completa com o Android
  (`NetworkManager.swift`, `StateMachine.swift`) ficam para a próxima
  rodada.

Nenhum achado novo. `deep-read-log.json` atualizado (chaves novas:
`cashapp/hermit`, `cashapp/cash-app-pay-ios-sdk`). Próxima rodada:
`NetworkManager.swift`/`StateMachine.swift` do `cash-app-pay-ios-sdk`
(comparar com o fluxo Android já auditado) ou `square/wire`
(desserialização de protobuf, ainda não coberta).

## Rodada 2026-08-29 (2) — fila vazia, leitura profunda em square/wire (wire-runtime)

Fila (`queue.jsonl`) sem itens `pending` no início desta rodada.

Leitura profunda: clonei `square/wire` via `git clone --depth 1` (público,
sem conta/token). Nenhum arquivo em `wire-runtime/src/commonMain` tem
auth/session/crypto/token/login/password/admin/permission/access no nome
(é uma lib de serialização protobuf, não tem essas categorias por
natureza) — segui o julgamento de especialista sugerido na rodada
anterior: a superfície mais sensível de uma lib de serialização é o
próprio parser de bytes não confiáveis (entrada de rede/arquivo), então
priorizei o núcleo do decoder e o caminho de resolução dinâmica de tipo
(`Any`), que em outras linguagens/libs (Java, .NET) é a classe de bug que
vira RCE via desserialização insegura.

3 arquivos lidos por completo:
- `wire-runtime/.../ProtoReader.kt` — parser central de bytes varint/
  length-delimited/fixed32/fixed64 de um `BufferedSource` não confiável.
  Verifiquei especificamente proteção contra recursão maliciosa (mensagens
  aninhadas ou grupos aninhados profundamente, um vetor clássico de DoS em
  parsers de protobuf): `beginMessage()` e `skipGroup()` incrementam
  `recursionDepth` e checam contra `RECURSION_LIMIT = 100` em ambos os
  caminhos, lançando `IOException` antes de estourar a pilha — não há
  caminho de recursão que escape dessa checagem (grupos aninhados chamam
  `skipGroup` recursivamente com o mesmo guard). Leitura de varint32/64
  tem limite de shift explícito (`shift < 64` / loop de 5 iterações extra
  para descartar bits altos de varint32>32bits, comportamento documentado,
  igual à implementação oficial do Google). Todo `read*` valida
  `remainingInLimit()`/`source.require()` antes de consumir bytes —
  comprimento negativo é rejeitado (`requireNonNegativeLength`) e
  comprimento maior que o restante do buffer lança `EOFException` em vez
  de alocar/ler além do limite. Sem falha de lógica encontrada.
- `wire-runtime/.../AnyMessage.kt` — implementação de `google.protobuf.Any`
  (tipo genérico que carrega um type URL + bytes). Verifiquei se `unpack`/
  `decode` resolvem o tipo dinamicamente a partir do `typeUrl` vindo dos
  bytes (o que seria o padrão de polymorphic/insecure deserialization que
  vira gadget chain em outras libs). Não é o caso: `decode()` só extrai
  `typeUrl` (string) e `value` (bytes) sem interpretar nenhum dos dois —
  a resolução do tipo real é sempre feita pelo código chamador, que passa
  um `ProtoAdapter<T>` explícito e conhecido em tempo de compilação para
  `unpack(adapter)`/`unpackOrNull(adapter)`; o método só compara
  `typeUrl == adapter.typeUrl` (post-decode) antes de decodificar com esse
  adapter fixo. Nenhuma reflection/carregamento de classe por nome vindo
  dos bytes. Sem falha encontrada.
- `wire-runtime/.../internal/RuntimeMessageAdapter.kt` — adapter genérico
  usado por reflection/binding em runtime para mensagens Wire. `decode()`
  usa `fields[tag]` (mapa de bindings construído a partir da classe da
  mensagem, em tempo de compilação/inicialização) para decidir como
  interpretar cada tag lida do stream — não há caminho onde um `tag`
  vindo dos bytes de entrada dispare criação de instância de classe
  arbitrária ou reflection sobre nome vindo do payload; tags desconhecidas
  vão para `addUnknownField` (armazenadas como bytes brutos, não
  executadas). Sem falha encontrada.

Nenhum achado novo adicionado à fila. `deep-read-log.json` atualizado com
`square/wire`. Próxima rodada: `NetworkManager.swift`/`StateMachine.swift`
do `cash-app-pay-ios-sdk` (comparar com o fluxo Android já auditado) ou
`afterpay/sdk-android`/`afterpay/sdk-ios`.

---

## Rodada 2026-08-29 (3) — fila vazia, leitura profunda em afterpay/sdk-android

Fila sem itens `pending` no início desta rodada. Cloneados `afterpay/sdk-android`,
`afterpay/sdk-ios`, `cashapp/cash-app-pay-ios-sdk` (`git clone --depth 1`,
público) só para localizar arquivos por nome/keyword — nenhum ainda no
`deep-read-log.json`. `afterpay/sdk-ios` e `cash-app-pay-ios-sdk` não têm
nenhum arquivo com auth/session/crypto/token/login/password/admin/permission/
access no nome; `afterpay/sdk-android` tinha 1 (`CheckoutV3Tokens.kt`, mas é
só um data class de request/response sem lógica). Optei por julgamento
próprio sobre o fluxo Cash App Pay embutido no SDK do Afterpay (superfície de
JWT + WebView bridge), que a busca por nome de arquivo não teria achado
sozinha.

3 arquivos lidos em `afterpay/sdk-android`:
- `afterpay/.../cashapp/AfterpayCashAppJwt.kt` — `AfterpayCashAppJwt.decode()`
  faz parse do payload do JWT (`jwtToken` retornado por
  `AfterpayCashAppSigningResponse`) SEM verificar a assinatura. À primeira
  vista parece o padrão clássico "JWT não verificado", mas rastreei a cadeia
  completa em `AfterpayCashAppCheckout.kt`: o JWT nunca vem de input do
  usuário/deep link/webview — vem direto da resposta HTTPS de
  `Afterpay.environment.cashAppPaymentSigningUrl`, um endpoint do próprio
  backend da Afterpay (`signPayment(token)`), chamado pelo próprio SDK. O
  campo decodificado (`amount`) só é usado para popular `AfterpayCashApp`
  (dado exibido/local); a decisão de autorização de pagamento de verdade
  acontece depois, em `validatePayment`, que reenvia o `jwt` bruto (não o
  payload decodificado) para outro endpoint da Afterpay
  (`cashAppPaymentValidationUrl`) — ou seja, a verificação de assinatura,
  se existir, é responsabilidade do backend, não do client. Sem canal para
  um atacante injetar um JWT arbitrário nesse fluxo (não há deep link nem
  postMessage entregando `jwtToken` de fora). Classificado como não
  suspeito o bastante para virar candidato — não adicionado à fila.
- `afterpay/.../internal/WebView.kt` — só define uma extension function
  que concatena a string de user-agent. Nada para auditar.
- `afterpay/.../view/AfterpayCheckoutV2Activity.kt` — usa
  `addJavascriptInterface(javascriptInterface, "Android")` com JS habilitado
  (padrão que a heurística `webview_js_bridge_exposure` marcaria). Verifiquei
  o escopo real: a bridge só é registrada em `bootstrapWebView`, que carrega
  APENAS uma URL fixa do próprio recurso de string do app
  (`R.string.afterpay_url_checkout_express`, domínio da Afterpay) e nunca
  navega para outra URL depois — não há `loadUrl` adicional nem
  `shouldOverrideUrlLoading` permissivo redirecionando para conteúdo externo.
  A segunda WebView (`checkoutWebView`, criada em `onCreateWindow` para
  pop-ups/iframes do checkout, onde conteúdo de terceiro poderia aparecer)
  NÃO recebe `addJavascriptInterface` — a bridge fica isolada da superfície
  que carrega conteúdo variável. `allowFileAccess = false` em ambas as
  WebViews, fechando o vetor clássico file://+JS-interface. O handler
  `postMessage` também faz parse estruturado (`Json.decodeFromString` em
  tipos selados), não `eval` de string arbitrária. Sem falha de lógica
  encontrada; escopo da bridge parece corretamente restrito a conteúdo
  primeiro-partido fixo.

Nenhum achado novo adicionado à fila nesta rodada. `deep-read-log.json`
atualizado. Próxima rodada: `square/wire` (wire-runtime) ou completar
`afterpay/sdk-ios` / `cash-app-pay-ios-sdk` (ainda não tocados).

---

## Rodada 2026-08-29 (4) — fila vazia, `NetworkManager.swift` do cash-app-pay-ios-sdk

Fila sem itens `pending`. Esta rodada rodou em paralelo com a rodada
anterior (disparo por push repetido no mesmo dia) — ao sincronizar,
`square/wire` (ProtoReader.kt/AnyMessage.kt/RuntimeMessageAdapter.kt) e
`afterpay/sdk-android` (JWT/WebView bridge) já tinham sido cobertos por
essa outra rodada, então não repeti a leitura. Único arquivo novo lido
aqui, ainda não registrado no log:

- `cash-app-pay-ios-sdk/Sources/PayKit/NetworkManager.swift` — completa a
  comparação com o `NetworkManagerImpl.kt` do Android (já auditado). O
  `baseURL` vem de `endpoint.baseURL`, um `switch` fechado sobre 3 hosts
  hardcoded (`api.cash.app`/`sandbox.api.cash.app`/`api.cashstaging.app`)
  — nenhum componente de host vem de entrada externa, sem superfície de
  SSRF. O header `Authorization: Client <clientID>` usa o `clientID`
  fornecido pelo integrador na inicialização do SDK, não algo vindo de
  rede. `parseResponseData` decodifica a resposta em cascata
  (`CustomerRequestWrapper` → `APIErrorWrapper` → `IntegrationErrorWrapper`
  → `UnexpectedErrorWrapper`) só com `Codable`/`try?` padrão do Swift, sem
  reflection ou tipo dinâmico perigoso. Sem achado.

Nenhum achado novo. `deep-read-log.json` atualizado (só a chave
`cashapp/cash-app-pay-ios-sdk`, ganhou mais uma entrada). Único arquivo do
trio Network/State/Facade do `cash-app-pay-ios-sdk` que falta agora é
`StateMachine.swift` — próxima rodada.

---

## Rodada 2026-08-29 (5) — fila vazia, leitura profunda em afterpay/sdk-ios

Fila sem itens `pending` no início desta rodada. Clonado `afterpay/sdk-ios`
via `git clone --depth 1` (público, sem conta/token) — repo ainda não tinha
entrada em `deep-read-log.json`. Nenhum arquivo em `Sources/` tem auth/
session/crypto/token/login/password/admin/permission/access no nome
(mesma ausência já observada em rodadas anteriores para este SDK), então
segui julgamento próprio: o equivalente iOS do fluxo JWT+WebView do Cash
App Pay já auditado no lado Android (`AfterpayCashAppJwt.kt`, rodada
anterior), pra confirmar se a mesma conclusão vale.

6 arquivos lidos por completo:
- `Sources/Afterpay/Helpers/JWT.swift` — `JWT.decode()` faz parse do
  payload sem verificar assinatura (idêntico ao Android). Rastreei a
  cadeia completa: `CashAppSigningResponse.decodeJwtToken()` chama
  `JWT.decode` só sobre o `jwtToken` retornado por
  `CashAppPayCheckout.signPayment` (`CashAppPayCheckout.swift:73`), que é
  resposta HTTPS de `cashAppSigningURL` — endpoint do próprio backend da
  Afterpay, nunca input de usuário/deep link/postMessage. O payload
  decodificado (`amount`, `redirectUrl`, `externalMerchantId`) só alimenta
  `CashAppSigningData`, dado local de UX; a autorização real usa o `jwt`
  bruto (não decodificado) reenviado para
  `CashAppPayCheckout.validateOrder`/`checkoutV3Confirm`, endpoints
  também da Afterpay — verificação de assinatura, se existir, é
  responsabilidade do backend. Mesma conclusão do Android: sem canal de
  injeção, não suspeito o bastante para virar candidato.
- `Sources/Afterpay/CashApp/CashAppSigningResponse.swift`,
  `Sources/Afterpay/CashApp/CashAppPayCheckout.swift` — confirmaram a
  cadeia acima (ponto de origem do `jwtToken` e uso do `jwt` bruto na
  validação).
- `Sources/Afterpay/Checkout/CheckoutV2Message.swift` — parse de mensagens
  vindas do WebView do checkout (`Codable` customizado, switch sobre tipo
  declarado). Decode estruturado e tipado (`ShippingAddress`,
  `ShippingOption`, etc.), sem `eval`/interpretação de string arbitrária;
  tipo desconhecido cai em `default: payload = nil` (fail-safe, não
  fail-open). Sem falha encontrada.
- `Sources/Afterpay/Checkout/CheckoutWebViewController.swift` — antes de
  carregar `checkoutUrl` no WKWebView, valida
  `CheckoutHost.validSet.contains(host)` e cancela com
  `.invalidURL` caso contrário (linha 71-76). Verifiquei
  `CheckoutHost.swift`: é um enum fechado (`CaseIterable`) com 8 hosts
  literais fixos da própria Afterpay/Clearpay (produção + sandbox,
  US/UK/EU) — nenhum bypass por subdomínio/case/porta, comparação é
  igualdade exata de string do `host` extraído via `URLComponents`. Sem
  falha encontrada.

Nenhum achado novo adicionado à fila. `deep-read-log.json` atualizado com
`afterpay/sdk-ios`. Com isso, todos os 7 repos do programa já receberam ao
menos uma rodada de leitura profunda. Próxima rodada: aprofundar em
`misk-hibernate/`/`misk-jdbc/` (SQL injection via Hibernate/JDBC, ainda
não coberto) ou `cash-app-pay-ios-sdk` (`StateMachine.swift`, único
arquivo do trio Network/State/Facade ainda não lido).

---

## Rodada 2026-08-29 (6) — fila vazia, leitura profunda em cashapp/misk

Fila sem itens `pending` no início desta rodada. Clonado `cashapp/misk`
(`git clone --depth 1`, público) pra listar arquivos ainda não lidos com
auth/crypto/token/etc. no nome dentro dos `pathPrefixes` autorizados
(`misk/`, `misk-core/`, `misk-crypto/`, `misk-inject/`, `misk-hibernate/`,
`misk-jdbc/`). Escolhi 3 arquivos do módulo `security/authz` e
`misk-crypto` ainda não cobertos pelas rodadas anteriores (que já tinham
lido `AccessInterceptor.kt`, `MiskCallerAuthenticator.kt` e
`CiphertextFormat.kt`):

- `misk/src/main/kotlin/misk/security/authz/AccessAnnotationEntry.kt` —
  classe de dados (`services`, `capabilities`, `allowAnyService`,
  `allowAnyUser`) usada via Guice multibinding pra declarar política de
  acesso por anotação. Não tem lógica de decisão própria (isso fica em
  `AccessInterceptor`, já auditado antes) — é só o modelo de config. Sem
  falha encontrada.
- `misk-crypto/src/main/kotlin/misk/crypto/pgp/RealPgpDecrypter.kt` —
  decriptador PGP de chave pública. Rastreei a ordem
  decrypt-then-verify-integrity com ceticismo, porque esse é um padrão
  clássico de falha (usar plaintext antes de validar MDC/tag de
  integridade). Confirmei que NÃO é falha: o plaintext é escrito só num
  buffer interno (`okio.Buffer`), nunca exposto ao chamador — o
  `pgpPublicKeyEncryptedData.verify()` só pode ser chamado depois de
  consumir o stream inteiro (exigência da própria API do BouncyCastle,
  o MDC é um digest cumulativo), e se a verificação falhar a função lança
  exceção antes do `return buffer.readByteArray()` (linha 63-67), então
  nenhum plaintext não verificado chega a sair da função. A única
  ressalva é documentada no próprio KDoc da classe ("No signature
  verification" e o MDC só é checado `if
  (pgpPublicKeyEncryptedData.isIntegrityProtected)`) — é uma limitação
  conhecida e assumida pelos chamadores, não uma falha escondida. Não virou
  candidato.
- `misk-crypto/src/main/kotlin/misk/crypto/KeyManager.kt` — classes
  `MappedKeyManager`/`AeadKeyManager`/etc. são só wrappers de lookup de
  chave via Guice (`injector.getInstance` por nome), delegando toda a
  criptografia de fato pro Google Tink. Nenhuma lógica de derivação,
  comparação ou validação própria. Sem falha encontrada.

Nenhum achado novo. `deep-read-log.json` atualizado (`cashapp/misk` ganhou
3 entradas novas). Próxima rodada: os itens já sinalizados na rodada
anterior continuam pendentes — `misk-hibernate/`/`misk-jdbc/` (SQL
injection via Hibernate/JDBC) e `cash-app-pay-ios-sdk`
(`StateMachine.swift`).

---

## Rodada 2026-08-29 (7) — revisitando afterpay/sdk-android em paralelo com a rodada (3) (achado inconclusivo — ver nota de discordância)

Fila (`queue.jsonl`) sem itens `pending` no início desta rodada. Esta rodada
começou antes de eu ver que a rodada (3) acima já tinha coberto
`AfterpayCheckoutV2Activity.kt` na mesma sincronização — os dois rounds
chegaram a conclusões diferentes sobre o mesmo trecho, então registro os dois
em vez de apagar um. A rodada (3) concluiu que a bridge JS está "corretamente
restrita a conteúdo primeiro-partido fixo" porque não há `loadUrl` adicional
nem `shouldOverrideUrlLoading` **permissivo**. Na minha leitura, isso inverte
o sentido: a AUSÊNCIA de qualquer override de `shouldOverrideUrlLoading` não
é restritiva, é o padrão do `WebViewClient` deixando a `WebView` navegar
livremente pra qualquer URL que a própria página (ou um redirect dela)
dispare — sem checagem de host nenhuma — ao contrário do V1
(`AfterpayCheckoutActivity.kt`, `validCheckoutUrls` checado antes do
`loadUrl` inicial) e do equivalente iOS já auditado na rodada (5)
(`CheckoutWebViewController.swift`, valida `CheckoutHost.validSet` antes de
carregar). Não chego a uma conclusão de exploração diferente da rodada (3)
— a precondição real (o conteúdo da página estática em
`static.afterpay.com`, fora deste repo e fora do escopo de alvos) não dá pra
verificar dos dois lados. Fica registrado pra quem pegar o próximo round
decidir com mais confiança; não é achado novo por si só sem informação
adicional sobre o conteúdo daquela página.

Leitura profunda (texto original desta rodada, antes de notar a
sobreposição): `afterpay/sdk-android` era o único alvo do programa ainda sem
nenhuma leitura profunda no início desta rodada (`deep-read-log.json` ainda
não tinha a chave quando este round começou). Clonado via
`git clone --depth 1` (público, sem conta/token). Sem arquivo com auth/
session/crypto/token/login/password/admin/permission/access no nome —
julgamento de especialista apontou os três `*CheckoutActivity.kt`
(V1/V2/V3, orquestram o WebView de checkout e a ponte JS->nativo) como a
superfície mais sensível: qualquer lógica de checkout via WebView é
candidata clássica a bug de validação de origem/redirect.

5 arquivos lidos por completo: `AfterpayCheckoutActivity.kt` (V1),
`AfterpayCheckoutV2Activity.kt`, `AfterpayCheckoutV3Activity.kt`,
`AfterpayCheckoutMessage.kt`, `AfterpayCheckoutCompletion.kt` (+ 2 docs:
`checkout-v1.md`, `checkout-v2.md`, + `res/values/urls.xml` para resolver a
URL do bootstrap).

**Achado (`ai_deep_read_finding`, revisado na mesma rodada, verdict
`inconclusivo`, confidence `baixa`)**: `AfterpayCheckoutV2Activity.kt`
(fluxo Express/V2) anexa uma ponte JS `addJavascriptInterface(..., "Android")`
em `bootstrapWebView` sem nunca sobrescrever `shouldOverrideUrlLoading` —
diferente da V1 (`AfterpayCheckoutActivity.kt`, que restringe a URL inicial a
um allowlist de host `validCheckoutUrls`) e da V3
(`AfterpayCheckoutV3Activity.kt`, que exige uma chamada real
`performConfirmationRequest(ppaConfirmToken)` contra a API da Afterpay antes
de finalizar). Em V2, `BootstrapJavascriptInterface.postMessage` aceita
qualquer JSON que decodifique como `AfterpayCheckoutCompletion(status=SUCCESS,
orderToken=<string livre>)` e retorna `RESULT_OK` direto pro app, sem etapa
de confirmação server-side equivalente à V3. Como a ponte JS é vinculada à
instância da WebView (não à origem carregada), JS de uma origem não confiável
poderia em teoria chamar `Android.postMessage(...)` diretamente **se**
`bootstrapWebView` algum dia navegasse pra fora do domínio da Afterpay
mantendo a ponte anexada.

Não deu pra fechar essa cadeia: a URL inicial
(`https://static.afterpay.com/mobile-sdk/bootstrap/index.html`, resolvida via
`urls.xml`) é conteúdo hospedado no servidor da Afterpay — fora deste
repositório e fora da lista de alvos autorizados
(`system/bugbounty-scanner/targets-*.mjs` só lista repos GitHub) — então não
dá pra confirmar nem refutar se essa página bootstrap alguma vez navega pra
fora do domínio afterpay.com. Mesmo que a precondição existisse, o impacto
fica limitado pelo próprio fluxo documentado: `docs/getting-started/
checkout-v2.md` confirma que o app consumidor ainda precisa fazer um
"Capture request" separado, servidor-a-servidor, contra a API real da
Afterpay (credenciais do merchant) — um `orderToken` forjado devolvido pelo
SDK não movimenta fundos sozinho; o pior cenário plausível é o app tratar
incorretamente o status do checkout (spoofing de UI/estado) até essa etapa de
captura falhar ou confirmar server-side.

Sem relatório (verdict != `confirmado`). `queue.jsonl` e `deep-read-log.json`
atualizados. Próxima rodada (já coberto por outras rounds nesta mesma
sincronização, ver acima): `afterpay/sdk-ios` foi auditado na rodada (5) —
`CheckoutWebViewController.swift` valida host antes do load inicial, mas o
mesmo tipo de pergunta sobre navegação pós-load não foi verificada lá
também. Sugestão pra próxima rodada de verdade: `misk-hibernate/`/
`misk-jdbc/` (SQL injection via Hibernate/JDBC, ainda não coberto) ou
`StateMachine.swift` do `cash-app-pay-ios-sdk`.
