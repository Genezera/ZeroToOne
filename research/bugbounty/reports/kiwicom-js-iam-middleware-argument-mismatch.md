# Positional Argument Mismatch in `AuthorizationDirective` Places the IAM Auth Token into a Malformed Fetch URL and Breaks GraphQL Authorization (`@kiwicom/iam`)

## Program / Platform
Kiwi.com via HackerOne — https://hackerone.com/kiwicom

## Category / Severity
Function Call with Incorrectly Specified Arguments (CWE-628) is the root cause, and it's the part I can prove with full confidence: `AuthorizationDirective.visitFieldDefinition` calls `isUserAuthorized` with its arguments in the wrong order relative to that function's own declared signature. Two consequences follow, and I want to keep their confidence levels separate rather than blur them together. The first is well-proven: the GraphQL `@authorization` directive throws on every real invocation instead of correctly granting or denying access — a fail-closed functional defect, not a bypass. The second is weaker, and I want to be upfront about exactly how much weaker: the service's real IAM authentication token ends up embedded, as plain text, inside a URL string the code constructs and attempts to send — but my own proof of concept shows that attempt fails before any network I/O occurs, so I have not demonstrated the token actually crossing a network or process boundary to anywhere an attacker, a log, or a proxy could observe it. I'm naming that gap explicitly rather than presenting this as a confirmed information disclosure. I'm not self-assigning a severity label.

## Affected asset
- Repository: `kiwicom/js-iam-middleware` (published to npm as `@kiwicom/iam`)
- Files: `src/authorizationDirective.ts` (the bug) and `src/getUser.ts` (the function whose contract gets violated)
- Function: `AuthorizationDirective.visitFieldDefinition`'s call to `isUserAuthorized`, `src/authorizationDirective.ts` line 51
- Confirmed identical at the current default-branch HEAD (commit `a5ca3d73fb83fab4dfbb347bf6a994da175b1f8e`) and at the latest published release tag `v2.3.0` — the version real consumers install from npm. This is the package's documented, README-featured primary usage pattern for GraphQL, not an unused code path.

## Summary
`isUserAuthorized` (in `src/authorizationDirective.ts`) has the signature `(serviceUA, email, permission, iamURL, iamToken, servicePermissionsIdentifier = "")`.
`AuthorizationDirective.visitFieldDefinition` — the code that actually runs when a protected GraphQL field is resolved — calls it as `isUserAuthorized(AuthorizationDirective.serviceUA, AuthorizationDirective.servicePermissionsIdentifier, email, this.args.permission, AuthorizationDirective.iamURL, AuthorizationDirective.iamToken)`.
Every argument after the first lands in the wrong parameter: the service's static permissions-identifier string is bound to `email`, the real requesting user's email is bound to `permission`, the real required permission string is bound to `iamURL`, the real IAM service URL is bound to `iamToken`, and — the part I think matters most — **the service's real IAM authentication token ends up bound to `servicePermissionsIdentifier`**, which `getUser` (the function `isUserAuthorized` calls next) uses to help build the outbound request's URL, not its `Authorization` header.
I traced this to the exact commit that introduced it — `f1a1d76ec7c1dbab1ec059da2b0d6a3c6d9c3cc1` ("feat: add param for permissions identification (#123)", 31 March 2020) — and confirmed it is unchanged 6+ years later, present in the current release.
I built and ran a real proof of concept (against the actual `node-fetch@2.6.x` dependency this package ships, not a hand-waved description) confirming exactly where each value ends up; see "Proof of concept".

