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
