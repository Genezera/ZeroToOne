# Kubernetes (HackerOne) — notas de pesquisa

## Rodada 2026-09-02 — saída deliberada do Circle BBP, achado real em cluster-bootstrap

Pivô explícito a pedido do usuário: depois de 4/4 relatórios em duplicata
(todos Circle BBP/Vercel Open Source), e depois de confirmar que a veia
"denylist/compliance no CCTP" da Circle está genuinamente esgotada
(4 chains independentes, mesmo padrão limpo), o pedido foi sair do
Circle BBP e buscar no universo completo de programas já conhecidos
por este pipeline, priorizando viabilidade e baixo risco de duplicata.

`targets-go.mjs` já tinha 12 alvos Kubernetes (via HackerOne)
auto-promovidos, mas **nenhum jamais tinha sido lido manualmente** —
só varredura heurística automatizada. Todos são repositórios satélite
(`apimachinery`, `cli-runtime`, `cloud-provider(-aws/-openstack)`,
`code-generator`, `component-base`, `cri-api`, `klog`,
`cluster-bootstrap`, `csi-translation-lib`, `gengo`), não o monorepo
`kubernetes/kubernetes` em si — sinal real de menor concorrência
(pesquisadores tendem a mirar o monorepo famoso, não as bibliotecas
satélite). Priorizei `cluster-bootstrap` (34★, só 7 arquivos de
código-fonte reais) por ser literalmente o mecanismo de autenticação
de bootstrap de novo nó — mesma categoria de bug (auth/credencial) de
onde os achados reais desta sessão já saíram antes.

### Achado: comparação não-constante de HMAC em `DetachedTokenIsValid`

`token/jws/jws.go::DetachedTokenIsValid` verifica a assinatura JWS
(HS256/HMAC-SHA256) de um bootstrap token comparando com `==` em vez
de `hmac.Equal`/`subtle.ConstantTimeCompare` — CWE-208, timing attack
clássico e bem documentado (a própria doc do `crypto/hmac` da stdlib
do Go existe pra evitar exatamente isso).

**Evidência que fortalece muito o achado**: no MESMO repositório,
`token/util/helpers.go::IsValidBootstrapToken` tem o comentário literal
"Avoid using BootstrapTokenRegexp.MatchString(token) and instead
perform constant-time comparisons on the secret", e `randBytes()`
(usado em `GenerateBootstrapToken`) comenta "Use simple operations in
constant-time to obtain a byte". Os próprios desenvolvedores do
Kubernetes já estabeleceram, documentado no código, que comparação em
tempo constante é o padrão esperado pra segredo de bootstrap token —
`DetachedTokenIsValid` quebra exatamente esse princípio já adotado em
outro lugar do mesmo pacote. Isso não é "talvez importe pra vocês", é
uma inconsistência real contra o próprio padrão que eles mesmos
fixaram.

Confirmado que **não é código morto**: usado de verdade em
`kubernetes/kubernetes::cmd/kubeadm/app/discovery/token/token.go`
(`validateClusterInfoToken`, ~linha 183). Rastreei o fluxo completo:
`kubeadm join` com bootstrap token conecta primeiro de forma insegura
(`InsecureSkipTLSVerify: true`) pra buscar a ConfigMap `cluster-info`,
que contém o `kubeconfig` real (com a CA do cluster) mais uma
assinatura JWS sobre esse conteúdo, assinada com HMAC derivado do
segredo do token (compartilhado fora de banda). `DetachedTokenIsValid`
é exatamente o que impede um atacante MITM (sem saber o segredo) de
forjar essa resposta insegura durante a janela de bootstrap.