## Confirmed call chain
1. `src/authorizationDirective.ts`, inside `AuthorizationDirective.visitFieldDefinition`'s field-resolver wrapper — this runs whenever a GraphQL field protected by the `@authorization` schema directive is resolved, which is exactly the documented, README-shown way to use this package for GraphQL authorization.
2. This resolver calls `isUserAuthorized(AuthorizationDirective.serviceUA, AuthorizationDirective.servicePermissionsIdentifier, email, this.args.permission, AuthorizationDirective.iamURL, AuthorizationDirective.iamToken)` — six positional arguments, in that order.
3. `isUserAuthorized`'s actual signature is `(serviceUA, email, permission, iamURL, iamToken, servicePermissionsIdentifier = "")` — a different order after the first parameter. `isUserAuthorized` calls `getUser(serviceUA, servicePermissionsIdentifier, email, iamURL, iamToken)` using its own (now-misbound) local variables.
4. `getUser` (`src/getUser.ts`) builds `` `${iamURL}/v1/user?service=${servicePermissionsIdentifier}&email=${email}` `` and sends a request with `headers: { Authorization: iamToken, "User-Agent": serviceUA }`. Because of the mismatch two steps up, the value `getUser` receives as `iamToken` (destined for the `Authorization` header) is actually `AuthorizationDirective.iamURL`, and the value it receives as `servicePermissionsIdentifier` (destined for the URL's `service=` query parameter) is actually `AuthorizationDirective.iamToken` — the service's real credential.
5. I confirmed this exact commit (`f1a1d76`, 31 March 2020) is where the mismatch was introduced: it correctly threaded the new `servicePermissionsIdentifier` parameter into `isUserAuthorized`'s own call to `getUser` (matching `getUser`'s new signature), but inserted it at the wrong position in `visitFieldDefinition`'s call to `isUserAuthorized` itself — a small, understandable copy/paste-style mistake across two call sites that both needed updating.
6. `getUser.test.ts` exists and passes, but it calls `getUser` directly with correctly-ordered arguments — it never calls `isUserAuthorized` or `visitFieldDefinition`, and no `authorizationDirective.test.ts` exists at all. This is a real, structural reason this has not been caught: the function that is misused is well-tested in isolation; the caller that misuses it has no test coverage.
7. The `permission` value (misbound into `iamURL`'s slot in this chain) comes from the GraphQL schema itself, not from a request-time client. I confirmed this against the package's own `AuthorizationDirective.graphql`, which declares `directive @requires(permission: String!) on FIELD_DEFINITION`, and against the README's own documented usage example, `@requires(permission: "payment-card.read")` on a `paymentCard` field. Whoever authors the GraphQL schema chooses this value; a GraphQL client cannot influence it. This also means the specific failure I observed (an invalid-URL-scheme error) is not an artifact of the example value I happened to pick for the proof of concept — real permission strings in this package's own documented convention (`payment-card.read`, `payment-card.write`) never resemble a URL, so the same failure would occur with real, currently-deployed permission strings too.

## Current vs. expected result
- **Current:** the service's real IAM authentication token is interpolated into the URL string passed to `fetcher` as the `service=` query-string value, while the real IAM URL is passed as the `Authorization` header value.
- **Expected:** `visitFieldDefinition` should call `isUserAuthorized` with arguments in the order its own signature declares (`serviceUA, email, permission, iamURL, iamToken, servicePermissionsIdentifier`), so that `getUser` in turn receives the real token in the `Authorization` header and the real permissions-identifier in the URL, matching `getUser`'s own contract and its own passing test.

## Evidence
`src/authorizationDirective.ts` (current HEAD and `v2.3.0`, identical) — `isUserAuthorized`'s declared signature:
```ts
export async function isUserAuthorized(
  serviceUA: string,
  email: string,
  permission: string,
  iamURL: string,
  iamToken: string,
  servicePermissionsIdentifier = "",
): Promise<boolean> {
```
📷 See attached screenshot `kiwicom-iam-01-isuserauthorized-signature.png`.

The actual call site, a few lines below in the same file, inside `visitFieldDefinition`:
```ts
if (
  !(await isUserAuthorized(
    AuthorizationDirective.serviceUA,
    AuthorizationDirective.servicePermissionsIdentifier,
    email,
    this.args.permission,
    AuthorizationDirective.iamURL,
    AuthorizationDirective.iamToken,
  ))
)
```
📷 See attached screenshot `kiwicom-iam-02-visitfielddefinition-callsite.png`.

`src/getUser.ts` — where the misbound `iamToken`/`servicePermissionsIdentifier` values actually get used to build the outbound request:
```ts
const cleanURL = iamURL.replace(/\/$/, "");
const url = `${cleanURL}/v1/user?service=${servicePermissionsIdentifier}&email=${email}`;
const response = await fetcher(url, {
  headers: {
    Authorization: iamToken,
    "User-Agent": serviceUA,
  },
});
```
📷 See attached screenshot `kiwicom-iam-03-getuser-request-construction.png`.

The introducing commit, `f1a1d76ec7c1dbab1ec059da2b0d6a3c6d9c3cc1` ("feat: add param for permissions identification (#123)", 31 March 2020) — its diff shows the same value correctly reaching `getUser`'s new second parameter from inside `isUserAuthorized`, but landing at the wrong position when `visitFieldDefinition` calls `isUserAuthorized` itself.
📷 See attached screenshot `kiwicom-iam-04-introducing-commit-diff.png`.

**Duplicate/history check**: no GitHub Security Advisory exists on this repository. I searched issues and pull requests for `isUserAuthorized`, `argument`, and `authorization` — no result describes this. One result initially looked concerning (PR #209, titled literally "HackerOne Bug Bounty program"), so I read it in full: it only modifies `package.json`/`package-lock.json`/`yarn.lock`, unrelated to this code path — most likely an automated setup PR from when this repository was added to the bounty program, not a vulnerability disclosure. This does not rule out an existing private report on this program.

## Proof of concept
I transcribed `getUser.ts` and `isUserAuthorized`'s call to it line-for-line from the real files (not from memory or paraphrase), then called it exactly the way `visitFieldDefinition` does, with values representative of a real deployment:
```
serviceUA:                     "my-backend-service/1.0"
servicePermissionsIdentifier:  "my-backend-service"          (static, configured once)
the real requesting user's email: "alice@example.com"        (varies per request)
the real required permission:  "read:billing-secrets"        (whatever the protected field requires)
iamURL:                        "https://iam.internal.example.com"
iamToken:                      "Bearer sk_live_REAL_SECRET_SERVICE_TOKEN_XYZ"  (the service's real credential)
```
Ran twice, each as its own small script (both attached): `mock-poc.mjs` replaces `fetcher` with a logging function, to capture the exact URL and headers without making any network call; `real-poc.mjs` uses the real `node-fetch@2.6.x` dependency this package actually pins in its own `package.json`, installed and executed for real rather than assumed to behave a certain way.

With the logging mock, the values passed to the fetcher are:
```
URL requested:        read:billing-secrets/v1/user?service=bearer sk_live_real_secret_service_token_xyz&email=my-backend-service
Authorization header: https://iam.internal.example.com
```
📷 See attached screenshot `kiwicom-iam-05-poc-mock-output.png`.

With the real `node-fetch@2.6.x`, the same call throws before any network I/O happens:
```
TypeError: Only HTTP(S) protocols are supported
```
📷 See attached screenshot `kiwicom-iam-06-poc-real-nodefetch-error.png`.

I specifically checked whether this error's message includes the URL (which would mean the secret could propagate into a GraphQL client-facing error response) — it does not, with either `node-fetch@2` or Node's own native `fetch`. I'm stating that I checked and it did not hold, rather than leaving the more severe possibility implied.

## Impact
What is demonstrated, directly, by running the real code above: on every real invocation of the documented `@authorization` GraphQL usage pattern, the service's live IAM authentication credential is interpolated into a URL string, in the same process that already legitimately held it, as part of constructing a request that then fails before any network I/O happens (confirmed against the real `node-fetch@2.6.x` dependency — see "Proof of concept"). I want to be precise about what that does and does not establish, because it changes how much this should weigh. The secret does not cross a process or network boundary here: it moves from one in-memory string to another, inside the same process that already had legitimate access to it, before the operation aborts. I have not demonstrated it reaching the IAM backend, a proxy, a log, a tracing system, or a GraphQL client — I specifically tested the one disclosure channel I could think of (whether the thrown error's message echoes the URL back to a caller) and it does not, with either `node-fetch@2` or Node's native `fetch` (see "Proof of concept"). I'm describing this as a real defect in how the value is handled — a secret should never be interpolated into a URL at all, since doing so creates risk if any surrounding infrastructure not exercised by my PoC (a custom `fetcher`, an APM tool instrumenting outbound HTTP calls, a debug log added later) captures request URLs — but I have not shown that risk actually materializing today, in this codebase, and I don't want the report to read as if I had.

Separately, and more concretely provable: I have not shown that this causes an authorization bypass. The most direct, repeatable consequence I observed is that the request fails (`TypeError: Only HTTP(S) protocols are supported`), which propagates as a thrown error out of the GraphQL resolver — the protected field errors out rather than incorrectly granting access. This is a fail-closed defect: real users of a protected field would see it break, not see it under-protected. If any consumer of this library ever wraps `authorizationDirective`'s resolver in code that swallows this specific error and defaults to allowing the request through, that would be a bypass — but that would be a defect in the consuming application, not something this library does or that I have observed.

Taken together: what I can prove with full confidence is a real, unambiguous root-cause defect (CWE-628) that breaks a security control's intended function for any consumer exercising this documented code path — the primary GraphQL usage pattern this package's own README presents — unfixed for 6+ years. What I have not proven is a concrete information-disclosure or authorization-bypass outcome from it. I'd rather state both halves plainly and let triage weigh them than have the gap found after the fact.

## Suggested fix
Reorder `visitFieldDefinition`'s call to `isUserAuthorized` to match its declared signature:
```ts
await isUserAuthorized(
  AuthorizationDirective.serviceUA,
  email,
  this.args.permission,
  AuthorizationDirective.iamURL,
  AuthorizationDirective.iamToken,
  AuthorizationDirective.servicePermissionsIdentifier,
)
```
I'd also suggest adding a test for `isUserAuthorized`/`visitFieldDefinition` specifically (not just `getUser` in isolation) — the existing `getUser.test.ts` would not have caught this class of bug regardless of how carefully it were extended, since the mismatch is entirely in the caller, not in `getUser` itself.
