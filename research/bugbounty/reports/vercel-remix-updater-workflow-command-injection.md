# Command Injection via Unsanitized `workflow_dispatch` Input in `update-remix-run-dev.js` CI Workflow

## Program / Platform
Vercel Open Source via HackerOne — https://hackerone.com/vercel-open-source

## Category / Severity
OS Command Injection (CWE-78). Target `vercel/vercel`, `asset_type:
Source Code`, eligible for bounty, with a critical ceiling for this
asset. I'm not self-assigning Critical — that's the ceiling for the
asset, not an assessment of this specific vulnerability; see
"Prerequisites" and "Impact" below for the real severity reasoning,
including why this isn't unauthenticated RCE.

## Affected asset
- Repository: `vercel/vercel`
- Files:
  - `.github/workflows/update-remix-run-dev.yml` (trigger declaration)
  - `utils/update-remix-run-dev.js` (vulnerable logic)
- Lines: workflow lines 4-8 (unvalidated input) and line 30 (input
  passed unescaped); script lines 20, 30, 32, 64, 66
- Commit confirmed against: `e06cc643cec6a47bd9344af7f4589c736d95ed15`
  (branch `main`) — confirmed as current HEAD via the GitHub API on
  2026-09-01, not a stale snapshot from an old scan.

## Summary
The `update-remix-run-dev.yml` workflow accepts a free-text input
(`new-version`) via `workflow_dispatch`, with no format validation at
all. That value flows, after only a `.trim()` and a trivial character
substitution, into three template-string `execSync()` calls inside
`utils/update-remix-run-dev.js` — which run through a real shell
(`/bin/sh -c`), not through `spawn()`/`execFile()` with an argument
array (the safe pattern already used in ~20 other places in the same
repository). Any collaborator with permission to trigger
`workflow_dispatch` on this repository can inject an arbitrary command
into the GitHub Actions runner that executes this workflow.

## Confirmed call chain
1. `.github/workflows/update-remix-run-dev.yml:4-8` — declares the
   `new-version` input as `type: string`, with no `pattern` or any
   format validation in the `workflow_dispatch` schema.
2. `.github/workflows/update-remix-run-dev.yml:30` — `await script({
   github, context }, "${{ inputs.new-version }}")` — the raw input
   value goes straight, as a string interpolated by GitHub Actions
   itself before the JS even runs, into the first positional argument
   of the function exported by `update-remix-run-dev.js`.
3. `utils/update-remix-run-dev.js:20` — `newVersion = newVersion.trim();`
   — the only transformation applied to the entire input value. No
   semver format validation, no character allowlist.
4. `utils/update-remix-run-dev.js:30` — `` const branch =
   `vercel-remix-run-dev-${newVersion.replaceAll('.', '-')}`; `` — only
   replaces the "." character with "-"; every other character
   (backtick, `$(`, `;`, `&&`, `|`, newline) is preserved literally.
5. `utils/update-remix-run-dev.js:32` — `` execSync(`git ls-remote
   --heads origin ${branch}`, { encoding: 'utf-8' }) `` — `branch`
   interpolated directly into a template string passed to `execSync`,
   which by default runs through `/bin/sh -c` in Node.js (unlike
   `spawn(cmd, args[])`, which passes arguments straight to `execve()`
   without invoking a shell). Confirmed the contrast by comparing
   against the pattern used in the rest of the repository — e.g.
   `packages/python/src/start-dev-server.ts:322/459/1115`,
   `packages/ruby/src/start-dev-server.ts:148`,
   `packages/rust/src/lib/start-dev-server.ts:145` — all use `spawn()`
   with an argument array, never a template string.
6. The same `branch` (already containing the injected value) is reused
   with no further sanitization at `utils/update-remix-run-dev.js:64`
   (`` execSync(`git checkout -b ${branch}`) ``) and `:66`
   (`` execSync(`git commit -m ${branch}`) ``) — three independent
   injection points, same root cause.

## Prerequisites
Permission to trigger `workflow_dispatch` on this repository —
concretely, **write** permission on `vercel/vercel` (GitHub's standard
model for who can trigger a manual workflow), **not** admin/maintainer
privilege and no direct secret access. No real user account is needed
beyond one's own — no third-party data involved.

## Steps to reproduce (real-world scenario)
1. Go to `vercel/vercel` → **Actions** tab → **"Update
   @remix-run/dev"** workflow → **"Run workflow"** button.
2. In the free-text **`new-version`** field, enter a string containing
   command substitution, for example:
   `1.0.0$(id > /tmp/poc-executed)` (deliberately harmless example —
   it only writes `id`'s output to a temp file on the runner itself,
   proving execution without exfiltrating anything or altering
   external state).
3. Trigger the workflow.
4. The runner builds and executes (script line 32):
   `git ls-remote --heads origin vercel-remix-run-dev-1-0-0$(id > /tmp/poc-executed)`
   — the `/bin/sh -c` that `execSync` invokes expands `$(id >
   /tmp/poc-executed)` BEFORE building the final `git ls-remote`
   argument, meaning `id > /tmp/poc-executed` runs as an independent
   command on the runner, successfully, regardless of what `git
   ls-remote` itself does afterward.

## Current vs. expected result
- **Current:** the `new-version` input value, supplied by whoever
  triggers the workflow, is interpolated with no shell-metacharacter
  sanitization inside three `execSync()` calls — command-execution
  control (not just data) in the hands of whoever fills the field.
- **Expected:** the value should be validated against a strict format
  (e.g. semver: `/^\d+\.\d+\.\d+$/`) before any use, AND/OR the
  commands should use `execFileSync`/`spawn` with an argument array
  (never a template string), which invokes no shell at all and makes
  any metacharacter in the value irrelevant.

