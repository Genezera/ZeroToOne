# Evidence: OAuth2 account-linking CSRF in mattermost-plugin-jira

**Commit analyzed:** `f65d8b9750c4cafbe4fbacd7aa36ca96e19f6b15` (fresh shallow
clone of `https://github.com/mattermost/mattermost-plugin-jira`, default
branch, 2026-09-09). The behavior was independently revalidated against
`0e5b7423fe406e69ef668d301ecfbc7fefc8f710` on 2026-09-10.

## What this proves

`server/user_cloud_oauth.go`'s `httpOAuth2Complete` — the handler behind
`GET .../oauth2/complete.html`, registered in `server/http.go` **without**
the `checkAuth` wrapper its OAuth1 sibling (`routeOAuth1Complete`) has —
derives the Mattermost account to link a freshly-authorized Jira identity
to **solely from the untrusted `state` query parameter**, never from the
`Mattermost-User-Id` session header of the request actually completing the
flow. `zz_zerotoone_oauth2_csrf_test.go` exercises the real, unmodified
handler function through persistence. The outbound HTTPS calls to Atlassian
are simulated with `jarcoal/httpmock`; this is a component-level PoC, not a
live Atlassian authorization or a browser end-to-end test. It proves:

- An attacker mints a valid server-issued `state` via their own
  authenticated `/user/connect` call — the *only* legitimate way to obtain
  one, and it can only ever embed the caller's own id.
- When a request carrying that attacker-minted `state`, a synthetic
  victim-authorized `code`, **and a different `Mattermost-User-Id` header**
  hits the completion handler, the resulting mocked Jira token and identity
  are persisted under the
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
directory for a captured run against the revalidation commit. A benign nil-pointer
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

Confirmed at the component/code level, but not a silent, zero-click
bug: it requires the victim to click an attacker-supplied link and
actively complete Atlassian's real OAuth consent screen (phishing-
dependent), and the final confirmation page renders a visible mismatch
("Mattermost account: `<attacker>`" next to "Jira account: `<victim>`")
that a moderately careful victim has a real chance of noticing before
damage accrues. Recommended framing: **Medium**. A real end-to-end test with
two researcher-controlled accounts would strengthen the impact evidence;
do not represent this mocked PoC as that test.