**Duplicate-check**: zero GitHub Security Advisories relacionados
(`kubernetes/kubernetes` e `kubernetes/cluster-bootstrap`); busca de
issues/PRs por termos relacionados devolveu 46 resultados, nenhum
sobre isso — o mais próximo (#133143, remover `go-jose`) é sobre um
CVE de dependência em código de teste OIDC não relacionado.

**Escopo**: `kubernetes/cluster-bootstrap` confirmado como asset
elegível (`eligible_for_bounty: true`, `max_severity: critical`) no
dataset real — mas **nenhum dos 12 alvos Go de Kubernetes tinha
snapshot de escopo formal capturado antes** (achado real, bloqueava
`check-scope`). Adicionado bloco Kubernetes em
`capture-scope-snapshots.mjs` (confidence "medium", mesmo padrão de
Circle BBP/Vercel — página oficial HackerOne continua sendo SPA que
exige sessão autenticada), 2 testes novos, snapshot real capturado e
`check-scope` confirmado ao vivo: `allowed: true, bountyEligible: true`.

**Atualização mesma rodada — PoC de timing executado de verdade,
2x independentemente**: construído um benchmark Go isolado (réplica só
do primitivo de comparação, não chama go-jose nem a função real —
`E:/dev-toolchains/poc-repos/jws-timing-poc/timing_test.go`),
comparando `==` (vulnerável) vs `hmac.Equal` (fix sugerido), erro no
primeiro byte vs erro no último byte, `n=10` rodadas de 2.000.000
iterações via `testing.B` + `benchstat` (ferramenta oficial do time do
Go, não script caseiro). Rodado por mim e, de forma independente, pelo
usuário no próprio terminal PowerShell (depois de uma sessão real de
debugging: `-flag=.` quebra especificamente no PowerShell quando o
valor é só um ponto — `-bench Benchmark` funciona, `-bench=.` não;
nada a ver com o achado em si, documentado à parte na memória de
metodologia). Resultado, nas duas execuções, concordando
qualitativamente: `==` mostra diferença de tempo real e
estatisticamente conclusiva entre erro-cedo e erro-tarde (+86,73%
p=0,000 na minha execução; +97,09% p=0,000 na do usuário — ambos
p<0,001). `hmac.Equal` não mostra esse sinal nas duas execuções
(p=0,631 e p=0,280 — ambos não-significativos). Validação gravada
(`timing_benchmark`, `result: pass`) e achado avançado formalmente pra
`reproduced_local` (transição `corroborated_static -> reproduced_local`
confirmada via `cli.mjs transition`).

**O que isso prova e o que não prova, sem exagero**: prova, com rigor
estatístico real e reproduzido de forma independente, que a
comparação NÃO se comporta como tempo-constante — essa é a alegação
central do achado, e agora está genuinamente comprovada, não só lida
no código. NÃO prova exploração remota bem-sucedida contra um cluster
real — isso depende de condições de rede que uma PoC local não testa e
que eu não tenho autorização nem meio de testar contra infraestrutura
real. Pré-requisito de ataque continua real: atacante precisa estar
posicionado pra interceptar/responder tráfego de descoberta insegura,
dentro da janela de validade do token (padrão 24h) — isso vai aparecer
calibrado honestamente no relatório final.

**Falta antes de `scope_verified`**: `deploymentEvidence` ligando o
commit lido (HEAD atual, confirmado ao vivo) a uma release
efetivamente publicada do Kubernetes/kubeadm (hoje só confirmei contra
`master`, não contra uma tag de release numerada).

`deep-read-log.json`: novo repo `kubernetes/cluster-bootstrap`, 5
arquivos (`token/jws/jws.go`, `util/tokens/tokens.go`,
`util/secrets/secrets.go`, `token/util/helpers.go`,
`token/api/types.go`).

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud, paralela à rodada acima) — 49 achados não-dependência triados

Nova leva de achados apareceu na fila enquanto a sessão que escreveu a
seção acima já estava rodando: 80 `known_vulnerable_dependency` + 49
achados semgrep, cobrindo repos satélite diferentes dos já lidos ali
(`apimachinery`, `cloud-provider`, `cloud-provider-aws`,
`cloud-provider-openstack`, `cri-api`, `code-generator` — sem
sobreposição com `cluster-bootstrap`). Clonados os 6 repos rasos e
revisados os 49 achados não-dependência com leitura de código real:

