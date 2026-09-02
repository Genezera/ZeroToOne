# Positional Argument Mismatch in `AuthorizationDirective` Leaks the Service's IAM Auth Token into a Request URL and Makes GraphQL Authorization Always Fail Closed (`@kiwicom/iam`, `isUserAuthorized`)

## Program / Platform
Kiwi.com via HackerOne — https://hackerone.com/kiwicom

## Category / Severity
Two distinct, independently-real issues in the same code path, and I want to separate them rather than blur them together. First: Insertion of Sensitive Information Into Sent Data via a URL query string (CWE-598-adjacent) — the service's own IAM authentication token ends up embedded in an outbound request URL instead of the `Authorization` header, on every real invocation of this code path. Second: the underlying cause is a positional-argument mismatch between two functions that makes the GraphQL authorization directive throw instead of correctly granting or denying access — a fail-closed functional defect, not an authorization bypass. I'm not self-assigning a severity label; I want to be explicit up front that I have not demonstrated an authorization bypass (see "Impact"), and the practical weight of this should reflect that.

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

## Current vs. expected result
- **Current:** the service's real IAM authentication token is placed into the outbound request's URL (as the `service=` query-string value), and the real IAM URL is placed into the `Authorization` header instead of the real token.
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
Ran twice: once with a logging mock in place of `fetcher` (to capture the exact URL and headers without making any network call), and once against the real `node-fetch@2.6.x` dependency this package actually pins in its own `package.json` (installed and executed for real, not assumed to behave a certain way).

With the logging mock, the request that would actually be sent:
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
What is demonstrated, directly, by running the real code above: on every real invocation of the documented `@authorization` GraphQL usage pattern, the service's live IAM authentication credential is placed into a URL string as part of constructing the (ultimately failing) request to the IAM backend, instead of staying inside the `Authorization` header. URLs are far more commonly captured by logging, tracing, and monitoring infrastructure than headers are — many tools and proxies explicitly redact `Authorization` by default but do not inspect or redact arbitrary query-string values — so this is a real secrets-hygiene defect (the credential ends up somewhere it should structurally never be) independent of whether the outbound request itself succeeds.

What I want to be explicit is not demonstrated: I have not shown that this causes an authorization bypass. The most direct, repeatable consequence I observed is that the request fails (`TypeError: Only HTTP(S) protocols are supported`), which propagates as a thrown error out of the GraphQL resolver — the protected field errors out rather than incorrectly granting access. This is a fail-closed defect: real users of a protected field would see it break, not see it under-protected. I also specifically tested for a secret-disclosure-via-error-message path and did not find one (see "Proof of concept"). If any consumer of this library ever wraps `authorizationDirective`'s resolver in code that swallows this specific error and defaults to allowing the request through, that would be a bypass — but that would be a defect in the consuming application, not something this library does or that I have observed.

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
