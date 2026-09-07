# Mattermost Public Bug Bounty Engagement (Bugcrowd) — notas de pesquisa

## Rodada 2026-09-06e (push automático via GitHub webhook, sessão cloud)

`program-policy.json` conferido como passo zero: `Auth0 by Okta` e
`Circle BBP` seguem `blocked:true`. `list-pending` = 34 candidatos,
100% nesses dois programas — skip completo, nenhum arquivo tocado.

Esta rodada investigou `mattermost/mattermost-plugin-mscalendar`
(fluxo OAuth2, mesma hipótese da rodada 2026-09-06d abaixo) em
paralelo a outra sessão cloud que chegou à mesma conclusão (binding
CSRF correto via `strings.Split(state, "_")[1] != authedUserID`,
mesmo padrão seguro do `-jira`, sem achado) — resultado duplicado,
sem novidade a registrar aqui além do que a rodada 2026-09-06d já
documenta.

A investigação foi então estendida a outro plugin da mesma família
ainda não coberto por `deep-read-log.json`:
`mattermost/mattermost-plugin-msteams-meetings` (clone raso público).
5 arquivos lidos: `server/authorization.go`, `server/state.go`,
`server/http.go`, `server/user.go`, `server/command.go`.

- **Achado novo confirmado** (`oauth2_login_csrf_account_linking`,
  `server/http.go::completeUserOAuth`): diferente de `-confluence`
  (onde a comparação de `mattermostUserID` simplesmente não existe) e
  diferente de `-jira`/`-mscalendar` (onde existe e funciona porque o
  `state` tem um componente aleatório de alta entropia), aqui o bug é
  mais sutil: a comparação de usuário *existe* em
  `completeUserOAuth`, mas é inócua porque o próprio `state` gerado em
  `StoreState` (`server/state.go`) é **100% determinístico** —
  `"msteamsmeetinguserstate_<userID>_<channelID>_<justConnect>"`, sem
  nenhum nonce aleatório. Qualquer atacante que conheça o `userID` e
  um `channelID` da vítima (ambos observáveis/previsíveis) consegue
  reconstruir o `state` exato sem nenhum segredo, e
  `completeUserOAuth` reconstrói a chave de KV a partir do próprio
  `state` recebido na requisição (não da sessão), então a comparação
  `storedState == state` e o check de `userID` subsequente não travam
  nada. Cadeia de exploração completa (CSRF em dois estágios —
  `/oauth2/connect?channelID=...` pra semear o KV com um state
  previsível, depois `/oauth2/complete?code=<code do atacante>&state=<state
  forjado>` pra vincular a conta Microsoft do atacante à identidade
  Mattermost da vítima) documentada em detalhe no campo `reasoning`
  do finding. Mesma classe (CWE-352, OAuth login/account-linking
  CSRF) já confirmada 2x nesta família de plugins, terceiro mecanismo
  de quebra distinto. `filesRead`/`reasoning` salvos, avançado para
  `corroborated_static` (aceito pelo CLI). `check-scope` recusa
  (`allowed:false`, "nenhum scope snapshot existe para este
  programa") — mesma lacuna de infraestrutura já documentada pros
  outros achados deste programa. `record-deployment-evidence`
  registrado com `confidence:"unverified"`. Tentativa de
  `scope_verified` corretamente recusada pela máquina de estados
  (transição `corroborated_static` → `scope_verified` não é permitida
  sem passar por `reproduced_local`, inexistente para Go — sem
  validador de PoC pra essa linguagem hoje). `corroborated_static` é
  o teto possível nesta rodada.

`deep-read-log.json` atualizado (+5 em
`mattermost-plugin-msteams-meetings`, repo novo). Clone temporário
removido. `export-queue` rodado ao final da rodada.

## Rodada 2026-09-06d (push automático via GitHub webhook, sessão cloud)

`research/bugbounty/program-policy.json` conferido como passo zero
(regra do CLAUDE.md): `Auth0 by Okta` e `Circle BBP` seguem
`blocked:true`. `list-pending` = 34 candidatos, 100% nesses dois
programas (30 `Auth0 by Okta`, 4 `Circle BBP`) — skip completo, nenhum
arquivo desses dois programas tocado.

Leitura profunda proativa em `mattermost/mattermost-plugin-mscalendar`
(repo novo, nunca coberto por `deep-read-log.json`), clone raso
público. Priorizei o fluxo OAuth2 (mesma classe de bug já encontrada
em `mattermost-plugin-confluence` na rodada anterior — CSRF de
account-linking por falta de checar o `mattermostUserID` embutido no
`state` contra o usuário que completa o fluxo). 4 arquivos lidos:
`calendar/utils/oauth2connect/oauth2_connect.go`,
`calendar/utils/oauth2connect/oauth2_complete.go`,
`calendar/utils/oauth2connect/oauth2.go`, `calendar/engine/oauth2.go`.

- Hipótese investigada (a mesma vulnerabilidade do `-confluence`,
  agora refutada aqui): `InitOAuth2`/`CompleteOAuth2`
  (`engine/oauth2.go`) geram `state` no mesmo formato
  `<random>_<mattermostUserID>` e o handler HTTP lê o usuário
  autenticado do header `Mattermost-User-ID` em ambas as pontas
  (`oauth2_connect.go`/`oauth2_complete.go`), igual ao padrão já visto
  em `-confluence` e `-jira`. Diferença decisiva: `CompleteOAuth2`
  faz `mattermostUserID := strings.Split(state, "_")[1]; if
  mattermostUserID != authedUserID { return errors.New("not
  authorized, user ID mismatch") }` — ou seja, o usuário embutido no
  `state` É comparado explicitamente contra `authedUserID` (o usuário
  real que completou o fluxo) antes de vincular a conta. Esse é
  exatamente o gate que faltava em `-confluence`
  (`VerifyOAuth2State` lá só confere existência/TTL do nonce, nunca
  compara o `mattermostUserID` embutido contra quem completou).
  `mscalendar` implementa o binding corretamente (mesmo padrão seguro
  do `-jira`) — sem achado.

`deep-read-log.json` atualizado (`mattermost/mattermost-plugin-mscalendar`,
repo novo, 4 entradas). Clone temporário removido. Achado
`-confluence::oauth2_login_csrf_account_linking` (rodada anterior)
segue em `corroborated_static`, sem mudança (`check-scope` ainda sem
snapshot pra este programa — gap de infraestrutura conhecido, não
forçado). `export-queue` rodado ao final da rodada.

## Rodada 2026-09-06c (push automático via GitHub webhook, sessão cloud)

`program-policy.json` conferido como passo zero (regra do CLAUDE.md,
antes de escolher qualquer alvo): `Auth0 by Okta` e `Circle BBP`
confirmados bloqueados via `check-program`. `list-pending` = 34
candidatos, 100% nesses dois programas (30 `Auth0 by Okta`, 4
`Circle BBP`) — skip completo, nenhum arquivo desses dois programas
tocado.

Leitura profunda proativa: `kubernetes/kubelet` (repo de staging,
`pkg/apis/credentialprovider/types.go` — só definição de tipos da API
kubelet↔credential-provider-plugin, sem lógica; repo é majoritariamente
tipos gerados/protobuf publicados do monorepo principal via
publishing-bot; sem achado) e `mattermost/mattermost-plugin-confluence`
(repo novo, ainda não coberto por `deep-read-log.json`).

**Achado novo** (`ai_deep_read_finding`, id termina em
`oauth2_login_csrf_account_linking`, avançou pra `corroborated_static`):
`server/store/store.go` `VerifyOAuth2State(state)` só confere que o
`state` recebido no callback OAuth2 (`/oauth2/complete.html`) foi
previamente armazenado (nonce anti-replay puro, TTL de 15min e — bug
secundário menor — sem `KVDelete` real apesar do comentário dizer que a
chave "will be deleted after the first verification"). Em nenhum
momento o `mattermostUserID` embutido no `state`
(`<random>_<mattermostUserID>`, gerado em `getUserConnectURL`) é
comparado contra o `mattermostUserID` de quem efetivamente completa o
fluxo (lido do header `Mattermost-User-Id` da segunda requisição, em
`httpOAuth2Complete`/`CompleteOAuth2`). Divergência real frente ao
`mattermost-plugin-jira` (investigado em rodada anterior, sem achado —
lá o segredo é explicitamente checado contra o `mattermostUserID`
específico antes de aceitar). Cadeia de ataque: atacante autenticado
inicia `/oauth2/connect` como si mesmo, completa a autorização no
Confluence com a própria conta, intercepta a URL de callback
(code+state válidos e atrelados à própria conta do atacante) sem
segui-la, e induz a vítima (sessão Mattermost já autenticada) a
visitar essa URL GET — o servidor troca o `code` pelo token do
atacante e vincula essa conta Confluence do atacante ao
`mattermostUserID` da vítima (CWE-352, OAuth login/account-linking
CSRF).

`check-scope` voltou `allowed:false` — não existe scope-snapshot local
pra este programa (mesma lacuna de infraestrutura já documentada em
achados anteriores de Mattermost, ex. `mattermost-plugin-zoom`).
Registrei `deploymentEvidence` com `confidence:"unverified"` mesmo
assim e tentei `scope_verified` — recusado pela máquina de estados como
esperado; achado permanece em `corroborated_static`. Nenhum rascunho de
relatório escrito (barra de `scope_verified` não foi alcançada —
sistema funcionando corretamente).

`deep-read-log.json` atualizado (`kubernetes/kubelet` +1;
`mattermost/mattermost-plugin-confluence`, repo novo, 7 entradas).
Clones temporários removidos. `export-queue` rodado ao final da
rodada.

## Rodada 2026-09-06b (push automático via GitHub webhook, sessão cloud)

`program-policy.json` conferido como passo zero: `Auth0 by Okta` e
`Circle BBP` confirmados bloqueados via `check-program`, nenhum arquivo
desses dois programas clonado/lido. `list-pending` = 34 candidatos,
100% em programas bloqueados (30 `Auth0 by Okta`, 4 `Circle BBP`) —
skip completo, sem exceção.

Leitura profunda proativa direcionada a `mattermost/mattermost-plugin-msteams`,
seguindo a mesma família de bug já confirmada 2x nesta missão
(`non_constant_time_hmac_comparison`: gate único em
`mattermost-plugin-gitlab`, segunda camada em `mattermost-plugin-zoom`;
já refutado em `mattermost-plugin-github`, que usa `hmac.Equal`
corretamente). 2 arquivos novos lidos por completo:

- `server/api.go` (`processActivity`/`processLifecycle`, linhas
  103-177) — REFUTADO: ambos os handlers de webhook do MS Graph usam
  `subtle.ConstantTimeCompare(activity.ClientState/event.ClientState,
  WebhookSecret)` corretamente, inclusive com comentário explícito no
  próprio código citando proteção contra timing attack. `validationToken`
  do handshake de assinatura do MS Graph é refletido como
  `text/plain`, sem contexto de renderização HTML — sem risco de XSS
  reletido. Não é o 3º irmão da família.
- `server/subscriptions.go` — gerenciamento de ciclo de vida de
  subscription (criar/renovar/deletar), sem input de rede não
  confiável alcançando essas funções (`NotificationURL` só comparado
  contra `m.baseURL` próprio, nunca o inverso).

Também verificado `mattermost/mattermost-plugin-calls` (já com 6
arquivos lidos em rodada anterior) e `plaid/plaid-ruby` (já com 4
arquivos lidos) via clone raso: `calls` não tem nenhum arquivo com
`signature`/`hmac`/`webhook` no conteúdo (usa sessão WebSocket, não
webhook de terceiro com segredo compartilhado); `plaid-ruby` só tem 4
arquivos de lógica escrita à mão (os 4 já lidos) — todo o resto de
`lib/plaid/models/*.rb` é código gerado por OpenAPI (classes de dado
puras, sem lógica de verificação de assinatura/JWT). Nenhum dos dois
gerou arquivo novo genuinamente inédito para o orçamento desta rodada;
não contam como um dos 3 slots, só descrito aqui para não repetir a
mesma checagem numa rodada futura.

Sem achado novo. `deep-read-log.json` atualizado
(`mattermost/mattermost-plugin-msteams`: 3 → 5 arquivos). Clones
temporários removidos. `export-queue` rodado ao final.

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud)

