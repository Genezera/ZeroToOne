# ⚠️ RASCUNHO — REVISÃO HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de análise de código-fonte
público e prova de conceito executada localmente (Go, servidor gRPC
real rodando em ambiente isolado — nunca contra o sistema real).
**Não foi enviado a nenhuma plataforma.** Antes de copiar/colar e
enviar, confira:

- [ ] Escopo confirmado — o ativo afetado está no escopo do programa AGORA
      (escopo pode mudar; reconfirme na página do programa antes de enviar)
- [ ] Categoria confirmada — bate com uma categoria que o programa
      declara como elegível para recompensa (não é metadado/cosmético)
- [ ] Evidência conferida — os trechos de código e a saída da prova de
      conceito abaixo realmente existem/rodaram como descrito (não foi
      paráfrase/alucinação)
- [ ] Não é duplicata — checado contra relatórios já enviados por você
      a este programa (zero security advisories/issues relacionados
      encontrados no repositório no momento desta varredura — ver seção
      de checagem de duplicata abaixo)

**Estado no sistema: `human_ready`** (grau de evidência E3 — reprodução
determinística local real, ver seção de PoC). Deployment evidence com
confidence **"medium"** — ver seção "Ativo afetado".

**⏱ URGÊNCIA REAL:** Arc Chain está em mainnet PRIVADA agora (100+
builders institucionais/ecossistema onboardados), com mainnet PÚBLICA
confirmada para **16 de setembro de 2026** (~2 semanas a partir desta
varredura). Validadores fundadores anunciados publicamente:
**BlackRock, DTCC, Galaxy, Mastercard, Visa, Standard Chartered, ICE,
MoneyGram, SBI Group, Sumitomo** (fonte: circle.com/pressroom,
30/08/2026). Isso não é infraestrutura hipotética — é o software que
provavelmente protege chaves de validador de instituições financeiras
reais agora, com a janela até o lançamento público encolhendo. Vale
priorizar a revisão e o envio deste relatório.

---

## Título
Serviço gRPC `SignerService` do sidecar de assinatura remota de
validador (`arc-remote-signer`) não exige nenhuma autenticação —
qualquer chamador de rede consegue fazer o validador assinar mensagens
de consenso arbitrárias com a chave da enclave

## Programa / Plataforma
Circle BBP via HackerOne — https://hackerone.com/circle-bbp

## Categoria / Severidade declarada
Falha de controle de acesso / ausência de autenticação em função crítica
(CWE-306) num componente de infraestrutura de validador de blockchain
(`asset_type: SOURCE_CODE`, `eligible_for_bounty: true`,
`max_severity: critical` — confirmado via scope snapshot real do
programa). Não é metadado nem cosmético: o serviço afetado assina
mensagens de consenso com a chave privada do validador Arc Chain.

## Ativo afetado
- Repositório: `circlefin/arc-remote-signer`
- Arquivo: `internal/app/public/public.go` (construção do servidor),
  `internal/common/grpc/server/server.go` e `option.go` (interceptors e
  TLS)
- Linhas: `public.go:39-72` (`New`), `server.go` (`NewServer`),
  `option.go:86-99` (`WithTLS`)
- Commit/branch no momento da análise: `main` (verificar SHA atual antes
  de enviar — o código pode ter mudado desde a varredura)
- Vínculo de deploy: repositório público real, licenciado Apache 2.0 e
  publicado pela Circle (não fork/não código experimental). O cliente
  real do protocolo (`circlefin/arc-node`,
  `crates/remote-signer/src/config.rs::RemoteSigningConfig::default()`)
  usa exatamente essa configuração insegura por padrão — endpoint
  `http://0.0.0.0:10340` (HTTP puro, não HTTPS) e `enable_tls: false` —
  evidência de que a postura vulnerável é o comportamento padrão do
  software real, não uma configuração exótica. Arc Chain está em
  mainnet **privada agora** (100+ builders institucionais) com mainnet
  **pública em 16/09/2026** — validadores fundadores anunciados
  publicamente: BlackRock, DTCC, Galaxy, Mastercard, Visa, Standard
  Chartered, ICE, MoneyGram, SBI Group, Sumitomo
  (circle.com/pressroom, 30/08/2026). **Confidence: medium** — evidência
  forte e datada de que a rede está ativa com validadores reais, mas sem
  confirmação de IP/instância específica rodando este software agora;
  confirme isso manualmente antes de enviar.

