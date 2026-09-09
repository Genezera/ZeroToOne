package tron

import "testing"

func expectPanic(t *testing.T, name string, fn func()) {
	t.Helper()
	defer func() {
		if recovered := recover(); recovered == nil {
			t.Fatalf("%s returned normally; expected a panic for a short signature", name)
		} else {
			t.Logf("%s panic confirmed: %v", name, recovered)
		}
	}()
	fn()
}

func TestZeroToOneShortSignaturePanics(t *testing.T) {
	const shortSignature = ""

	t.Run("VerifyMessage", func(t *testing.T) {
		expectPanic(t, "VerifyMessage", func() {
			_ = VerifyMessage("hello", "", shortSignature)
		})
	})

	t.Run("VerifyMessageWithAddress", func(t *testing.T) {
		expectPanic(t, "VerifyMessageWithAddress", func() {
			_ = VerifyMessageWithAddress("hello", "", shortSignature)
		})
	})

	t.Run("VerifyMessageV1", func(t *testing.T) {
		expectPanic(t, "VerifyMessageV1", func() {
			_ = VerifyMessageV1("", "", shortSignature, false)
		})
	})
}

