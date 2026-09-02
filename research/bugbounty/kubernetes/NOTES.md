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

## Rodada 2026-09-02 (push automático via GitHub webhook, sessão cloud) — 49 achados semgrep novos: 48 falso-positivo, 1 real (`corroborated_static`)

Programa segue sem scope-snapshot dedicado documentado nesta nota
anterior — na prática `research/bugbounty/scope-snapshots/kubernetes.json`
já existe (capturado numa rodada concorrente/anterior no mesmo push,
`check-scope "Kubernetes" ...` funcional). Fila tinha 49 `candidate`
não-dependência (dependência = 31 `known_vulnerable_dependency`,
não tocados nesta rodada). Clonados shallow `apimachinery`,
`cloud-provider`, `cloud-provider-aws`, `cloud-provider-openstack`,
`code-generator`, `cri-api`.

**48 falso-positivo**, agrupados por padrão real confirmado por
leitura de código:
- `unsafe.Pointer` em `zz_generated.conversion.go`/`api.pb.go` (23×):
  código 100% autogerado por `conversion-gen`/`protoc-gen-go`,
  reinterpretação de tipos com layout de memória idêntico — padrão
  oficial do ecossistema Kubernetes/protobuf-go.
- `math/rand` (16×): em cada caso confirmado por grep do call site —
  fuzzer/roundtrip de teste (`*_fuzz.go`, `apitesting/`), jitter de
  retry/backoff (`wait.go`, `controllermanager.go`, `options.go`,
  `csi.go`), amostragem probabilística de log
  (`skipnonapplied.go`), randomização de ordem de iteração
  (`collections.go`), fallback de escolha de zona sem segredo
  envolvido (`zones.go`), ou seed do gerador global não-criptográfico
  no entrypoint (`main.go`) — nenhum uso de segurança identificado.
- `sha1`/`md5` (2×): checksum de idempotência de tags
  (`tagging_controller.go`) e nome determinístico truncado de target
  group AWS (`aws_loadbalancer.go`) — nenhum protege segredo.
- `grpc_server_insecure_connection` (`kms/server/server.go`): gRPC
  sem TLS mas sobre Unix domain socket LOCAL — arquitetura oficial e
  documentada do plugin KMS do Kubernetes (kube-apiserver fala com o
  provider via socket local, nunca rede).
- `semgrep_use_tls` (`openstack.go`): endpoint `/metrics` HTTP puro,
  padrão universal do ecossistema Prometheus/cloud-native.
- `avoid_bind_to_all_interfaces` (`testserver.go`): mora em
  `app/testing/`, servidor de teste efêmero (`*testing.T`), nunca
  produção.
- `var_in_href` (`copyright.html`): valor de config de build do
  MkDocs Material, não input de usuário refletido.

**1 real, mantido em `corroborated_static`** (sem PoC — sem
validador automatizado disponível pra achados Go, mesma limitação
documentada em outros programas):
`cloud-provider-openstack/pkg/autohealing/healthcheck/plugin_endpoint.go:144`
— `tls.Config{InsecureSkipVerify: true}` real e alcançável no cliente
HTTPS que o autohealing controller usa pra checar o healthcheck de um
nó (CWE-295, Improper Certificate Validation). Severidade
provavelmente baixa/média — exige posição de rede já dentro do plano
de dados do cluster pra MITM, não explorável pela internet pública —
calibrado honestamente no `reasoning`, não inflado nem descartado.

`Kubernetes` fila agora: **31 candidate** (só `known_vulnerable_dependency`,
não tocados nesta rodada — API OSV segue bloqueada pela política de
rede desta sessão, `api.osv.dev:443` recusado pelo proxy, mesmo
sintoma já documentado em outros programas).
