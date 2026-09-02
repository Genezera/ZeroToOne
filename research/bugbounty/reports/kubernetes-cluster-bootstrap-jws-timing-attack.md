# Timing Side-Channel in Bootstrap Token JWS Verification via Non-Constant-Time HMAC Comparison (`cluster-bootstrap`'s `DetachedTokenIsValid`)

## Program / Platform
Kubernetes via HackerOne — https://hackerone.com/kubernetes

## Category / Severity
Observable Timing Discrepancy (CWE-208) — specifically, a secret-derived cryptographic MAC compared with a non-constant-time operator, which is a narrower and more security-relevant claim than "some timing difference exists somewhere." I'm not self-assigning a severity label — the real question for triage is how much practical weight to give this given that I did not find a concrete, repeatable mechanism for a remote attacker to observe the timing signal against `kubeadm`'s actual call pattern (see "Impact"); that gap is real and I'd rather state it than have triage discover it.

## Affected asset
- Repository: `kubernetes/cluster-bootstrap`
- File: `token/jws/jws.go`
- Function: `DetachedTokenIsValid`
- Line: 81 (`return detachedToken == newToken`)
- Also present, byte-for-byte identical, in the vendored copy inside `kubernetes/kubernetes` at `staging/src/k8s.io/cluster-bootstrap/token/jws/jws.go`, and used at `cmd/kubeadm/app/discovery/token/token.go:183`.
- Confirmed against the current stable release `v1.37.0` (published 2026-08-26, not a release candidate) for both repositories, and against current `main`/`master` HEAD — identical in both.

## Summary
`DetachedTokenIsValid` verifies a bootstrap token's JWS signature (HS256, i.e. HMAC-SHA256, a symmetric, secret-derived MAC — 32 raw bytes, 43 base64url characters with no padding) by comparing the computed signature against the received one with Go's plain `==` string operator, which compares byte-by-byte and returns as soon as it finds a mismatch. The security property this breaks is specific: **the comparison's execution time becomes correlated with how many leading bytes of a secret-derived MAC a candidate got right** — e.g. a candidate matching only the first byte (`A???...` vs the correct `AXYZ...`) returns faster than one matching the first 42 of 43 bytes (`AXYZ...?` vs `AXYZ...Z`). That correlation is exactly what `crypto/hmac.Equal` (Go's own standard-library function for this) exists to eliminate. I built an isolated benchmark reproducing only this exact primitive and confirmed, with real statistical significance and reproduced independently three times, that this correlation is measurable in this specific comparison — not a theoretical concern. **What this does not establish on its own is a concrete, repeatable mechanism for a remote attacker to observe that timing signal against `kubeadm`'s actual call pattern** — see "Impact" for why that gap matters and what I did and didn't find while looking for one.

