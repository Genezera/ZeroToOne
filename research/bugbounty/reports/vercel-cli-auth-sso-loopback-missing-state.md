> **Nota de confiança (leia antes de decidir enviar):** este achado é tecnicamente real — o padrão de código descrito abaixo existe exatamente como descrito, verificado por leitura direta do código-fonte. O que **não** foi possível confirmar, apesar de esforço exaustivo (código-fonte completo do monorepo, busca por código em todo o GitHub público com API autenticada, enumeração completa do registro npm sob o escopo `@vercel/*`, Sourcegraph, socket.dev), é se este caminho de código é de fato alcançável a partir do binário `vercel` publicado — o fluxo de login realmente ativo usa um mecanismo diferente, imune a esta classe de problema. Programas de bug bounty tipicamente fecham relatórios de código correto-mas-sem-uso-confirmado como "Informative"/"Not Applicable", sem recompensa. Enviar como um achado de **hardening/defesa em profundidade**, não como uma vulnerabilidade com exploração confirmada.

## Title
Missing CSRF state/nonce validation in `@vercel/cli-auth`'s SSO reauthorization loopback listener (RFC 8252 §8.3) — reachability from the published `vercel` CLI not confirmed

## Program / Platform
Vercel Open Source via HackerOne — https://hackerone.com/vercel-open-source (target: `vercel/vercel`, tier 1, `eligible_for_bounty: true`, `max_severity: critical`)

## Category / Severity
CWE-352-adjacent (cross-site request forgery against a local OAuth-style callback listener) / missing state validation in an authorization loopback flow (RFC 8252 §8.3, OAuth 2.0 for Native Apps). Reported severity: **Low / Informational** — the code pattern is a genuine violation of a well-established security best practice, but I could not confirm the vulnerable path is reachable from any code Vercel actually ships today, so I am not claiming a demonstrated exploit.

## Affected asset
- Package: `@vercel/cli-auth` (published, non-private, on npm)
- File: `packages/cli-auth/sso.ts` — functions `waitForVerification` (consumed by `reauthorizeTeam`)
- Repository: `vercel/vercel` monorepo, `main` branch (commit current as of 2026-08-30, confirmed unchanged through 2026-08-31 re-checks)

## Summary
`waitForVerification`/`reauthorizeTeam` in `@vercel/cli-auth` implement team SSO reauthorization by opening the user's browser to a `vercel.com/sso/<team>?session_id=...&client_id=...&next=http://localhost:<port>` URL and starting a local HTTP server on `127.0.0.1:<random port>` to catch the redirect. The server treats the **first request it receives** (`server.once('request', ...)`) as the legitimate response: it extracts `token` from the query string and immediately uses it in a call to `api.vercel.com/registration/verify?token=...`. No secret, `state`, or nonce generated locally before opening the browser is ever required back in the callback to bind the response to the specific flow that was started — exactly the class of vulnerability RFC 8252 §8.3 (OAuth 2.0 for Native Apps) exists to prevent for loopback redirect listeners.

Because the local server sends no CORS headers and a simple `GET` request triggers no preflight, a malicious page open in another tab of the same browser during the window the CLI is listening could send a forged query string to `127.0.0.1:<port>`. CORS blocks the attacking page from *reading* the response, but not from the local server *receiving and acting on* the request. If an attacker runs their own SSO flow to obtain a valid verification token tied to their own account, then races the victim's CLI listener (candidate ports are a small, guessable range — port-scanning `localhost` from page JavaScript via `fetch()` is a known, unblocked technique), the victim's CLI could complete `registration/verify` using the attacker's token — a session-fixation-style account confusion.