## Evidence
`.github/workflows/update-remix-run-dev.yml` (lines 4-8 and 30):
```yaml
on:
  workflow_dispatch:
    inputs:
      new-version:
        type: string
        description: 'Optional version to update @remix-run/dev to inside of @vercel/remix-builder'
```
```yaml
            const script = require('./utils/update-remix-run-dev.js')
            await script({ github, context }, "${{ inputs.new-version }}")
```
📷 See attached screenshot `remix-injection-01-workflow-yaml-input.png`.

`utils/update-remix-run-dev.js` (lines 20, 30, 32, 64, 66):
```js
newVersion = newVersion.trim();
// ...
const branch = `vercel-remix-run-dev-${newVersion.replaceAll('.', '-')}`;
if (
  execSync(`git ls-remote --heads origin ${branch}`, { encoding: 'utf-8' })
    .toString()
    .trim()
) {
// ...
execSync(`git checkout -b ${branch}`);
execSync('git add -A');
execSync(`git commit -m ${branch}`);
execSync(`git push origin ${branch}`);
```
📷 See attached screenshot `remix-injection-02-update-script-execsync.png`.

Contrast with the safe pattern already used elsewhere in the same
repository (`packages/python/src/start-dev-server.ts:322`):
```js
const child = spawn(spawnCmd, spawnArgs, {
  cwd: projectDir,
  env: getProtectedUvEnv(env),
  stdio: ['inherit', 'pipe', 'pipe'],
});
```

**Duplicate/history check** (GitHub API, not a local clone): script
created 2023-03-01 (PR #9588), the only logic change since then was
removing a build dependency on 2024-12-17 (PR #12762) — the
unsanitized `execSync` pattern has never been touched by any security
review in over 3 years, despite the `.yml` having gone through 2
recent credential swaps (PR #15463 on 2026-03-11, PR #16042 on
2026-04-20 — "Replace NPM_TOKEN with OIDC trusted publishing") that
touched the token but not this pattern. Searched the issues/PRs API
for "update-remix-run-dev": 116 results, all routine automated PRs
("[remix] Update @remix-run/dev to vX" or "Version Packages") — none
about security. Zero security advisories in the repository cover this.

## Proof of concept
Not executed against `vercel/vercel`'s real repository or CI — doing
so would require triggering a real `workflow_dispatch` on production
infrastructure without prior authorization specifically for this kind
of test. Instead, here is a fully isolated, local reproduction of the
exact vulnerable primitive, safe to run anywhere, with no access to
`vercel/vercel`'s CI or any production system:

```bash
mkdir remix-injection-poc && cd remix-injection-poc
node -e "
const { execSync } = require('child_process');
let newVersion = '1.0.0\$(id > poc-executed.txt)';
newVersion = newVersion.trim();
const branch = \`vercel-remix-run-dev-\${newVersion.replaceAll('.', '-')}\`;
try {
  execSync(\`git ls-remote --heads origin \${branch}\`, { encoding: 'utf-8' });
} catch (e) {
  // git has no real remote to talk to in this throwaway folder and
  // throws here -- irrelevant, the injected command already ran
  // before execSync's own command even got parsed.
}
"
cat poc-executed.txt
```

If `poc-executed.txt` exists and contains the output of `id` (e.g.
`uid=1000(user) gid=1000(user) groups=...`), arbitrary command
execution is confirmed. The three operations above
(`.trim()` → build `branch` → `execSync` template string) are copied
verbatim from `utils/update-remix-run-dev.js:20,30,32` at the commit
cited above — diff them against the real file to confirm this
reproduces the exact code path, not an equivalent reconstruction.

## Impact
A collaborator with **write** permission on `vercel/vercel` (no need
to be a maintainer or have any configured secret access) can execute
an arbitrary command on the GitHub Actions runner (`ubuntu-latest`)
that processes this workflow. This is a genuine privilege escalation,
not unauthenticated RCE — the distinction matters and I'm not
inflating the severity:

- The runner has access to the job's default `GITHUB_TOKEN` (scope
  defined by the workflow/repository's permissions) and to any other
  repository/organization-level secret configured to run in GitHub
  Actions — none of which an ordinary "write" collaborator necessarily
  has direct access to outside this context.
- The `github-token` explicitly configured in the step
  (`secrets.VERCEL_CLI_RELEASE_BOT_TOKEN`) carries the comment "TODO:
  this secret is deleted, replace with a new bot token or GitHub App"
  — this **does not neutralize the finding**: the `execSync` injection
  runs BEFORE the script's only two `github.rest.*` calls at the end
  (the only use of that specific token), and the job's automatic
  `GITHUB_TOKEN` remains available regardless of that particular
  secret's state.
- A realistic threat scenario even without a malicious insider: a
  compromised "write" collaborator account (phishing, leaked token)
  would gain, through this bug, access to whatever secrets/environment
  the runner has — more than the nominal GitHub "write" permission
  should grant on its own.

## Suggested fix
Two independent changes, either one alone would already fix it:
1. Validate `newVersion` against a strict format as soon as it enters
   the function (e.g. `if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion))
   throw new Error(...)`), before any use in `branch` or `execSync`.
2. Replace the 4 template-string `execSync` calls with
   `execFileSync(cmd, argsArray)` (e.g. `execFileSync('git', ['checkout',
   '-b', branch])`) — the same pattern already used via `spawn()` in
   the rest of the repository. This eliminates the entire injection
   class regardless of any future format validation.
