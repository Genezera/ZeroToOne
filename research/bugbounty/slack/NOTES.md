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
