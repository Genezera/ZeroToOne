> **Nota de confiança (leia antes de decidir enviar):** este é o achado mais sólido encontrado nesta missão até agora. Diferente de outros rascunhos desta pasta, aqui NÃO há incerteza técnica: alcançabilidade, escopo, elegibilidade de recompensa e o próprio bug foram confirmados por **duas verificações adversariais independentes** (4 agentes céticos, depois uma sessão dirigida por humano que clonou o repositório de novo do zero e leu cada linha pessoalmente) e por uma **PoC real, executada, contra a função vulnerável verdadeira** (não uma reimplementação) — ver `research/bugbounty/mattermost-plugin-jira/evidence/oauth2-account-linking-csrf/` pro teste Go completo e a saída real de `go test`. O gate anti-duplicata interno deste pipeline recusou avançar o achado para "pronto para envio" sozinho — mas por um motivo puramente de política interna (o bug é antigo, ~agosto/2023, não uma regressão das últimas 48h, e o programa não está marcado como baixa competição), não por dúvida técnica sobre o bug em si. Essa política é uma cautela deste projeto contra duplicatas, não um critério da HackerOne. Calibrei a severidade como Medium-High (não Critical) porque a exploração exige um passo de engenharia social e a página de confirmação final expõe visivelmente a inconsistência para a vítima — ambos os pontos já estão declarados no corpo do relatório abaixo, não escondidos. Decisão de enviar (e de severidade final) é sua.

## Title
OAuth2 Account-Linking CSRF in Jira Cloud Connect Flow (`httpOAuth2Complete` never validates the completing session against the `state` parameter)

## Program / Platform
Mattermost via HackerOne — https://hackerone.com/mattermost (asset: "Mattermost Plugins", `eligible_for_bounty: true`, `max_severity: critical`)

## Category / Severity
CWE-352-adjacent (Cross-Site Request Forgery) applied to an OAuth2 authorization-code completion endpoint — more precisely, a missing binding between the `state` parameter and the session that completes the flow, which is exactly the property `state` exists to provide (RFC 6749 §10.12). I'm not self-assigning the asset's Critical ceiling. The mechanism is fully confirmed and reproduced (see "Proof of concept"), but the real-world exploitability has two honest qualifiers I want to state up front rather than let severity framing hide: (1) it requires the victim to click an attacker-supplied link and actively complete Atlassian's own OAuth consent screen — this is a phishing-style CSRF, not a same-origin or zero-click attack; (2) the flow is not silent — the final confirmation page explicitly renders the mismatched pairing ("Mattermost account: `<attacker>`" next to "Jira account: `<victim>`") with a one-click Disconnect button right there, which gives a moderately attentive victim a real chance to notice before any lasting damage. Given those two factors, I'd put this at Medium-High rather than Critical, but I'll leave the final call to your triage.

## Affected asset
- Repository: `mattermost/mattermost-plugin-jira`
- File: `server/user_cloud_oauth.go`, function `httpOAuth2Complete`
- Route registration: `server/http.go` (`routeOAuth2Complete`)
- Confirmed against the current default-branch HEAD, commit `f65d8b9750c4cafbe4fbacd7aa36ca96e19f6b15` (2026-09-09)

## Summary
`httpOAuth2Complete` is the handler behind the Jira Cloud OAuth2 callback, `GET .../oauth2/complete.html`. It is registered in `server/http.go` **without** the `checkAuth` middleware that its own OAuth1 sibling route (`routeOAuth1Complete`, same file, immediately above it) has. Instead of binding the completing request to the session that started the flow, it derives the entire identity of "which Mattermost account gets this Jira connection" from the untrusted `state` query parameter alone — never from the `Mattermost-User-Id` session header of the request that actually lands on the callback. Because `state` can only ever be minted embedding the *minting* user's own id (see "Confirmed call chain"), an attacker can mint a state for themselves, get a victim to complete Atlassian's real consent using that state, and have the victim's real, freshly-issued Jira OAuth2 token end up linked under the *attacker's* Mattermost account.

