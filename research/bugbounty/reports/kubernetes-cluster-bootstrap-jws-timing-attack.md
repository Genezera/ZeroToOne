# Non-Constant-Time HMAC Comparison in `cluster-bootstrap`'s `DetachedTokenIsValid` (kubeadm Bootstrap Token Verification)

## Program / Platform
Kubernetes via HackerOne — https://hackerone.com/kubernetes

## Category / Severity
Observable Timing Discrepancy (CWE-208) in a cryptographic signature comparison. I'm not self-assigning a severity label — the real question for triage is how much practical weight to give a network-remote timing side-channel, which depends on factors (network path, exact deployment) I can't test from here; see "Impact" below for the real reasoning, including what this finding does and does not demonstrate.

## Affected asset
- Repository: `kubernetes/cluster-bootstrap`
- File: `token/jws/jws.go`
- Function: `DetachedTokenIsValid`
- Line: 81 (`return detachedToken == newToken`)
- Also present, byte-for-byte identical, in the vendored copy inside `kubernetes/kubernetes` at `staging/src/k8s.io/cluster-bootstrap/token/jws/jws.go`, and used at `cmd/kubeadm/app/discovery/token/token.go:183`.
- Confirmed against the current stable release `v1.37.0` (published 2026-08-26, not a release candidate) for both repositories, and against current `main`/`master` HEAD — identical in both.

## Summary
`DetachedTokenIsValid` verifies a bootstrap token's JWS signature (HS256, i.e. HMAC-SHA256, a symmetric algorithm) by comparing the computed signature against the received one with Go's plain `==` string operator, which compares byte-by-byte and returns as soon as it finds a mismatch. A cryptographic MAC comparison needs to run in constant time regardless of where the first differing byte is — otherwise the comparison's execution time leaks information about how many leading bytes were guessed correctly, which is exactly what `crypto/hmac.Equal` (Go's own standard-library function for this) exists to prevent. I built an isolated benchmark reproducing only this exact primitive and confirmed, with real statistical significance, that this specific comparison behaves as described below — not as a theoretical concern.

## Confirmed call chain
1. `token/jws/jws.go:76-82` — `DetachedTokenIsValid(detachedToken, content, tokenID, tokenSecret string) bool` recomputes the expected HS256 signature via `ComputeDetachedSignature`, then returns `detachedToken == newToken`.
2. `cmd/kubeadm/app/discovery/token/token.go:183` (inside `validateClusterInfoToken`) — this is the only real caller. `kubeadm join`, when using token-based discovery, first connects to the target API server with TLS verification disabled (`BuildInsecureBootstrapKubeConfig` sets `InsecureSkipTLSVerify: true`) to fetch the `cluster-info` ConfigMap, which carries the real cluster's `kubeconfig` (including its CA certificate) plus a JWS signature over that content, keyed by the bootstrap token's secret (shared out-of-band between whoever runs `kubeadm join` and the cluster admin). `DetachedTokenIsValid` is the only check that a response received over this deliberately-insecure connection actually comes from someone who knows the token secret, before the joining node trusts the CA it just received.
3. If pinned CA hashes weren't also configured, this JWS check is the entire trust anchor for that exchange — nothing else validates the response's origin at that point in the flow.

## Prerequisites
An actor positioned to intercept and respond to the insecure discovery request a node sends while running `kubeadm join` with a bootstrap token — concretely, a network man-in-the-middle position between the joining node and the real control-plane endpoint, active during the token's validity window (24 hours by default, operator-configurable). This does not require possessing the token secret itself — that is precisely what the attack targets. I have not verified whether any particular cluster's network topology makes this position easy or hard to obtain; that's deployment-specific.