## Confirmed call chain
1. `packages/cli-auth/sso.ts` (`reauthorizeTeam`) opens `vercel.com/sso/<team>?session_id=<uuid>&client_id=...&next=http://localhost:<port>` in the user's default browser and starts a local HTTP server via `async-listen` on an OS-assigned port.
2. `waitForVerification` resolves on the server's `request` event, registered with `.once(...)` — the first HTTP request the server receives at all, regardless of origin, is treated as authoritative.
3. `token`/`loginError`/`ssoEmail` are read directly from that request's query string.
4. `token` is passed, unvalidated against anything generated locally, to `api.vercel.com/registration/verify?token=...`.
5. No `session_id`/`client_id`/any locally-generated secret is required to appear in the callback for it to be accepted — the only binding between "the flow that was started" and "the response that gets accepted" is winning the race to be the first request the ephemeral port receives.

## What I could NOT confirm, and how hard I tried
This is the central open question, and I want to be explicit about it rather than bury it in a footnote:

- **Is this code reachable from the `vercel` CLI binary that Vercel actually publishes?** I could not find an import of `@vercel/cli-auth/sso.js` (or `oauth.js`, the sibling module) anywhere in `packages/cli/src` — the only subpath of `@vercel/cli-auth` actually imported there is `credentials-store.js` (unrelated, already audited, no issue). The real, active `vercel login` flow (`packages/cli/src/commands/login/future.ts`, `packages/cli/src/util/oauth.ts`) implements OAuth 2.0 Device Authorization Grant (RFC 8628) instead — a polling-based flow with no local listener, structurally immune to this class of attack. `packages/cli/src/commands/teams/sso.ts` (the actual `vercel teams sso` command) only reads SAML status via API; it never calls `reauthorizeTeam`.
- **Could some other Vercel product call it?** `@vercel/cli-auth`'s own `package.json` has no `exports` field, so nothing stops an external consumer from importing the `sso.js` subpath if one existed. Its README describes it as "used by Vercel's CLI tools" (plural). I checked every angle I could reach without internal access:
  - GitHub code search (authenticated API) across **all of public GitHub** for `"reauthorizeTeam"`, `"waitForVerification"`, `"cli-auth/sso"`, and the literal import string `"@vercel/cli-auth/sso.js"` — the only real matches for the first two are `vercel/vercel/packages/cli-auth/sso.ts` itself and two personal forks of the same monorepo (same file, not a separate consumer); zero independent repositories import or call these functions.
  - npm registry: enumerated every package published under the `@vercel/*` scope. Every CLI-flavored package (`@vercel/cli-exec`, `@vercel/cli-config`, `@vercel/vc-native` and its per-platform binary variants) declares the same `repository.url` pointing at this same monorepo — there is no second, separately-published CLI product.
  - npms.io: 0 dependents recorded for `@vercel/cli-auth`.
  - Sourcegraph, npmjs.com's "Dependents" tab, and socket.dev were also tried but returned no usable data (indexing gap, JS-rendered SPA, and a Vercel-hosted security checkpoint, respectively — documented for transparency, not treated as evidence either way).
  - This is not proof a fully private, never-published-anywhere internal Vercel tool doesn't call it — that's outside what any public source can confirm or refute.

## Impact (conditional on reachability, which is not confirmed)
If some caller does invoke `reauthorizeTeam`, a successful race lets an attacker cause the victim's CLI to complete team SSO reauthorization using the attacker's own verification token instead of the victim's — an account/session confusion at the reauthorization step. I am not claiming this is exploitable today against any code Vercel ships; I'm reporting a real gap in a security-relevant code path that matches a well-documented, named vulnerability class (RFC 8252 §8.3), on the theory that "dead code today" is still worth fixing before it becomes reachable tomorrow, and because I could not rule out an internal caller I have no visibility into.

## Suggested fix
Generate a random `state`/nonce value locally before opening the browser (the same `session_id`/`client_id` already sent on the outbound URL could be repurposed, or a fresh value added), and require it to match exactly in the callback query string before accepting `token` and calling `registration/verify`. This is the standard OAuth CSRF mitigation for loopback listeners (RFC 8252 §8.3) and mirrors what the actually-active Device Authorization Grant flow in `packages/cli/src/util/oauth.ts` already gets for free by not using a local listener at all.
