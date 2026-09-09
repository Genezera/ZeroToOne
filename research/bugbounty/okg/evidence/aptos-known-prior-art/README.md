# Aptos SDK findings — public prior knowledge and upstream provenance

Reviewed on 2026-09-09 against OKX public commit
`12fec6b0616347265efcc23bfc240c155da710eb`.

## MultiKey bitmap / verification bypass

The code defect is technically reproducible, but OKX's own committed test suite
already acknowledges both relevant symptoms:

- `multiKey_test.go:187`: `ContainsKey implementation has issues`
- `multiKey_test.go:330-331`: the wrong-message verification assertion is
  disabled `due to verification logic issues`

Primary source:
https://github.com/okx/go-wallet-sdk/blob/12fec6b0616347265efcc23bfc240c155da710eb/coins/aptos/v2/crypto/multiKey_test.go#L187-L203
and
https://github.com/okx/go-wallet-sdk/blob/12fec6b0616347265efcc23bfc240c155da710eb/coins/aptos/v2/crypto/multiKey_test.go#L328-L331

This is public project knowledge at the exact affected commit, so both local
records for this root cause are classified `known_duplicate`. No report should
be submitted as a novel vulnerability.

## MultiEd25519 verification panic

The short-signature panic is technically real. It is not refuted by the absence
of a bitmap-derived public-key index: the affected loop indexes
`sig.Signatures[i]` while iterating every public key, and a short signature list
therefore panics.

The implementation was copied from the upstream Aptos Go SDK. Upstream publicly
changed MultiEd25519 verification on 2026-01-27 to validate signature count and
bitmap-selected key indices:
https://github.com/aptos-labs/aptos-go-sdk/commit/36335d917d9ece55b8e1a18b3cc0f4387e420369

That public upstream correction predates this review and makes a novelty claim
unsafe. The OKX copy remains affected, but no in-repository production caller or
OKX service deployment was found. The local record is classified
`known_duplicate`, not `false_positive`.

## Empty MultiEd25519 transaction-authenticator deserializer

The OKX copy has the entire `UnmarshalBCS` body commented out, so the local
nil-pointer PoC is technically valid. The corresponding upstream legacy Aptos
SDK implementation has initialized and deserialized the sender authenticator
since June 2024. The OKX commented body is therefore an incomplete/divergent SDK
surface, not evidence of a deployed remote boundary. No production caller was
found. This record remains `inconclusive` and non-reportable unless deployment
and distinct-victim reachability are independently proven.