## Confirmed call chain
1. `token/jws/jws.go:76-82` — `DetachedTokenIsValid(detachedToken, content, tokenID, tokenSecret string) bool` recomputes the expected HS256 signature via `ComputeDetachedSignature`, then returns `detachedToken == newToken`.
2. `cmd/kubeadm/app/discovery/token/token.go:183` (inside `validateClusterInfoToken`) — this is the only real caller. `kubeadm join`, when using token-based discovery, first connects to the target API server with TLS verification disabled (`BuildInsecureBootstrapKubeConfig` sets `InsecureSkipTLSVerify: true`) to fetch the `cluster-info` ConfigMap, which carries the real cluster's `kubeconfig` (including its CA certificate) plus a JWS signature over that content, keyed by the bootstrap token's secret (shared out-of-band between whoever runs `kubeadm join` and the cluster admin). `DetachedTokenIsValid` is the only check that a response received over this deliberately-insecure connection actually comes from someone who knows the token secret, before the joining node trusts the CA it just received.
3. This matters most when `kubeadm join` is run without `--discovery-token-ca-cert-hash` (i.e. without CA pinning): in that configuration, `validateClusterCA` is skipped entirely (`pubKeyPins.Empty()` short-circuits the function), so `DetachedTokenIsValid` is the *only* check standing between the joining node and trusting an attacker-supplied CA. When a pinned hash *is* configured, the pinned-CA check is a second, independent gate on the same exchange — the finding's relevance is strongest in the no-pinning case, which the project's own docs note is a real, supported configuration (there's a separate, explicitly-named `--discovery-token-unsafe-skip-ca-verification` flag for an even weaker mode, implying pinning itself is already treated as the optional hardening layer, not something always present).
4. I looked specifically for a mechanism that would let an attacker obtain *repeated*, timing-observable attempts against this comparison within a single `kubeadm join` invocation, since that's what a practical timing attack needs. I did not find one: `getClusterInfo` (the function that fetches the ConfigMap before verification) retries via `wait.PollUntilContextTimeout`, but its retry condition only checks whether the JWS signature *key is present* in the fetched ConfigMap's data (`if _, ok := cm.Data[...]; !ok { ...retry... }`) — it does not call `DetachedTokenIsValid` at all. Verification happens exactly once, in `validateClusterInfoToken`, after `getClusterInfo` already returned successfully. I'm stating this gap plainly rather than implying a retry-driven oracle exists — see "Impact" for what this means for practical exploitability.

## Prerequisites
An actor positioned to intercept and respond to the insecure discovery request a node sends while running `kubeadm join` with a bootstrap token — concretely, a network man-in-the-middle position between the joining node and the real control-plane endpoint, active during the token's validity window (24 hours by default, operator-configurable). This does not require possessing the token secret itself — that is precisely what the attack targets. I have not verified whether any particular cluster's network topology makes this position easy or hard to obtain; that's deployment-specific.

## Steps to reproduce (description only — not tested against any real Kubernetes cluster or infrastructure)
This describes how the primitive would play out during a real `kubeadm join` bootstrap; I did not perform these steps against a live cluster.
1. A node begins `kubeadm join <endpoint> --token <id>.<secret>` (or the equivalent discovery-by-token flow), which triggers an insecure GET of the `cluster-info` ConfigMap at `<endpoint>`.
2. An attacker in a position to intercept or respond to that request, without knowing `<secret>`, would need to produce a JWS signature over attacker-controlled `kubeconfig` content that `DetachedTokenIsValid` accepts.
3. Because the comparison in step 1 of "Confirmed call chain" is not constant-time, its execution time is, in principle, correlated with how much of the attacker's candidate signature matches — information a properly constant-time comparison would not leak. I have not identified a concrete mechanism by which the joining node's internal comparison timing becomes observable to a network-positioned attacker within `kubeadm`'s actual single-shot call pattern (see point 4 of "Confirmed call chain" and "Impact"); I'm naming this gap explicitly rather than asserting a working oracle that I have not demonstrated.

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
**What this section demonstrates and what it doesn't**: the benchmark below proves the local, isolated timing property — that the comparison's duration is measurably correlated with mismatch position — with real statistical rigor. It does not demonstrate a remote-observable oracle or a working exploit; see "Impact" for exactly what gap that leaves. I'm stating that up front so the numbers below are read in that context rather than out of it.

I built an isolated Go benchmark that reproduces only the exact comparison primitive from `DetachedTokenIsValid` — it does not call `go-jose` or the real function, to keep the measurement focused on the one property under test. Using Go's own `testing.B` benchmark framework and the official `golang.org/x/perf/cmd/benchstat` tool (not a hand-rolled timer), I compared:
- `==` (the current code) vs. `hmac.Equal` (the suggested fix)
- against two inputs of otherwise identical length: one differing from the correct signature only at the first character, one differing only at the last character

Ran with `n=10` rounds of 2,000,000 iterations each. Reproduced independently three times (once by me, twice by a second person on a separate machine/terminal); the run shown in the attached screenshots:

```
==         : first-byte-mismatch vs last-byte-mismatch -> +107.66% (p=0.000, n=10)
```
📷 See attached screenshot `k8s-jws-04-benchmark-run-output.png` (raw benchmark output, all four series).
📷 See attached screenshot `k8s-jws-05-benchstat-comparison.png` (formal statistical comparison of the `==` series from that same run).

Two earlier independent runs of the same benchmark (not separately screenshotted, same code, same methodology) showed the identical pattern: `==` at +86.73% (p=0.000, n=10) and +97.09% (p=0.000, n=10) respectively, while `hmac.Equal` showed no significant difference in either (p=0.631 and p=0.280). All three runs agree: the current comparison shows a large, highly statistically significant timing difference depending on where the mismatch occurs (p<0.001 every time); the suggested fix shows no such difference. This demonstrates, with real statistical rigor reproduced three times, that `DetachedTokenIsValid`'s comparison is measurably non-constant-time. It does not demonstrate a successful end-to-end forgery over a real network against a real cluster — that depends on network conditions (jitter, path, sampling opportunity) that a local benchmark cannot test, and which I have no authorization or means to test against live infrastructure. Remote timing attacks against short cryptographic comparisons are a real, published attack class, genuinely harder to execute than local ones; I'm stating that distinction plainly rather than implying I've proven more than I have.

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
What is proven, directly and with statistical significance, by the PoC above: `DetachedTokenIsValid`'s timing behavior is measurably correlated with how much of a candidate signature matches the correct one, instead of leaking nothing beyond pass/fail. That correlation is the security-relevant property a secret-derived comparison must not have.

What this does not establish, and I want to be explicit about rather than let the framing imply more than it does:
- **No repeatable interaction was found.** I looked at how `kubeadm` actually calls this function (see point 4 of "Confirmed call chain") and found that verification runs exactly once per `kubeadm join` attempt, outside any retry loop — the retry logic that exists (`getClusterInfo`) only re-fetches the ConfigMap until a JWS key is *present*, it never re-invokes `DetachedTokenIsValid`. A practical timing attack needs many timed observations against varying candidates; I have not identified where those would come from in this call pattern, and I'm not aware of one.
- **No network-observable channel was identified.** The comparison runs entirely on the joining node, after it has already received the (possibly attacker-supplied) response; I have not identified what a network-positioned attacker would observe that reflects the comparison's internal duration back to them, as opposed to observing it directly the way a local benchmark does.
- Consequently, I have not demonstrated recovery of any part of the HMAC, forgery of a valid signature, or a successful MITM against a real `kubeadm join` — only that the comparison primitive itself lacks the property that would make such an attack impossible in principle.

If a concrete attack primitive does exist (through some interaction I haven't considered), the consequence would be that the bootstrap-token discovery flow's integrity guarantee — that an insecurely-fetched response was produced by someone holding the token secret — is weaker than intended, most relevantly when `--discovery-token-ca-cert-hash` is not configured (see point 3 of "Confirmed call chain"). I'm presenting that as the conditional consequence of the underlying primitive defect, not as something I have shown to be achievable end-to-end.

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
