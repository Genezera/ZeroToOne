# Command Injection via Unsanitized `workflow_dispatch` Input in `update-remix-run-dev.js` CI Workflow

## Program / Platform
Vercel Open Source via HackerOne — https://hackerone.com/vercel-open-source

## Category / Severity
OS Command Injection (CWE-78). Target `vercel/vercel`, `asset_type: Source Code`, eligible for bounty, with a critical ceiling for this asset. I'm not self-assigning Critical — that's the ceiling for the asset, not an assessment of this specific vulnerability; see "Prerequisites" and "Impact" below for the real severity reasoning, including why this isn't unauthenticated RCE.

## Affected asset
- Repository: `vercel/vercel`
- Files:
  - `.github/workflows/update-remix-run-dev.yml` (trigger declaration)
  - `utils/update-remix-run-dev.js` (vulnerable logic)
- Lines: workflow lines 4-8 (unvalidated input) and line 30 (input passed unescaped); script lines 20, 30, 32, 64, 66, 67
- Commit confirmed against: `e06cc643cec6a47bd9344af7f4589c736d95ed15` (branch `main`) — confirmed as current HEAD via the GitHub API on 2026-09-01, not a stale snapshot from an old scan.

## Summary
The `update-remix-run-dev.yml` workflow accepts a free-text input (`new-version`) via `workflow_dispatch`, with no format validation at all. That value flows, after only a `.trim()` and a trivial character substitution, into template-string `execSync()` calls inside `utils/update-remix-run-dev.js` — which run through a real shell (`/bin/sh -c`), not through `spawn()`/`execFile()` with an argument array (the safe pattern already used in ~20 other places in the same repository). An actor who can trigger this workflow can inject an arbitrary command into the GitHub Actions runner executing the workflow.

## Confirmed call chain
1. `.github/workflows/update-remix-run-dev.yml:4-8` — declares the `new-version` input as `type: string`, with no `pattern` or any format validation in the `workflow_dispatch` schema.
2. `.github/workflows/update-remix-run-dev.yml:30` — `await script({ github, context }, "${{ inputs.new-version }}")` — the raw input value goes straight, as a string interpolated by GitHub Actions itself before the JS even runs, into the first positional argument of the function exported by `update-remix-run-dev.js`.
3. `utils/update-remix-run-dev.js:20` — `newVersion = newVersion.trim();` — the only transformation applied to the entire input value. No semver format validation, no character allowlist.
4. `utils/update-remix-run-dev.js:30` — `` const branch = `vercel-remix-run-dev-${newVersion.replaceAll('.', '-')}`; `` — only replaces the "." character with "-"; every other character (backtick, `$(`, `;`, `&&`, `|`, newline) is preserved literally.
5. `utils/update-remix-run-dev.js:32` — `` execSync(`git ls-remote --heads origin ${branch}`, { encoding: 'utf-8' }) `` — `branch` interpolated directly into a template string passed to `execSync`, which by default runs through `/bin/sh -c` in Node.js (unlike `spawn(cmd, args[])`, which passes arguments straight to `execve()` without invoking a shell). Confirmed the contrast by comparing against the pattern used in the rest of the repository — e.g. `packages/python/src/start-dev-server.ts:322/459/1115`, `packages/ruby/src/start-dev-server.ts:148`, `packages/rust/src/lib/start-dev-server.ts:145` — all use `spawn()` with an argument array, never a template string.
6. The same `branch` (already containing the injected value) is reused with no further sanitization at `utils/update-remix-run-dev.js:64` (`` execSync(`git checkout -b ${branch}`) ``), `:66` (`` execSync(`git commit -m ${branch}`) ``), and `:67` (`` execSync(`git push origin ${branch}`) ``) — four independent injection points, same root cause. Confirmed live: the replica PoC below shows the injected command executing four separate times, one per call site (see "Proof of concept").

