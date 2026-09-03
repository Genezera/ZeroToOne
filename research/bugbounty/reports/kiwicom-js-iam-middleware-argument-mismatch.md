# Incorrect Argument Order Breaks the Documented GraphQL `@requires` Authorization Flow (`@kiwicom/iam`)

## Program / Platform
Kiwi.com via HackerOne — https://hackerone.com/kiwicom

## Category / Severity
Function Call With Incorrect Order of Arguments (CWE-683, a child of the broader CWE-628) is the root cause, and it's the part I can prove with full confidence: `AuthorizationDirective.visitFieldDefinition` calls `isUserAuthorized` with its arguments in the wrong order relative to that function's own declared signature. Two consequences follow, and I want to keep their confidence levels separate rather than blur them together. The first is well-proven: the GraphQL `@requires` directive (exposed via the `authorizationDirective`/`AuthorizationDirective` factory this report otherwise refers to) throws on a cold cache with a realistic, non-URL-shaped permission identifier, instead of correctly granting or denying access — a fail-closed functional defect, not a bypass; see "Confirmed call chain" for the narrower, precise conditions under which I actually observed this. The second is weaker, and I want to be upfront about exactly how much weaker: the service's real IAM authentication token (lowercased by `getUser` before use) ends up embedded inside a URL string the code constructs and attempts to send — but my own proof of concept shows that attempt fails before any network I/O occurs, so I have not demonstrated the token actually crossing a network or process boundary to anywhere an attacker, a log, or a proxy could observe it. I'm naming that gap explicitly rather than presenting this as a confirmed information disclosure. I'm not self-assigning a severity label.

## Affected asset
- Repository: `kiwicom/js-iam-middleware` (published to npm as `@kiwicom/iam`)
- Files: `src/authorizationDirective.ts` (the bug) and `src/getUser.ts` (the function whose contract gets violated)
- Function: `AuthorizationDirective.visitFieldDefinition`'s call to `isUserAuthorized`, `src/authorizationDirective.ts` lines 56-63
- Confirmed identical at the current default-branch HEAD (commit `a5ca3d73fb83fab4dfbb347bf6a994da175b1f8e`) and at the latest published release tag `v2.3.0` — the latest version published to npm. This is one of the package's documented GraphQL usage patterns (the SDL/directive approach; the README also documents calling `isUserAuthorized` directly).

## Summary
`isUserAuthorized` (in `src/authorizationDirective.ts`) has the signature `(serviceUA, email, permission, iamURL, iamToken, servicePermissionsIdentifier = "")`.
`AuthorizationDirective.visitFieldDefinition` — the code that actually runs when a protected GraphQL field is resolved — calls it as `isUserAuthorized(AuthorizationDirective.serviceUA, AuthorizationDirective.servicePermissionsIdentifier, email, this.args.permission, AuthorizationDirective.iamURL, AuthorizationDirective.iamToken)`.
Every argument after the first lands in the wrong parameter: the service's static permissions-identifier string is bound to `email`, the real requesting user's email is bound to `permission`, the real required permission string is bound to `iamURL`, the real IAM service URL is bound to `iamToken`, and — the part I think matters most — **the service's real IAM authentication token ends up bound to `servicePermissionsIdentifier`**, which `getUser` (the function `isUserAuthorized` calls next) uses to help build the outbound request's URL, not its `Authorization` header.
I traced this to the exact commit that introduced it — `f1a1d76ec7c1dbab1ec059da2b0d6a3c6d9c3cc1` ("feat: add param for permissions identification (#123)", 31 March 2020) — and confirmed it is unchanged 6+ years later, present in the current release.
I built and ran a real proof of concept (against the actual `node-fetch` dependency this package declares, `^2.6.0`, not a hand-waved description) confirming exactly where each value ends up; see "Proof of concept".

