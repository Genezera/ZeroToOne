# ⚠️ REVIEW CHECKLIST — READ BEFORE SUBMITTING, THEN DELETE THIS SECTION

Everything below the `---` line is the actual report — copy from there
down. This section above the line is only for you; do not paste it.

Before copying/pasting and submitting, check:

- [ ] Scope confirmed — the affected asset is in the program's scope
      RIGHT NOW (scope can change; re-confirm on the program page before
      submitting)
- [ ] Category confirmed — matches a category the program declares
      eligible for a reward (not metadata/cosmetic)
- [ ] Evidence checked — the code excerpts and the PoC output below
      really exist/ran as described (not paraphrase/hallucination)
- [ ] Not a duplicate — checked against reports you've already
      submitted to this program (zero related security advisories/
      issues found in the repository at the time of this scan — see
      the duplicate-check section below)

**⏱ TIMING:** Arc Chain is on private mainnet right now (100+
institutional/ecosystem builders onboarded), with public mainnet
confirmed for **September 16, 2026** (~2 weeks away). Publicly announced
founding validators: **BlackRock, DTCC, Galaxy, Mastercard, Visa,
Standard Chartered, ICE, MoneyGram, SBI Group, Sumitomo** (source:
circle.com/pressroom, 2026-08-30). This is likely the software protecting
real financial institutions' validator keys right now, with the window
until public launch shrinking. Worth submitting soon.

Re-checked on 2026-08-31, right before writing this: current `main`
commit is `a9e9fdb48c1e96a6c3fb875aba3d341e6a8af1a6` (2026-06-18, a
trivial CI-only change, nothing security-relevant). `configs/app.yaml`
still ships `tls.enabled: false` by default right now, and `public.go`
still has no auth/interceptor/token/credential logic anywhere. Nothing
has changed since the proof of concept below was run.

---

## Title
The `SignerService` gRPC service of the validator remote-signing sidecar
(`arc-remote-signer`) requires no authentication whatsoever — any network
caller can make the validator sign arbitrary consensus messages with the
enclave key

## Program / Platform
Circle BBP via HackerOne — https://hackerone.com/circle-bbp

## Category / Declared severity
Access-control failure / missing authentication on a critical function
(CWE-306) in a blockchain validator infrastructure component
(`asset_type: SOURCE_CODE`, `eligible_for_bounty: true`,
`max_severity: critical` — confirmed via the program's real scope
snapshot, and independently re-confirmed live on the HackerOne scope
table on 2026-08-31: `circlefin/arc-remote-signer`, type "Source code",
**In scope**, max severity **Critical**, **Eligible**). Not metadata, not
cosmetic: the affected service signs consensus messages with the Arc
Chain validator's private key.

## Affected asset
- Repository: `circlefin/arc-remote-signer`
- File: `internal/app/public/public.go` (server construction),
  `internal/common/grpc/server/server.go` and `option.go` (interceptors
  and TLS)
- Lines: `public.go:39-72` (`New`), `server.go` (`NewServer`),
  `option.go:86-99` (`WithTLS`)
- Commit/branch at time of analysis: `main` @
  `a9e9fdb48c1e96a6c3fb875aba3d341e6a8af1a6` (re-verified live on
  2026-08-31 — re-check the SHA again right before submitting, in case
  the code changes further)
- Deployment link: real public repository, Apache 2.0 licensed and
  published by Circle (not a fork, not experimental code). The real
  protocol client (`circlefin/arc-node`,
  `crates/remote-signer/src/config.rs::RemoteSigningConfig::default()`)
  uses exactly this insecure configuration by default — endpoint
  `http://0.0.0.0:10340` (plain HTTP, not HTTPS) and `enable_tls: false`
  — evidence that the vulnerable posture is the real software's default
  behavior, not an exotic configuration. Arc Chain is on PRIVATE mainnet
  **right now** (100+ institutional builders) with PUBLIC mainnet on
  **2026-09-16** — publicly announced founding validators: BlackRock,
  DTCC, Galaxy, Mastercard, Visa, Standard Chartered, ICE, MoneyGram, SBI
  Group, Sumitomo (circle.com/pressroom, 2026-08-30). **Confidence:
  medium** — strong, dated evidence that the network is active with real
  validators, but no confirmation of the specific IP/instance running
  this software right now; confirm this manually before submitting.

## Summary
`arc-remote-signer` is a remote-signing sidecar for the Arc Chain
validator (a design derived from `avalanchego`'s external signer, cited
in the code itself). It exposes a gRPC service (`SignerService`) with a
`Sign(message bytes) -> signature bytes` RPC that signs ANY received
message with the validator's private key, held in an AWS Nitro Enclave.
The gRPC server has no authentication/authorization interceptor at all,
and even when TLS is enabled, it is one-directional TLS only
(authenticates the server to the client, never the reverse) — there is
no mTLS, API key, JWT, or any other mechanism confirming the caller is
actually the legitimate validator process. The only documented
protection is network-level (AWS VPC security group). Any principal able
to reach the service's port (via SSRF from another service in the same
VPC, security-group misconfiguration, lateral movement, etc.) can make
the validator sign arbitrary consensus messages — risk of
equivocation/double-signing and possible slashing, without needing to
compromise the enclave itself.

