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