Primeira rodada tocando este programa. Mesma lacuna documentada em
`slack/NOTES.md`: `Mattermost Public Bug Bounty Engagement` foi promovido
automaticamente pro scanner ativo pelo pipeline de descoberta
(`targets-auto-promoted-log.json`) sem revisão de RoE da Bugcrowd quanto a
proibição de pesquisa assistida por IA — percebido só depois de já ter
lido/triado os achados abaixo. Registrado em `program-policy.json`
(`"roeReviewNeeded": true`) como advertência pro usuário revisar a RoE real
do engagement `mattermost-mbb-public` antes de qualquer pesquisa futura
aqui.

`list-pending` trouxe 5 achados em `mattermost/mattermost-plugin-jira`
(clonado raso localmente, leitura de código público):

- 3x `semgrep_use_of_md5` (`server/utils/kvstore/hashed_key.go:76`,
  `server/kv.go:95,101`): MD5 usado só como hash não-criptográfico pra
  derivar chave de KV store (namespacing/lookup key) — nunca senha, token,
  assinatura ou verificação de integridade. Código upstream já anota
  `// #nosec G501`/`G401`, reconhecendo e suprimindo deliberadamente o aviso
  do gosec. Falso positivo — CWE-328 só importa quando o hash protege algo.
- 2x `semgrep_var_in_script_tag` (`assets/templates/ac/user_connected.html:62`,
  `user_confirm.html:59`): `{{ .ArgJiraJWT }}` renderizado dentro de
  `<script>` (`document.getElementById(...)`) — rastreado até
  `server/user_cloud.go`, `ArgJiraJWT` vem de uma constante hardcoded
  (`argJiraJWT = "jwt"`), nunca de input de usuário/request. Sem fonte
  controlável por atacante alcançando o sink, não há XSS real.

Todos os 5 refutados como falso positivo com reasoning individual salvo em
cada finding.

**Pendência pro usuário**: confirmar a RoE do engagement
`mattermost-mbb-public` no Bugcrowd antes de qualquer rodada futura de
pesquisa aqui (ver `program-policy.json`).

## Rodada 2026-09-04 (push automático via GitHub webhook, sessão cloud)

`program-policy.json` checado como passo zero (regra do CLAUDE.md):
programa segue `roeReviewed:true`/`aiResearchBanned:false`, liberado.

`list-pending` trouxe 3 achados `known_vulnerable_dependency` em
`mattermost/mattermost-plugin-zoom/webapp/package-lock.json`
(`yaml@1.10.2` GHSA-48c2-rrv3-qjmp, `ajv@6.12.6` e `ajv@8.17.1`
GHSA-2g4f-4pwh-qvx6) — todos com GHSA extraível no reasoning e sem
verificação de alcançabilidade real ainda feita. Rodei
`cli.mjs auto-triage-known-cve`, que fecha automaticamente este padrão
como `known_duplicate` (não `false_positive`: o CVE é real, só não é
achado novo — já é divulgação pública rastreável, exatamente o critério
de `state-machine.mjs::known_duplicate`). Os 3 fecharam limpo, sem
erro. Nenhuma leitura de arquivo do repositório-alvo foi necessária
para isso (a decisão depende só do GHSA já publicado, não do código).

Leitura profunda proativa desta rodada ficou em `nuxt/nuxt` (programa
Vercel Open Source) — ver NOTES.md de Vercel Open Source. Nenhum achado
novo neste programa.

## Rodada 2026-09-04 #2 (push automático via GitHub webhook, sessão cloud)

`program-policy.json` checado como passo zero: `Block Open Source`/
`Circle BBP`/`Auth0 by Okta` bloqueados via `check-program`, `Kubernetes`
com `roeReviewNeeded` (revisão pendente) — nenhum dos quatro tocado.
`migrate-to-v2.mjs` + `list-pending` global = 37, todos pertencentes a
esses quatro programas fora de escopo desta sessão; nenhum candidato
pendente em Mattermost.

Leitura profunda proativa desta rodada em `mattermost-plugin-github`
(primeiro repo Mattermost tocado por leitura profunda — `-plugin-jira`
e `-plugin-zoom` só tinham sido cobertos por achados de fila, nunca por
sweep proativo), clonado raso localmente, 4 arquivos (`oauth.go`,
`api.go` — trecho `connectUserToGitHub`/`completeConnectUserToGitHub`,
`webhook.go` — `verifyWebhookSignature`/`signBody`,
`mm_34646_token_refresh.go`):

- Fluxo OAuth (`api.go`): state token gerado com `model.NewId()[:15]`,
  guardado no KV store server-side com TTL, chave de lookup já é o
  próprio token; `state.UserID != c.UserID` checado contra a sessão
  Mattermost autenticada antes de aceitar o code exchange do GitHub;
  escopo do token OAuth validado pós-exchange via
  `validateOAuthScopes`. Sem achado.
- Assinatura de webhook (`webhook.go`): HMAC-SHA1 sobre o body cru,
  comparação via `hmac.Equal` (constant-time), length-check de 45
  chars + prefixo `sha1=` antes do `hex.Decode`, fail-closed em erro ou
  assinatura inválida. Sem achado.
- `oauth.go`/`mm_34646_token_refresh.go`: pub/sub interno e job de
  manutenção histórico gated por mutex de cluster, sem input de
  rede/usuário controlável alcançando nenhum dos dois. Sem achado.

`deep-read-log.json` atualizado (+1 repo, `mattermost/mattermost-plugin-github`,
4 entradas). Nenhum achado novo, nenhuma transição de estado nesta
rodada em Mattermost — resultado normal e válido.

## Rodada 2026-09-04 #33 (push automático via GitHub webhook, sessão cloud)

`program-policy.json` checado como passo zero (`check-program` confirmou
`Block Open Source`/`Circle BBP`/`Auth0 by Okta` bloqueados; nenhum repo
desses três tocado). `migrate-to-v2.mjs` + `list-pending` global = 34,
100% fora de escopo (30 Auth0 by Okta bloqueado, 4 Circle BBP
bloqueado). Nenhum candidato pendente em Mattermost.