## Prerequisites
Permission to trigger `workflow_dispatch` on this repository. As a GitHub platform default, dispatching a workflow manually requires at least write access to the repository — I have not verified whether `vercel/vercel` layers any additional restriction (e.g. an environment protection rule) on top of that default for this specific workflow. Either way, no admin/maintainer privilege or direct secret access is required, and no real user account beyond one's own is needed — no third-party data involved.

## Steps to reproduce (real-world scenario)
1. Go to `vercel/vercel` → **Actions** tab → **"Update @remix-run/dev"** workflow → **"Run workflow"** button.
2. In the free-text **`new-version`** field, enter a string containing command substitution, for example: `1.0.0$(id > /tmp/poc-executed)` (deliberately harmless example — it only writes `id`'s output to a temp file on the runner itself, proving execution without exfiltrating anything or altering external state).
3. Trigger the workflow.
4. The runner builds and executes (script line 32): `git ls-remote --heads origin vercel-remix-run-dev-1-0-0$(id > /tmp/poc-executed)` — the `/bin/sh -c` that `execSync` invokes expands `$(id > /tmp/poc-executed)` BEFORE building the final `git ls-remote` argument, meaning `id > /tmp/poc-executed` runs as an independent command on the runner, successfully, regardless of what `git ls-remote` itself does afterward.

## Current vs. expected result
- **Current:** the `new-version` input value, supplied by whoever triggers the workflow, is interpolated with no shell-metacharacter sanitization inside four `execSync()` calls — command-execution control (not just data) in the hands of whoever fills the field.
- **Expected:** the value should be validated against a strict format (e.g. semver: `/^\d+\.\d+\.\d+$/`) before any use, AND/OR the commands should use `execFileSync`/`spawn` with an argument array (never a template string), which invokes no shell at all and makes any metacharacter in the value irrelevant.

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

`utils/update-remix-run-dev.js` (lines 20, 30, 32, 64, 66, 67):
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

Contrast with the safe pattern already used elsewhere in the same repository (`packages/python/src/start-dev-server.ts:322`):
```js
const child = spawn(spawnCmd, spawnArgs, {
  cwd: projectDir,
  env: getProtectedUvEnv(env),
  stdio: ['inherit', 'pipe', 'pipe'],
});
```

**Duplicate/history check**: no public advisory, issue, or pull request was found describing this specific command-injection path in `update-remix-run-dev.js`. `vercel/vercel`'s public GitHub Security Advisories were also reviewed and none matched. This does not rule out an existing private report on the same program.

## Proof of concept
Not executed against `vercel/vercel`'s own repository or CI — doing so would mean triggering a real `workflow_dispatch` against Vercel's own production infrastructure, which the program's Rules of Engagement explicitly prohibit ("Researchers must NOT conduct proof-of-concept testing or active exploitation directly against Vercel owned production repositories including: ... CI/CD in Vercel maintained repositories"). Instead, I built an isolated replica repository containing `utils/update-remix-run-dev.js` copied byte-for-byte from the commit cited above (verified against the GitHub API immediately before use, not a stale local copy) plus the same workflow trigger, and actually ran it on a real GitHub Actions runner using this isolated replica of the vulnerable code and workflow structure — without touching Vercel's own CI/CD:

- Replica repository: https://github.com/Genezera/remix-injection-poc
- Vulnerable file in the replica (unmodified copy): https://github.com/Genezera/remix-injection-poc/blob/main/utils/update-remix-run-dev.js
- Live run, publicly viewable: https://github.com/Genezera/remix-injection-poc/actions/runs/33637084151/job/100270575320

Steps actually performed:
1. Opened the replica's **Actions** tab → **"Update @remix-run/dev"** → **Run workflow**, with the `new-version` field set to `1.0.0$(id 1>&2)`. 📷 See attached screenshot `remix-injection-03-workflow-dispatch-input.png`.
2. Triggered the run. Node's `execSync` inherits the child process's stderr into the parent's own stderr by default, so the output of the injected `id` surfaces directly in the step's log rather than being silently captured. The log shows it four separate times — once for each of the four `execSync` call sites that reuse the tainted `branch` value (`git ls-remote`, `git checkout -b`, `git commit -m`, `git push`):
   ```
   uid=1001(runner) gid=1001(runner) groups=1001(runner),4(adm),100(users),118(docker),999(systemd-journal)
   ```
   📷 See attached screenshot `remix-injection-04-actions-log-command-executed.png`.
3. The run finishes with the job marked **Failed** — expected, and irrelevant to the finding: the injected command already ran, in step 2, well before the script reaches `git push origin ${branch}`, which fails afterward on an unrelated 403 (the replica intentionally omits Vercel's own release-bot token, so the default `GITHUB_TOKEN` lacks push permission in my test repo — a limitation of the replica, not of the vulnerability). 📷 See attached screenshot `remix-injection-05-run-summary-failed-as-expected.png`.

The only intentional difference between the replica and the real `vercel/vercel` workflow is that missing bot-token line — every line of `utils/update-remix-run-dev.js`, including all four vulnerable `execSync` calls, is unmodified. The replica's public run log is independent, checkable evidence: a reviewer can open the run URL above directly, without trusting the screenshots alone.

A minimal, dependency-free version of the same primitive, useful for tracing the exact three lines responsible without setting up GitHub Actions at all:

```bash
node -e "
const { execSync } = require('child_process');
let newVersion = '1.0.0\$(id > poc-executed.txt)';
newVersion = newVersion.trim();
const branch = \`vercel-remix-run-dev-\${newVersion.replaceAll('.', '-')}\`;
try {
  execSync(\`git ls-remote --heads origin \${branch}\`, { encoding: 'utf-8' });
} catch (e) {
  // no real remote in this throwaway folder, throws here -- irrelevant,
  // the injected command already ran before execSync's own command
  // even finished
}
"
cat poc-executed.txt
```
If `poc-executed.txt` contains the output of `id`, that confirms the same primitive locally. The three operations (`.trim()` → build `branch` → `execSync` template string) are copied verbatim from `utils/update-remix-run-dev.js:20,30,32`.

## Impact
An actor able to trigger this workflow achieves **arbitrary command execution in the security context of the GitHub Actions job** (`ubuntu-latest`) that processes it — demonstrated directly by the PoC above. This is a genuine escalation beyond what triggering a workflow is meant to grant, not unauthenticated RCE — the distinction matters and I'm not inflating the severity:

- The concrete downstream impact (which secrets, which environment, which further systems) depends on whatever permissions are actually granted to this specific job — I have not enumerated those beyond what's visible in the workflow file itself. The workflow also runs with GitHub Actions' automatically provided `GITHUB_TOKEN`, subject to the permissions granted to the job.
- The `github-token` explicitly configured in the step (`secrets.VERCEL_CLI_RELEASE_BOT_TOKEN`) carries the comment "TODO: this secret is deleted, replace with a new bot token or GitHub App" — this **does not neutralize the finding**: the `execSync` injection runs BEFORE the script's only two `github.rest.*` calls at the end, which are the only use of that specific token.
- Even without a malicious insider, a compromised "write" collaborator account (phishing, leaked token) would be able to execute arbitrary commands in this job's context — a capability beyond what the nominal GitHub "write" permission is meant to grant on its own.

## Suggested fix
Two independent changes, either one alone would already fix it:
1. Validate `newVersion` against a strict format as soon as it enters the function (e.g. `if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion)) throw new Error(...)`), before any use in `branch` or `execSync`.
2. Replace the 4 template-string `execSync` calls with `execFileSync(cmd, argsArray)` (e.g. `execFileSync('git', ['checkout', '-b', branch])`) — the same pattern already used via `spawn()` in the rest of the repository. This eliminates the entire injection class regardless of any future format validation.