## Steps to reproduce (description only — not tested against any real Kubernetes cluster or infrastructure)
This describes how the primitive would play out during a real `kubeadm join` bootstrap; I did not perform these steps against a live cluster.
1. A node begins `kubeadm join <endpoint> --token <id>.<secret>` (or the equivalent discovery-by-token flow), which triggers an insecure GET of the `cluster-info` ConfigMap at `<endpoint>`.
2. An attacker in a position to intercept or respond to that request, without knowing `<secret>`, would need to produce a JWS signature over attacker-controlled `kubeconfig` content that `DetachedTokenIsValid` accepts.
3. Because the comparison in step 1 of "Confirmed call chain" is not constant-time, an attacker able to make many repeated timing-measured attempts against the comparison (whether directly, or by any means that lets them observe how long verification takes for different candidate signatures) has, in principle, more information available to them than a properly constant-time comparison would leak — the basis for the CWE-208 classification.

## Current vs. expected result
- **Current:** `DetachedTokenIsValid` compares the signature with `==`, whose execution time depends on the position of the first mismatched byte.
- **Expected:** the comparison should use `hmac.Equal(a, b []byte) bool` (Go standard library, `crypto/hmac`) or `subtle.ConstantTimeCompare`, both designed specifically to avoid leaking timing information about a secret-derived comparison.

## Evidence
`token/jws/jws.go` (current, confirmed identical at `v1.37.0` and at HEAD):
```go
func DetachedTokenIsValid(detachedToken, content, tokenID, tokenSecret string) bool {
	newToken, err := ComputeDetachedSignature(content, tokenID, tokenSecret)
	if err != nil {
		return false
	}
	return detachedToken == newToken
}
```
📷 See attached screenshot `k8s-jws-01-detachedtokenisvalid-source.png`.

`cmd/kubeadm/app/discovery/token/token.go` (the real, only caller):
```go
if !tokenjws.DetachedTokenIsValid(detachedJWSToken, insecureKubeconfigString, token.ID, token.Secret) {
	return nil, errors.New("failed to verify JWS signature of received cluster info object, can't trust this API Server")
}
```
📷 See attached screenshot `k8s-jws-02-kubeadm-caller-source.png`.

The same repository already documents constant-time comparison as its own stated standard for bootstrap token secrets, which this function does not follow: `token/util/helpers.go`'s `IsValidBootstrapToken` carries the comment "Avoid using BootstrapTokenRegexp.MatchString(token) and instead perform constant-time comparisons on the secret," and `randBytes` (used by `GenerateBootstrapToken`) is separately implemented "in constant-time" per its own comment. `DetachedTokenIsValid` is inconsistent with a principle this codebase has already adopted elsewhere in the same package.
📷 See attached screenshot `k8s-jws-03-helpers-constanttime-comment.png`.

**Duplicate/history check**: no public GitHub Security Advisory on either `kubernetes/kubernetes` or `kubernetes/cluster-bootstrap` addresses this. A search of issues and pull requests for related terms returned no match specific to this comparison (the closest result, an issue about removing the `go-jose` dependency, concerns an unrelated CVE in OIDC test code). This does not rule out an existing private report on this program.

## Proof of concept
I built an isolated Go benchmark that reproduces only the exact comparison primitive from `DetachedTokenIsValid` — it does not call `go-jose` or the real function, to keep the measurement focused on the one property under test. Using Go's own `testing.B` benchmark framework and the official `golang.org/x/perf/cmd/benchstat` tool (not a hand-rolled timer), I compared:
- `==` (the current code) vs. `hmac.Equal` (the suggested fix)
- against two inputs of otherwise identical length: one differing from the correct signature only at the first character, one differing only at the last character

Ran with `n=10` rounds of 2,000,000 iterations each, on two separate machines/terminals independently:

```
Run 1:
  ==         : first-byte-mismatch vs last-byte-mismatch -> +86.73% (p=0.000, n=10)
  hmac.Equal : first-byte-mismatch vs last-byte-mismatch -> ~ no difference (p=0.631, n=10)

Run 2 (independent re-run):
  ==         : first-byte-mismatch vs last-byte-mismatch -> +97.09% (p=0.000, n=10)
  hmac.Equal : first-byte-mismatch vs last-byte-mismatch -> ~ no difference (p=0.280, n=10)
```
📷 See attached screenshot `k8s-jws-04-benchmark-run-output.png`.
📷 See attached screenshot `k8s-jws-05-benchstat-comparison.png`.

