# Tron short-signature panic — local verification evidence

## Result

At public commit `12fec6b0616347265efcc23bfc240c155da710eb`, all three
exported helpers below panic when passed an empty (but valid hexadecimal)
signature instead of returning a normal verification failure:

- `VerifyMessage`
- `VerifyMessageWithAddress`
- `VerifyMessageV1`

The reproduction uses the unmodified target implementation plus the test in
`zz_zerotoone_short_signature_test.go`. Dependencies were resolved inside an
isolated clone and the test was run from `coins/tron` with:

```text
go mod tidy
go test . -run TestZeroToOneShortSignaturePanics -v -count=1
```

The captured output is in `test-output.txt`.

## Proven and not proven

Proven: the SDK functions decode a caller-supplied signature and index/slice it
without first requiring 65 decoded bytes; short input causes a Go runtime panic.

Not proven: that an OKX production service invokes these helpers on remotely
controlled input, that the panic crosses a process boundary, or that another
user can affect a victim. Repository-wide and public exact-name searches did not
identify a production caller. The demonstrated impact is therefore limited to
the process that directly invokes the SDK API, and this is not currently a
reportable Medium-or-higher bounty finding.

## Target

- Repository: https://github.com/okx/go-wallet-sdk
- Commit: `12fec6b0616347265efcc23bfc240c155da710eb`
- File: `coins/tron/tron.go`