- **26 `semgrep_use_of_unsafe_block`**: todos em arquivos
  `zz_generated.conversion.go` ("Code generated by conversion-gen. DO
  NOT EDIT.") ou `.pb.go` (gerado por protoc-gen-go), exceto 2 em
  `apimachinery/pkg/apis/meta/v1beta1/conversion.go` (não gerado, mas
  segue manualmente o mesmo idioma seguro de type-punning entre tipos
  de layout de memória idêntico). Todos **falso_positivo** — padrão
  mais usado e mais auditado de todo o codebase do Kubernetes.
- **16 `semgrep_math_random_used`**: todos em uso não-criptográfico
  confirmado por leitura (fuzzing/teste, jitter de backoff, amostragem
  probabilística de managed-fields, seleção de zona de disponibilidade
  como fallback, seed do gerador global). Nenhum caso de token/chave/
  segredo. Todos **falso_positivo**.
- **1 `semgrep_use_of_md5`** (`tagging_controller.go`): checksum de
  mudança de tags, não segurança. **falso_positivo**.
- **1 `semgrep_use_of_sha1`** (`aws_loadbalancer.go`): geração de nome
  determinístico curto para Target Group AWS, não segurança.
  **falso_positivo**.
- **1 `semgrep_grpc_server_insecure_connection`** (`kms/server/server.go`):
  gRPC server servido sobre unix domain socket local (`netProtocol =
  "unix"`) — protocolo oficial do KMS Provider v2 do Kubernetes, TLS
  não é o mecanismo de proteção aqui (é permissão de arquivo do
  socket). **falso_positivo**.
- **1 `semgrep_use_tls`** (`openstack.go`, endpoint `/metrics`):
  padrão consistente com todo o ecossistema Kubernetes (métricas
  Prometheus servidas em texto plano, sem segredo no conteúdo).
  **falso_positivo**.
- **1 `semgrep_avoid_bind_to_all_interfaces`** (`testserver.go`):
  helper de teste (`app/testing`), `net.Listen("tcp", ":0")` é o
  idioma padrão Go para servidor de teste efêmero. **falso_positivo**.
- **1 `semgrep_var_in_href`** (`copyright.html`): partial vendored do
  tema MkDocs Material, variável de config de build-time, não input de
  runtime. **falso_positivo**.
- **1 `insecure_tls`** (`plugin_endpoint.go`, controller de
  auto-healing): `InsecureSkipVerify: true` real em healthcheck HTTPS
  de node — código genuíno, mas não consigo confirmar se é acidente ou
  design deliberado (padrão comum no ecossistema, mesma lógica do
  `--kubelet-insecure-tls`). **corroborated_static** — fica para
  julgamento humano sobre elegibilidade real.

Os 80 achados `known_vulnerable_dependency` NÃO foram revisados nesta
rodada: `api.osv.dev` continua bloqueada pela política de rede desta
sessão cloud (confirmado de novo via `curl` → 403 no CONNECT tunnel).
Ficam em `candidate` para rodada futura — cada achado já carrega o
texto da vulnerabilidade (GHSA/severidade) salvo quando o OSV era
alcançável, falta confirmar alcançabilidade real por leitura de código.

Reconciliação: esta sessão rodou em paralelo à sessão que escreveu a
seção "Rodada 2026-09-02 — saída deliberada..." acima (mesmo push,
duas sessões cloud simultâneas). `git fetch`/`merge-base` confirmou que
os dois conjuntos de achados são disjuntos por id (nenhum dos 49 desta
seção sobrepõe o achado de `cluster-bootstrap` da outra sessão) — sem
conflito lógico real, só reconciliação de `queue.jsonl` via
re-importação (`migrate-to-v2.mjs`) depois de `git fetch origin master`
+ checkout do estado remoto mais recente antes do `export-queue` final.

## Rodada 2026-09-02 — revisão do relatório após review externa detalhada (honestidade sobre exploração remota)

Usuário colou uma revisão técnica externa detalhada do relatório
`kubernetes-cluster-bootstrap-jws-timing-attack.md`, concordando que o
bug é real no nível do primitivo mas apontando que o relatório
misturava "provado localmente" (comparação não é constant-time, com
rigor estatístico real) com "provado remotamente explorável" (nunca
demonstrado) — conclusão da review: "eu enviaria, mas não enviaria
ainda exatamente essa versão... falta tornar o attack path
remoto/repetitivo muito mais concreto."

Verifiquei o ponto central da review lendo o código real de
`cmd/kubeadm/app/discovery/token/token.go` (`retrieveValidatedConfigInfo`,
`getClusterInfo`) e confirmei que o problema é mais fundamental do que a
review presumiu: o loop de retry de `getClusterInfo`
(`wait.PollUntilContextTimeout`) só checa se a chave da assinatura JWS
está *presente* na ConfigMap buscada — nunca re-invoca
`DetachedTokenIsValid`. A verificação roda exatamente uma vez por
tentativa de `kubeadm join`, sem nenhum oráculo de retry embutido (não
é só "ruído de rede torna mais difícil", é ausência total de mecanismo
de repetição no ponto certo).

Relatório revisado com honestidade em todas as seções (título,
categoria/severidade, resumo, cadeia de chamada confirmada — novo
ponto 4 documentando o achado do retry loop —, passos de reprodução,
impacto reescrito como "o que é provado" vs. três itens explícitos "o
que isso não estabelece", e um aviso no início da seção de PoC). Nenhum
código-fonte mudou — é o mesmo achado, a mesma evidência, sem a
alegação que eu não conseguia sustentar. Commit `1d1d819`, enviado pro
`origin/master`. Nova lição de metodologia salva na memória
(`feedback_hackerone_report_methodology.md`): para qualquer achado de
timing, nomear um mecanismo concreto de observação repetível ou admitir
explicitamente que não achei um, e verificar se a comparação vulnerável
em si (não só uma operação de rede ao redor dela) está dentro de algum
loop de retry.

**Avaliação honesta e calibrada**: a alegação central (comparação
não-constante) continua sólida e comprovada 3x independentemente. A
exploração remota/prática permanece não demonstrada e, pela leitura do
código, sem oráculo de retry óbvio — isso pesa pra uma severidade real
provavelmente Informational/Low do ponto de vista do triager, não
High/Critical, mesmo que a causa raiz seja uma inconsistência real
contra o próprio padrão que o Kubernetes já adota em código vizinho.
Decisão de enviar ou não, ou investigar mais (outro ponto de chamada
para `DetachedTokenIsValid`, ou um canal lateral diferente) fica com o
usuário.

**Atualização mesma rodada — RESULTADO FINAL: duplicata de #3612349
(que já tinha fechado Informative)**. Confirmado ao vivo via
`report-status` antes de gravar qualquer coisa. Mensagem real do
triager: "#3612349... describe the identical timing side-channel
vulnerability in the DetachedTokenIsValid function... Both reports
provide benchmark evidence... The original report was evaluated and
closed as Informative... no significant security impact due to the
lack of demonstrated remote exploitation capability and no statistical
significance over network conditions. Your report, while more
extensive in its statistical analysis, explicitly acknowledges the
same fundamental limitations." Pipeline atualizado: `record-platform-
outcome` (state=duplicate) + transição automática `submitted->duplicate`
confirmada.

**Por que isso valida a rodada de honestidade em vez de invalidar o
esforço**: o triager leu o relatório de verdade e reconheceu que é MAIS
rigoroso estatisticamente que o original, mas confirma exatamente os
mesmos limites que nós mesmos já tínhamos declarado explicitamente
(sem canal observável pela rede, sem interação repetível dentro de um
único join, sem recuperação de HMAC/forjamento demonstrado) — e o
motivo de fechamento do achado ORIGINAL ("Informative... falta de
exploração remota demonstrada") bate EXATAMENTE com a calibração de
severidade que fizemos a partir das duas revisões externas, antes mesmo
de saber que um relatório anterior existia. Isso é confirmação externa
real de que a calibração estava certa, não uma coincidência favorável.
Zero indício de que reescrever com mais confiança teria mudado o
resultado — o "gap" apontado é estrutural (falta oráculo remoto), não
um problema de como foi escrito.

**Atualização mesma rodada — mecanismo de repetição real encontrado
(reuso de token multi-nó)**: usuário pediu especificamente o que
poderia aumentar a chance de severidade subir de forma legítima (não
reescrevendo texto, investigando de verdade). Verifiquei ao vivo a doc
oficial `kubernetes/website::bootstrap-tokens.md`, que confirma que
reusar o mesmo token em múltiplos clientes é prática real (desencorajada,
mas real) e alerta especificamente sobre risco de MITM nesse mesmo
mecanismo de assinatura JWS — bate com o uso comum de `kubeadm`
(`kubeadm init` imprime UM comando de join com UM token, tipicamente
rodado sem alteração em todos os workers). Isso muda o relatório de "não
achei nenhum mecanismo de repetição" pra "não há repetição DENTRO de um
join, mas existe um mecanismo real de repetição ENTRE joins que reusam o
mesmo token" — mais forte e ainda 100% honesto, sem medir de verdade o
sinal via rede real entre eventos independentes (isso continua não
demonstrado, dito explicitamente). Relatório atualizado em todas as
seções relevantes, commit `07887ea`, no `origin/master`.

**Atualização mesma rodada — ENVIADO**: usuário colou a página real do
formulário do HackerOne (revelou risco real de Signal — ver seção
abaixo — e confirmou lista de assets/weakness ao vivo), corrigi mais uma
imprecisão real achada por verificação ao vivo (direção do espelhamento
`cluster-bootstrap` ↔ `kubernetes/kubernetes`: o staging DENTRO de
kubernetes/kubernetes é a fonte, cluster-bootstrap é o espelho
publicado pelo `publishing-bot`, não o contrário como o relatório dizia
antes — commit `ad4669b`), montei o mapeamento exato dos campos do
formulário deles (Title/Description no template próprio deles/Impact) e
usuário confirmou envio. **Relatório #3990816** no programa Kubernetes
(programHandle 39386, weaknessId 116 = CWE-208, sem severidade
auto-atribuída), estado inicial `new`, confirmado ao vivo via
`report-status`. Pipeline formal avançado: `record-report` +
`transition human_ready->submitted` (humanApproval real, actor
Genezera) + `record-platform-outcome` (state=new) — tudo com
`ledgerHash` real, `export-queue` rodado.

**Atualização mesma rodada — usuário colou a página de política oficial
do programa Kubernetes no HackerOne**: li o `severity-ratings.md` real
(linkado da política) e achei que o análogo mais próximo do nosso
padrão de ataque completo (serviço se passando pela API server pra
fazer MITM) já é classificado por eles mesmos como **High, não
Critical**, e o glossário deles rebaixa Critical→High por padrão
justamente pra "Adjacent Network Access" (nosso caso). Adicionada uma
frase de contexto em "Category/Severity" citando isso — reforça a
calibração já feita, não muda nada. Commit `58e768b`. Também identifiquei
um risco real de elegibilidade que **não** entra no relatório (é decisão
da plataforma, não autodenúncia técnica): a política marca "ataques que
dependem de configuração insegura" como escopo válido mas **não elegível
pra bounty**, e nosso achado só importa de verdade sem CA pinning —
usuário avisado diretamente na conversa. Relatório considerado pronto
pra envio (commits `1d1d819` → `58e768b`).

## Rodada 2026-09-03 (agente de nuvem) — 66 candidatos refutados (39 semgrep + 27 `known_vulnerable_dependency`), todos falso-positivo com leitura real de código/go.mod

Fila `candidate` trouxe 66 achados de Kubernetes espalhados por 13
repos de staging clonados (utils, metrics, publishing-bot, kubeadm,
kube-openapi, org, cloud-provider, cloud-provider-aws, cli-runtime,
code-generator, gengo, csi-translation-lib, klog, kubelet). Nenhum
sobreviveu à checagem de alcançabilidade. Padrões que valem registrar
pra não repetir a investigação do zero:

**32 de 34 `semgrep_use_of_unsafe_block` eram `zz_generated.conversion.go`**
(metrics, todas as 5 API versions): padrão canônico
`*out = *(*Tipo)(unsafe.Pointer(in))` gerado por `conversion-gen` entre
structs versionada/interna layout-compatíveis — usado em toda a base
apimachinery há mais de uma década, não processa dado de atacante. Os
outros 2 eram `kubernetes/utils/inotify/inotify_linux.go`: reinterpreta
buffer de `read()` sobre um fd inotify LOCAL (dado do kernel, não de
rede). `math/rand` (4 achados: `trace.go`, `kinder/waiter.go`,
`kube-openapi/fuzz.go`, + 1 Kiwi.com) sempre usado só pra jitter/ID de
log/dado de teste, nunca segredo/token — `vaultsecret_controller.go`
(Kiwi.com) já carrega `//nolint:gosec` reconhecendo isso.
`publishing-bot/server.go` (`semgrep_use_tls`) serve só `/healthz` e um
`/run` sem parâmetros num binário de automação interna com
`server-port` desabilitado por padrão, fora da lista de alvos ativos
deste programa (ver tabela no topo do STATUS.md). `kinder/util.go`
(`semgrep_avoid_bind_to_all_interfaces`) é o idiom padrão de "pegar
porta livre" — listener fechado antes de servir qualquer coisa.

**Lição nova pra reachability de Go, vale generalizar pra próximas
rodadas**: quase todo `known_vulnerable_dependency` aqui (25/27) caiu
numa de duas categorias objetivamente checáveis sem precisar de
`govulncheck`:
1. **Marcado `// indirect` no go.mod + repo é biblioteca sem `main.go`
   próprio** (cloud-provider, cloud-provider-aws, cli-runtime,
   csi-translation-lib parcial, gengo, klog/examples, code-generator):
   a versão real que roda em produção é decidida pelo `go.mod`/`go.sum`
   do BINÁRIO final (ex.: `aws-cloud-controller-manager`), não deste
   repo isolado. Confirmado ainda mais forte pelo histórico: 74/74
   revisões anteriores de `known_vulnerable_dependency`/go neste
   sistema já eram falso-positivo (ver `quarantine-status.md`).
2. **Pseudo-versão `k8s.io/*` recente (`v0.0.0-2026...`) comparada
   contra CVE antiga**: `apimachinery`/`client-go`/`apiserver` em
   `cloud-provider`, `cli-runtime`, `csi-translation-lib`,
   `code-generator` foram flagados pra CVEs de 2020
   (GHSA-33c5-9fx5-fvjm/CVE-2020-8559, privilege escalation, corrigida
   em 0.16.13/0.17.9/0.18.7 — confirmado via advisory oficial) mesmo a
   pseudo-versão sendo um snapshot de ago/set-2026. OSV-Scanner não
   ordena pseudo-versão de branch principal corretamente contra ranges
   semver publicados — bug de comparação do scanner, não achado real.
   Vale registrar como classe conhecida de ruído pra próximas rodadas
   com `k8s.io/*`.

Duas exceções que mereceram leitura funda em vez de aplicar padrão:
- **`kubernetes/kubelet` + `google.golang.org/grpc@v1.82.1`
  (GHSA-vp52-pcj8-j9qc/CVE-2026-84304, DoS real e atual — corrigido só
  em 1.83.1)**: esse repo é só as definições de tipo/API geradas
  (`pkg/apis/{podresources,deviceplugin,dra,pluginregistration}`,
  arquivos `*_grpc.pb.go`) — confirmado por grep que NENHUM
  `grpc.NewServer()` roda aqui. O kubelet de verdade (que instancia os
  servidores gRPC de podresources/device-plugin) vive em
  `kubernetes/kubernetes` (`cmd/kubelet`), repo que não está na lista
  de alvos ativos rastreados por este scanner — sem acesso pra
  confirmar a versão de grpc real do binário publicado.
- `kubernetes/org` (`go-git@v5.6.1` com ~28 CVEs de path
  traversal/RCE, `sirupsen/logrus@v1.9.0` DoS via `Entry.writerScanner`):
  ambos usados só em `cmd/korg`/`cmd/restrictions`, ferramentas CLI de
  administração do org GitHub rodadas localmente por mantenedores
  contra arquivos/repos confiáveis — `go-git` nunca processa repo
  arbitrário de atacante; `logrus` nunca chama `.Writer()` (o método
  vulnerável), só `Fatalf`/`Infof`/`Error`.

## Rodada 2026-09-04 — leitura profunda proativa (cloud-provider-openstack, cloud-provider-aws), sem achados

Fila (`list-pending`) vazia. Leitura profunda proativa priorizando path com
auth/token/cred: `pkg/identity/keystone/authenticator.go` e
`pkg/identity/keystone/authorizer.go` (cloud-provider-openstack) e
`cmd/ecr-credential-provider/plugin.go` (cloud-provider-aws).

- `authenticator.go`: `AuthenticateToken` delega validação real pro Keystone
  (`GetTokenInfo`/`GetGroups`); qualquer erro do Keystone propaga como falha
  de autenticação — fail-closed, sem bypass de token vazio/malformado.
- `authorizer.go`: policy-based authorizer cuja `policyList` vem de config
  carregada no startup do apiserver pelo admin (não de input de requisição).
  Fail-closed explícito quando `user.GetExtra() == nil` (falha de auth do
  Keystone). Policy sem campo `Users` aplica pra qualquer usuário — isso é
  comportamento documentado do upstream `k8s-keystone-auth`, não um bypass
  introduzido neste código.
- `plugin.go` (ecr-credential-provider): protocolo oficial de exec plugin do
  kubelet — request chega via stdin do próprio processo kubelet local
  (trusted), nunca de rede/atacante remoto.

Nenhum achado novo. `deep-read-log.json` atualizado com os 3 arquivos.

## Rodada 2026-09-04 (push automático) — leitura profunda proativa (apimachinery), sem achado

Fila global vazia. `program-policy.json` checado como passo zero:
`Block Open Source`/`Circle BBP` seguem bloqueados. Clone raso sparse
de `kubernetes/apimachinery` (repo alvo ainda não tocado por este
programa — só `cluster-bootstrap`/`cloud-provider-openstack`/
`cloud-provider-aws` tinham leitura prévia). Grep por auth/token/
crypto/cred/permission/access/admission em `pkg/` (excluindo `_test.go`,
`fuzzer/`, `testing/`) achou só 1 arquivo: `pkg/sharding/
accessor.go` — `ResolveFieldValue` extrai `uid`/`namespace` de
metadata de um `runtime.Object` pra um path CEL fixo (`object.metadata.
uid`/`object.metadata.namespace`), puro getter sem I/O nem lógica de
controle de acesso (nome "accessor" é sobre acessar campo de objeto,
não sobre access control). Sem achado. Resultado esperado — como já
documentado nas rodadas anteriores deste programa, `apimachinery` é
majoritariamente machinery de tipos/serialização, a lógica real de
autenticação/autorização do Kubernetes vive em `kubernetes/kubernetes`
(`cmd/kube-apiserver`), repo fora da lista de alvos ativos rastreados
aqui.

`deep-read-log.json` atualizado (`kubernetes/apimachinery` novo, 1
arquivo).

## Rodada 2026-09-04 (push automático, webhook head 8c9169b) -- leitura profunda (cloud-provider), sem achado

`program-policy.json` conferido como passo zero: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado.
`migrate-to-v2.mjs` + `list-pending` global = 0 (fila vazia). Leitura
profunda proativa direcionada a `kubernetes/cloud-provider` (repo alvo
ativo em `STATUS.md` ainda não tocado por este programa -- só
`cluster-bootstrap`/`cloud-provider-openstack`/`cloud-provider-aws`/
`apimachinery` tinham leitura prévia). Clone raso, grep por
auth/token/crypto/login/password/admin/permission/access/secret/cred
em `*.go` (excluindo `_test.go`), 3 candidatos escolhidos por
julgamento próprio entre os poucos hits genuinamente relacionados a
segurança (maioria dos hits era ruído de "config"/"access" em nomes
comuns de campo, não lógica de autenticação real):

- `credentialconfig/registry.go`: só struct de tipos (`RegistryConfig`/
  `RegistryConfigEntry`) pra representar config docker de pull de
  imagem -- comentário no topo confirma que é código copiado de
  `/pkg/credentialprovider/config.go` do core k8s; sem lógica de
  leitura/parsing/uso neste arquivo. Sem achado.
- `app/webhooks.go` (`WebhookHandler.ServeHTTP`/`parseRequest`):
  servidor HTTP dos admission webhooks do cloud-controller-manager.
  `ServeHTTP` não valida identidade do chamador além da própria camada
  TLS (sem shared secret nem verificação adicional no handler) -- mas
  esse é o modelo de confiança padrão do admission webhook do
  Kubernetes: é o apiserver quem autentica o servingCert do webhook via
  `caBundle` configurado no registro do webhook, não o inverso: o
  endpoint não expõe ação privilegiada diretamente a partir do payload
  (`AdmissionHandler` só decide allow/deny, delegado por webhook
  específico). Comportamento upstream documentado, não é bypass
  introduzido aqui.
- `options/webhook.go` (`WebhookServingOptions.ApplyTo`): setup do TLS
  server-side (cert/key/cipher-suites/curve-preferences/SNI) pro
  listener do webhook -- confirma que não há `ClientCA`/mTLS
  configurado nesta camada, consistente com o modelo de confiança
  descrito acima (o server não autentica o cliente; é o cliente/
  apiserver que autentica o server via `caBundle`). Sem achado.

`deep-read-log.json` atualizado (`kubernetes/cloud-provider` novo, 3
arquivos). Nenhum achado novo, nenhuma transição de estado nesta
rodada -- resultado normal e válido.

## Rodada 2026-09-04 (push automático via GitHub webhook, sessão cloud, rodada seguinte)

`program-policy.json` checado como passo zero: `Block Open Source`/
`Circle BBP` seguem bloqueados, nenhum repo desses tocado. Também notado
`Auth0 by Okta` com `roeReviewNeeded` (flag de processo de rodada
anterior, mesma plataforma Bugcrowd do Block Open Source) -- tratado com
cautela extra, `auth0/auth0-java` não foi escolhido como alvo nesta
rodada. `migrate-to-v2.mjs` + `list-pending` global = 0.

Também revisado (sem alteração) o estado geral da fila via
`pipeline-status`: os dois achados travados de Block Open Source
(`js_injection_unescaped_token_risk` em `corroborated_static` e
`Root.kt::DirectoryRoot.resolve::path_traversal_risk` em `human_ready`)
seguem intocados, como esperado -- nenhuma ação tomada sobre eles nesta
rodada (não avançam, não são revertidos, apenas confirmados como
"não tocar").

Leitura profunda proativa: mais 2 arquivos de `kubernetes/cloud-provider`
(clone raso público, mesmo repo de rodadas anteriores):

- `controllers/service/controller.go` (`Controller.syncLoadBalancerIfNeeded`/
  `ensureLoadBalancer`/`addFinalizer`/`removeFinalizer`/`patchStatus`):
  loop de reconciliação padrão do service controller; toda lógica
  sensível (validação de `LoadBalancerSourceRanges`, `ExternalIPs`, etc.)
  é delegada ao `balancer.EnsureLoadBalancer` específico de cada cloud
  provider, que não vive neste repo. Finalizer add/remove e patchStatus
  usam só API padrão do client-go contra o próprio objeto Service, sem
  trust boundary novo. Sem achado.
- `controllers/nodelifecycle/node_lifecycle_controller.go`
  (`CloudNodeLifecycleController.MonitorNodes`/`getProviderID`/
  `shutdownInCloudProvider`/`ensureNodeExistsByProviderID`):
  `getProviderID` confia em `node.Spec.ProviderID` se já setado no
  objeto Node, sem re-verificar contra o cloud provider -- superfície já
  conhecida e documentada pela comunidade k8s (mitigada pelo
  `NodeRestriction` admission plugin, que impede o kubelet de setar o
  `ProviderID` de outro node), não um bug novo introduzido aqui; nenhuma
  lógica de auth/token neste arquivo, só orquestração de delete/taint
  baseada em `InstanceExists`/`InstanceShutdown` do cloud provider. Sem
  achado.

`deep-read-log.json` atualizado (`kubernetes/cloud-provider`, +2
arquivos). Nenhum achado novo, nenhuma transição de estado nesta rodada
-- resultado normal e válido.

## Rodada 2026-09-04 (push automático via GitHub webhook, sessão cloud, rodada seguinte -- kubernetes/cli-runtime + kubernetes/csi-translation-lib)

`program-policy.json` conferido como passo zero: `Block Open Source`/
`Circle BBP` seguem bloqueados, nenhum repo desses tocado; `Auth0 by
Okta` segue com `roeReviewNeeded` (informativo, não bloqueia) -- não
escolhido como alvo. `migrate-to-v2.mjs` + `list-pending` global = 0
(fila vazia, nenhum finding em `candidate`).

Leitura profunda proativa em 2 repos alvo ainda não tocados por este
programa (`STATUS.md`): `kubernetes/cli-runtime` e `kubernetes/
csi-translation-lib`. Clone raso público, grep de conteúdo (não só nome
de arquivo -- nenhum arquivo tinha auth/token/secret/credential/access
no *nome*) por password/secret/credential/token/authoriz/authent, 3
candidatos escolhidos por julgamento próprio:

- `cli-runtime/pkg/genericclioptions/config_flags.go`
  (`ConfigFlags.AddFlags`/uso de `BearerToken`/`Password`/`Username`):
  flags de linha de comando do kubectl sobrescrevem o `AuthInfo` do
  kubeconfig carregado localmente -- sem trust boundary novo, é o
  próprio usuário que roda o comando e já possui os valores em texto
  claro nos argumentos/env que digitou. Plumbing client-side padrão do
  client-go/clientcmd. Sem achado.
- `csi-translation-lib/plugins/azure_file.go`
  (`TranslateInTreeInlineVolumeToCSI`/`TranslateInTreePVToCSI`):
  namespace do `NodeStageSecretRef` pra volume inline vem de
  `podNamespace` (namespace do próprio pod que monta o volume -- não
  controlável a partir de outro namespace) e pra PV vem de
  `SecretNamespace` explícito no PV ou do `ClaimRef` -- ambos os casos
  já exigem privilégio de criar PV/volume inline hoje; a tradução
  in-tree→CSI não introduz leitura cross-namespace de secret nova, só
  copia o que já estava no objeto original. Sem achado.
- `csi-translation-lib/plugins/portworx.go`
  (parâmetros `openstorage.io/auth-secret-name(space)` reescritos pra
  chaves CSI prefixadas -- `provisioner-secret-name`,
  `controller-publish-secret-name`, etc.): mapeamento 1:1 de valores já
  presentes nos annotations/params da StorageClass/PV original, sem
  leitura nem elevação nova de segredo. Sem achado.

`deep-read-log.json` atualizado (`kubernetes/cli-runtime` novo, 1
arquivo; `kubernetes/csi-translation-lib` novo, 2 arquivos). Nenhum
achado novo, nenhuma transição de estado nesta rodada -- resultado
normal e válido, consistente com o padrão já observado neste programa
(código de translation/plumbing client-side, lógica sensível de
auth real do core do Kubernetes vive fora dos repos rastreados aqui).

## Rodada 2026-09-04 (push automático via GitHub webhook, sessão cloud)

`program-policy.json` checado como passo zero (`Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado).
`migrate-to-v2` rodado, `list-pending` global = 0.

Leitura profunda proativa: `kubernetes/component-base` (repo nunca
lido nesta missão até agora), shallow clone público. 3 arquivos:

- `configz/configz.go` (`InstallHandler`/`write`) — handler HTTP
  `/configz` que serializa em JSON todo `ComponentConfig` registrado
  via `configz.New`/`Set`. É um debug endpoint documentado do próprio
  ecossistema Kubernetes (usado por `kube-scheduler` etc.), sem
  autenticação própria embutida — decisão de montar esse handler num
  mux exposto/autenticado (ou não) é do componente chamador, fora
  desta lib. Padrão conhecido, não é introdução nova de vulnerabilidade
  neste arquivo. Sem achado.
- `logs/datapol/datapol.go` (`Verify`/`datatypes`) — reflection
  recursiva que localiza campos marcados com a tag de struct
  `datapolicy` para sinalizar dado sensível antes de logar; `recover()`
  protege contra panic de reflection, recursão cobre corretamente
  ponteiro/slice/map/struct. Sem achado.
- `cli/flag/namedcertkey_flag.go` (`NamedCertKey.Set`/
  `NamedCertKeyArray.Set`) — só parsing de flag de linha de comando
  (`certfile,keyfile[:names]`), sem decisão de autorização nem I/O de
  rede. Sem achado.

`deep-read-log.json` atualizado (`kubernetes/component-base` novo, 3
arquivos). Nenhum achado novo, nenhuma transição de estado nesta
rodada. `Block Open Source`/`Circle BBP` seguem fora de escopo por
política local (`program-policy.json`).

## Rodada 2026-09-04 #14 (push automático via GitHub webhook, rodada seguinte)

`program-policy.json` checado como passo zero (`Block Open
Source`/`Circle BBP` seguem bloqueados). `migrate-to-v2` + `list-pending`
global = 0.

Leitura profunda proativa: `kubernetes/apiserver` (repo nunca lido nesta
missão até agora, alvo de alto valor — decisão de autorização real),
shallow clone público. 2 arquivos na fronteira de autorização:

- `pkg/authorization/union/union.go` (`Authorize`/`ConditionsAwareAuthorize`/
  `EvaluateConditions`) — encadeia múltiplos sub-authorizers, retorna a
  primeira decisão Allow/Deny (short-circuit correto), NoOpinion sempre
  continua a cadeia. Investiguei com ceticismo se `return decision, reason,
  err` com `decision==Allow` e `err!=nil` (linha 92-93) seria um bypass —
  rastreei até o ponto de consumo real
  (`pkg/endpoints/filters/authorization.go:78-79`), que documenta e trata
  isso deliberadamente: *"an authorizer like RBAC could encounter
  evaluation errors and still allow the request, so authorizer decision is
  checked before error here"*. Comportamento intencional e já documentado
  no consumidor, não introduzido por `union.go`. Sem achado.
- `plugin/pkg/authorizer/webhook/webhook.go` (`WebhookAuthorizer.Authorize`) —
  fail-open documentado no próprio TODO do código-fonte ("We are failing
  open now to preserve backwards compatible behavior"), `decisionOnError`
  é config do operador do cluster, comportamento conhecido e configurável
  há anos no kube-apiserver, não é vulnerabilidade introduzida pela lib.
  `shouldCache` evita cache de attrs muito grandes (mitigação de DoS via
  cache poisoning já presente). Sem achado novo.

`deep-read-log.json` atualizado (`kubernetes/apiserver` novo, 2
arquivos). Nenhum achado novo, nenhuma transição de estado nesta rodada.
`Block Open Source`/`Circle BBP` seguem fora de escopo por política
local (`program-policy.json`).