Both independent runs agree: the current comparison shows a large, highly statistically significant timing difference depending on where the mismatch occurs (p<0.001 both times); the suggested fix shows no such difference (p>0.05 both times). This demonstrates, with real statistical rigor, that `DetachedTokenIsValid`'s comparison is measurably non-constant-time. It does not demonstrate a successful end-to-end forgery over a real network against a real cluster — that depends on network conditions (jitter, path, sampling opportunity) that a local benchmark cannot test, and which I have no authorization or means to test against live infrastructure. Remote timing attacks against short cryptographic comparisons are a real, published attack class, genuinely harder to execute than local ones; I'm stating that distinction plainly rather than implying I've proven more than I have.

Minimal, dependency-free version of the same primitive:
```go
package timingpoc

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

var secret = []byte("this-is-a-32-byte-long-secret-k")

func computeSig(content string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(content))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

var correctSig = computeSig("some-jws-payload-content")

func flip(s string, pos int) string {
	b := []byte(s)
	if b[pos] == 'A' {
		b[pos] = 'B'
	} else {
		b[pos] = 'A'
	}
	return string(b)
}

var earlyMismatch = flip(correctSig, 0)
var lateMismatch = flip(correctSig, len(correctSig)-1)

func nonConstantEqual(a, b string) bool { return a == b }
func constantTimeEqual(a, b string) bool { return hmac.Equal([]byte(a), []byte(b)) }

func BenchmarkNonConstant_EarlyMismatch(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = nonConstantEqual(earlyMismatch, correctSig)
	}
}
func BenchmarkNonConstant_LateMismatch(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = nonConstantEqual(lateMismatch, correctSig)
	}
}
func BenchmarkConstantTime_EarlyMismatch(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = constantTimeEqual(earlyMismatch, correctSig)
	}
}
func BenchmarkConstantTime_LateMismatch(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = constantTimeEqual(lateMismatch, correctSig)
	}
}
```
To reproduce: save as `timing_test.go` alongside a `go.mod` (`module timingpoc` / `go 1.21`), then run `go test -bench Benchmark -benchtime 2000000x -count 10 .` (on Windows PowerShell, use a space rather than `=` before the `Benchmark` value — `-bench=.` is known to misbehave in some PowerShell configurations). Compare the two `NonConstant_*` results against each other, and the two `ConstantTime_*` results against each other; optionally feed paired outputs into `benchstat` for the formal significance test shown above.

## Impact
The current implementation makes `DetachedTokenIsValid`'s timing behavior depend on how much of a forged signature matches the correct one, instead of leaking nothing beyond pass/fail — demonstrated directly, with statistical significance, by the PoC above. This is the specific, proven claim: I am not asserting that this has been used to successfully forge a token or MITM a real cluster, only that the verification primitive itself does not behave the way a secret-derived comparison must to avoid a timing side channel.

- The realistic consequence, if the timing signal is exploitable in a given network position, is that the bootstrap-token-based discovery flow's core integrity guarantee (that a response over the insecure discovery connection was produced by someone who holds the token secret) would be weaker than intended, potentially letting an attacker without the secret construct a valid-looking signature and have a joining node trust an attacker-supplied cluster CA.
- I have not enumerated how much of that theoretical consequence is achievable against a real deployment — that depends on the attacker's actual network position and how much noise is present on that path, which a local benchmark cannot speak to either way.
- This does not require possessing or guessing the bootstrap token's secret directly; the entire point of the finding is that the comparison may leak enough to make that unnecessary.

## Suggested fix
Replace the comparison in `DetachedTokenIsValid` with a constant-time equivalent:
```go
func DetachedTokenIsValid(detachedToken, content, tokenID, tokenSecret string) bool {
	newToken, err := ComputeDetachedSignature(content, tokenID, tokenSecret)
	if err != nil {
		return false
	}
	return hmac.Equal([]byte(detachedToken), []byte(newToken))
}
```
`crypto/hmac.Equal` is already a transitive dependency of this file (`ComputeDetachedSignature` uses `go-jose`, which itself uses HMAC), so this adds no new dependency — only an added `crypto/hmac` import if not already present, and swaps one operator for one existing standard-library function.
