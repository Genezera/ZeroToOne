# Mattermost Public Bug Bounty Engagement (Bugcrowd) — notas de pesquisa

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
