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
- Nenhuma vulnerabilidade candidata ainda (normal/esperado).
- Se quiser ampliar depois: `wire-kotlin-generator`/`wire-java-generator`/
  `wire-swift-generator` (codegen, não runtime) ficaram de fora do escopo
  do `wire` por serem menos sensíveis (rodam em build-time, não em
  produção com input de rede não confiável) — podem entrar numa v2 se
  valer a pena.