Leitura profunda proativa desta rodada abriu `mattermost-plugin-zoom`
(clone raso público, descartado ao final do scratchpad) — único repo
Mattermost com fluxo OAuth próprio ainda não coberto por sweep
proativo (`-plugin-github` já foi coberto em rodada anterior). 1
arquivo: `server/zoom/oauth.go`
(`OAuthClient.GetUser`/`CreateMeeting`/`getUserViaOAuth`) — refresh de
token OAuth2 via `tokenSource.Token()`, token novo só é persistido no
KV store (por usuário ou super-user, conforme `isAccountLevel`) quando
o `RefreshToken` muda; `CreateMeeting`/`GetUser` sempre usam o
`user.Email` do próprio usuário Mattermost autenticado que disparou o
fluxo (vindo da sessão, não de input de terceiro) — sem vetor pra um
usuário forjar ação em nome de outro. Sem achado.

`deep-read-log.json` atualizado (`mattermost/mattermost-plugin-zoom`,
+1 entrada, repo novo). Nenhum achado novo, nenhuma transição de
estado nesta rodada em Mattermost — resultado normal e válido.

## Rodada 2026-09-05 (rotina agendada) — ACHADO real em `mattermost-plugin-gitlab`, avançado até `reproduced_local`

`program-policy.json` conferido como passo zero: `Block Open Source`/
`Circle BBP`/`Auth0 by Okta` seguem bloqueados, nenhum repo desses
tocado. `migrate-to-v2.mjs` + `list-pending` global = 68 (60 Auth0 by
Okta + 8 Circle BBP), 100% fora de escopo — fila inteira pulada sem
investigar nenhum item, como já esperado.

Leitura profunda proativa: dois repos Mattermost nunca tocados por
sweep proativo nem por achado de fila (`mattermost-plugin-gitlab`,
`mattermost-plugin-jira` só tinha 5 achados de fila já refutados em
rodada anterior, nunca sweep proativo) — escolhido `-plugin-gitlab`
por ter fluxo de webhook + OAuth próprio ainda inteiramente não lido.
Clone raso público, 3 arquivos:

- **`server/webhook.go::handleWebhook` (linha 79) — ACHADO CONFIRMADO**:
  `config.WebhookSecret != signature` autentica o webhook do GitLab
  comparando o header `X-Gitlab-Token` com `!=` comum (curto-circuita
  no primeiro byte diferente) em vez de `hmac.Equal`/
  `subtle.ConstantTimeCompare` — CWE-208, timing side-channel. Mesma
  classe de bug do achado `DetachedTokenIsValid` já investigado nesta
  sessão em Kubernetes/kubeadm (fechado Informative por falta de
  posição de rede), mas com um detalhe que muda a calibração: aqui não
  existe NENHUM esquema de assinatura HMAC sobre o corpo (diferente do
  webhook do GitHub no plugin irmão `-plugin-github`, que usa
  `hmac.Equal` corretamente sobre `X-Hub-Signature-256`, já confirmado
  sem achado em rodada anterior) — é comparação direta de bearer
  secret, e o endpoint `/webhook` é registrado no router raiz
  (`server/api.go:60`) **sem** o middleware `checkConfigured`/
  `checkAuth` que protege `/api/v1/*`. O pré-requisito de ataque cai de
  "posição de rede/MITM" (caso kubeadm) para "alcançar o endpoint HTTP
  público do servidor Mattermost" — GitLab precisa conseguir entregar
  webhooks nele, então ele já é internet-reachable por design.
  `WebhookSecret` (`configuration.go:248-259`) é gerado via
  `crypto/rand`, 32 chars base64, e é o ÚNICO fator de autenticação do
  path do webhook.

  **Evidência que fortalece o achado**: `WebSearch` confirmou que o
  próprio time de segurança do Mattermost já corrigiu e recebeu um CVE
  real (`CVE-2025-54499`, Observable Timing Discrepancy) para EXATAMENTE
  esta classe de bug no core server ("fail to use constant-time
  comparison for sensitive string comparisons... allows attackers to
  exploit timing oracles to perform byte-by-byte brute force attacks...
  on Cloud API keys and OAuth client secrets", versões 10.5.x<=10.5.10 e
  10.11.x<=10.11.2) — isto é forte sinal de que o vendor trata esta
  classe como real e patcheável, não teórica, o que muda a calibração
  de risco de duplicata/rejeição em relação ao caso kubeadm.

  **Duplicate-check**: `search-prior-art` via CLI falhou (GitHub API
  HTTP 401 — mesma restrição de rede de sessões cloud anteriores
  documentada no repo). Contornado com `mcp__github__search_issues`/
  `search_code` diretamente (4 queries: constant-time/timing/
  X-Gitlab-Token/hmac.Equal) — zero resultados relacionados; as 12
  issues que batem com termos genéricos de "token" são todas sobre
  reconexão/refresh de OAuth do usuário, nada sobre o webhook shared
  secret. Sem ferramenta de listagem de GitHub Security Advisories
  disponível nesta sessão para este repo — limite reconhecido, não
  contornado. `record-duplicate-check` registrado com
  `foundExisting=false`; sinal honesto do próprio portfólio local:
  `portfolioDuplicateRate=1` (as 6 submissões anteriores da sessão
  viraram duplicata/informative) — risco de resultado similar (fechado
  sem bounty) é real e está registrado, não escondido.

  **PoC de timing real executado** (mesma metodologia do achado kubeadm
  desta sessão — benchmark Go isolado, sem rede/Docker, réplica exata
  do primitivo `!=` de `webhook.go:79` vs. `subtle.ConstantTimeCompare`
  como fix, `n=10` rodadas de 2.000.000 iterações via `testing.B` +
  `benchstat`): comparação `!=` com erro no último byte do segredo é
  **88,03% mais lenta** que com erro no primeiro byte (2,457ns vs.
  4,619ns, **p=0,000**, estatisticamente conclusivo); `ConstantTimeCompare`
  não mostra esse sinal (15,46ns nas duas posições, **p=0,985**,
  não-significativo). Prova a propriedade LOCAL de vazamento de timing
  proporcional ao prefixo correto do segredo com rigor estatístico
  real — NÃO prova exploração remota bem-sucedida contra um servidor
  Mattermost real pela rede (ruído de rede real não medido nesta
  rodada, dito com honestidade).

  **Estado atual: `reproduced_local`** (transições
  `candidate->corroborated_static->reproduced_local`, ambas com
  `filesRead`/`validations` reais, `ledgerHash` gravado). **Não**
  avançado a `scope_verified`: `check-scope` rodado ao vivo e recusou
  (`allowed:false`, "nenhum scope snapshot existe para este programa")
  — infraestrutura de scope-snapshot para o programa Mattermost/Bugcrowd
  ainda não existe neste pipeline (só Kubernetes/Vercel/Kiwi.com/OKG/
  Circle/Block/StackingDAO/Auth0 têm bloco em
  `capture-scope-snapshots.mjs`). Não forçado nem simulado — fica como
  trabalho futuro explícito (mesmo padrão já usado para Kubernetes numa
  rodada anterior: alguém precisa adicionar um bloco Mattermost real a
  `capture-scope-snapshots.mjs` antes deste achado poder avançar).
  Nenhum rascunho de relatório escrito ainda (correto: `scope_verified`
  é pré-requisito do template, não pulado).

  Severidade estimada com honestidade: moderada (Low/Medium), não
  crítica — impacto real é forjar eventos GitLab (merge_request/issue/
  push/pipeline/tag/release/deployment) processados pelos handlers do
  plugin, resultando em notificações/mensagens spoofadas em canais/DMs
  do Mattermost (vetor de phishing/engenharia social interna), não RCE
  nem acesso a dados.

- `server/api.go` (`initializeAPI`, linhas 49-65): só a confirmação de
  roteamento acima (webhook fora do middleware de auth). Sem achado
  adicional.
- `server/configuration.go` (struct `configuration` + `generateSecret()`,
  linhas 248-259): confirma geração criptograficamente aleatória do
  segredo e que ele não é reutilizado em nenhum outro mecanismo de
  auth. Sem achado adicional (faz parte da evidência do achado acima).

`deep-read-log.json` atualizado (`mattermost/mattermost-plugin-gitlab`,
repo novo, 3 arquivos). `export-queue` rodado ao final da rodada.

## Rodada 2026-09-05 #2 (push automático via GitHub webhook, rotina agendada)

`program-policy.json` checado como passo zero: `Circle BBP`/`Auth0 by
Okta` seguem bloqueados via `check-program`, nenhum repo desses dois
tocado (`Block Open Source` não apareceu na fila desta rodada).
`migrate-to-v2.mjs` + `list-pending` global = 38 (30 Auth0 by Okta + 4
Circle BBP bloqueados, 4 Mattermost liberados).

`list-pending` trouxe 4 achados novos em
`mattermost/mattermost-plugin-msteams` (clone raso público):

- 2x `sql_injection_risk` (`server/store/sqlstore/utils.go:11,19` —
  `createTable`/`tableExist`, SQL montado via `fmt.Sprintf`): rastreado
  os call sites reais — `createTable` só é chamado em `helper_test.go`
  (linhas 100-106), sempre com literais hardcoded, nunca em produção;
  `tableExist` só é chamado em `data_migrations.go:31` com
  `whitelistedUsersLegacyTableName`, constante hardcoded em `store.go:38`
  (marcada `LEGACY-UNUSED` no próprio código). Nenhuma fonte
  controlável por atacante alcança o parâmetro `tableName`/`columnList`
  em nenhum dos dois casos — falso positivo, mesmo padrão já visto em
  `-plugin-jira`.
