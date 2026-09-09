# Evidence: OAuth2 account-linking CSRF in mattermost-plugin-jira

**Commit analyzed:** `f65d8b9750c4cafbe4fbacd7aa36ca96e19f6b15` (fresh shallow
clone of `https://github.com/mattermost/mattermost-plugin-jira`, default
branch, 2026-09-09)

## What this proves

`server/user_cloud_oauth.go`'s `httpOAuth2Complete` — the handler behind
`GET .../oauth2/complete.html`, registered in `server/http.go` **without**
the `checkAuth` wrapper its OAuth1 sibling (`routeOAuth1Complete`) has —
derives the Mattermost account to link a freshly-authorized Jira identity
to **solely from the untrusted `state` query parameter**, never from the
`Mattermost-User-Id` session header of the request actually completing the
flow. `zz_zerotoone_oauth2_csrf_test.go` exercises the real, unmodified
handler function end to end (only the three outbound HTTPS calls to
Atlassian's real hardcoded hostnames are faked, via the same `jarcoal/httpmock`
technique this repo's own `command_test.go` already uses) and proves:

- An attacker mints a real, validly-signed `state` via their own
  authenticated `/user/connect` call — the *only* legitimate way to obtain
  one, and it can only ever embed the caller's own id.
- When a request carrying that attacker-minted `state`, a victim-authorized
  `code`, **and the victim's own `Mattermost-User-Id` header** hits the
  completion handler, the resulting Jira connection (a live OAuth2 token
  plus the account holder's real Jira `accountId`) is persisted under the
  **attacker's** Mattermost id — not the victim's.
- The victim's own Mattermost account is never even queried
  (`GetUser` is asserted never called with the victim's id).

## How to reproduce

```bash
git clone --depth 1 https://github.com/mattermost/mattermost-plugin-jira.git
cd mattermost-plugin-jira
go build -o build/bin/manifest ./build/manifest/   # generates server/manifest.go (required to compile)
./build/bin/manifest apply
cp <this-dir>/zz_zerotoone_oauth2_csrf_test.go server/
cd server
go test -run TestZeroToOne -v -count=1 .
```

Expected output: both tests `PASS` — see `test-output.txt` in this
directory for a real, captured run (commit above). A benign nil-pointer
panic from unrelated bot-wizard/telemetry code (`p.setupFlow`, wired up by
`OnActivate` via a real bot user that this minimal unit-test harness does
not construct) is expected *after* the vulnerable persistence completes,
and is caught with `recover()` inside the test — it does not affect the
assertions, which run against real, already-persisted KV-store state.

Running the full pre-existing suite (`go test .`, no `-run` filter) shows
3 unrelated, pre-existing failures ("no template found for
`/command/install_cloud.md`" etc.) that reproduce identically with or
without this file present — confirmed by running both ways — so they are
a bare-clone asset-loading gap in the upstream test suite itself, not
something this PoC introduces.

## Severity note (see `prior-art.json` for the duplicate-check)

Confirmed technically real and reachable, but not a silent, zero-click
bug: it requires the victim to click an attacker-supplied link and
actively complete Atlassian's real OAuth consent screen (phishing-
dependent), and the final confirmation page renders a visible mismatch
("Mattermost account: `<attacker>`" next to "Jira account: `<victim>`")
that a moderately careful victim has a real chance of noticing before
damage accrues. Recommended framing: **Medium-High**, not an unqualified
Critical — state the mechanism and let the platform's own triage set the
final severity.