## Resumo
`arc-remote-signer` é um sidecar de assinatura remota para o validador
da Arc Chain (design derivado do external signer do `avalanchego`,
citado no próprio código). Ele expõe um serviço gRPC (`SignerService`)
com um RPC `Sign(message bytes) -> signature bytes` que assina QUALQUER
mensagem recebida com a chave privada do validador, mantida numa AWS
Nitro Enclave. O servidor gRPC não tem nenhum interceptor de
autenticação/autorização, e mesmo quando TLS está habilitado, é apenas
TLS unidirecional (autentica o servidor pro cliente, nunca o contrário)
— não há mTLS, API key, JWT ou qualquer outro mecanismo que confirme
que o chamador é de fato o processo validador legítimo. A única
proteção documentada é de rede (security group da AWS VPC). Qualquer
principal capaz de alcançar a porta do serviço (via SSRF de outro
serviço na mesma VPC, misconfiguração de security group, movimento
lateral, etc.) consegue fazer o validador assinar mensagens de
consenso arbitrárias — risco de equivocation/double-signing e possível
slashing, sem precisar comprometer a enclave em si.

## Cadeia de chamada confirmada
1. `proto/arc/signer/v1/signer.proto` — define `SignerService.Sign`
   sem NENHUM campo de autenticação/token na mensagem `SignRequest`
   (só `bytes message`).
2. `internal/app/public/public.go:39-72` (`New`) — monta o servidor
   gRPC: chama `grpcServer.WithTLS(cfg.TLS)`, registra
   `SignerServiceServer` e reflection. Nenhuma menção a auth.
3. `internal/common/grpc/server/server.go` (`NewServer`) — cadeia de
   interceptors é `[WithRecovery, WithRequestID, WithMetrics,
   WithLogging]` mais o que for passado em `UnaryInterceptors` (só usado
   pra métricas Prometheus). Nenhum interceptor de autenticação em
   nenhum caminho.
4. `internal/common/grpc/server/option.go:86-99` (`WithTLS`) — usa
   exclusivamente `credentials.NewServerTLSFromFile` (TLS de um lado
   só); a função nem tem parâmetro para CA de cliente/mTLS.
5. `configs/app.yaml` (config default/dev) documenta explicitamente
   `tls.enabled: false` com o comentário "tls secures the malachite ->
   sidecar gRPC connection. Disabled by default", e `host: 0.0.0.0`
   (bind em todas interfaces, não só loopback).
6. `docs/architecture.md`, seção "Production Deployment Notes"/"AWS
   Prerequisites", confirma que a ÚNICA proteção documentada é de rede
   (security group da VPC) — nenhuma menção a controle de autorização
   em nível de aplicação.
7. Lado cliente confirmado em `circlefin/arc-node` (o software real do
   validador): `crates/remote-signer/src/client.rs::RemoteSignerClient`
   é o código que o validador usa de verdade para chamar
   `SignerService.Sign`. `crates/remote-signer/src/config.rs::
   RemoteSigningConfig::default()` confirma o mesmo padrão inseguro do
   lado servidor: endpoint padrão `http://0.0.0.0:10340`, `enable_tls:
   false` por padrão. Quando TLS é habilitado, `client.rs` usa só
   `ClientTlsConfig::new().ca_certificate(...)` — nenhum certificado de
   cliente configurado (`with_client_auth`/`identity()` não existem no
   arquivo) — confirmando, do lado cliente, que mesmo com TLS habilitado
   não há mTLS.