- 2x `insecure_tls` (`server/msteams/client_mock.go:25,41` —
  `InsecureSkipVerify: true`): o arquivo inteiro tem
  `//go:build msteamsMock` (linha 4) — só compila com essa build tag
  explícita. O build de produção (sem a tag, `!msteamsMock`) usa
  `client_nomock.go`, que chama `http.DefaultClient`/
  `khttp.GetDefaultClient` sem nenhum bypass de TLS. O client
  inseguro aponta pra `mockserver:1080` (endpoint de teste local) —
  infraestrutura de mock, nunca alcança produção. Falso positivo.

Todos os 4 refutados como `false_positive` com reasoning individual e
`filesRead` salvos em cada finding (cadeia de chamada completa
rastreada em cada caso: call sites reais, build tags, constante vs.
input externo).

Leitura profunda proativa: 3 arquivos ainda não lidos em
`mattermost-plugin-msteams` (repo já tocado por achados de fila nesta
mesma rodada, mas nunca por sweep proativo), priorizados por
crypto/auth no caminho — `server/store/sqlstore/crypt.go` (AES-256-GCM
para criptografar token armazenado — nonce aleatório por chamada,
chave de 32 bytes com alta entropia via `crypto/rand`, sem achado),
`server/connect.go` (lógica de convite/allowlist de conexão MS
Teams↔Mattermost, sem achado) e `server/credentials.go` (job interno
de monitoramento de credencial do Azure App, sem input externo, sem
achado). `deep-read-log.json` atualizado (+1 repo, 3 entradas).