## Confirmed call chain
1. `src/authorizationDirective.ts`, inside `AuthorizationDirective.visitFieldDefinition`'s field-resolver wrapper — this runs whenever a GraphQL field protected by the `@requires` schema directive (the SDL directive this package's `authorizationDirective` factory implements — the README's own example is `paymentCard: String @requires(permission: "payment-card.read")`) is resolved.
2. This resolver calls `isUserAuthorized(AuthorizationDirective.serviceUA, AuthorizationDirective.servicePermissionsIdentifier, email, this.args.permission, AuthorizationDirective.iamURL, AuthorizationDirective.iamToken)` — six positional arguments, in that order.
3. `isUserAuthorized`'s actual signature is `(serviceUA, email, permission, iamURL, iamToken, servicePermissionsIdentifier = "")` — a different order after the first parameter. `isUserAuthorized` calls `getUser(serviceUA, servicePermissionsIdentifier, email, iamURL, iamToken)` using its own (now-misbound) local variables.
4. `getUser` (`src/getUser.ts`) builds `` `${iamURL}/v1/user?service=${servicePermissionsIdentifier}&email=${email}` `` and sends a request with `headers: { Authorization: iamToken, "User-Agent": serviceUA }`. Because of the mismatch two steps up, the value `getUser` receives as `iamToken` (destined for the `Authorization` header) is actually `AuthorizationDirective.iamURL`, and the value it receives as `servicePermissionsIdentifier` (destined for the URL's `service=` query parameter) is actually `AuthorizationDirective.iamToken` — the service's real credential.
5. I confirmed this exact commit (`f1a1d76`, 31 March 2020) is where the mismatch was introduced: it correctly threaded the new `servicePermissionsIdentifier` parameter into `isUserAuthorized`'s own call to `getUser` (matching `getUser`'s new signature), but inserted it at the wrong position in `visitFieldDefinition`'s call to `isUserAuthorized` itself — a small, understandable copy/paste-style mistake across two call sites that both needed updating.
6. `getUser.test.ts` exists and passes, but it calls `getUser` directly with correctly-ordered arguments — it never calls `isUserAuthorized` or `visitFieldDefinition`, and no `authorizationDirective.test.ts` exists at all. This is a real, structural reason this has not been caught: the function that is misused has a passing isolated cache test; the caller that misuses it has no test coverage.
7. The `permission` value (misbound into `iamURL`'s slot in this chain) comes from the GraphQL schema itself, not from a request-time client. I confirmed this against the package's own `AuthorizationDirective.graphql`, which declares `directive @requires(permission: String!) on FIELD_DEFINITION`, and against the README's own documented usage example, `@requires(permission: "payment-card.read")` on a `paymentCard` field. Whoever authors the GraphQL schema chooses this value; a GraphQL client cannot influence it. I tested both the README's real documented value and the invented one I used for the proof of concept: neither produces a valid URL, but they fail via two different validation errors — `payment-card.read` throws `Only absolute URLs are supported`, while a colon-shaped permission like my `read:billing-secrets` throws `Only HTTP(S) protocols are supported` (the leading `read:` segment gets parsed as a URI scheme). Both documented-style permission values fail before any network I/O, but I'm naming the difference rather than implying one identical error message covers every case.
8. `getUser`'s cache write (`userCache.set(...)`) happens only after `await fetcher(...)` resolves, and that call is exactly what throws in this broken path — so this specific call chain can never populate the cache, and a cache hit would require some unrelated, correctly-ordered call to have already written an entry under the same (already-unusual, garbled) cache key. I have not tried to construct such a scenario. My "throws" claims in this report describe what I actually ran: a cold cache, with the two permission-string shapes above. I have not tested every conceivable cache state or permission value, and I'm not claiming to.

## Current vs. expected result
- **Current:** a lowercased value of the service's real IAM authentication token is interpolated into the URL string passed to `fetcher` as the `service=` query-string value, while the real IAM URL is passed as the `Authorization` header value.
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
I transcribed `getUser.ts`'s request-construction logic and `isUserAuthorized`'s call to it from the real files (not from memory or paraphrase), then called it exactly the way `visitFieldDefinition` does, with values representative of a real deployment. I deliberately left out `getUser`'s cache lookup/write (`userCache.get`/`userCache.set`) — it's irrelevant to the argument-order bug itself, and, as "Confirmed call chain" point 8 explains, this specific broken path can never reach the cache-write line anyway, so omitting it doesn't change the observed behavior; I'm naming the omission rather than calling this a complete transcription:
```
serviceUA:                     "my-backend-service/1.0"
servicePermissionsIdentifier:  "my-backend-service"          (static, configured once)
the real requesting user's email: "alice@example.com"        (varies per request)
the real required permission:  "read:billing-secrets"        (whatever the protected field requires)
iamURL:                        "https://iam.internal.example.com"
iamToken:                      "Bearer sk_live_REAL_SECRET_SERVICE_TOKEN_XYZ"  (the service's real credential)
```
Ran twice, each as its own small script (both in the attached `kiwicom-iam-argument-poc.zip`): `mock-poc.mjs` replaces `fetcher` with a logging function, to capture the exact URL and headers without making any network call; `real-poc.mjs` uses the real `node-fetch` dependency this package actually declares (`^2.6.0` in its own `package.json`; I tested both `2.6.7`, the version the package's own upstream lockfile resolves, and `2.6.9`), installed and executed for real rather than assumed to behave a certain way. The same archive also has `verify-nonnull-propagation.mjs` and its captured output, referenced in "Impact".

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

Both error messages come from the same place in `node-fetch`'s own source, `getNodeRequestOptions` in [`request.js`](https://github.com/node-fetch/node-fetch/blob/v2.6.7/src/request.js#L205-L220) — a request-options-building step that runs before the module ever opens a socket, which is consistent with the two runs above returning a rejected promise before any `http.request`, DNS resolution, or socket creation happens.

## Impact
What is demonstrated, directly, by running the real code above: on a cold cache, with a realistic (documented-style) permission identifier, a lowercased token value is interpolated into a URL string, in the same process that already legitimately held the original token, as part of constructing a request that then fails before any network I/O happens (confirmed against the real `node-fetch` dependency — see "Proof of concept"). I have not tested every cache state or every conceivable permission value, and I'm not claiming to. I want to be precise about what that does and does not establish, because it changes how much this should weigh. The token does not cross a process or network boundary here: it moves from one in-memory string to another, inside the same process that already had legitimate access to it, before the operation aborts. I have not demonstrated it reaching the IAM backend, a proxy, a log, a tracing system, or a GraphQL client — I specifically tested the one disclosure channel I could think of (whether the thrown error's message echoes the URL back to a caller) and it does not, with either `node-fetch@2` or Node's native `fetch` (see "Proof of concept"). I'm describing this as a real defect in how the value is handled — a secret should never be interpolated into a URL at all — but I have not shown any concrete disclosure resulting from it today, in this codebase, and I don't want the report to read as if I had.

Separately, and more concretely provable: I have not shown that this causes an authorization bypass. The most direct, repeatable consequence I observed is that the request fails (`TypeError: Only HTTP(S) protocols are supported`, or `Only absolute URLs are supported` for a documented-style permission value — see "Confirmed call chain" point 7), which propagates as a thrown error out of the GraphQL resolver — the protected field errors out rather than incorrectly granting access, for legitimate authorized users exactly as much as anyone else. This is a fail-closed defect: real users of a protected field would see it break, not see it under-protected. If any consumer of this library ever wraps `authorizationDirective`'s resolver in code that swallows this specific error and defaults to allowing the request through, that would be a bypass — but that would be a defect in the consuming application, not something this library does or that I have observed.

I verified this behavior using the real `graphql` execution engine, not asserted from memory (attached: `verify-nonnull-propagation.mjs` and its raw output). Per the [GraphQL spec's error-handling section](https://spec.graphql.org/October2021/#sec-Handling-Field-Errors), an error on a Non-Null field propagates to the nearest ancestor field that is allowed to be null — the *entire* `data` payload only becomes null if every field from the root down to the error is itself Non-Null (e.g., the protected field is a Non-Null root field, or every field on the path to it is Non-Null). In my minimal test, an unrelated, unprotected sibling resolver executed successfully, but its result was discarded once the Non-Null root field's error propagated, and the response contained `data: null`. I have not verified whether any real Kiwi.com schema exposes a field protected by this directive with that specific nullability shape — I'm stating the mechanism as real, verified GraphQL behavior, not claiming it applies to every protected field everywhere.

Taken together: what I can prove with full confidence is a real, unambiguous root-cause defect (CWE-683) that breaks a security control's intended function for any consumer exercising this documented code path — one of the GraphQL usage patterns this package's own README presents — unfixed for 6+ years. What I have not proven is a concrete information-disclosure or authorization-bypass outcome from it. I'd rather state both halves plainly and let triage weigh them than have the gap found after the fact.

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
