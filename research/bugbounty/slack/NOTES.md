# Slack (HackerOne) — notas de pesquisa

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud)

Primeira rodada tocando este programa. `Slack` foi promovido automaticamente
pro scanner ativo pelo pipeline de descoberta em rodada anterior
(`targets-auto-promoted-log.json`, commit `83dce7a`) — **sem** passar por
revisão de RoE quanto a proibição de pesquisa assistida por IA (ao contrário
de Block Open Source, que só foi corretamente flagado como
`aiResearchBanned` depois de alguém ler a RoE da Bugcrowd de verdade). Isso
foi percebido só depois de já ter lido/triado os 86 achados abaixo — ver
`program-policy.json` (`"Slack": {"roeReviewNeeded": true, ...}`), registrado
nesta mesma rodada como advertência pro usuário revisar a RoE real do
programa no HackerOne antes de qualquer pesquisa futura aqui.

`list-pending` trouxe 86 achados, todos `semgrep_use_of_unsafe_block`
(CWE-242, severidade WARNING) em `slackhq/nebula` — regra genérica que
flagga qualquer uso do pacote `unsafe` do Go, sem analisar o que o código
realmente faz com ele. Clonado `slackhq/nebula` raso localmente (leitura de
código público, sem conta/token). 14 arquivos únicos cobrindo todos os 86
achados:

- `noiseutil/fips140.go` (1): `unsafe.Pointer` + `reflect` só pra extrair um
  campo não-exportado de `crypto/tls.xorNonceAEAD` (acessar a implementação
  FIPS140 interna do Go) — operação local em material de cifra já derivado,
  sem entrada de rede. Tem self-test em `init()` com panic defensivo se o
  layout interno do Go mudar.
- `udp/udp_linux.go`, `udp/udp_linux_writebatch.go` (8): parsing de cmsg
  (GRO/GSO) via `unsafe.Slice`/`unsafe.Pointer` — **li linha a linha**
  (`parseRecvCmsg`): bounds-check explícito por header (`clen <
  SizeofCmsghdr || clen > len(ctrl)-off`) e por payload antes de cada
  leitura; `deliverSegments` valida `segSize <= 0 || segSize >=
  len(payload)` antes de fatiar. Sem bug de memória demonstrável.
- `udp/udp_rio_windows.go` (15): aritmética de ponteiro pra API Windows
  Registered I/O (RIO) — offsets calculados sobre ring buffer alocado
  localmente pelo próprio processo (tamanho fixo, `packetsPerRing`), não
  sobre tamanho/offset vindo de pacote de rede.
- `udp/udp_darwin.go` (4): conversão de struct sockaddr local pra
  `unsafe.Pointer` exigida pela assinatura raw de `sendto` no Darwin.
- `overlay/tun_linux.go`, `tun_freebsd.go`, `tun_darwin.go`,
  `tun_openbsd.go`, `tun_netbsd.go`, `tun_windows.go` (35 no total):
  `unsafe.Pointer` pra structs `ifreq`/`ifaliasreq` locais em chamadas
  `ioctl` de configuração de interface (nome, MTU, flags, endereço) e
  iovecs de tamanho fixo (2) em READV/WRITEV do fd do TUN local —
  configuração local do dispositivo, sem processar pacote de rede.
- `overlay/tio/tio_gso_linux.go` (3): mesmo padrão de iovec fixo (2) pra
  READV/WRITEV.
- `overlay/network_category_windows.go` (14), `wfp/wfp_windows.go` (6):
  `unsafe.Pointer` pra chamadas de vtable COM / API nativa WFP (Windows
  Filtering Platform) — padrão exigido pelo Go pra interoperar com essas
  APIs Windows, sem equivalente seguro. Ponteiros apontam pra objetos/buffers
  locais construídos pelo próprio nebula, não pra dado de peer remoto.

Todos os 86 refutados como falso positivo com reasoning individual por
arquivo salvo em cada finding (`update-finding` + `transition ...
false_positive`). Nenhum PoC aplicável (findings não-Solidity não têm
validador disponível hoje — limitação conhecida do sistema, não inventei
um).

**Pendência pro usuário**: confirmar a RoE do programa Slack no HackerOne
antes de qualquer rodada futura de pesquisa aqui (ver `program-policy.json`).

## Adendo — sessão concorrente (mesmo push, mesma janela de tempo)

Outra sessão desta mesma rotina (disparada pelo mesmo push) investigou os
86 achados em paralelo e chegou ao mesmo veredito de forma independente —
sem coordenação entre as duas, a leitura de código convergiu igual.
`git reset --hard` pra essa versão canônica em vez de empurrar um commit
duplicado com reasoning redundante.

Contribuição incremental desta sessão, além do que já está documentado
acima: leitura profunda proativa da fronteira de confiança PKI própria do
Nebula (autenticação mútua entre peers, não coberta pela outra sessão, que
focou em `vercel/vercel`):

- `cert/ca_pool.go` (`VerifyCertificate`/`verify`/`checkCAConstraints`):
  cadeia CA->cert -- expiração, correspondência de curva, blocklist de
  fingerprint (incluindo fingerprint alternativo pra assinatura P256
  high-s/low-s), e constraints de grupos/redes/redes-inseguras do signer
  respeitadas no subordinado. Todos os ramos de erro são fail-closed.
- `cert/crypto.go` (`aes256Encrypt`/`aes256Decrypt`/`deriveKey`): AES-256-GCM
  com nonce aleatório de `crypto/rand` por chamada (sem reuso), KDF
  Argon2id com parâmetros validados antes de uso.
- `cert/cert_v1.go` e `cert/cert_v2.go` (`CheckSignature`): `ed25519.Verify`
  / `ecdsa.VerifyASN1`, curva vinculada ao tipo do certificado no parse
  (não escolhível pelo atacante independente da chave), `default` retorna
  `false` -- sem confusão de algoritmo nem bypass óbvio.

Sem achado nesta leitura -- resultado válido, não forçado. Mesma
pendência de RoE acima também se aplica a esta leitura (aconteceu na
mesma janela, antes de qualquer confirmação de RoE).

## Rodada 2026-09-04 (push automático via GitHub webhook)

`program-policy.json` checado como passo zero antes de qualquer leitura:
`Slack` está `roeReviewed:true`/`aiResearchBanned:false` desde 03/09 (a
pendência mencionada acima já foi resolvida por sessão anterior).
`Block Open Source`, `Circle BBP` e `Auth0 by Okta` seguem bloqueados,
nenhum repo desses tocado.

`list-pending` global = 34 candidatos, todos pertencentes a programas
bloqueados (30 `Auth0 by Okta` em `auth0/react-native-auth0`, 4
`Circle BBP`) — nenhum processado, conforme regra de pular o programa
inteiro sem ler/abrir nada. Ver `auth0-by-okta/NOTES.md` e nota de
processo abaixo.

Leitura profunda proativa (3 arquivos), continuando a fronteira de
confiança PKI/handshake do Nebula (`slackhq/nebula`) do adendo anterior:
- `handshake/credential.go` — só struct de dados + delega pro
  `noise.NewHandshakeState`. Sem achado.
- `handshake/machine.go` — máquina de estados do handshake Noise
  (`ProcessPacket`/`validateCert`). Negociação de versão de certificado só
  troca pra versão que o host local já aceita, e a chave pública do
  certificado alegado é sempre conferida contra a chave estática já
  autenticada pelo Noise DH antes de qualquer outra coisa — não dá pra
  forjar downgrade sem já possuir a chave privada correspondente. Sem
  achado.
- `cert/sign.go` — usado só pela ferramenta offline `nebula-cert` (CA),
  não pelo daemon nem por input de peer remoto; assinatura padrão
  (ed25519/ecdsa com `crypto/rand`), normalização low-S antes de gravar.
  Sem achado.

Nenhum achado novo nesta rodada. `deep-read-log.json` atualizado (+3,
agora 7 no total para `slackhq/nebula`).

## Rodada 2026-09-05 (push automático via GitHub webhook, sessão cloud)

