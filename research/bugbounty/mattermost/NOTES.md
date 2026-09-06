# Mattermost Public Bug Bounty Engagement (Bugcrowd) — notas de pesquisa

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