## Confirmed call chain
1. `server/http.go`: `routeOAuth1Complete` is registered as `p.checkAuth(p.handleResponseWithCallbackInstance(p.httpOAuth1aComplete))`. `routeOAuth2Complete`, its Cloud-OAuth2 counterpart, is registered as `p.handleResponseWithCallbackInstance(p.httpOAuth2Complete)` — no `checkAuth`. `checkAuth` (`server/http.go`) is exactly a `Mattermost-User-ID` header gate that 401s when the header is empty.
2. `handleResponseWithCallbackInstance` (used by both routes) only resolves the plugin instance ID from the URL path — it performs no identity or session check of any kind.
3. `server/instance_cloud_oauth.go`, `GetUserConnectURL(mattermostUserID)` — the function that mints a connect `state` — is only reachable via `httpUserConnect` (`server/user.go`), which *is* `checkAuth`-protected and reads `mattermostUserID := r.Header.Get("Mattermost-User-Id")` from the caller's own session. It builds `state := fmt.Sprintf("%s_%s", randomSecret, mattermostUserID)` and stores the one-time secret keyed by that same id. This means a `state` can only ever legitimately embed the id of whoever minted it — an attacker cannot forge one embedding someone else's id, only their own.
4. `server/user_cloud_oauth.go`, `httpOAuth2Complete` parses `code` and `state` from the query string, splits `state` on `_`, and uses the second segment as `mattermostUserID` — a value taken **entirely from the untrusted query string**. It never calls `r.Header.Get` on any session header. That `mattermostUserID` is used to load the one-time secret, load the Mattermost user, exchange `code` for a real OAuth2 token via `GenerateInitialOAuthToken`, fetch the Jira identity via `client.GetSelf()`, and finally persist the connection via `connectUser` (`server/user.go`) — all keyed on the same query-string-derived id.
5. `connectUser` stores `connection.OAuth2Token` and the fetched `jiraUser` (including its real `AccountID`) under that id with no cross-check against any actual requester identity.

## Prerequisites
- Attacker: any ordinary, already-authenticated Mattermost user — no special privilege, admin role, or existing Jira connection required.
- Victim: any Mattermost user who has (or is willing to set up) a Jira Cloud connection via this plugin, and who can be persuaded to click a link while logged into Mattermost.
- No access to any secret, token, or credential belonging to the victim is needed at any point.

## Steps to reproduce (real-world scenario)
1. The attacker, authenticated as themselves, triggers the plugin's normal "connect your Jira account" flow (`/user/connect`). This mints a `state` value of the form `<randomSecret>_<attackerMattermostId>` and returns an Atlassian authorization URL carrying that `state`.
2. The attacker does **not** complete the flow themselves. Instead, they send that Atlassian authorization URL to the victim (e.g., "click here to connect your Jira account to Mattermost").
3. The victim, logged into Mattermost, clicks the link and lands on Atlassian's real, genuine OAuth consent screen. Believing they are connecting their own account, they authorize with their own real Jira account.
4. Atlassian redirects the victim's browser back to Mattermost's `.../oauth2/complete.html?code=<victim-authorized-code>&state=<attacker's unchanged state>`.
5. Because this endpoint requires no session and never reads the `state`'s embedded id against anything but its own one-time-secret store, it exchanges the victim-authorized `code` for a real token and links the resulting Jira identity — the victim's real account — under the **attacker's** Mattermost id.
6. The attacker's Mattermost account can now run `/jira` slash commands (search, comment, create, transition, share-publicly) that execute against Jira using the victim's real, live token and permissions.