8. Comparação com o design do motor de consenso que este validador
   roda (`circlefin/malachite`, `crates/signing/src/lib.rs`): os
   traits `Signer<Ctx>`/`Verifier<Ctx>` documentam explicitamente que
   cada tipo de assinatura precisa de separação de domínio ("no two
   (scope, extension) pairs produce the same preimage bytes"). O
   `SignerService.Sign` do `arc-remote-signer` é o oposto estrutural
   desse design: assina bytes arbitrários sem noção de propósito/escopo
   — mesmo que o transporte fosse autenticado, a interface já abre mão
   da garantia de domínio que o próprio ecossistema documenta como
   necessária para chaves de validador.
9. `docs/architecture.md`, seção "Security Model" (lida por completo):
   documenta em detalhe a proteção da CHAVE (isolamento de hardware,
   criptografia envelope, KMS vinculado a attestation via PCR) — a
   palavra "authenticate"/"authorization" tem ZERO ocorrências no
   documento inteiro. Confirma que a ausência de autenticação no
   request do `Sign()` não é uma decisão de design documentada como
   aceitável (diferente de casos já fechados nesta mesma missão onde um
   audit público documentava explicitamente um comportamento equivalente
   como intencional) — é um ponto cego real do threat model do projeto:
   protege a chave de quem tem acesso ao host, nunca discute quem pode
   PEDIR uma assinatura pela rede.

## Pré-requisitos
Nenhuma credencial de usuário real. Para reproduzir: acesso de rede à
porta do `SignerService` (na configuração padrão publicada,
`0.0.0.0:10340` sem TLS) — no cenário real, isso corresponde a um
princípio de rede dentro da mesma VPC/subnet (outro serviço
comprometido, SSRF, misconfiguração de security group).

## Passo a passo de reprodução
1. O validador Arc Chain roda `arc-remote-signer` como sidecar,
   expondo `SignerService` na porta configurada (padrão `10340`, sem
   TLS habilitado por padrão).
2. Um chamador de rede qualquer (dentro do alcance de rede do serviço)
   conecta via gRPC sem nenhuma credencial.
3. Chama `Sign(SignRequest{message: <bytes arbitrários>})`.
4. O servidor processa a chamada normalmente e retorna
   `SignResponse{signature: <assinatura real da chave do validador>}`.

## Resultado atual vs. esperado
- **Atual:** qualquer chamador de rede que alcance a porta do serviço
  consegue obter uma assinatura válida da chave do validador para
  qualquer mensagem, sem nenhuma autenticação.
- **Esperado:** o serviço deveria autenticar o chamador (mTLS, token
  compartilhado, ou equivalente) antes de assinar — o mesmo padrão que
  sistemas de remote signing de validador do setor usam (ex.:
  Tendermint/CometBFT KMS, que implementa `SecretConnection` com
  station-to-station handshake e node keys pré-compartilhadas).

## Evidência
```go
// internal/app/public/public.go:39-72 (New)
func New(cfg *grpcServer.Config, params CreateServerParams) (lifecycle.Runnable, error) {
  opts, err := grpcServer.WithTLS(cfg.TLS)
  // ...
  grpcSrv := grpcServer.NewServer(engineParams, opts...)
  reflection.Register(grpcSrv)
  pb.RegisterSignerServiceServer(grpcSrv, params.SignerSvc)
  // nenhum interceptor de auth em lugar nenhum
}
```
```go
// internal/common/grpc/server/option.go:86-99 (WithTLS)
func WithTLS(cfg *TLSConfig) ([]grpc.ServerOption, error) {
  if cfg != nil && cfg.Enabled {
    // ...
    creds, err := credentials.NewServerTLSFromFile(cfg.Cert, cfg.Key)
    // TLS de UM LADO SÓ — sem ClientCAs, sem RequireAndVerifyClientCert
    return []grpc.ServerOption{grpc.Creds(creds)}, nil
  }
  return []grpc.ServerOption{}, nil
}
```
```yaml
# configs/app.yaml
tls:
  enabled: false  # "secures the malachite -> sidecar gRPC connection. Disabled by default"
host: 0.0.0.0
```

## Prova de conceito executável
Toolchain Go real montado (Go 1.27, `buf` v1.50.0,
`protoc-gen-go`/`protoc-gen-go-grpc`, todos via `go install`, sem
Docker) e código protobuf real gerado a partir do `.proto` do próprio
repositório (`buf generate`, zero erro). Escrito um teste Go
(`internal/app/public/poc_unauth_test.go`, só na cópia local clonada,
nunca commitado no repositório real) que usa a função de **produção
real** `public.New()` — mesmo código-fonte, não reimplementação — para
montar o servidor gRPC exatamente como `app.Run()` faz, com um
`SignerServiceServer` mínimo no lugar do `signer.Service` real (que
exigiria AWS KMS/Secrets Manager reais ou Localstack via Docker — fora
do escopo desta checagem específica, que é sobre a AUSÊNCIA DE
INTERCEPTOR, não sobre a lógica de assinatura em si).

Comando exato:
```
go install github.com/bufbuild/buf/cmd/buf@v1.50.0
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.6
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.5.1
cd proto && buf generate
cd .. && go test ./internal/app/public/... -run TestUnauthenticatedSignIsAccepted -v
```

Saída real (literal, 30/08/2026):
```
=== RUN   TestUnauthenticatedSignIsAccepted
2026/08/30 18:29:15 gRPC server listening on 127.0.0.1:57080
{"time":"2026-08-30T18:29:15.7539059-03:00","level":"INFO","msg":"gRPC request completed","logger":"common.middleware","method":"/arc.signer.v1.SignerService/Sign","userAgent":"grpc-go/1.79.3","requestID":"b5c254b5-0159-4efa-9b63-f6fd5bff9be4","status":"OK","requestTimeMS":0,"clientIP":"127.0.0.1","mdc":{"clientIP":"127.0.0.1","method":"/arc.signer.v1.SignerService/Sign","requestID":"b5c254b5-0159-4efa-9b63-f6fd5bff9be4","requestTimeMS":0,"status":"OK","userAgent":"grpc-go/1.79.3"}}
    poc_unauth_test.go:112: RESULTADO: Sign() foi ACEITO sem NENHUMA credencial/autenticacao. resposta="ASSINATURA-FALSA-SO-PRA-PROVAR-QUE-CHEGOU-AQUI" — achado REPRODUZIDO: o servidor gRPC real (public.New(), sem reimplementacao) processa Sign() de qualquer chamador de rede.
2026/08/30 18:29:15 initiating graceful shutdown of gRPC server at 127.0.0.1:57080
2026/08/30 18:29:15 gRPC server gracefully stopped
--- PASS: TestUnauthenticatedSignIsAccepted (0.03s)
PASS
ok  	github.com/circlefin/arc-remote-signer/internal/app/public	1.220s
```

O próprio log de middleware de request REAL do servidor confirma
`"status":"OK"` — a chamada não-autenticada foi processada como
requisição legítima. Nenhuma rede real, nenhuma chave/enclave real,
servidor efêmero local, encerrado ao fim do teste (princípio de menor
impacto).

## Impacto
Um atacante capaz de alcançar a porta do `SignerService` (SSRF a partir
de outro serviço na mesma VPC, misconfiguração de security group,
movimento lateral após comprometer outro host na mesma subnet) consegue
fazer o validador da Arc Chain assinar QUALQUER mensagem de consenso
com a chave da enclave — sem precisar comprometer a enclave/chave em
si. Isso abre risco real de equivocation/double-signing (assinar dois
valores conflitantes na mesma altura/rodada de consenso), que em
sistemas BFT tipicamente resulta em slashing do validador e pode, a
depender do design específico do consenso Arc Chain, contribuir para
ataques mais amplos de disponibilidade/integridade da rede. A garantia
de isolamento de hardware da enclave protege a CHAVE contra extração,
mas não protege contra QUEM PODE PEDIR uma assinatura — e hoje,
qualquer um que alcance a porta.

## Correção sugerida
Adicionar autenticação mútua (mTLS com `RequireAndVerifyClientCert` +
`ClientCAs`, ou um mecanismo equivalente de identidade do chamador) ao
`SignerService`, seguindo o mesmo padrão que sistemas de remote signing
de validador do setor já implementam (ex.: Tendermint/CometBFT KMS).
Mudança localizada em `internal/common/grpc/server/option.go`
(`WithTLS`) e `configs/app.yaml` (habilitar TLS + configurar client CA
por padrão, não deixar `tls.enabled: false` como default).

---
*Gerado a partir do achado
`Circle BBP::arc-remote-signer/internal/app/public/public.go::SignerService.Sign::ai_deep_read_finding`
na fila (`research/bugbounty/queue.jsonl`). Ver histórico completo do
veredito em `ledger/ledger.research.jsonl`.*