## Confirmed call chain
1. `proto/arc/signer/v1/signer.proto` — defines `SignerService.Sign` with
   NO authentication/token field whatsoever in the `SignRequest` message
   (just `bytes message`).
2. `internal/app/public/public.go:39-72` (`New`) — assembles the gRPC
   server: calls `grpcServer.WithTLS(cfg.TLS)`, registers
   `SignerServiceServer` and reflection. No mention of auth.
3. `internal/common/grpc/server/server.go` (`NewServer`) — the
   interceptor chain is `[WithRecovery, WithRequestID, WithMetrics,
   WithLogging]` plus whatever is passed via `UnaryInterceptors` (only
   used for Prometheus metrics). No authentication interceptor on any
   path.
4. `internal/common/grpc/server/option.go:86-99` (`WithTLS`) — uses only
   `credentials.NewServerTLSFromFile` (one-sided TLS); the function
   doesn't even have a parameter for a client CA/mTLS.
5. `configs/app.yaml` (default/dev config) explicitly documents
   `tls.enabled: false` with the comment "tls secures the malachite ->
   sidecar gRPC connection. Disabled by default", and `host: 0.0.0.0`
   (binds on all interfaces, not just loopback).
6. `docs/architecture.md`, "Production Deployment Notes"/"AWS
   Prerequisites" section, confirms the ONLY documented protection is
   network-level (VPC security group) — no mention of
   application-level authorization control.
7. Confirmed client-side in `circlefin/arc-node` (the real validator
   software): `crates/remote-signer/src/client.rs::RemoteSignerClient`
   is the code the validator actually uses to call
   `SignerService.Sign`. `crates/remote-signer/src/config.rs::
   RemoteSigningConfig::default()` confirms the same insecure pattern on
   the client side: default endpoint `http://0.0.0.0:10340`,
   `enable_tls: false` by default. When TLS is enabled, `client.rs` uses
   only `ClientTlsConfig::new().ca_certificate(...)` — no client
   certificate configured (`with_client_auth`/`identity()` don't exist
   in the file) — confirming, from the client side too, that even with
   TLS enabled there is no mTLS.
8. Comparison with the design of the consensus engine this validator
   runs (`circlefin/malachite`, `crates/signing/src/lib.rs`): the
   `Signer<Ctx>`/`Verifier<Ctx>` traits explicitly document that every
   signature type needs domain separation ("no two (scope, extension)
   pairs produce the same preimage bytes"). `arc-remote-signer`'s
   `SignerService.Sign` is the structural opposite of that design: it
   signs arbitrary bytes with no notion of purpose/scope — even if the
   transport were authenticated, the interface already gives up the
   domain-separation guarantee the ecosystem itself documents as
   necessary for validator keys.
9. `docs/architecture.md`, "Security Model" section (read in full):
   documents the KEY's protection in detail (hardware isolation,
   envelope encryption, attestation-bound KMS via PCR) — the word
   "authenticate"/"authorization" has ZERO occurrences in the entire
   document. Confirms the absence of authentication on the `Sign()`
   request is not a documented, accepted design decision (unlike other
   cases already closed in this same effort where a public audit
   explicitly documented an equivalent behavior as intentional) — it's a
   real blind spot in the project's threat model: it protects the key
   from whoever has host access, but never discusses who can REQUEST a
   signature over the network.

## Prerequisites
No real user credentials needed. To reproduce: network access to the
`SignerService` port (in the published default configuration,
`0.0.0.0:10340` with TLS disabled) — in the real-world scenario, this
corresponds to a network principal within the same VPC/subnet (another
compromised service, SSRF, security-group misconfiguration).

## Steps to reproduce
1. The Arc Chain validator runs `arc-remote-signer` as a sidecar,
   exposing `SignerService` on the configured port (default `10340`,
   TLS disabled by default).