## Current vs. expected result
- **Current:** the OAuth2 completion handler accepts any request carrying a syntactically valid `state` + a real, exchangeable `code`, regardless of who is making the request. The Mattermost account that ends up linked is whichever id happens to be embedded in `state` — controlled entirely by whoever minted it, not by whoever completes it.
- **Expected:** the handler should require an authenticated session for the completing request (mirroring its own OAuth1 sibling's `checkAuth` wrapper) and reject unless the session's `Mattermost-User-Id` matches the id embedded in `state`.

## Evidence
`server/http.go` — the asymmetry between the two callback routes:
```go
// Oauth1 (Jira Server)
instanceRouter.HandleFunc(routeOAuth1Complete, p.checkAuth(p.handleResponseWithCallbackInstance(p.httpOAuth1aComplete))).Methods(http.MethodGet)

// OAuth2 (Jira Cloud)
instanceRouter.HandleFunc(routeOAuth2Complete, p.handleResponseWithCallbackInstance(p.httpOAuth2Complete)).Methods(http.MethodGet)
```

`server/http.go` — `checkAuth`, the exact check the OAuth2 route is missing:
```go
func (p *Plugin) checkAuth(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.Header.Get("Mattermost-User-ID")
		if userID == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}
		handler(w, r)
	}
}
```

`server/user_cloud_oauth.go` — `httpOAuth2Complete`, the vulnerable core (never reads any request header):
```go
func (p *Plugin) httpOAuth2Complete(w http.ResponseWriter, r *http.Request, instanceID types.ID) (int, error) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	stateArray := strings.Split(state, "_")
	if len(stateArray) != 2 || stateArray[1] == "" {
		return respondErr(w, http.StatusBadRequest, errors.New("Bad request: invalid state"))
	}
	stateSecret := stateArray[0]
	mattermostUserID := stateArray[1]
	storedSecret, err := p.otsStore.LoadOneTimeSecret(mattermostUserID)
	// ... loads the Mattermost user, exchanges `code` for a real token,
	// fetches the Jira identity, and persists the connection --
	// all keyed on `mattermostUserID` from the query string above.
	connection.MattermostUserID = types.ID(mattermostUserID)
	if err := p.connectUser(instance, types.ID(mattermostUserID), connection); err != nil { ... }
}
```

`server/instance_cloud_oauth.go` — `GetUserConnectURL`, confirming `state` can only ever embed the minting user's own id:
```go
func (ci *cloudOAuthInstance) GetUserConnectURL(mattermostUserID string) (string, *http.Cookie, error) {
	state := fmt.Sprintf("%s_%s", model.NewId()[0:15], mattermostUserID)
	// ...
	if err := ci.Plugin.otsStore.StoreOneTimeSecret(mattermostUserID, state); err != nil { ... }
	return url, nil, nil
}
```
— reachable only from `httpUserConnect` (`server/user.go`), which reads `mattermostUserID := r.Header.Get("Mattermost-User-Id")` from the caller's own authenticated session.

**Duplicate/history check:** I searched this repository's issues, pull requests, commit history on the two files above, and its published security advisories for terms covering this specific code path (OAuth2 state handling, session binding, account-linking CSRF) and found no coverage. I did find three real, already-disclosed, distinct advisories in this same plugin for the same *general* bug class — trusting a client-supplied identity instead of the verified session (a logout-CSRF disconnecting a Jira connection; two HTTP handlers trusting a `UserId` field in an action payload; and an information-disclosure issue) — none of which touch `server/user_cloud_oauth.go` or this OAuth2 completion path. I read this as the vendor's security team actively finding and fixing this exact bug *pattern* in this plugin, which increases my confidence this is a real, taken-seriously class of issue rather than something too trivial to have ever been reported — while this specific instance does not appear to already be among the fixed ones.

## Proof of concept
I wrote a Go test that calls the actual, unmodified `httpOAuth2Complete` and `GetUserConnectURL` functions directly against a freshly-cloned copy of the repository at the commit above — no plugin logic was reimplemented. Only the three real outbound HTTPS calls to Atlassian's hardcoded hostnames (token exchange, accessible-resources, and the Jira `/rest/api/2/myself` identity lookup) are faked, using `jarcoal/httpmock` — the same library and technique this repository's own `server/command_test.go` already uses for equivalent purposes.

Command: `go test -run TestZeroToOne -v -count=1 .`

Real output (unedited):
```
=== RUN   TestZeroToOne_OAuth2CompleteIgnoresSessionIdentity
    zz_zerotoone_oauth2_csrf_test.go:112: attacker-minted Atlassian authorize URL (would be sent to the victim): https://auth.atlassian.com/authorize?...&state=bewu8u45xtnz9cj_attacker0000000000000000000
    zz_zerotoone_oauth2_csrf_test.go:137: httpOAuth2Complete panicked AFTER the connection was persisted, in unrelated bot/setup-flow/telemetry code (p.setupFlow/p.tracker are nil in this unit test): runtime error: invalid memory address or nil pointer dereference
    zz_zerotoone_oauth2_csrf_test.go:159: RESULT: attacker Mattermost id "attacker0000000000000000000" is now linked to victim's real Jira account "real.victim.jira.account" (accountId=victim-real-jira-account-id), while the victim's own Mattermost account ("victim00000000000000000000000", sent in the Mattermost-User-Id header of the completing request) was never even queried.
--- PASS: TestZeroToOne_OAuth2CompleteIgnoresSessionIdentity (0.03s)
=== RUN   TestZeroToOne_OAuth2CompleteRouteHasNoAuthWrapper
--- PASS: TestZeroToOne_OAuth2CompleteRouteHasNoAuthWrapper (0.00s)
PASS
ok  	github.com/mattermost/mattermost-plugin-jira/server	0.201s
```

The one panic logged above is benign and unrelated to the vulnerability: it comes from bot-wizard/telemetry plumbing (`p.setupFlow`) that `OnActivate` normally wires up via a real bot user, which this minimal unit-test harness does not construct — and it fires *after* the vulnerable persistence (`StoreConnection`/`StoreUser`) has already completed, so it does not affect the assertions below, which run against the real, already-persisted key-value store state:
- The attacker's connection holds a live, non-nil `OAuth2Token`.
- The attacker's connection's `AccountID` equals the victim's real Jira account id.
- The victim's own Mattermost account received no connection at all.
- `GetUser` was called for the attacker's id, and asserted **never** called for the victim's id — the handler never even looks up the identity of whoever actually completed the request.

Reproduced twice (`-count=1`, no cache). Running the full pre-existing test suite with and without this new file confirms it introduces zero new failures — the suite's 3 unrelated pre-existing failures (missing command templates in a bare shallow clone) reproduce identically either way.

## Impact
An attacker with no special privileges can end up with a live OAuth2 token and identity binding to a victim's real Jira Cloud account, without ever obtaining the victim's credentials. Concretely: the attacker's Mattermost account gains the ability to run `/jira` commands (search, comment, create, transition issues, and share issues publicly) that execute against Jira using the victim's real permissions and project access — a confused-deputy access pattern against a third party's connected third-party account. This requires the victim to click an attacker-supplied link and complete a real Atlassian consent screen (a phishing-style CSRF, not zero-click), and the final confirmation page visibly shows the mismatched account pairing to the victim, giving them a real chance to notice and immediately disconnect before lasting damage — both factors I've weighed into the Medium-High severity estimate above rather than claiming an unqualified Critical.

## Suggested fix
Bind the OAuth2 completion to the session that actually completes it, mirroring the pattern this codebase already uses for its own OAuth1 flow. Concretely: wrap `routeOAuth2Complete` in `checkAuth` (or an equivalent check inside `httpOAuth2Complete`), read `Mattermost-User-Id` from the completing request, and reject with 401 unless it matches the id embedded in `state` — the same three-guard design (require an authenticated session on the completing request, extract the id embedded in `state`, and explicitly reject on any mismatch before touching the token store) that other Mattermost-maintained plugins with an equivalent OAuth2 connect/complete flow already implement correctly.