Achado `mattermost-plugin-gitlab` (webhook timing) segue em
`reproduced_local`: `check-scope` conferido novamente ao vivo, ainda
recusa (`allowed:false`, "nenhum scope snapshot existe para este
programa") — gap de infraestrutura conhecido, não é novidade desta
rodada, não forçado.

Nenhum achado novo digno de relatório nesta rodada (os 4 da fila
refutados, os 3 do sweep proativo sem achado) — resultado normal e
válido. `export-queue` rodado ao final da rodada.

## Rodada 2026-09-05 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`program-policy.json` conferido como passo zero — `Block Open Source`,
`Circle BBP` e `Auth0 by Okta` confirmados bloqueados, nenhum tocado.
`list-pending` global = 34, 100% fora do escopo desta missão (30 Auth0
by Okta, 4 Circle BBP), skip completo, nenhum arquivo desses dois
programas lido.

Leitura profunda proativa (delegada a subagente) direcionada a
`mattermost-plugin-zoom` (repo do log já tocado por achados de fila em
rodada anterior, mas nunca por sweep proativo de arquivo completo).
4 arquivos novos lidos: `server/webhook.go`, `server/zoom/webhook.go`,
`server/http.go`, `server/configuration.go`.

Achado novo: `verifyZoomWebhookSignature` (`server/webhook.go:589`)
compara a assinatura HMAC-SHA256 do webhook do Zoom com
`computedSignature != providedSignature` (comparação de string comum)
em vez de `hmac.Equal`/`subtle.ConstantTimeCompare` — mesma classe
CWE-208 já confirmada 2x nesta sessão (kubeadm `DetachedTokenIsValid`,
e o irmão direto `mattermost-plugin-gitlab::handleWebhook`). Diferença
importante que reduz a severidade bem abaixo do irmão gitlab: a rota
`/webhook` exige primeiro passar por `verifyMattermostWebhookSecret`
(comparação segura, `subtle.ConstantTimeCompare`, sobre um segredo
`WebhookSecret` obrigatório e não-vazio) — só depois desse gate seguro
é que o código chega na comparação insegura de um segundo segredo
independente (`ZoomWebhookSecret`). Ao contrário do caso gitlab (onde
a comparação vulnerável era o único gate), aqui um atacante precisaria
já conhecer o `WebhookSecret` só pra alcançar o oráculo de timing do
Zoom — superfície de ataque prática muito reduzida. Rastreei também o
impacto teórico (spoofing de eventos Zoom → posts falsos; download de
arquivo de gravação via `downloadZoomFile`, mas `isZoomDownloadURL` já
restringe corretamente o host, sem SSRF aberto). Severidade estimada
baixa/informativa. Registrado, `filesRead` completo salvo, avançado
para `corroborated_static` (aceito pelo CLI). `check-scope` rodado ao
vivo: recusa (`allowed:false`, "nenhum scope snapshot existe para este
programa") — mesmo gap de infraestrutura já documentado para o achado
gitlab, não forçado. Tipo `non_constant_time_hmac_comparison` não é
Solidity, então não há validador de PoC disponível no sistema hoje —
limitação real, `corroborated_static` é o teto possível nesta rodada,
consistente com a regra do pipeline.

Um registro duplicado por erro de digitação no path (criado a meio da
investigação, faltando o prefixo `mattermost/`) foi identificado e
transicionado para `false_positive` com nota explicando o erro e
apontando para o id correto — mantém o histórico limpo sem inventar
um "achado" onde só havia um typo.

`deep-read-log.json` atualizado (+4 entradas em
`mattermost/mattermost-plugin-zoom`). Clones temporários removidos.
`export-queue` rodado ao final da rodada.

## Rodada 2026-09-06 (cloud, disparada por push)
Revisão do achado `corroborated_static`
(`mattermost-plugin-zoom::verifyZoomWebhookSignature`) — nada mudou
desde a última rodada (check-scope já negativo por falta de
scope-snapshot pra este programa, mesma limitação de infraestrutura já
documentada). Não tocado. Nenhum achado novo em Mattermost nesta
rodada. `export-queue` rodado ao final da rodada.

## Rodada 2026-09-06 (b) (cloud, disparada por push)

`list-pending` só trouxe candidatos em programas bloqueados (Auth0 by
Okta, Circle BBP) — nenhum tocado, consistente com `program-policy.json`.

Leitura profunda proativa em `mattermost/mattermost-plugin-jira` (ainda
não coberto por `deep-read-log.json` até esta rodada, apesar de já ter
achados antigos revisados em rodadas anteriores — os arquivos abaixo
nunca tinham sido lidos): `server/auth_token.go`,
`server/user_cloud_oauth.go`, `server/instance_cloud_oauth.go`.

- `auth_token.go`: `encrypt`/`decrypt` tem fallback `if len(secret) ==
  0 { return plain, nil }` (token ficaria em texto puro/base64 se o
  segredo de criptografia estivesse vazio). Rastreei até
  `EnsureAuthTokenEncryptSecret` em `kv.go` — sempre gera e persiste 32
  bytes aleatórios na primeira chamada (self-healing), então o "secret
  vazio" não é um caminho alcançável em operação normal, só em teoria
  se o KV store falhasse de um jeito que hoje não acontece. Sem
  achado.
- `user_cloud_oauth.go` (`httpOAuth2Complete`) + `instance_cloud_oauth.go`
  (`GetUserConnectURL`): o parâmetro `state` do callback OAuth do Jira
  Cloud é decomposto em `{secret}_{mattermostUserID}`, e o
  `mattermostUserID` embutido nele vem direto da URL (potencialmente
  controlável por quem constrói o redirect). Investiguei se isso
  permite login-CSRF (vincular a conta Jira de um atacante à conta
  Mattermost de outra pessoa) — mas o `state` completo é gerado como
  `model.NewId()[0:15] + "_" + mattermostUserID` no momento do
  `/jira connect` (autenticado), armazenado server-side via
  `StoreOneTimeSecret` com TTL de 15 min e apagado no primeiro uso, e
  `httpOAuth2Complete` exige que o segredo aleatório bata exatamente
  com o valor guardado pra aquele `mattermostUserID` — sem conhecer o
  segredo de 15 chars (alta entropia, de uso único), o atacante não
  consegue forjar o `state`. CSRF binding funciona como esperado. Notei
  também que o par PKCE (`CodeVerifier`/`CodeChallenge`) é gerado uma
  vez por instância Jira (não por fluxo/usuário) — mais fraco que PKCE
  por-requisição, mas o client já é confidencial (tem
  `JiraClientSecret`), então PKCE aqui é defesa em profundidade, não o
  mecanismo primário; não é um caminho de exploração isolado. Sem
  achado.

Nenhum achado novo nesta rodada — resultado válido e esperado.
`deep-read-log.json` atualizado (+3 entradas em
`mattermost/mattermost-plugin-jira`). Clones temporários removidos.
`export-queue` rodado ao final da rodada.

## Rodada 2026-09-06 #4 (rotina agendada)

`program-policy.json` conferido como passo zero via `check-program`:
`Auth0 by Okta` e `Circle BBP` seguem `blocked:true` — `list-pending`
global = 34, 100% nesses dois programas, skip completo sem tocar
nenhum arquivo deles.

Leitura profunda proativa em `mattermost/mattermost-plugin-calls`
(primeiro repo Mattermost tocado por sweep proativo nesta sessão — os
outros plugins Mattermost já cobertos são `-jira`/`-zoom`/`-github`/
`-gitlab`/`-msteams`; `-calls` nunca tinha entrada em
`deep-read-log.json`), clone raso público. Priorizei a superfície de
controles de host (mute/remove/make-host/end-call), por ser a
funcionalidade com maior potencial de bypass de autorização
(um participante comum agindo como host). 6 arquivos lidos:
`server/api.go`, `server/api_router.go`, `server/host_controls_api.go`,
`server/host_controls.go`, `server/session.go`, `server/websocket.go`.

- Hipótese investigada com ceticismo (e refutada): as rotas de host
  controls (`/calls/{call_id}/host/make|mute|screen-off|lower-hand|
  remove|mute-others|end`) extraem `call_id` da URL e passam esse
  valor posicionalmente pras funções `changeHost`/`muteSession`/
  `screenOff`/`lowerHand`/`hostRemoveSession`/`hostEnd`/`muteOthers`
  em `host_controls.go`, cujo parâmetro se chama `channelID` e é usado
  pra buscar o estado da call via `getCallState`/`lockCallReturnState`
  (ambas keyed por `channelID`, não por `Call.ID` — confirmado em
  `state.go`/`sync.go`). Como `Call.ID` e `Call.ChannelID` são campos
  distintos (`public/call.go`), a princípio isso pareceria uma
  confusão call-ID vs. channel-ID que quebraria (ou pior, cruzaria) a
  autorização entre calls. Rastreei o valor real enviado pelo webapp
  (`webapp/src/actions.ts` + `host_controls_menu.tsx` +
  `participant_cell.tsx`/`call_widget/component.tsx`) até a origem: em
  toda a cadeia, a prop/variável chamada `callID` é populada com
  `this.props.channel.id` — ou seja, apesar do nome enganoso em ambos
  os lados (rota Go `call_id`, prop TS `callID`), o valor que
  efetivamente trafega é sempre o **channel ID**, nunca o `Call.ID`
  real. Confirma-se com `slash_command.go:166`, que chama a mesma
  `changeHost(args.UserId, args.ChannelId, ...)` passando
  explicitamente `ChannelId`. Não há bug de autorização — é só uma
  escolha de nomenclatura confusa (mantida consistente em produção),
  não uma vulnerabilidade. Sem achado.
- `handleJoin` (`websocket.go:734`) — verificado o gate de permissão
  real antes de `addUserSession`: exige
  `HasPermissionToChannel(userID, channelID, PermissionCreatePost)`
  (ou ser o bot) antes de qualquer entrada em uma call, incluindo
  quando "If there is an ongoing call, we can let anyone join" (state.go
  comment) — esse comentário se refere a limites de licença/sysadmin-only
  pra *criar* uma call, não a pular a checagem de canal; a checagem de
  permissão de canal já aconteceu antes, incondicionalmente. Sem achado.
- `handleUploadLogsToBot` (`api.go`) — `req.ChannelID`/`req.TeamID` só
  validados como IDs bem-formados (`model.IsValidId`), sem checar
  associação do usuário a eles; usados só pra `SendEphemeralPost`
  (visível apenas ao próprio remetente) e pra montar um permalink
  textual — impacto no máximo de enumeração de nome de time via texto
  de erro, não elevação de privilégio nem leitura de dado alheio. Não
  atinge a barra de achado reportável.

Nenhum achado novo nesta rodada — resultado válido e esperado (uma
hipótese real de bypass de autorização foi levantada e ativamente
refutada rastreando a cadeia completa cliente→servidor, não apenas
descartada por inspeção superficial). `deep-read-log.json` atualizado
(`mattermost/mattermost-plugin-calls`, repo novo, 6 entradas). Clone
temporário removido. `export-queue` rodado ao final da rodada.

## Rodada 2026-09-07 (rotina agendada, gatilho push) — causa raiz real do bloqueio de `verify_scope` corrigida; PoC de timing tentada e honestamente refutada no achado zoom

`program-policy.json` conferido no passo 0: `Block Open Source` e
`Circle BBP` seguem bloqueados (`check-program`, nenhum repo desses
tocado). Nota lateral sobre um falso alarme desta mesma checagem:
`check-program "Mattermost Public Bug Bounty Engagement"` (sem o
espaço final) devolvia `blocked:true` por mismatch exato de nome contra
a chave real em `program-policy.json` (`"...Engagement "`, COM espaço
final) — não é um bloqueio real, é erro de digitação na consulta.
Confirmado com o espaço final: `blocked:false`, RoE já revisado
(03/09/2026), sem proibição de IA.

`research-plan` trouxe os 3 achados `corroborated_static` deste
programa (`-confluence::CompleteOAuth2`, `-msteams-meetings::
completeUserOAuth`, `-zoom::verifyZoomWebhookSignature`) como
`actionable`/`verify_scope`, mesmos 3 já documentados em rodadas
anteriores. Investigando por que nenhum avançava apesar de o snapshot
`mattermost-public-bug-bounty-engagement.json` já existir (rodada
anterior mencionava isso como resolvido) — **causa raiz real, dupla**:

1. **Bug em `capture-scope-snapshots.mjs`**: `fetchJson` enviava o
   `GITHUB_TOKEN` desta sessão cloud (escopado só a
   `genezera/zerotoone` pela integração GitHub) como `Authorization:
   Bearer` para `raw.githubusercontent.com/arkadiyt/bounty-targets-data`
   -- um repositório de TERCEIRO alheio ao escopo do token. GitHub
   responde 404 em vez de servir o arquivo raw público anonimamente
   quando um token sem acesso àquele repo é enviado (confirmado ao
   vivo: `curl` sem headers funcionava, o script com `githubHeaders()`
   falhava). Corrigido: fetch agora deliberadamente anônimo (comentário
   explicando o motivo deixado no arquivo) -- isso bloqueava a
   regeneração de QUALQUER snapshot nesta sessão específica, não só
   Mattermost.
2. **`asset`/`file` destes 3 findings guardavam o CAMINHO COMPLETO
   (`owner/repo/caminho/arquivo.go`) em vez de só `owner/repo`** --
   quebra silenciosamente `assetRefForFinding`/`repositoryFromFindingId`
   (que dependem do sufixo do path bater com uma fração do `id` pra
   inferir o repo; aqui path completo == sufixo completo, a checagem
   `location === suffix` sempre descarta e cai no fallback errado que
   devolve o path inteiro). Corrigido registrando `repository` explícito
   em cada um dos 3 findings (`update-finding`).
3. **Efeito colateral notado e documentado, não uma correção nova**:
   `research-plan`/`list-pending` rodam `migrateAll` a partir de
   `queue.jsonl` ANTES de calcular o plano -- uma correção feita só no
   banco local (`update-finding`) sem `export-queue` antes da próxima
   chamada de `research-plan` é revertida silenciosamente (mesmo
   comportamento "upsert aditivo" já documentado em NOTES anteriores,
   mas aqui reescreve campos já existentes de um finding já existente,
   não só preserva achados novos). Lição operacional: sempre
   `export-queue` logo depois de um `update-finding` que precisa
   sobreviver à próxima leitura de `research-plan`/`list-pending` na
   mesma rodada.

Com os 2 bugs reais corrigidos, criado o bloco Mattermost em
`capture-scope-snapshots.mjs` (padrão idêntico a Block Open
Source/Auth0: Bugcrowd, `confidence=low`, sem flags de elegibilidade de
recompensa por ativo) e rodado -- `check-scope` agora confirma
`allowed=true` pros 3 repositórios (`mattermost-plugin-confluence`,
`-msteams-meetings`, `-zoom`), todos listados como alvo real no
engagement (`Mattermost Confluence Plugin`, `Mattermost Plugin for
Microsoft Teams Meetings`, `Mattermost Zoom Plugin`). `bountyEligible`
continua `null` -- Bugcrowd não expõe elegibilidade por ativo no
dataset público (mesma limitação de Block Open Source/Auth0);
`research-plan` corretamente continua pedindo `verify_scope` por esse
motivo específico agora ("esta fonte não informa elegibilidade de
recompensa"), não mais por falta de snapshot -- confirmação manual na
página oficial fica pendente pra antes de qualquer `human_ready`, não
presumida.

**Tentativa de PoC real no achado zoom** (`verifyZoomWebhookSignature`,
não tentada em rodada anterior por decisão explícita de "ceticismo
honesto"): já que o achado-irmão `mattermost-plugin-gitlab::
handleWebhook` tinha avançado a `reproduced_local` com um benchmark de
timing estatisticamente conclusivo, tentei o mesmo aqui pra não deixar
a decisão de pular baseada só em suposição. Clone raso público +
`server/manifest.go` stub local (arquivo gerado por `build/bin/manifest
apply` normalmente, `.gitignore`, não disponível em clone raso sem o
submódulo de build) pra permitir compilar o pacote de teste. Escrito
`zzrepro_timing_test.go` chamando `verifyZoomWebhookSignature` de
produção via `Plugin`/`configuration` reais (mesmo padrão dos testes
oficiais do próprio repo), 10 trials x 300000 iters, comparando
`providedSignature` com erro no 1º char pós-prefixo vs erro só no
último char. **Resultado: SEM sinal estatístico** (Welch |t|=0.095,
limiar 2.5) **e na direção errada** -- overhead de
`json.Unmarshal`+parse de timestamp+HMAC-SHA256 (~11400ns/call) domina
qualquer diferença de poucos ns da comparação de string em si. Um
segundo teste de controle, isolando só a comparação `!=` pura sem
overhead ao redor, também não confirmou sinal na direção esperada
(dominado por otimização do compilador Go sobre operandos constantes em
loop apertado). `record-validation` registrado com `result=fail`
(honesto, não simulado) -- **não avança a `reproduced_local`**,
diferente do irmão gitlab onde o mesmo tipo de teste teve sinal
estatisticamente claro (p=0.000). Reforça a conclusão já registrada em
rodada anterior de severidade BAIXA/Informativa para este achado
específico (dupla camada de segredo + agora também falta de confirmação
empírica do timing leak).

Os 2 achados de CSRF de account-linking (`confluence`,
`msteams-meetings`) permanecem em `corroborated_static`: nenhum
validador de PoC local existe pra essa classe de bug (exigiria servidor
Mattermost real rodando com o plugin instalado, infraestrutura que este
pipeline não tem) -- reasoning atualizado em cada um documentando a
correção de escopo, não forçado além disso.

Clones temporários (`mattermost-plugin-zoom`) removidos ao final.
`deep-read-log.json` não alterado nesta rodada (trabalho foi 100% sobre
achados de fila existentes, não leitura profunda proativa nova).
`export-queue` rodado ao final da rodada.

---

## Rodada 07/09/2026 (research-plan / verify_scope + leitura profunda proativa)

`cli.mjs research-plan` apontou os 3 achados corroborated_static deste
programa (`confluence`, `msteams-meetings`, `zoom`) como os únicos 3
itens `actionable` do banco inteiro (ação `verify_scope`). Antes de
tocar em qualquer coisa, `check-program "Mattermost Public Bug Bounty
Engagement "` (nome exato, com o espaço à direita que a chave usa em
`program-policy.json`) -- confirmado `blocked:false`, roeReviewed,
liberado. (Nota: rodar sem o espaço à direita bate no default seguro
"bloqueado" por não achar a chave exata -- corrigido a query, não a
suposição.)

`check-scope` ao vivo pros 3 repositórios confirma de novo
`allowed:true`, `bountyEligible:null` -- mesmo estado documentado na
rodada anterior, nada mudou na fonte pública. Tentativa de
`corroborated_static->reproduced_local` recusada corretamente pela
máquina de estados pros 3 (nenhum validador de PoC local existe pra
CSRF de OAuth account-linking nem pro timing HMAC sem infraestrutura
Mattermost real) -- registrado `record-validation type=manual_review
result=not_applicable` em cada um pra documentar isso formalmente (não
existia esse registro ainda, só a prosa no reasoning). Reasoning de
cada achado atualizado com a confirmação desta rodada. Nenhuma
transição de estado avançou -- resultado esperado, não forçado.

**Bug de infraestrutura real encontrado e corrigido nesta rodada**:
`list-deep-read-candidates.mjs` (passo 4, leitura profunda proativa)
falhava com `SyntaxError` ao buscar os datasets HackerOne/Bugcrowd --
mesma causa raiz já corrigida pontualmente em
`capture-scope-snapshots.mjs` (ver rodada anterior acima), mas o
conserto não tinha sido generalizado: `github-auth.mjs::githubHeaders()`
manda `Authorization: Bearer <GITHUB_TOKEN>` em toda chamada, e nesta
sessão cloud esse token é escopado só a `genezera/zerotoone` -- qualquer
leitura de repositório de terceiro (100% do que este projeto lê) volta
404 em vez do conteúdo público. Confirmado com `curl` direto contra
`raw.githubusercontent.com/arkadiyt/bounty-targets-data`: 404 com o
header, 200 sem ele, mesma URL. Adicionado `githubFetch()` em
`github-auth.mjs` (tenta autenticado, refaz sem `Authorization` só se
vier 404) e migrados os 6 pontos de rede que usavam `githubHeaders()`
diretamente (`fetch-repo.mjs`, `discover-targets.mjs`, `code-age.mjs`,
`cve-digest.mjs`, `change-monitor.mjs`,
`list-deep-read-candidates.mjs`) -- preserva o ganho de rate-limit em
ambiente local (token com acesso público real nunca bate 404, nunca
refaz a chamada) e conserta o ambiente cloud sem precisar detectar qual
ambiente é. 3 testes novos em `github-auth.test.mjs` cobrindo o
fallback; suíte completa dos 7 arquivos afetados rodada (92/92 pass).
Confirmado ao vivo: `list-deep-read-candidates.mjs` agora lista os
candidatos normalmente.

Com a ferramenta destravada, leitura profunda proativa (passo 4) nos 3
arquivos ainda não lidos de `mattermost-plugin-calls` com maior
prioridade de auth/token no nome dentre os candidatos seguros do
momento: `server/recording_api.go`, `server/transcription_api.go`,
`server/rtcd.go`. Nenhum achado: `handleRecordingAction` faz o gate
correto (`HasPermissionToChannel` + `state.Call.GetHostID()==userID`,
`Mattermost-User-Id` vindo do header setado pelo core, não spoofável)
antes de start/stop de gravação; `transcription_api.go` não tem handler
HTTP próprio, só é acionado a partir do path já gateado; `rtcd.go` usa
`AuthKey` gerado via `crypto/rand` (`random.NewSecureString(32)`) pra
credencial servidor-a-serviço própria do admin, não alcançável por
usuário final da chamada -- nenhuma comparação insegura de string
encontrada nos 3. `deep-read-log.json` atualizado com os 3 arquivos e o
motivo de "sem achado" de cada um.

**Repeti o mesmo erro operacional já documentado na rodada anterior**
(ver "Lição operacional" logo acima): rodei `list-pending
--include-held` e (indiretamente, via `list-deep-read-candidates.mjs`,
que chama `migrateAll` no próprio `main()`) `migrateAll` DEPOIS dos 3
`update-finding`/`record-validation` originais desta rodada, sem
`export-queue` entre eles -- `list-pending`/`research-plan` sempre
rodam `migrateAll` primeiro (`cli.mjs` linha ~797), que reimporta a
tabela `findings` inteira a partir do `queue.jsonl` ainda não exportado,
descartando qualquer `reasoning`/`state` só-em-DB. `validationsHistory`
sobreviveu porque `record-validation` grava numa tabela `validations`
separada, nunca tocada por `migrateAll` -- só o `reasoning` (coluna da
tabela `findings`) se perdeu, silenciosamente, sem erro nenhum pra
avisar. Percebido só ao conferir o `queue.jsonl` exportado contra
`cli.mjs get` ao vivo antes do commit. Refeitos os 3 `update-finding`
(mesmo texto) e `export-queue` de novo, desta vez sem nenhum
`list-pending`/`research-plan` no meio -- confirmado via `get` que os
3 ficaram com o reasoning certo antes do export final. Regra prática
pra próxima rodada: depois do último `update-finding`/`transition` que
precisa sobreviver, não rodar mais `list-pending`/`research-plan` (nem
`list-deep-read-candidates.mjs`, que também chama `migrateAll`) até
depois do `export-queue` -- ou, se precisar rodar mesmo assim,
`export-queue` ANTES de qualquer um desses três.

`export-queue` rodado ao final da rodada.

## Rodada 07/09/2026 #2 (push automático via GitHub webhook, rotina agendada)

`program-policy.json`/`check-program "Mattermost Public Bug Bounty
Engagement "` (nome exato, com espaço final) conferidos no passo 0:
`blocked:false`, RoE já revisado. `migrate-to-v2.mjs` + `research-plan`
trouxeram os mesmos 3 achados `corroborated_static` (`-confluence`,
`-msteams-meetings`, `-zoom`) como únicos `actionable`/`verify_scope` do
banco inteiro — conferido via `cli.mjs get` em cada um: já totalmente
processados na rodada anterior, que é o próprio commit que disparou esta
sessão (`3ca14cb`, ~10min antes deste run). `check-scope`/deployment
evidence/`record-validation type=manual_review` já registrados, nada de
novo a fazer nos 3 sem confirmação manual externa de `bountyEligible` (fora
do alcance deste pipeline). Não retocado, para não duplicar trabalho já
feito e commitado.

`list-pending` (sem `--include-held`) = 0 — os 34 `candidate` restantes no
banco são 100% `Auth0 by Okta`/`Circle BBP` bloqueados, held corretamente.

Leitura profunda proativa desta rodada foi direcionada a `slackhq/nebula`
(programa Slack) em vez de um novo plugin Mattermost, já que todos os
plugins Mattermost com superfície OAuth/webhook/HMAC conhecida já foram
lidos exaustivamente em rodadas anteriores sem achado adicional pendente
de investigação óbvia — ver `slack/NOTES.md` desta mesma data para o
detalhe dos 3 arquivos lidos (`firewall.go`/`pki.go`/`outside.go`, sem
achado).

`export-queue` rodado ao final da rodada (sem mudança de estado nesta
rodada em Mattermost).

## Rodada 07/09/2026 #3 (push automático via GitHub webhook, rotina agendada)

`program-policy.json` conferido no passo 0: `Mattermost Public Bug Bounty
Engagement ` segue `blocked:false`, RoE já revisado. `migrate-to-v2.mjs` +
`research-plan` trouxeram de novo os mesmos 3 `corroborated_static`
(`-confluence`, `-msteams-meetings`, `-zoom`) como únicos
`actionable`/`verify_scope`. Tentei fechar a lacuna real (`bountyEligible`
`null` no scope-snapshot do dataset comunitário Bugcrowd) via `WebFetch`
direto na página oficial `https://bugcrowd.com/engagements/mattermost-mbb-public`
— bloqueado pelo proxy de egress desta sessão cloud (`EGRESS_BLOCKED:
bugcrowd.com`). Confirma que a confirmação manual de elegibilidade
mencionada no `reasoning` dos 3 achados só é possível de uma sessão com
acesso de navegador real (a mesma que gerou `reviewMethod:
official_program_page_full_browser_read` em `program-policy.json`), não
desta sessão cloud sandboxed — não é um problema no achado, é limitação de
ambiente já esperada. Nenhum dos 3 tocado além disso (nada novo pra
registrar).

Leitura profunda proativa: a nota da rodada #2 dizia que "todos os plugins
Mattermost com superfície OAuth/webhook/HMAC conhecida já foram lidos
exaustivamente" — na prática ainda faltava `server/oauth.go` (broker de
eventos) e o handler completo `connectUserToGitlab`/`completeConnectUserToGitlab`
em `server/api.go` do **mattermost-plugin-gitlab**, que não estavam no
`deep-read-log.json`. Lidos agora: confirma o mesmo padrão CORRETO de
vinculação OAuth já visto em `jira` (state = `<random>_<userID>`, e
`completeConnectUserToGitlab` compara explicitamente o `userID` embutido
no state contra `Mattermost-User-ID` da requisição de completion antes de
aceitar — linha 344, `if userID != authedUserID`) — ao contrário do bug já
confirmado em `confluence`/`msteams-meetings`. **Sem achado.**

Também lido `mattermost-plugin-jira/server/webhook_http.go`
(`verifyHTTPSecret`): comparação do secret via `subtle.ConstantTimeCompare`
corretamente constant-time; o loop de `url.QueryUnescape` é só pra lidar
com secrets duplo-codificados na query string e não introduz side-channel
(a comparação `unescaped==got` só decide quando parar de desescapar, nunca
compara contra o segredo). `EnableWebhookEventLogging` (opt-in, config do
próprio admin) loga a request crua com o secret quando ligado — não é
explorável por terceiro. **Sem achado** — jira confirmado como referência
também pra verificação de webhook secret, não só account-linking OAuth.

`export-queue` rodado ao final da rodada.

## Rodada 2026-09-07 #4 (rotina agendada, gatilho push)

`program-policy.json`/`check-program` conferidos no passo 0: segue
`blocked:false`. Os mesmos 3 `corroborated_static` (`-confluence`,
`-msteams-meetings`, `-zoom`) continuam como únicos `actionable`/
`verify_scope` — já totalmente processados nas rodadas anteriores desta
mesma data (`check-scope` ao vivo, `deploymentEvidence`, `record-validation
type=manual_review`); nada novo a registrar sem confirmação manual externa
de `bountyEligible` (bloqueada nesta sessão cloud por egress a
bugcrowd.com, mesma limitação já documentada na rodada #3). Não retocado
para não duplicar trabalho já commitado.

Leitura profunda proativa desta rodada foi direcionada a `okx/go-wallet-sdk`
(programa OKG) em vez de um novo plugin Mattermost — ver `okg/NOTES.md`
desta mesma data para o 8º irmão da família panic/DoS encontrado lá.

`export-queue` rodado ao final da rodada (sem mudança de estado nesta
rodada em Mattermost).

## Rodada 2026-09-07 #5 (rotina agendada, gatilho push)

`program-policy.json`/`check-program "Mattermost Public Bug Bounty
Engagement "` (nome exato, espaço final) conferidos no passo 0:
`blocked:false`. `migrate-to-v2.mjs` + `research-plan` trouxeram de novo os
mesmos 3 `corroborated_static` (`-confluence`, `-msteams-meetings`, `-zoom`)
como únicos `actionable`/`verify_scope` do banco inteiro — conferidos via
`cli.mjs get` em cada um: reasoning/`check-scope`/deployment evidence/
`record-validation type=manual_review` já registrados em rodadas anteriores
desta mesma data, nada novo a fazer sem confirmação manual externa de
`bountyEligible` (bloqueada nesta sessão cloud por egress a bugcrowd.com,
mesma limitação já documentada nas rodadas #3/#4). Não retocado, pra não
duplicar trabalho já commitado.

`list-pending` (sem `--include-held`) = 0.

Leitura profunda proativa desta rodada foi direcionada a `slackhq/nebula`
(programa Slack) em vez de um novo plugin Mattermost — ver `slack/NOTES.md`
desta mesma data (3 arquivos novos: `cmd/nebula-cert/passwords.go`,
`handshake_manager.go`, `sshd/session.go`, sem achado confirmado).

`export-queue` rodado ao final da rodada (sem mudança de estado nesta
rodada em Mattermost).

## Rodada 2026-09-07 #6 (rotina agendada, gatilho push do próprio bot scanner)

`program-policy.json`/`check-program` conferidos no passo 0: segue
`blocked:false`. `research-plan` trouxe de novo os mesmos 3
`corroborated_static` (`-confluence`, `-msteams-meetings`, `-zoom`) como
únicos `actionable`/`verify_scope` — já constatado que foram processados ao
máximo possível em rodadas anteriores desta mesma data; `bountyEligible`
continua exigindo confirmação manual na página oficial do Bugcrowd,
inacessível a esta sessão cloud (egress bloqueado, mesma limitação já
documentada). Não retocados de novo.

Leitura profunda proativa via `list-deep-read-candidates.mjs` (confirma
exclusão correta de Circle BBP e Auth0 by Okta pela política). Escolhido
`mattermost-plugin-mscalendar` (restavam `msgraph/get_super_user_token.go`,
`calendar/store/oauth2_store.go`, `calendar/utils/bot/admin.go`,
`calendar/api/get_authorized.go`). Verificação prioritária: a cadeia
completa de account-linking OAuth2 (`oauth2_connect.go` →
`engine/oauth2.go::InitOAuth2`/`CompleteOAuth2` → `store/oauth2_store.go`)
usa `state = "<15 chars aleatórios de model.NewId()>_<mattermostUserID>"`,
e `CompleteOAuth2` explicitamente extrai o `mattermostUserID` do state e
compara contra `authedUserID` do header da requisição de completion antes
de aceitar (`engine/oauth2.go`, `if mattermostUserID != authedUserID {
return errors.New(...) }`) — mesmo padrão CORRETO já confirmado em `jira`
e `gitlab`, ao contrário do bug confirmado em `confluence` (falta
comparação de userID) e `msteams-meetings` (state sem componente
aleatório, 100% forjável). **Sem achado** — mscalendar confirmado como
mais uma implementação de referência correta nesta família de plugins.
`GetSuperuserToken`, `IsUserAdmin` e o stub `getAuthorized` também sem
achado (sem input de usuário não confiável alcançando lógica sensível).
`deep-read-log.json` atualizado.

`export-queue` rodado ao final da rodada (sem mudança de estado nesta
rodada em Mattermost).

## Rodada 2026-09-07 #7 (rotina agendada, gatilho push)

`program-policy.json`/`check-program "Mattermost Public Bug Bounty
Engagement "` conferidos no passo 0: `blocked:false`. `migrate-to-v2.mjs` +
`research-plan` trouxeram de novo os mesmos 3 `corroborated_static`
(`-confluence`, `-msteams-meetings`, `-zoom`) como únicos `actionable`/
`verify_scope` do banco inteiro — `cli.mjs get` em cada um confirma que
reasoning/`check-scope`/deployment evidence/`record-validation
type=manual_review` já foram registrados nas rodadas #3/#4/#5/#6 desta
mesma data, sem nenhuma informação nova (mesma limitação de
`bountyEligible` manual pendente, fora do alcance desta sessão cloud). Não
retocado, pra não duplicar trabalho já commitado. `list-pending` (sem
`--include-held`) = 0.

Leitura profunda proativa desta rodada (independente da rodada #6, que
cobriu `mattermost-plugin-mscalendar`) foi direcionada a
`mattermost/mattermost-plugin-calls` (9→13 arquivos lidos): `server/bot_api.go`,
`server/job_service.go`, `server/activate.go` (mais uma releitura confirmatória
de `server/api_router.go`, já lido antes). Motivação: `bot_api.go` expõe
handlers `handleBot*` (postar recording/transcription, criar/enviar upload,
atualizar status de job) que, à primeira vista, pareciam não ter checagem de
autorização própria dentro do arquivo — hipótese de que um usuário comum
pudesse forjar posts de recording/transcription ou status de job em
qualquer chamada. Refutado ao ler `api_router.go`: todo o `botRouter` está
sob middleware que exige `isBotSession(r)` (compara `Mattermost-User-Id` —
header reescrito pelo core do Mattermost após validar sessão, não
spoofável pelo cliente — contra o ID do bot `calls`) + `licenseChecker.
RecordingsAllowed()` antes de qualquer handler; `handleBotUploadData`
também confere `us.UserId==p.getBotID()`. Gate correto, sem achado.

Investigação seguiu a cadeia até `job_service.go`/`activate.go` por
curiosidade sobre o `authToken` repassado ao job de recording/transcribing
offloaded (`RunJob`): é um Mattermost session token do próprio bot `calls`
(`createJobSession`, `ExpiresAt=now+jobSessionTTL`, TTL = 2× duração máxima
de gravação), usado pelo container externo (recorder/transcriber) para se
autenticar de volta contra os endpoints `/bot/*` já gateados. Isso é o
padrão de credencial esperado pela própria arquitetura `calls-offloader`
(o job processando fora do processo do plugin precisa se autenticar como o
bot para postar o resultado) — não é uma falha de código introduzida neste
repositório, e o escopo dessa credencial já é limitado às permissões do
bot `calls` (não admin), controladas pelo próprio Mattermost. Registrado
como observação de arquitetura no `deep-read-log.json`, não como achado
reportável (comprometer o container offloaded dá acesso a essa sessão pela
duração do TTL, mas isso é inerente ao modelo de offloading documentado do
produto, não uma falha exclusiva deste plugin).

`deep-read-log.json` atualizado. `export-queue` rodado ao final da rodada
(sem mudança de estado nesta rodada em Mattermost).

## Rodada 2026-09-07 #8 (rotina agendada, gatilho push)

`program-policy.json`/`check-program "Mattermost Public Bug Bounty
Engagement "` conferidos no passo 0: `blocked:false`. `migrate-to-v2.mjs` +
`research-plan` trouxeram de novo os mesmos 3 `corroborated_static`
(`-confluence`, `-msteams-meetings`, `-zoom`) como único `actionable`/
`verify_scope` do banco inteiro (8ª vez consecutiva na mesma data) —
`cli.mjs get` em cada um confirma reasoning/`check-scope`/deployment
evidence/`record-validation type=manual_review` já registrados em rodadas
anteriores, sem nenhuma informação nova (mesma limitação de
`bountyEligible` manual pendente, fora do alcance desta sessão cloud). Não
retocado. `list-pending` (sem `--include-held`) = 0.

Leitura profunda proativa direcionada a `mattermost/mattermost-plugin-calls`
(12→15 arquivos lidos), priorizando por contagem de palavras-chave
auth/permission/token/secret/admin nos arquivos ainda não lidos:
`server/limits.go` (`handleCloudNotifyAdmins`/aviso de sessões
concorrentes — userID sempre do header `Mattermost-User-Id`, não
spoofável; sem escalação de privilégio, só notifica os próprios admins do
servidor), `server/state.go` (gerenciamento de estado da call, populado só
a partir do DB depois de handlers já gateados; `getHostID` deriva host por
ordem de entrada/lock, sem input de rede direto) e uma leitura dirigida
(grep) de `server/configuration.go` em busca de auth/token/secret/admin —
achou `TURNStaticAuthSecret` alimentando `rtc.GenTURNConfigs`, mas essa
função geradora de credenciais TURN vive no pacote externo
`github.com/mattermost/rtcd`, fora deste repositório e fora da lista de
candidatos vetada por `list-deep-read-candidates.mjs` nesta rodada — não
investigado (precisaria de `check-program`/policy check próprio antes de
tratar `rtcd` como alvo em rodada futura, conforme regra do CLAUDE.md de
checar a política antes de escolher qualquer repositório, inclusive por
iniciativa própria). **Sem achado** nos três itens revisados nesta rodada.

`deep-read-log.json` atualizado. `export-queue` rodado ao final da rodada
(sem mudança de estado nesta rodada em Mattermost).

**Correção honesta sobre `deep-read-log.json` na rodada #6 (mais cedo,
nesta mesma data)**: o texto da rodada #6 acima diz "`deep-read-log.json`
atualizado", o que é verdade só localmente naquela sessão -- na tentativa
de persistir essa atualização no repositório remoto (via
`create_or_update_file`, já que `git push` direto por HTTPS retorna 403
nesta sessão cloud e o branch `master` remoto tinha avançado por sessões
paralelas, exigindo reconciliar via conteúdo em vez de `git push` bruto),
o tamanho do arquivo (~220KB) exigiria reconstruir manualmente o conteúdo
inteiro em ~13 blocos grandes na chamada da ferramenta -- risco real de
erro de transcrição corrompendo um JSON usado por todo o pipeline, por um
ganho pequeno (só evita reler 4 arquivos já zerados de achado numa rodada
futura). Decisão: não empurrar essa atualização específica pro remoto:
mais vale esta nota em prosa aqui (que qualquer rodada futura lê antes de
escolher alvo) do que arriscar corromper `deep-read-log.json` pra todo o
projeto. Efeito prático conhecido e aceito: uma rodada futura pode reler
`msgraph/get_super_user_token.go`, `calendar/store/oauth2_store.go`,
`calendar/utils/bot/admin.go` e `calendar/api/get_authorized.go` de
`mattermost-plugin-mscalendar` sem saber que já foram lidos sem achado --
custo baixo, sem risco de correção, já documentado aqui por extenso.

## Rodada 2026-09-07 #9 (rotina agendada, gatilho push)

`program-policy.json`/`check-program "Mattermost Public Bug Bounty
Engagement "` (nome exato, espaço final) conferidos no passo 0:
`blocked:false`, RoE já revisado. `migrate-to-v2.mjs` + `research-plan`
trouxeram de novo os mesmos 3 `corroborated_static` (`-confluence`,
`-msteams-meetings`, `-zoom`) como únicos `actionable`/`verify_scope` do
banco inteiro (9ª vez consecutiva na mesma data) — conferido via
`cli.mjs get` no achado `-confluence`: reasoning/`check-scope`/
deployment evidence/`record-validation type=manual_review` já
registrados em rodadas anteriores desta mesma data, sem nenhuma
informação nova a acrescentar sem confirmação manual externa de
`bountyEligible` na página oficial do Bugcrowd (fora do alcance desta
sessão cloud, mesma limitação de egress já documentada nas rodadas
#3-#8). Não retocado, para não duplicar trabalho já commitado.

`list-pending` (sem `--include-held`) = 0 — os 34 `candidate` restantes
no banco seguem 100% em `Auth0 by Okta`/`Circle BBP` bloqueados, held
corretamente.

Leitura profunda proativa desta rodada foi direcionada a
`okx/go-wallet-sdk` (programa OKG) em vez de mais um plugin Mattermost —
ver `okg/NOTES.md` desta mesma data (rodada #3: 3 arquivos novos,
`avax`/`harmony`/`nostrassets`, hipótese de 9º irmão da família
panic/DoS investigada e refutada com evidência de código-fonte de
terceiro, sem achado).

`export-queue` rodado ao final da rodada (sem mudança de estado nesta
rodada em Mattermost).

## Rodada 2026-09-07 #10 (rotina agendada, gatilho push)

`program-policy.json`/`check-program "Mattermost Public Bug Bounty
Engagement "` conferidos no passo 0: `blocked:false`. `migrate-to-v2.mjs`
+ `research-plan` trouxeram de novo os mesmos 3 `corroborated_static`
(`-confluence`, `-msteams-meetings`, `-zoom`) como únicos
`actionable`/`verify_scope` do banco inteiro (10ª vez consecutiva na
mesma data) — `cli.mjs get` em `-confluence` reconfirma que
reasoning/`check-scope`/deployment evidence/`record-validation
type=manual_review` já foram registrados em rodadas anteriores, sem
nenhuma informação nova a acrescentar: o único passo que falta
(confirmar `bountyEligible` na página oficial do Bugcrowd) exige
navegação/login humano que esta sessão automatizada não tem meios de
fazer, não é uma tarefa que uma 11ª tentativa idêntica resolveria. Não
retocado, para não duplicar trabalho já commitado. `list-pending` (sem
`--include-held`) = 0.

Leitura profunda proativa direcionada a `mattermost/mattermost-plugin-github`
(4→6 arquivos lidos, escolhido por ter só 4 arquivos no log entre os
candidatos permitidos por `list-deep-read-candidates.mjs`):

- `server/plugin/command.go` — `handleSubscribesAdd`/`Subscribe`/
  `SubscribeOrg`: a hipótese investigada foi se um usuário qualquer
  poderia inscrever um canal público em um repositório GitHub PRIVADO
  ao qual não tem acesso, vazando conteúdo desse repo pro canal
  (`info disclosure`). Refutado: `Subscribe` (`subscriptions.go:199`)
  só grava a subscription depois de `githubClient.Repositories.Get`/
  `Organizations.Get` retornar sucesso usando o `githubClient` do
  PRÓPRIO usuário que roda o comando (token OAuth dele, obtido em
  `/github connect`) — se o usuário não tem acesso de leitura ao
  repo/org via GitHub, a chamada falha (404) e a função retorna erro
  antes de `AddSubscription`. Quando o repo É privado e o usuário TEM
  acesso, o código ainda emite um aviso explícito no post de
  confirmação (`"Warning: You subscribed to a private repository.
  Anyone with access to this channel will be able to read the events
  getting posted here."`) — comportamento documentado e intencional,
  não uma falha. `isAuthorizedSysAdmin`/`ExecuteCommand`: ações de
  configuração (`setup`) checam `system_admin` via `user.Roles`; o
  slash command em si só é invocado pelo servidor Mattermost para um
  usuário que já é membro do canal onde digitou o comando (garantia do
  core, não do plugin). Sem achado.
- `server/plugin/configuration.go` — `setDefaults`/`sanitize`/
  `ClientConfiguration`: `EncryptionKey`/`WebhookSecret` gerados via
  `generateSecret()` (`crypto/rand`) quando vazios; `ClientConfiguration()`
  (único mapa de config exposto ao JS do navegador via API) inclui
  apenas `left_sidebar_enabled`/`review_target_days`/
  `review_target_day_type` — nunca `GitHubOAuthClientSecret`/
  `WebhookSecret`/`EncryptionKey`. Sem vazamento de segredo pro
  frontend. Sem achado.

`deep-read-log.json` atualizado (edição programática via Python
`json.load`/`json.dump`, não reconstrução manual do arquivo inteiro —
evita o risco de corrupção por transcrição já documentado na rodada #6).

`export-queue` rodado ao final da rodada (sem mudança de estado nesta
rodada em Mattermost).