2. Any network caller (within the service's network reach) connects via
   gRPC with no credentials at all.
3. Calls `Sign(SignRequest{message: <arbitrary bytes>})`.
4. The server processes the call normally and returns
   `SignResponse{signature: <a real signature from the validator's
   key>}`.

## Actual vs. expected result
- **Actual:** any network caller who can reach the service's port
  obtains a valid signature from the validator's key for any message,
  with no authentication at all.
- **Expected:** the service should authenticate the caller (mTLS, a
  shared token, or equivalent) before signing — the same pattern
  industry validator remote-signing systems already use (e.g.,
  Tendermint/CometBFT KMS, which implements `SecretConnection` with a
  station-to-station handshake and pre-shared node keys).

## Evidence
```go
// internal/app/public/public.go:39-72 (New)
func New(cfg *grpcServer.Config, params CreateServerParams) (lifecycle.Runnable, error) {
  opts, err := grpcServer.WithTLS(cfg.TLS)
  // ...
  grpcSrv := grpcServer.NewServer(engineParams, opts...)
  reflection.Register(grpcSrv)
  pb.RegisterSignerServiceServer(grpcSrv, params.SignerSvc)
  // no auth interceptor anywhere
}
```
```go
// internal/common/grpc/server/option.go:86-99 (WithTLS)
func WithTLS(cfg *TLSConfig) ([]grpc.ServerOption, error) {
  if cfg != nil && cfg.Enabled {
    // ...
    creds, err := credentials.NewServerTLSFromFile(cfg.Cert, cfg.Key)
    // ONE-SIDED TLS only — no ClientCAs, no RequireAndVerifyClientCert
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

## Executable proof of concept
Built a real Go toolchain (Go 1.27, `buf` v1.50.0,
`protoc-gen-go`/`protoc-gen-go-grpc`, all via `go install`, no Docker)
and generated real protobuf code from the repository's own `.proto`
(`buf generate`, zero errors). Wrote a Go test
(`internal/app/public/poc_unauth_test.go`, only on the local clone,
never committed to the real repository) that uses the **real
production** function `public.New()` — the actual source code, not a
reimplementation — to assemble the gRPC server exactly as `app.Run()`
does, with a minimal `SignerServiceServer` stand-in for the real
`signer.Service` (which would require real AWS KMS/Secrets Manager or
Localstack via Docker — out of scope for this specific check, which is
about the ABSENCE OF AN INTERCEPTOR, not the signing logic itself).

Exact command:
```
go install github.com/bufbuild/buf/cmd/buf@v1.50.0
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.6
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.5.1
cd proto && buf generate
cd .. && go test ./internal/app/public/... -run TestUnauthenticatedSignIsAccepted -v
```

Real output (literal, 2026-08-30):
```
=== RUN   TestUnauthenticatedSignIsAccepted
2026/08/30 18:29:15 gRPC server listening on 127.0.0.1:57080
{"time":"2026-08-30T18:29:15.7539059-03:00","level":"INFO","msg":"gRPC request completed","logger":"common.middleware","method":"/arc.signer.v1.SignerService/Sign","userAgent":"grpc-go/1.79.3","requestID":"b5c254b5-0159-4efa-9b63-f6fd5bff9be4","status":"OK","requestTimeMS":0,"clientIP":"127.0.0.1","mdc":{"clientIP":"127.0.0.1","method":"/arc.signer.v1.SignerService/Sign","requestID":"b5c254b5-0159-4efa-9b63-f6fd5bff9be4","requestTimeMS":0,"status":"OK","userAgent":"grpc-go/1.79.3"}}
    poc_unauth_test.go:112: RESULT: Sign() was ACCEPTED with NO credentials/authentication at all. response="FAKE-SIGNATURE-JUST-TO-PROVE-IT-GOT-HERE" — finding REPRODUCED: the real gRPC server (public.New(), no reimplementation) processes Sign() from any network caller.
2026/08/30 18:29:15 initiating graceful shutdown of gRPC server at 127.0.0.1:57080
2026/08/30 18:29:15 gRPC server gracefully stopped
--- PASS: TestUnauthenticatedSignIsAccepted (0.03s)
PASS
ok  	github.com/circlefin/arc-remote-signer/internal/app/public	1.220s
```

The server's own real middleware request log confirms `"status":"OK"` —
the unauthenticated call was processed as a legitimate request. No real
network, no real key/enclave, ephemeral local server, shut down at the
end of the test (minimal-impact principle).

## Impact
An attacker able to reach the `SignerService` port (SSRF from another
service in the same VPC, security-group misconfiguration, lateral
movement after compromising another host on the same subnet) can make
the Arc Chain validator sign ANY consensus message with the enclave key
— without needing to compromise the enclave/key itself. This opens real
risk of equivocation/double-signing (signing two conflicting values at
the same consensus height/round), which in BFT systems typically results
in validator slashing and, depending on Arc Chain's specific consensus
design, could contribute to broader availability/integrity attacks on
the network. The enclave's hardware-isolation guarantee protects the KEY
against extraction, but does not protect against WHO CAN REQUEST a
signature — and today, that's anyone who can reach the port.

## Suggested fix
Add mutual authentication (mTLS with `RequireAndVerifyClientCert` +
`ClientCAs`, or an equivalent caller-identity mechanism) to
`SignerService`, following the same pattern industry validator
remote-signing systems already implement (e.g., Tendermint/CometBFT
KMS). Localized change in `internal/common/grpc/server/option.go`
(`WithTLS`) and `configs/app.yaml` (enable TLS + configure a client CA by
default, don't leave `tls.enabled: false` as the default).
