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

**Estado real, sem exagero**: registrado como `corroborated_static`,
não além disso. Falta PoC real (medição estatística de timing, não só
leitura de código) antes de qualquer relatório. Pré-requisito real:
atacante precisa estar posicionado pra interceptar/responder tráfego
de descoberta insegura, dentro da janela de validade do token (padrão
24h) — ataque de timing remoto é uma classe real e documentada, mas
genuinamente mais difícil que local; isso deve ser calibrado
honestamente no relatório final, não escondido nem inflado.

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