`program-policy.json` checado como passo zero antes de qualquer clone/leitura
(disciplina mantida). `list-pending` global = 34 candidatos, 100% pertencentes
a programas bloqueados (30 `Auth0 by Okta` em
`auth0/react-native-auth0/.yarn/releases/yarn-4.11.0.cjs`, 4 `Circle BBP` em
`circlefin/evm-gateway-contracts/script/004_UpgradeGatewayWallet.sol`) —
verifiquei os `createdAt`/`foundAt` desses registros contra as datas de
bloqueio em `program-policy.json` (Circle BBP bloqueado 02/09, achados
`foundAt` 04/09; Auth0 bloqueado 04/09, achados `foundAt` 04/09 mesma
janela) e confirmei que esse resíduo já tinha sido identificado e
documentado por rodadas anteriores (ver `auth0-by-okta/NOTES.md` rodada
#7 e `circle-bbp/NOTES.md` rodadas anteriores) — não é incidente novo
desta rodada, apenas leftover em `candidate` intencionalmente intocado.
Nenhum arquivo desses dois programas foi lido, clonado ou tocado nesta
rodada (nem mesmo `get`/`list-pending` conta como pesquisa nova, só
consulta ao estado já persistido).

Leitura profunda proativa (3 arquivos), continuando `slackhq/nebula`
pelo lado do console admin SSH (`sshd.*`, prioridade por palavra-chave
"admin"/"access"/"password" no domínio):
- `sshd/server.go` — autenticação do console: `IsUserAuthority` compara
  bytes completos da CA marshaled, `UserKeyFallback` exige bater a chave
  pública marshaled inteira (não só fingerprint) contra
  `trustedKeys[user]`. Usa `ssh.CertChecker.Authenticate` da lib padrão,
  que já valida principals/expiração de certificado internamente. Sem
  achado.
- `ssh.go` — `sshSanitizeFilePath` (usado por
  start-cpu-profile/save-heap-profile/save-mutex-profile) tentei
  refutar com path traversal relativo (`../../etc/passwd`) e absoluto
  fora do sandbox: `filepath.Join` já resolve o `..` antes da checagem
  de prefixo, e o `strings.HasPrefix(cleaned, sandbox+separador)`
  rejeita ambos os casos testados mentalmente. Sem achado (parece
  sanitização correta, possivelmente já endurecida em resposta a achado
  anterior deste próprio pipeline — não investiguei o histórico de git
  do upstream pra confirmar).
- `sshd/command.go` — despacho dos comandos, só `flag.FlagSet` +
  callback, sem `os/exec` em lugar nenhum. Sem achado.

Nenhum achado novo nesta rodada. `deep-read-log.json` atualizado (+3,
agora 10 no total para `slackhq/nebula`).

## Rodada 07/09/2026 #2 (push automático via GitHub webhook, rotina agendada)

`program-policy.json` conferido no passo 0 (`check-program`): `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado. `research-plan`
trouxe só os 3 `verify_scope` de Mattermost como `actionable` (ver
`mattermost/NOTES.md` desta mesma data) — já totalmente processados na rodada
anterior (mesmo commit que disparou esta sessão), nada novo a fazer ali.

Leitura profunda proativa continuando `slackhq/nebula` (10→13 arquivos lidos),
desta vez no caminho de dados de pacote/firewall em vez do console SSH já
coberto:
- `firewall.go` — avaliação de regras allow (CA sha/name, groups AND, host,
  cidr) sobre pacotes já autenticados pelo handshake Noise; conntrack revalida
  contra ruleset atual em reload; `Drop()` confere endereço remoto contra as
  redes do próprio certificado do peer antes de checar qualquer regra. Sem
  achado.
- `pki.go` — carregamento de `pki.key`/`pki.cert`/`pki.ca`, sempre a partir de
  config local do operador (não de pacote de rede); `VerifyPrivateKey`
  confere par pub/priv, hot-reload recusa mudança de rede/curva no cert. Sem
  achado.
- `outside.go` — caminho de pacote recebido da rede antes/depois da
  decriptação; toda leitura de slice em `parseV4`/`parseV6` é precedida por
  checagem de comprimento mínimo (testei mentalmente pacote IPv4 truncado no
  meio do header TCP/UDP — retorna erro antes de qualquer slice de porta);
  `handleRecvError` confere o endereço remoto antes de aceitar um
  `RecvError` (proteção contra spoofing já no próprio código, comentário
  "Someone spoofing recv_errors?"); decrypt/verify sempre antes de qualquer
  parse do payload (auth-then-parse). Sem achado.

Nenhum achado novo nesta rodada (13/? arquivos cobertos, ~6%+ do repo,
cobertura ainda parcial). `deep-read-log.json` atualizado (+3, 13 no total
para `slackhq/nebula`). Clone temporário removido. `export-queue` rodado ao
final da rodada.

## Rodada 07/09/2026 #5 (push automático via GitHub webhook, rotina agendada)

`program-policy.json`/`check-program` conferidos no passo 0: `Block Open
Source`/`Circle BBP` seguem bloqueados, nenhum repo desses tocado.
`research-plan` trouxe só os 3 `verify_scope` de Mattermost como
`actionable` (já totalmente processados em rodadas anteriores desta mesma
data — ver `mattermost/NOTES.md`, nada novo sem confirmação manual externa
de `bountyEligible`, bloqueada por egress nesta sessão cloud). `list-pending`
(sem `--include-held`) = 0.

Leitura profunda proativa continuando `slackhq/nebula` (13→16 arquivos
lidos), priorizando por palavra-chave (`password`/`session`) mais um arquivo
de handshake ainda não coberto no nível do gerenciador (distinto de
`handshake/machine.go`, já lido):

- `cmd/nebula-cert/passwords.go` — `StdinPasswordReader.ReadPassword` é um
  wrapper fino sobre `golang.org/x/term.ReadPassword`/`IsTerminal` pra ler a
  senha de criptografia da chave privada offline via terminal interativo.
  Nenhuma lógica própria de crypto/validação aqui (delega pra
  `cert/crypto.go`, já lido). Sem achado.
- `handshake_manager.go` — camada que envolve `handshake/machine.go`:
  `HandleIncoming` exige `RemoteIndex==0` no stage-1 e dropa qualquer
  `RemoteIndex!=0` sem gastar CPU rodando Noise; `beginHandshake`/
  `continueHandshake` só aceitam o pacote depois que
  `handshake.Machine.ProcessPacket` já verificou o certificado do peer
  contra a CA pool (`certVerifier` → `pki.GetCAPool().VerifyCertificate`);
  `validatePeerCert` recusa self-handshake e aplica
  `lighthouse.remote_allow_list`; `continueHandshake` ainda confere
  `correctHostResponded` (o cert de quem respondeu bate com o `vpnAddr`
  pretendido) antes de completar — defesa contra um lighthouse/MITM
  redirecionar pra um peer diferente com cert próprio válido mas de outro
  endereço. Ponto anotado pra investigação futura (não um achado
  confirmado): `via.IsRelayed` pula a checagem de `remote_allow_list` tanto
  em `HandleIncoming` quanto em `validatePeerCert` — parece intencional
  (tráfego relayed já passou por um túnel autenticado separado, perímetro
  de confiança diferente), mas não confirmei a fundo lendo
  `relay_manager.go` nesta rodada. `allocateIndex` usa `crypto/rand` com
  checagem de colisão. Sem achado confirmado.
- `sshd/session.go` — despacho de comando do console SSH admin
  (pós-autenticação, já gateada por `sshd/server.go` lido em rodada
  anterior). `shlex.Split` só tokeniza a linha, `lookupCommand` resolve
  contra uma radix tree de comandos internos registrados — nenhum
  `os/exec`, nenhuma concatenação de shell, inclusive no canal `exec` do
  SSH (que reusa o mesmo `dispatchCommand` interno, não abre shell do SO).
  Sem achado.

Nenhum achado novo nesta rodada. `deep-read-log.json` atualizado (+3, 16 no
total para `slackhq/nebula`). Clone temporário removido. `export-queue`
rodado ao final da rodada.

## Rodada 2026-09-07 (rotina agendada, gatilho push)

`program-policy.json` conferido no passo 0 (regra do CLAUDE.md, antes de
escolher qualquer alvo via `check-program`): `Block Open Source` e
`Circle BBP` seguem bloqueados, nenhum repo desses tocado. `Slack` segue
`roeReviewed:true`/`aiResearchBanned:false`, liberado. `list-pending`
global não trouxe nenhum achado pendente em Slack.

Leitura profunda proativa (passo 4, via `list-deep-read-candidates.mjs`)
escolheu `slackhq/nebula` (16 arquivos lidos, 9% coberto — maior espaço
livre entre os candidatos liberados junto com `okx/go-wallet-sdk`, mas
`nebula` ainda não tinha nenhuma rodada dedicada exclusivamente a ele
nesta sessão). Clone raso público, 3 arquivos novos priorizados por
adjacência a handshake/crypto/key ainda não cobertos pelo log:

- `handshake/payload.go` (`MarshalPayload`/`UnmarshalPayload`):
  serialização protobuf manual do payload de handshake IX. Rastreei
  `UnmarshalPayload`/`unmarshalPayloadDetails` com ceticismo (hipótese:
  parsing manual de protobuf é terreno clássico de overflow/aliasing) —
  refutado: cada campo conhecido rejeita wire-type incompatível como erro
  duro (não ignora silenciosamente), `ConsumeVarint`/`ConsumeBytes` tratam
  `n<0` como erro, `CertVersion`/`InitiatorIndex`/`ResponderIndex` checam
  `v>math.MaxUint32` antes do cast pra `uint32` (sem overflow silencioso),
  e `p.Cert` é copiado via `append([]byte(nil), v...)` — sem aliasing do
  buffer de rede recebido. Sem achado.
- `handshake/patterns.go`: só uma tabela estática (`subtypeInfos`)
  mapeando `header.MessageSubType` pro `noise.HandshakePattern` e flags
  de quais mensagens carregam payload/cert — sem lógica de validação de
  peer. Padrão XX ainda comentado/não habilitado. Sem achado.
- `cmd/nebula-cert/keygen.go` (+ `x25519Keypair`/`p256Keypair` em
  `sign.go`, lidos em conjunto por serem os dois call sites da geração de
  chave): ferramenta CLI offline do operador da CA (`nebula-cert keygen`),
  sem input de rede/peer remoto. `x25519Keypair` usa 32 bytes de
  `crypto/rand.Reader` + `curve25519.X25519`; `p256Keypair` usa
  `crypto/ecdh.P256().GenerateKey(rand.Reader)` — geração correta em
  ambos, `fips140.Enforced()` bloqueia X25519 em modo FIPS. Sem achado.

Nenhum achado novo nesta rodada. `deep-read-log.json` atualizado (+3, 19
no total para `slackhq/nebula`). Clone temporário removido. `export-queue`
rodado ao final da rodada.

## Rodada 2026-09-07 #2 (rotina agendada, gatilho push, sessão paralela)

`program-policy.json` conferido no passo 0: `Block Open Source` e
`Circle BBP` seguem bloqueados, nenhum repo desses tocado. `Slack` segue
`roeReviewed:true`/`aiResearchBanned:false`, liberado. `list-pending`
global não trouxe nenhum achado pendente em Slack. (Nota: `git push`
revelou uma sessão paralela que rodou a mesma rotina quase
simultaneamente e já tinha empurrado `okg/NOTES.md` rodada #8 cobrindo
`slackhq/nebula/noiseutil/` — `git reset --hard origin/master` +
`migrate-to-v2.mjs` adotados antes de continuar, pra não sobrescrever o
trabalho dela.)

Leitura profunda proativa desta rodada fechou especificamente a pista
deixada em aberto na entrada de `handshake_manager.go` do log
(`via.IsRelayed` pulando `lighthouse.remote_allow_list` em ~8 call
sites, "anotado como avenida pra rodada futura, não investigado a
fundo") — a sessão paralela não tocou nisso (foi para `noiseutil/`), a
pista continuava genuinamente aberta.

Clone raso público, leitura completa de `relay_manager.go` (605 linhas —
`StartRelays`/`AddRelay`/`EstablishRelay`/`HandleControlMsg`/
`handleCreateRelayRequest`/`handleCreateRelayResponse`) mais
`allow_list.go:270-303` (`RemoteAllowList.Allow`/`AllowAll`/
`getInsideAllowList`) pra confirmar a semântica exata do que
`remote_allow_list` filtra. **Refutado**: `remote_allow_list` é um ACL de
rede sobre o **endereço UDP de transporte** (`udpAddr`) do pacote
recebido — controla de quais faixas de IP este nó aceita handshakes,
documentado em `examples/config.yml:64-71` como filtro de segmentação de
rede ("allow public IPs but only private IPs from a specific subnet"),
não como mecanismo de autenticação de identidade do peer. Para tráfego
relayed, `via.UdpAddr` é o endereço do **relay**, não do peer final —
checar `remote_allow_list` contra o endereço do relay seria
semanticamente incorreto (o relay já passou pelo próprio
`remote_allow_list` quando este nó fez o handshake DIRETO com ele, um
evento anterior e distinto). A identidade criptográfica do peer final
continua validada em todos os casos pelo handshake Noise/certificado
(`handshake/machine.go::validateCert`, já confirmado em rodada anterior:
`bytes.Equal(rc.PublicKey(), m.hs.PeerStatic())`), independente de
`IsRelayed` — `remote_allow_list` nunca foi a linha de defesa de
identidade, só uma camada extra de política de rede sobre o hop de
transporte imediato. Pular essa checagem pra tráfego relayed é portanto
comportamento correto e intencional, não uma vulnerabilidade. Pista
fechada, sem achado.

`relay_manager.go` também revela bom tratamento defensivo em casos
adversariais testados mentalmente: `handleCreateRelayRequest` rejeita
`from == myVpnAddrs` ("Discarding relay request from myself"), valida
que `existingRelay.RemoteIndex` não muda silenciosamente entre mensagens
(early-return em vez de aceitar), e `AddRelay` confere
`hm.unlockedMakePrimary` antes de registrar índice (evita relay
pendurado em hostinfo já derrubado). Sem achado.

`deep-read-log.json` atualizado (+1 entrada, `relay_manager.go`; 22→23
no total para `slackhq/nebula`, já contando a atualização da sessão
paralela). Clone temporário removido. `export-queue` rodado ao final da
rodada.

## Rodada 2026-09-07 #6 (rotina agendada, gatilho push)

`program-policy.json`/`check-program "Slack"` conferidos no passo 0:
`blocked:false`. `migrate-to-v2.mjs` + `research-plan` trouxeram
`actionable: 0` de novo (`list-pending` global vazio) — os 60 candidatos
retidos são de outros programas (Circle BBP bloqueado por escolha do
usuário, duplicate history Kubernetes/Vercel, scope/impacto Mattermost/OKG),
nada acionável em Slack nesta rodada.

Leitura profunda proativa direcionada a `slackhq/nebula` (candidato
liberado por `list-deep-read-candidates.mjs`, 15% coberto, maior
superfície ainda não lida da lista permitida): 3 arquivos novos
priorizados por proximidade com `crypto` no path — `cert/cert.go`
(interface `Certificate` + `Recombine`, o dispatch de deserialização
alcançado diretamente do handshake de rede), `cert/asn1.go` (helpers
ASN.1 usados por `unmarshalDetails`) e `cert/pem.go` (parsing de
PEM local — arquivos de config/CLI do operador, não input de peer
remoto, já que certificados chegam pelo wire em binário via
`Recombine`, não em PEM). Nenhum achado isolado nos três, mas
`cert.go::Recombine` levou a reler `cert_v2.go::unmarshalCertificateV2`/
`unmarshalDetails`/`validate` (arquivo já tinha entrada no log só para
`CheckSignature`, de rodada anterior) com foco em alcançabilidade real:
confirmei que `validate()` não confere o tamanho de `c.publicKey`
contra o que a curva exige (32 bytes Curve25519 / 65 bytes P256
descomprimido) — em tese um vetor pra acionar o panic conhecido do
stdlib (`ed25519.Verify` panica com chave de tamanho errado). Rastreei
todo call site de `c.PublicKey()`/`c.publicKey` no pacote: o único
lugar em que uma chave pública vira argumento de uma função
`Verify` é `CheckSignature`, e ali o argumento é a chave de
**verificação da CA** (`key`, vinda do `ca_pool` já confiável), não
`c.publicKey` (a chave DH do próprio certificado, que só entra como
bytes concatenados dentro do hash assinado — nunca como argumento de
`Verify`). `CheckSignature` já tem guarda explícita pra isso
(`len(key) != ed25519.PublicKeySize -> return false // avoids a panic
internal to ed25519`, comentário dos próprios devs) e usa
`ecdsa.ParseUncompressedPublicKey` pro P256 (retorna erro, não
panica). REFUTADO — não encontrei nenhum caminho onde
`c.PublicKey()` de tamanho arbitrário alcance uma função de
verificação criptográfica sem checagem prévia de tamanho. Sem achado
novo nesta rodada.

`deep-read-log.json` atualizado (+4 entradas em `slackhq/nebula` — os 3
arquivos novos e a revisita anotada de `cert_v2.go` —, 26→30 no total).
Clone temporário removido. `export-queue` rodado ao final da rodada.

## Rodada 2026-09-07 (push automático via GitHub webhook, sessão cloud)

`research-plan` e `list-pending` vazios de novo (`actionable: 0`) —
nada acionável em nenhum programa nesta rodada. Fui para leitura
profunda proativa (`list-deep-read-candidates.mjs`, política/histórico
conferidos antes de qualquer clone, conforme CLAUDE.md).

`slackhq/nebula` continuava sendo o candidato liberado com maior
superfície não lida (17% coberto). 3 arquivos novos, priorizados por
proximidade com `crypto`/`access`/`session`:

- `cert/p256/p256.go` (não lido antes — só os call sites em `sign.go`/
  `cert.go` já tinham sido lidos em rodadas anteriores):
  `IsNormalized`/`Normalize`/`Swap`, normalização low-S de assinaturas
  ECDSA P256. `Normalize` só é chamado ao assinar (`sign.go:132`,
  anti-malleability padrão). `Swap` é chamado só em
  `cert.go:169 CalculateAlternateFingerprint`, que calcula de propósito
  o fingerprint da forma alternativa (high-S) da mesma assinatura válida
  para que o teste de blocklist do `CAPool` cheque as duas formas —
  design defensivo intencional contra evasão de blocklist via
  maleabilidade ECDSA, não um bug. Sem achado.
- `allow_list.go`: árvore CIDR construída a partir de config do
  operador (não de input de rede/peer); `Allow()` nil-safe retorna
  `true` (permite) quando a allowlist não foi configurada — default
  documentado (feature opt-in), não bypass de autenticação. Sem achado.
- `connection_state.go` — **ACHADO NOVO**: `ConnectionState.Decrypt` e
  `VerifyRelay` fazem `Check` → `Decrypt` (sem lock) → `Update` em duas
  seções críticas separadas por `decryptLock.Unlock()`/`Lock()`, TOCTOU
  real (CWE-367/CWE-294) sobre a janela anti-replay (`Bits`, `bits.go`)
  — se duas goroutines processarem o mesmo `messageCounter` (mesmo
  pacote replayed) concorrentemente para a mesma `ConnectionState`,
  ambas podem passar por `Check()` antes de qualquer `Update()`,
  derrotando a proteção anti-replay. Rastreei a cadeia completa:
  `outside.go:132` é o único call site fora de teste; `interface.go`
  confirma que `routines>1` (config `routines`/`listen.routines`,
  default 1) lança uma goroutine `listenOut(i)` por fila UDP, cada uma
  com socket `SO_REUSEPORT` próprio (`udp/udp_linux.go:51-54`); o
  lookup do hostinfo usa `h.RemoteIndex` do header, não o endereço UDP
  de origem (comentário "Roam before we respond" confirma que roaming
  é suportado de propósito) — ou seja, um atacante que capturou um
  pacote legítimo pode reenviar os mesmos bytes de uma porta de origem
  diferente para cair numa fila `SO_REUSEPORT` diferente e abrir a
  corrida. `git log`: o lock foi introduzido no commit `3615a79` ("add
  locks around replay window updates", #1802, 2026-07-20) — antes disso
  não havia lock nenhum (race de memória pior ainda); o PR fechou o
  data race Go mas manteve a mesma estrutura de duas seções separadas
  pelo decrypt caro no meio, sem comentário justificando isso como
  aceitável. Confirmado presente já na tag de release publicada
  `v1.11.0` (`git show v1.11.0:connection_state.go`), não só em HEAD
  não lançado. Pré-condições honestas (severidade não inflada):
  `routines>1` não é default; atacante precisa já ter capturado um
  ciphertext legítimo (observação passiva de rede); precisa reenviar
  com porta de origem diferente (spoofing UDP trivial, sem exigir estar
  exatamente on-path já que não há checagem de origem antes do
  decrypt); janela de timing estreita (decrypt AEAD é da ordem de
  microssegundos). Registrado como
  `Slack::slackhq/nebula/connection_state.go::ConnectionState.Decrypt+VerifyRelay::replay_window_toctou_race`,
  avançado `candidate` → `corroborated_static` (reasoning + filesRead
  salvos, `check-scope` rodado — sem scope snapshot pra Slack ainda —,
  deployment evidence registrada com `confidence="medium"` pelo vínculo
  commit↔tag de release confirmado). Tentativa de `reproduced_local`
  não se aplica: achado Go, sem validador local disponível no sistema
  hoje (mesma limitação conhecida já documentada para outros achados
  não-Solidity) — fica em `corroborated_static`, não forcei nem
  contornei. Sem PoC executável possível para esta classe hoje.

`deep-read-log.json` atualizado (+3 entradas em `slackhq/nebula`,
30→33 no total). Clone temporário removido. `export-queue` rodado ao
final da rodada.

## Rodada 2026-09-08 (push automático via GitHub webhook, sessão cloud)

`research-plan` apontou exatamente 1 item `actionable` no sistema inteiro
(todos os outros 4 programas ativos — StackingDAO, Vercel Open Source,
Circle BBP, Block Open Source — sem candidatos elegíveis nesta rodada;
Circle BBP e Block Open Source seguem bloqueados por `program-policy.json`,
nenhum arquivo dos dois foi tocado): o achado `replay_window_toctou_race`
(`connection_state.go`) da rodada anterior, ação indicada `verify_scope`,
motivo "nenhum scope snapshot existe para este programa". Ação executada
foi só a autorizada por essa indicação — revisar fontes de escopo, não
presumir confirmação.

Criado `research/bugbounty/scope-snapshots/slack.json` (não existia até
agora) a partir do dataset comunitário estruturado
(`arkadiyt/bounty-targets-data`, `hackerone_data.json`, handle `slack`, 19
ativos), mesmo padrão já usado para Kubernetes/OKG/Kiwi.com/Mattermost
neste sistema (`capture-scope-snapshots.mjs` estendido com o bloco Slack).
`check-scope "Slack" "slackhq/nebula"` agora confirma `allowed=true`:
`https://github.com/slackhq/nebula` está explicitamente em escopo
(`SOURCE_CODE`), `eligible_for_bounty=true`, `eligible_for_submission=true`.

**Achado de escopo relevante, registrado sem inflar severidade pra
satisfazer nada**: a instrução anexada a esse ativo no dataset diz
"Accepting Critical severity ONLY as of 2026-05-27. Refer to Out of Scope
section for detailed guidance" — ou seja, o programa hoje só aceita
submissões Critical para `slackhq/nebula`, e a avaliação honesta do TOCTOU
de replay window continua Medium (pré-condições reais: `routines>1`
não-default, spoofing de porta UDP, janela de timing estreita — não é
comprometimento de chave nem RCE). Isso não muda a classificação do
achado; só limita, por ora, a elegibilidade de submissão dele neste
programa especificamente.

Tentei formalmente as duas transições, pra deixar registrado: `record-
validation type=go_race_poc result=not_applicable` (nenhum validador local
existe pra achados Go/race-condition neste pipeline — não inventei nem
simulei um), seguido de `corroborated_static->reproduced_local` (recusada,
esperado) e `corroborated_static->scope_verified` (recusada — a máquina de
estados não tem essa aresta direta; `scope_verified` só é alcançável a
partir de `reproduced_local`). O achado fica em `corroborated_static`,
teto real do sistema hoje pra esta classe. Nenhum rascunho de relatório
escrito nesta rodada — não alcançou `scope_verified`.

Leitura profunda proativa (passo 4) rodada via `list-deep-read-candidates.mjs`
(13 candidatos permitidos pela política/histórico; `slackhq/nebula` seguia
com mais superfície não coberta, 19%). 3 arquivos novos lidos (nenhum lido
em rodadas anteriores desta campanha), priorizando tema
`access`/parsing de input externo: `firewall/packet.go`, `firewall/cache.go`,
`header/header.go`. Sem achado nos três — structs de dados simples, cache
sem mutação compartilhada entre goroutines fora de `atomic.Uint64`, e
parsing de header com bounds check (`len(b) < Len`) antes de indexar.
`deep-read-log.json` atualizado (+3 entradas em `slackhq/nebula`, 33→36 no
total). Clone temporário removido. `export-queue` rodado ao final.

## Rodada 2026-09-08 #2 (push automático, sessão cloud) — fix do bug de metadado que ainda bloqueava check-scope

A rodada anterior (acima) criou o scope-snapshot e confirmou
`check-scope "Slack" "slackhq/nebula"` (owner/repo) → `allowed=true`. Mas
o finding em si continuava sem o campo `repository` gravado
explicitamente — mesmo bug de causa raiz já documentado pro achado irmão
`mattermost-plugin-confluence`: `assetRefForFinding` (`scope-registry.mjs`)
só reduz `owner/repo/caminho/arquivo.go` pra `owner/repo` quando o valor
vem de `finding.file` (heurística de comprimento de path); quando vem de
`finding.asset` (como aqui, `"slackhq/nebula/connection_state.go"`), o
valor é devolvido bruto, sem reduzir. Corrigido nesta rodada com
`update-finding --patch='{"repository":"slackhq/nebula"}'`.

Sem mudança de estado: o achado segue corretamente em
`corroborated_static` — `corroborated_static->reproduced_local` continua
recusado porque não existe validador local pra achados Go/race-condition
neste pipeline (`record-validation type=go_race_poc result=not_applicable`
já registrado em rodada anterior); teto real do sistema hoje pra esta
classe, nada forçado. A avaliação honesta de severidade (Medium, não
Critical) também não muda — não infla pra satisfazer o filtro "Critical
only" do programa.

`export-queue` rodado ao final.

## Rodada 2026-09-08 #3 (push automático, sessão cloud) — leitura profunda adicional em nebula

Sessão iniciada de um checkout anterior a #2 acima; ao tentar empurrar,
`git push` mostrou que duas outras sessões desta mesma rotina já tinham
corrigido o mesmo bug de metadado (`repository`, depois `file`/`asset`) e
reconfirmado o `verify_scope` de Mattermost de forma independente
(commits `7a0a50c`/`e8ab0bf`) — `git reset --hard origin/master` pra essa
versão canônica em vez de empurrar um commit duplicado com reasoning
redundante, mesma disciplina já registrada no adendo de 03/09.

Contribuição incremental desta sessão, além do que já está documentado
acima: 3 arquivos novos em `slackhq/nebula`, ainda não lidos em nenhuma
rodada anterior (`lighthouse.go`, `connection_manager.go`,
`remote_list.go`), escolhidos por serem a superfície de maior confiança
do protocolo ainda não coberta (lighthouse é autoridade central de
mapeamento vpnAddr↔endereço underlay). Em `lighthouse.go`: confirmado que
`handleHostUpdateNotification` só aceita atualizar o `RemoteList` da
própria identidade autenticada pelo transporte (`fromVpnAddrs`, não
spoofável via payload), e `handleHostQueryReply` só é aceito de
lighthouses configurados (`IsAnyLighthouseAddr`); `sendHostPunchNotification`
não é vetor de amplificação de terceiro porque o alvo do punch é sempre a
identidade autenticada de quem perguntou, nunca um IP arbitrário do
payload. `connection_manager.go` e `remote_list.go` operam só sobre
hostinfo já estabelecido/endereços já filtrados pelo allow list do
chamador. Sem achado nos três arquivos. `deep-read-log.json` atualizado
(+3, 36→39 no total). Clone temporário removido. Nenhuma mudança de
estado tentada nesta rodada (nada novo em `actionable`/`candidate` além
do já tratado pelas sessões paralelas).

## Rodada 2026-09-08 #4 (push automático, sessão cloud) — deep-read pkclient/PKCS11 + correção de lost-update no log

`research-plan` confirmou os 4 itens `actionable` da campanha (3 Mattermost
`verify_scope` + 1 Slack `measure_code_age`) já tinham sido totalmente
processados por rodadas anteriores no mesmo dia: os 3 Mattermost seguem
travados em `corroborated_static`/`reproduced_local` por `EGRESS_BLOCKED`
genuíno (WebFetch pra bugcrowd.com/engagements/mattermost-mbb-public
bloqueado pelo proxy desta sessão) — sem evidência nova pra repetir; o
achado Slack/nebula segue em `corroborated_static` pela mesma razão
honesta já registrada (severidade real Medium, programa só aceita
Critical). Nada reexecutado sem motivo.

Ao preparar o push, `git fetch` mostrou que `origin/master` já tinha
avançado (commits `f5d63bc` + `ad9ce83`, sessões paralelas). Rebase via
cherry-pick teve conflito nos arquivos gerados (queue.jsonl,
migration-log.json, deep-read-log.json); em vez de resolver conflito
linha-a-linha num arquivo semi-estruturado, `git checkout -B master
origin/master` pra partir da versão canônica + `migrate-to-v2.mjs` fresco
(contagens de estado idênticas, confirma nada perdido na fila) e
reaplicação manual só das minhas mudanças pontuais.

Nesse processo, identificado um bug real de **lost update** em
`deep-read-log.json`: o commit `f5d63bc` (sessão paralela) partiu de um
checkout anterior ao commit `a7087f6` (que tinha adicionado
`lighthouse.go`/`connection_manager.go`/`remote_list.go` à lista de
`slackhq/nebula`) e, ao gravar suas próprias 3 entradas novas em
`okx/go-wallet-sdk`, sobrescreveu a lista de nebula com a versão antiga
(sem as 3 entradas), perdendo silenciosamente esse registro — não é bug
do CLI (que só toca `queue.jsonl`/db), é `deep-read-log.json` sendo um
arquivo hand-edited por sessões concorrentes sem lock nem merge
estruturado, mesma classe de risco que o bug de `upsertFinding` corrigido
em `ad9ce83` pro banco. Restaurado as 3 entradas perdidas nesta rodada
antes de adicionar as minhas — sem isso, uma rodada futura poderia
reler `lighthouse.go` como se fosse arquivo novo.

Leitura profunda proativa (contribuição desta sessão): 3 arquivos novos em
`slackhq/nebula`, superfície de manuseio de chave privada via PKCS11/HSM
ainda não coberta (`pkclient/pkclient.go`, `noiseutil/pkcs11.go`,
`pkclient/pkclient_cgo.go`). Achado potencial investigado e REFUTADO:
`pkclient_cgo.go::DeriveNoise` faz `copy(secret[:], tmpKey[:NoiseKeySize])`
sem checar `len(tmpKey)>=32` antes do slice — panicaria se o módulo PKCS11
devolvesse segredo curto, mas esse módulo só vem de config local do
operador (`pki.pkcs11` no yaml), nunca de payload de peer remoto; mesma
classe `self_request_only`/`below_campaign_impact` já retida repetidamente
nos achados-irmãos do OKG nesta campanha. Documentado como nota de
robustez, sem finding novo aberto. `deep-read-log.json` atualizado (+3
recuperadas +3 novas, 36→42 no total, refletindo tanto a correção quanto
a contribuição desta rodada). Clone temporário removido. Nenhuma mudança
de estado tentada (nada novo em `actionable`/`candidate`).

`export-queue` rodado ao final.

## Rodada 2026-09-08 #5 (rotina agendada) — bug real de infraestrutura corrigido (`upsertFinding` não persistia file/asset), evidence worker rodado até o fim

Rodei o Evidence Worker (`evidence-worker.mjs`) pra tentar avançar de
verdade o `measure_code_age` do achado `connection_state.go` (ação
`actionable` indicada pelo `research-plan`). Primeira tentativa falhou
com "arquivo não encontrado no histórico da branch padrão": o campo
`file` do finding ainda guardava `slackhq/nebula/connection_state.go`
(prefixo owner/repo indevido — mesma classe de bug já corrigida pro
campo `repository` nos achados-irmãos Mattermost). Corrigi via
`update-finding --patch='{"file":"connection_state.go","asset":"connection_state.go"}'`,
mas o valor **voltava sozinho** a cada `migrate-to-v2`/`get` novo.

**Causa raiz real, em `system/bugbounty-scanner/db.mjs::upsertFinding`**:
o `ON CONFLICT(id) DO UPDATE SET` do SQL só atualizava
`semantic_fingerprint/state/confidence/historical_confidence/reasoning/
files_read_json/poc_run/poc_result/updated_at/raw_json` — nunca
`program/platform/asset/type/language/file/fn/line`. Um `update-finding`
tocando qualquer uma dessas 8 colunas gravava certo em `raw_json` (por
isso a resposta imediata do CLI parecia correta), mas `rowToFinding()`
lê as colunas achatadas via SQL, não `raw_json` — o patch sumia no
próximo `get`/`list`/`migrate-to-v2` pra QUALQUER finding já existente
(só funcionava no INSERT inicial). Corrigido o SQL, adicionado teste de
regressão em `db.test.mjs`, suíte completa validada (613 testes, só as
8 falhas pré-existentes de ferramenta externa ausente neste ambiente
seguem vermelhas — semgrep/osv-scanner/codeql, nada relacionado).
Reaplicado o fix do achado `connection_state.go` (agora persistente de
verdade). Detalhe completo em `research/bugbounty/okg/NOTES.md`
("Rodada 2026-09-08 #4"), commit `ad9ce83`.

Com o bug corrigido, `measure_code_age` rodou de verdade contra
`git log --follow -- connection_state.go` (resultado registrado no
finding; ver `deploymentEvidence`/`codeAgeEvidence` atuais). Achado
segue em `corroborated_static` — sem validador local pra
Go/race-condition, teto real do sistema hoje, nada forçado.

## Rodada 2026-09-08 (sessão cloud, push trigger)

Leitura profunda proativa (3 arquivos, `slackhq/nebula`, ferramenta
`cmd/nebula-cert/`, ainda não lida em rodadas anteriores que cobriram
sobretudo `cert/`/handshake/rede): `verify.go`, `sign.go`, `ca.go`.
Todas são orquestração de flags + I/O de arquivo local pro CLI offline
do operador (gera/assina/verifica certificado), delegando a lógica
criptográfica real pro pacote `cert/` já auditado em rodadas anteriores
(`cert.VerifyPrivateKey`, `caPool.VerifyCertificate`, etc.). Sem input
de rede não autenticado alcançando este código — fora do modelo de
ameaça relevante pra um programa de bug bounty (o "atacante" seria o
próprio operador rodando a CLI contra si mesmo). Sem achado em nenhum
dos 3. `deep-read-log.json` atualizado.

## Rodada 2026-09-08 #2 (sessão cloud, push trigger, continuação da rodada acima)

Antes de escolher alvo: `research-plan` rodado (Passo 0 + CLAUDE.md) —
`list-pending` vazio; os 6 itens `actionable` (todos `OKG::okx/go-wallet-sdk`,
ação `verify_scope`) já tinham sido plenamente processados no commit que
disparou este push (`0cd5f12`, sessão anterior): `check-scope` a nível de
repo confirma `allowed=true`, mas o gate de transição real do `state-machine`
exige o **asset exato** (caminho do arquivo) no snapshot de escopo — que só
lista o repositório, sem granularidade de arquivo — e `deploymentEvidence.
confidence` nunca passa de `unverified` (SDK sem tags/releases Git). Ambos os
motivos já registrados no `reasoning` de cada um dos 6 achados-irmãos; nenhuma
tentativa de forçar/contornar. Nada de novo a fazer ali nesta rodada.

Leitura profunda proativa (3 arquivos novos, `slackhq/nebula`, ainda não
lidos): `dns_server.go`, `punchy.go`, `hostmap.go`.

- `dns_server.go`: hipótese de disclosure de topologia interna / reflection
  UDP via o listener DNS opt-in do lighthouse (`lighthouse.serve_dns`,
  default `0.0.0.0` no `examples/config.yml` — bind em todas interfaces, não
  só a VPN). Refutada: é a funcionalidade documentada e pretendida do recurso
  ("can even be delegated to for resolution"), fator de amplificação baixo, e
  a única parte potencialmente sensível (certificado via TXT/`QueryCert`) já é
  gateada por `isSelfNebulaOrLocalhost` e não é segredo (chave pública
  assinada pela CA).
- `punchy.go`: hipótese de nó autenticado virar canhão de pacotes UDP pra IP
  arbitrário via `handleHostPunchNotification` (função distinta da já
  auditada `sendHostPunchNotification`). Refutada: só alcançável a partir de
  um lighthouse já autenticado via Noise, cada alvo passa por
  `remoteAllowList.Allow` antes do punch, payload de 1 byte sem amplificação
  útil, e o modelo de confiança do lighthouse já concede poder equivalente ou
  maior por outras vias já auditadas.
- `hostmap.go`: hipótese de um hostinfo forjado sequestrar a posição primária
  de outro peer no mapa (`unlockedInnerAddHostInfo` sempre promove o mais
  recente). Refutada: só alcançável após handshake Noise completo com
  certificado válido pela CA — o `vpnAddr` vem do próprio certificado
  assinado, sem caminho de rede não autenticado até essa função.

Sem achado novo nos 3. `deep-read-log.json` atualizado (48 entradas agora em
`slackhq/nebula`, ~25%+ do repo coberto).

## Rodada 2026-09-13 (push automático via GitHub webhook, sessão cloud)

`research-plan`: `actionable` vazio (0), `list-pending` vazio. Checado
`check-program "Slack"` → `{"blocked": false}` antes de tocar o repo (nota
pra próxima rodada: usar sempre esse comando direto, não só confiar no
filtro de `list-deep-read-candidates.mjs`, mesmo que hoje os dois tenham
batido). `list-deep-read-candidates.mjs` apontou 4 candidatos permitidos;
`plaid/plaid-ruby` e `plaid/react-plaid-link` já estavam 100% esgotados
(ver entradas anteriores no log), então leitura profunda desta rodada ficou
só em `slackhq/nebula` (2 arquivos novos, priorizando os que lidam com
input de rede não confiável / cálculo de endereço de peer):

- `iputil/packet.go`: hipótese motivada pelo próprio comentário do código em
  `IPv6FindUpperProtocol` (que se descreve como "single source of truth" e
  documenta fail-closed contra bypass de firewall). Achei uma inconsistência
  real: depois de exaurir as 8 iterações do loop de extension headers sem
  cair no ramo `default:`, o código sai do loop e cai num `return` final que
  NÃO repete a checagem `offset > len(packet)` que o ramo `default:` tem.
  Rastreei os 2 únicos chamadores (`outside.go::parseV6` e
  `iputil/packet.go::ipv6CreateRejectPacket`) e ambos revalidam limites de
  forma independente antes de qualquer leitura em `data[offset:...]` — a
  falta da guarda redundante não chega a virar leitura fora dos limites nem
  bypass de firewall observável. REFUTADO como vulnerabilidade (é um code
  smell real, não um bug explorável). De passagem, também notei que
  `CreateRejectPacket` (IPv4) nunca valida `ihl >= ipv4.HeaderLen` antes de
  fatiar o suposto header TCP — ao contrário de `parseV4`, que exige isso
  explicitamente — mas é só corretude cosmética do pacote de RST/ICMP de
  diagnóstico devolvido, sem leitura fora dos limites nem bypass. Sem
  achado.
- `calculated_remote.go`: mecanismo de "chute" de endereço de peer
  (`lighthouse.calculated_remotes`) inteiramente alimentado por config local
  do operador; o `vpnAddr` usado vem do certificado assinado pela CA, não é
  forjável por payload de rede. Sem achado.

`deep-read-log.json` atualizado (50 entradas agora em `slackhq/nebula`).
Nenhum finding novo criado nesta rodada — resultado normal e válido.

## Rodada 2026-09-14 (scheduled task, sessão cloud)

`migrate-to-v2.mjs` + `research-plan`: `actionable` vazio (0), `list-pending`
vazio (0). Checado `check-program` para os 4 programas mencionados na
descrição desta task (StackingDAO, Vercel Open Source, Block Open Source,
Circle BBP) antes de tocar qualquer repositório: Block Open Source e Circle
BBP seguem `blocked:true` (confirmados de novo, nenhum não tocado); Vercel
Open Source segue sem nada em `actionable` (todos os findings pendentes
retidos por `campaign_duplicate_history`/`previous_submission`); StackingDAO
não tem repositório reconhecido no dataset público atual do
`list-deep-read-candidates.mjs` (aparece na lista "revise à mão antes de
ler", não em candidatos nem em excluídos) — não iniciei leitura ali sem uma
correspondência de escopo real. Também checado `change-events.jsonl` para
StackingDAO/Vercel Open Source com os critérios estritos do CLAUDE.md
(`changedFiles` + `introducedCommit` completo + `directSingleCommit=true` +
≤48h): zero eventos qualificaram (o mais recente com essa forma é de
2026-09-10T20:48Z, já fora da janela de 48h a partir de 2026-09-14).

Sem candidato de fila e sem novo alvo autorizado por change-event recente,
segui para leitura profunda proativa via `list-deep-read-candidates.mjs`
(ferramenta indicada pelo CLAUDE.md para essa seleção, já aplicando
histórico de campanha). `plaid/plaid-ruby` e `plaid/react-plaid-link`
seguem 100% esgotados. `okx/go-wallet-sdk` tinha mais cobertura restante,
mas escolhi `slackhq/nebula` por já ter contexto acumulado desta sessão de
notas. 3 arquivos novos lidos (nenhum arquivo restante batia literalmente
com as palavras-chave auth/session/crypto/token/login/password/admin/
permission/access no caminho — usei julgamento: escolhi os mais próximos
do caminho crítico de rede/handshake/credencial ainda não cobertos):

- `interface.go`: orquestrador de threads/filas (tun queues, udp writers,
  batch coalescers, cpu pinning) que liga overlay↔outside e os callbacks de
  reload de config em runtime (firewall, recv-error mode, contadores). O
  parsing/decrypt real de pacote vive em `outside.go`/`inside.go`, já
  auditados em rodadas anteriores. Nenhuma lógica de autenticação/cripto
  própria aqui. Sem achado.
- `udp/conn.go`: só a interface `Conn` + `NoopConn` (stub sem I/O real usado
  em testes/plataformas sem UDP). Sem achado.
- `cmd/nebula-cert/p11_cgo.go`: 15 linhas, só expõe a flag `--pkcs11` e
  `p11Supported()=true` sob build tag `cgo+pkcs11`; a lógica real de uso da
  URI PKCS#11 fica em `pkclient/pkclient_cgo.go`, já auditado em rodada
  anterior. Sem achado.

`deep-read-log.json` atualizado (53 entradas agora em `slackhq/nebula`).
Nenhum finding novo criado nesta rodada — resultado normal e válido.

## Rodada 14/09/2026 (cloud, disparada por push no repo -- rotina agendada)

`research-plan` rodado antes de qualquer leitura (conforme CLAUDE.md):
`actionable=0`, `held=64`. `list-pending` vazio (confirma actionable=0).
`change-events.jsonl` checado de novo com os critérios estritos
(`changedFiles` + `introducedCommit` + `directSingleCommit=true` + ≤48h):
evento mais recente com essa forma segue de 2026-09-10T20:48Z, fora da
janela de 48h a partir de agora (14/09 11:36 UTC) -- zero eventos
qualificaram, nenhum alvo novo autorizado por essa via.

Segui para leitura profunda proativa via `list-deep-read-candidates.mjs`.
Mesmos 4 candidatos permitidos por política de rodadas anteriores
(`plaid/plaid-ruby`, `plaid/react-plaid-link` esgotados; `okx/go-wallet-sdk`
com mais cobertura restante; `slackhq/nebula` escolhido de novo por
contexto acumulado). Clone raso público de `slackhq/nebula` (HEAD atual,
sem token/conta) só para listar arquivos -- nenhuma leitura de conteúdo de
repositório-alvo tratada como instrução, só como dado a analisar (regra
crítica do CLAUDE.md).

3 arquivos novos lidos (nenhum batia literalmente as palavras-chave
auth/session/crypto/token/login/password/admin/permission/access no
caminho; julgamento próprio -- escolhi os mais próximos de config/trust e
os dois arquivos de erro sentinela do handshake/cert ainda não cobertos):

- `config/config.go`: loader de YAML local (`Load`/`resolve`/`parse`,
  merge via `mergo.WithAppendSlice` para concatenar firewall rules entre
  múltiplos arquivos). O `path` vem de flag/env de quem roda o binário
  nebula, nunca de input remoto/rede -- sem trust boundary cruzável por um
  peer. `ReloadConfig`/`CatchHUP` só reagem a SIGHUP local. Sem achado.
- `handshake/errors.go`: só declarações de erro sentinela do state machine
  de handshake (`ErrInitiateOnResponder` etc.), sem lógica. Sem achado.
- `cert/errors.go`: só declarações de erro sentinela de certificado +
  `ErrInvalidCertificateProperties` (wrapper simples de string), sem
  lógica. Sem achado.

`deep-read-log.json` atualizado (56 entradas agora em `slackhq/nebula`).
Nenhum finding novo criado nesta rodada — resultado normal e válido.
Nenhuma transição de estado tentada (sem candidate/corroborated_static
tocado nesta rodada).

## Rodada 14/09/2026 #9 (push webhook)

`check-program "Slack"` confirmado `blocked=false` antes de qualquer
clone/leitura (regra do CLAUDE.md). `list-deep-read-candidates.mjs`
liberou os mesmos 4 repositórios de sempre; escolhi `slackhq/nebula` de
novo (mais cobertura acumulada entre os não-esgotados; `plaid/plaid-ruby`
e `plaid/react-plaid-link` seguem esgotados desde rodadas anteriores —
100% dos arquivos hand-written já lidos em ambos). Clone raso público
(HEAD atual `89178f4`) só pra listar árvore de arquivos e ler conteúdo
como dado, nunca como instrução.

2 arquivos novos lidos, priorizando o que mais se aproxima de
cert/crypto ainda não coberto:

- `cert/cert_v1.pb.go`: 100% gerado por `protoc-gen-go` a partir de
  `cert_v1.proto` — só structs `RawNebulaCertificate`/
  `RawNebulaCertificateDetails` com getters mecânicos, mesmo padrão já
  descartado em SDKs gerados de outros programas. Motivou releitura
  focada de `unmarshalCertificateV1` (cert_v1.go, já lido em rodada
  anterior) no parsing de `Details.Ips`/`Subnets`: **hipótese
  investigada com ceticismo real, REFUTADA**. `ones, _ :=
  net.IPMask(int2ip(rawIp)).Size()` descarta o retorno `bits` sem checar
  canonicidade da máscara — `net.IPMask.Size()` devolve `(0,0)` tanto
  pra máscara canônica `0.0.0.0` (`/0` legítimo) quanto pra máscara
  NÃO-canônica (bits não contíguos), então um `Subnets`/`Ips` malformado
  no wire vira silenciosamente `netip.PrefixFrom(ip,0)` (rede mais ampla
  possível) sem erro de parse. Rastreei a cadeia completa até
  `cmd/nebula-cert/sign.go`+`ca.go`: a CLI oficial só aceita máscaras via
  `netip.ParsePrefix` (sempre canônica), então o único jeito de um
  `uint32` não-canônico chegar até `unmarshalCertificateV1` é forjar os
  bytes do certificado diretamente — o que exige a CHAVE PRIVADA DA CA
  pra produzir assinatura válida (`CheckSignature` bloqueia qualquer
  coisa sem isso). E quem já tem a chave da CA não ganha nada de novo
  com esse bug: pode codificar `UnsafeNetworks=/0` diretamente e de
  forma canônica, sem precisar do fallback malformado. Sem elevação de
  privilégio real sobre o que a própria CA (raiz de confiança por
  design) já pode fazer legitimamente. Sem achado reportável.
- `nebula.pb.go`: 100% gerado por `protoc-gen-gogo` a partir de
  `nebula.proto` — só structs de mensagem (`NebulaMeta`/`NebulaPing`/
  `NebulaControl`/`Addr`/`V4AddrPort`/`V6AddrPort`) com getters/
  marshal/unmarshal mecânicos, sem lógica de validação própria. Sem
  achado.

`deep-read-log.json` atualizado (60→63 entradas em `slackhq/nebula`).
Nenhum finding novo criado nesta rodada — resultado normal e válido.
Nenhuma transição de estado tentada.

## Rodada 14/09/2026 #10 (push webhook)
`list-pending` vazio; `research-plan` só devolveu o `actionable` de OKG
(ver NOTES.md do OKG). Leitura profunda proativa (passo 4) avaliou
`plaid/plaid-ruby` e `plaid/react-plaid-link` primeiro (menor cobertura
na listagem de `list-deep-read-candidates.mjs`), mas confirmei que
ambos já estão esgotados: `plaid-ruby` só tem `lib/models/*` restante,
100% classes de dados geradas por `openapi-generator` (confirmado via
`plaid.rb`, puro `autoload` mecânico, e grep por
`webhook|jwt|verify|signature` fora de `models/` não bate em nada além
dos 4 arquivos não-gerados já lidos); `react-plaid-link` não tem nenhum
`src/*.ts(x)` não-teste restante (os 8 arquivos já cobertos são o
pacote inteiro). Voltei para `slackhq/nebula`: 3 arquivos novos —
`service/listener.go` (`tcpListener` do stack gvisor embutido, só
mecânica de canal Go sob mutex, sem decisão de autorização própria),
`cmd/nebula/main.go` (entrypoint — parse de flags e wiring de
`config.NewC.Load`/`nebula.Main`, já auditados em rodada anterior, sem
lógica de segurança nova) e `routing/gateway.go`
(`CalculateBucketsForGateways`, bucketing hash-threshold puramente
aritmético sobre `gateways`/`weight` vindos da config local do
operador, sem input de rede/peer remoto). Sem achado novo em nenhum dos
três. `deep-read-log.json` atualizado (63→66 entradas em
`slackhq/nebula`).

## Rodada 15/09/2026 (push webhook)
`list-pending` vazio; `research-plan` só devolveu o `actionable` de OKG
(ver NOTES.md do OKG). Leitura profunda proativa: 5 arquivos novos em
`slackhq/nebula` (66→71 no `deep-read-log.json`), escolhidos por
julgamento próprio já que não sobrou nenhum caminho batendo literalmente
com as palavras-chave do CLAUDE.md (auth/session/crypto/token/...) —
priorizei superfícies de segurança do host (firewall/debug endpoint):
`pprof_debug.go`/`pprof_nodebug.go` (servidor pprof, bind fixo em
`localhost:6060`, atrás de build tag `debug` — não exposto por padrão;
sem achado), `noiseutil/fips140enforce.go` (guarda de build que só faz
panic se FIPS não estiver de fato forçado; sem achado) e, com mais
profundidade, `wfp/wfp_windows.go` + seus dois chamadores
(`overlay/tun_bypass_windows.go`, `udp/udp_bypass_windows.go`).

Esse último grupo levantou uma HIPÓTESE séria antes de eu refutar:
`PermitUDPPort` instala um filtro WFP `PERMIT` **global** (todas as
interfaces, não só a interface virtual do nebula) para a porta UDP do
listener, com `FWPM_FILTER_FLAG_CLEAR_ACTION_RIGHT` (derruba a
prioridade de regras concorrentes do Windows Defender Firewall na mesma
sublayer), e o gate fica em `listen.windows_bypass_wdf: true` por
padrão — ou seja, *opt-out*, não *opt-in*, sem nenhum prompt de
consentimento do usuário no momento em que acontece. Cheguei a
levantar isso como possível redução silenciosa da postura de firewall
local. REFUTEI ao confirmar que é comportamento **conhecido e
documentado publicamente**: `CHANGELOG.md` (entrada do PR #1710) avisa
explicitamente sobre o efeito e já ensina como desativar via
`tun.windows_bypass_wdf`/`listen.windows_bypass_wdf: false`, e
`examples/config.yml` tem o mesmo aviso comentado ao lado da opção. O
próprio código deixa explícito que o padrão de tipos/constantes foi
"derived from the wireguard-windows firewall package (MIT)" — é a
mesma solução estabelecida de um projeto de VPN irmão pro mesmo
problema estrutural (WFP fica abaixo do WDF; sem isso o daemon nem
consegue receber o handshake inicial de forma confiável). Não é
vulnerabilidade não-divulgada; é feature documentada com opt-out
disponível. Sem achado reportável.

`overlay/route.go` (`parseRoutes`/`parseUnsafeRoutes`): entrada vem do
próprio arquivo de config YAML local do operador (`tun.routes`/
`tun.unsafe_routes`), nunca de peer remoto — fora do modelo de ameaça
do projeto. Validação de containment correta nos dois sentidos. Sem
achado.

Nenhum achado novo nesta rodada — resultado normal e válido. Nenhuma
transição de estado tentada.

## Rodada 15/09/2026c (rotina agendada, mesmo push webhook)
`check-program`/`program-policy.json` reconfirmados (`roeReviewed`,
`aiResearchBanned: false`, programa liberado). Mais 3 arquivos de
`slackhq/nebula` lidos via leitura profunda proativa (nenhum
sobreposto com a rodada anterior): `pkclient/pkclient_stub.go`,
`config/default.go`, `cmd/nebula-service/service.go` — nenhum tem
lógica própria relevante (stub vazio, resolução de caminho local a
partir do próprio executável, wrapper de serviço OS sobre lib de
terceiros já reputada). Sem achado. Ver NOTES.md do OKG para o
diagnóstico (repetido, mesma causa raiz) do bloqueio estrutural de
`verify_prior_art`.

## Rodada 15/09/2026d (scheduled task, sessão cloud)

`check-program "Slack"`/`check-program "Plaid"` reconfirmados
(`blocked:false` nos dois) antes de qualquer clone. `research-plan`
trouxe o mesmo único `actionable` do sistema inteiro
(`verify_prior_art` do OKG — ver NOTES.md do OKG, mesmo bloqueio
estrutural de proxy já documentado, sem novidade). `list-deep-read-
candidates.mjs` confirmou `plaid/plaid-ruby` e `plaid/react-plaid-link`
100% esgotados (nenhum arquivo hand-written restante fora de
`/models/` gerado e `/spec/`/`*.test.tsx`).

Leitura profunda proativa em `slackhq/nebula` (4 arquivos novos, sem
sobreposição com as 74 entradas já no log; nenhum caminho restante
batia literalmente com as palavras-chave auth/session/crypto/token/
login/password/admin/permission/access — julgamento próprio priorizou
a fronteira de I/O de pacote do tun/checksum, ainda não coberta):

- `overlay/user.go`: implementação de tun userspace via `io.Pipe`,
  usada só em testes/embedding (`Read`/`Write`/`Close`/`Queues` são
  wrappers finos, sem parsing de pacote nem lógica de autorização).
  Sem achado.
- `overlay/tio/tio.go`: só definições de interface
  (`QueueSet`/`Queue`/`Packet`/`GSOInfo`) e helpers de delegação
  (`Clone`/`SupportsGSO`) — nenhuma lógica executável de parsing. Sem
  achado.
- `cmd/nebula-cert/p11_stub.go`: stub sob build tag `!cgo || !pkcs11`,
  espelha `pkclient/pkclient_stub.go` já lido (`p11Supported` sempre
  `false`, `p11Flag` retorna ponteiro pra string vazia). Sem achado.
- `iputil/checksum.go`: `SetTransportChecksum`/`setTransportChecksum4`/
  `6` recalculam o checksum TCP/UDP de pacote vindo do tun antes de
  reinjetá-lo (kernel entrega com checksum de transporte incompleto
  quando offloaded pro NIC). Tentei refutar via limites: todo slice
  (`packet[ihl:end]`, `transport[:ulen]`, `transport[at:at+2]`) é
  precedido por checagem contra `len(packet)`/`len(transport)`
  (`ihl<ipv4.HeaderLen`, `end<ihl||end>len(packet)`,
  `ulen<udpHeaderLen||ulen>len(transport)`,
  `len(transport)<minLen`) antes de qualquer leitura/escrita;
  fragmento IPv4 (`flags&0x3fff!=0`) e caminho IPv6 com
  `anyFragment`/`offset>=end` são descartados cedo, sem alcançar os
  slices. Sem overflow nem escrita fora dos limites — REFUTADO. Sem
  achado.

`deep-read-log.json` atualizado (+4 entradas em `slackhq/nebula`,
74→78 no total). Clone temporário removido. Nenhum finding novo criado
nesta rodada — resultado normal e válido. `export-queue` rodado ao
final.
