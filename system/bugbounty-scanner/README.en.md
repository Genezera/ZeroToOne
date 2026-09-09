# ZeroToOne Bug Bounty Scanner

ZeroToOne is a fail-closed, cloud-first research pipeline for authorized bug
bounty work on open-source targets. It discovers bounty-eligible repositories,
monitors exact source changes, runs several static analyzers, records evidence,
and prepares candidates for human review.

It does **not** submit reports automatically. It also does not claim that a
candidate is novel merely because no public match was found. Private reports
are invisible to researchers, so no system can guarantee zero duplicates.

The Portuguese operational reference remains available in
[README.md](README.md). This document is the English architecture and operator
guide.

## Design goals

- Check program policy before selecting or reading a target.
- Prefer fresh, exact changes over repeated analysis of old code.
- Preserve the exact commit and changed-file provenance for every delta.
- Separate technical validity, impact, scope, novelty, deployment evidence,
  and submission readiness.
- Fail closed when evidence is missing, stale, malformed, or ambiguous.
- Keep all report submissions and production testing under human control.
- Learn from real platform outcomes without treating prose as proof.
- Run continuously in the cloud without Windows startup tasks or a local
  machine dependency.

## Non-goals and hard limitations

- ZeroToOne cannot see private reports submitted by other researchers.
- A public prior-art search can reduce duplicate risk, but cannot eliminate it.
- Static analyzer output is a lead, not a vulnerability.
- A recent commit is a prioritization signal, not proof that a vulnerability
  was introduced by that commit.
- Severity is evidence-driven. The pipeline must not inflate a Low or
  non-reportable issue to satisfy a campaign target.
- The pipeline never grants itself authorization to test a production system.
- Scheduled GitHub Actions are best-effort and do not provide a strict
  15-minute service-level guarantee.

## Current operating model

GitHub Actions is the primary runtime. The local Windows environment is
`manual_only` and has no boot, login, service, or scheduled-task trigger.

| Component | Nominal cadence | Purpose |
| --- | ---: | --- |
| Change monitor | Every 15 minutes | Poll authorized repository HEADs and scan exact deltas |
| Static safety scan | Every 6 hours | Rotate broader repository coverage |
| Target discovery | Daily | Refresh metadata-only bounty repository candidates |
| HackerOne outcome sync | Hourly | Import real report status and duplicate outcomes |
| Evidence worker | Every 2 hours and after successful upstream jobs | Execute authorized evidence work orders |
| Operations metrics | Every 30 minutes and after monitor/evidence jobs | Measure coverage, latency, retries, and alert delivery |
| Cloud health | Every 30 minutes and after operational jobs | Verify workflow freshness and administrative state |

The change monitor also runs after successful static scan, outcome sync, and
target discovery jobs. The evidence worker runs after successful change
monitor, static scan, and discovery jobs. These links add polling opportunities
without creating an infinite workflow cycle.

GitHub may delay cron jobs. A separate external cloud scheduler is required if
a strict detection latency is needed.

## End-to-end data flow

1. **Program policy gate**
   - Load the explicit local program policy.
   - Reject blocked, expired, unknown, or AI/automation-prohibited programs
     before source access.
2. **Target discovery**
   - Read structured HackerOne/Bugcrowd metadata.
   - Keep only programs offering bounties and allowed by local policy.
   - Publish an authorized metadata-only monitor registry.
3. **Change detection**
   - Poll the current HEAD of each authorized repository.
   - Resolve the GitHub compare result to an exact changed-file list.
   - Refuse truncated, missing, malformed, or oversized comparisons.
4. **Immutable delta scan**
   - Read the source tree, manifests, and files from the observed full commit
     SHA, never from a moving branch.
   - Scan only the attested changed paths for delta-originated findings.
   - Advance the monitor cursor only after the delta scan succeeds.
5. **Finding materialization**
   - Assign a deterministic identity and preserve commit provenance.
   - Store the finding in the portable JSONL queue and materialized SQLite
     view.
   - Append lifecycle evidence to the hash-chained ledger.
6. **Research plan**
   - Re-evaluate program policy, scope, prior submissions, code age, impact,
     identity quality, novelty, and readiness.
   - Return either a single actionable next step or a specific hold reason.
7. **Evidence worker**
   - Revalidate scope from an official source.
   - Measure the latest path touch using Git history.
   - Execute registered regression recipes in an isolated sandbox.
   - Stop at `needs_human` when positive impact or judgment cannot be proved
     safely.
8. **Human review**
   - Inspect the complete call chain and attack boundary.
   - Reproduce the issue end to end where authorization permits.
   - Review the final draft and explicitly approve any submission.
9. **Outcome feedback**
   - Import the real HackerOne decision.
   - Preserve duplicate, informative, rejected, triaged, resolved, and paid
     outcomes for future prioritization.

## Anti-duplicate controls

The duplicate controls are intentionally stricter than a normal vulnerability
scanner:

- A program/repository with sufficient high duplicate history is removed from
  routine historical scanning but remains on the change monitor.
- The current campaign only promotes exact direct changes no older than 48
  hours.
- Findings derived from a delta carry base commit, introduced commit, parent,
  changed files, and detection time.
- Root cause identity uses structured fields instead of titles or report prose:
  repository, file, weakness, root cause, attacker input, security sink,
  missing control, and expected fix.
- Local root-cause collisions must be consolidated or mechanically
  distinguished.
- Public prior-art searches cover issues, pull requests, commits, advisories,
  and public Hacktivity when available.
- A prior public match blocks progression.
- A previous submission or program/repository duplicate history can hold a
  candidate before more expensive research.
- A regression novelty claim requires the same test to show a safe baseline
  and vulnerable candidate in an isolated executor.
- Every final preflight states the unavoidable private-report visibility
  limitation.

These controls lower risk; they do not make a guarantee about private reports.

## Detection engines

The scanner combines purpose-built parsers with established tools:

- JavaScript/TypeScript AST and taint-oriented heuristics.
- Go security heuristics.
- JVM source and dependency analysis.
- Solidity heuristics and Slither.
- Swift source heuristics where supported.
- Semgrep for selected vulnerability patterns.
- OSV-Scanner for known-vulnerable dependencies.
- Buildless CodeQL for JavaScript/TypeScript.

Third-party target install scripts are not executed during ordinary cloud
scanning. Findings in tests, examples, fixtures, generated code, vendored code,
and dependency caches are filtered where the detector can establish that
context.

Analyzer matches remain untrusted until the real call chain and boundary are
validated.

## Evidence model

Evidence is split into independent dimensions:

- **Technical validity**: whether the behavior exists.
- **Attacker control**: what an attacker can actually influence.
- **Victim and boundary**: which other user, tenant, service, or security
  boundary is affected.
- **Observable outcome**: confidentiality, integrity, or availability effect.
- **Scope and bounty eligibility**: exact official asset status.
- **Deployment evidence**: whether the tested code is relevant to the eligible
  deployed product or distributed artifact.
- **Novelty**: verified regression plus completed public prior-art search.
- **Evidence grade**: from source lead to end-to-end reproduction and platform
  confirmation.

Validation records distinguish execution `result` (`pass`, `fail`, or
`not_applicable`) from hypothesis `conclusion` (`supports`, `refutes`, or
`inconclusive`). A command failure is not automatically proof of a security
hypothesis.

## Telegram attention alerts

Telegram credentials are supplied through GitHub Actions secrets. The evidence
worker sends an explicit alert only when:

- an exact delta no older than 48 hours reaches `needs_human`; or
- a finding reaches `human_review` after satisfying automated preflight.

The message begins with:

```text
🚨 ZeroToOne — ATENÇÃO HUMANA NECESSÁRIA
```

The operational message remains in Portuguese. Each item is labeled either
`DELTA RECENTE BLOQUEADO` or `PRONTO PARA REVISÃO FINAL`.
Historical work orders do not trigger this alert. Successful delivery is stored
on the work order so it is not sent again. A failed delivery remains pending
and is retried by the next evidence-worker run.

No Telegram alert means only that no candidate crossed this threshold. It does
not prove that no vulnerability exists.

## Finding lifecycle

The state machine includes:

```text
candidate
  -> corroborated_static
  -> reproduced_local
  -> scope_verified
  -> human_ready
  -> submitted
  -> triaged | duplicate | informative | rejected | resolved | paid
```

Negative or retained states such as `false_positive`, `inconclusive`, and
`known_duplicate` preserve rejected research without returning it to ordinary
active selection. `inconclusive` may still be resolved to `false_positive`.

Important transitions are guarded:

- `candidate -> corroborated_static`: multiple relevant files and substantive
  reasoning.
- `corroborated_static -> reproduced_local`: recorded supporting validation.
- `reproduced_local -> scope_verified`: current exact scope plus strong
  deployment evidence.
- `scope_verified -> human_ready`: report draft, Medium+ cross-boundary impact,
  end-to-end E4 evidence, regression proof, completed prior-art checks, and
  current policy.
- `human_ready -> submitted`: explicit human approval.

## Important files

| Path | Purpose |
| --- | --- |
| `research/bugbounty/program-policy.json` | Explicit allow/block and policy-review decisions |
| `research/bugbounty/authorized-monitor-targets.json` | Metadata-only authorized repository registry |
| `research/bugbounty/change-monitor-state.json` | Last observed repository heads |
| `research/bugbounty/change-events.jsonl` | Exact observed source deltas |
| `research/bugbounty/queue.jsonl` | Portable finding view |
| `research/bugbounty/submissions.jsonl` | Portable report and platform outcomes |
| `research/bugbounty/ledger.jsonl` | Hash-chained research event ledger |
| `research/bugbounty/evidence-recipes.json` | Finding-specific safe evidence recipes |
| `research/bugbounty/evidence-worker-state.json` | Idempotent evidence work orders and alert delivery state |
| `research/bugbounty/zerotoone.db` | Local materialized SQLite view |

The JSONL files are the shared version-controlled records. SQLite can be
rehydrated and must not be treated as the only source of truth.

## Requirements

- Node.js 20 or newer; cloud workflows currently use Node.js 24.
- Git and GitHub CLI for manual administration.
- GitHub Actions enabled on the private control repository.
- Required GitHub secrets:
  - `HACKERONE_USERNAME`
  - `HACKERONE_API_TOKEN`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
- Docker only for local regression recipes that require the sandbox. Docker is
  not required for routine cloud monitoring or notifications.

Install locked project dependencies:

```bash
npm ci --ignore-scripts
```

## Operator commands

Always generate the current research plan before choosing work:

```bash
node system/bugbounty-scanner/cli.mjs research-plan
```

Inspect the complete operational state:

```bash
node system/bugbounty-scanner/cli.mjs mission-control
```

Audit invariants, workflows, policy, queue, ledger, and integrations:

```bash
node system/bugbounty-scanner/cli.mjs audit-system
```

Inspect actionable findings only:

```bash
node system/bugbounty-scanner/cli.mjs list-pending
```

Include retained historical candidates for diagnosis:

```bash
node system/bugbounty-scanner/cli.mjs list-pending --include-held
```

Check one program before any source access:

```bash
node system/bugbounty-scanner/cli.mjs check-program "Exact Program Name"
```

Inspect one finding and its evidence dimensions:

```bash
node system/bugbounty-scanner/cli.mjs get "finding-id"
node system/bugbounty-scanner/cli.mjs evidence-grade "finding-id"
node system/bugbounty-scanner/cli.mjs submission-preflight "finding-id"
```

Run the test suite:

```bash
npm test
```

## Cloud operation

The workflows are stored under `.github/workflows/`. All writer workflows use
the same concurrency group to serialize changes to shared JSONL state. Actions
are pinned to immutable SHAs and workflows declare explicit permissions.

Each writer:

1. checks out current `master` with full history;
2. installs the locked dependencies without package scripts;
3. runs one bounded worker;
4. publishes state through the guarded Git synchronization layer; and
5. asserts that the resulting worktree is clean.

The publication layer checks for secrets, suspicious binaries, unsafe archive
contents, dirty/stale state, and push races. Failed pushes are reconciled only
through the guarded merge behavior; a worker must not silently overwrite
newer shared state.

## Local operation

The computer does not need to remain powered on for monitoring, scanning,
evidence scheduling, health checks, or Telegram alerts.

Local execution is useful for:

- authorized manual source review;
- an E4 reproduction needing a specialized runtime;
- screenshots and final evidence capture;
- two-account or browser-based validation within program rules;
- final report review and human submission.

There must be no automatic Windows startup task. A broken or stopped Docker
Desktop instance does not stop the cloud pipeline.

## Failure behavior

- Missing or expired policy: block before source access.
- Missing exact scope or unknown bounty eligibility: hold for verification.
- Incomplete GitHub compare: do not scan and do not advance the cursor.
- Scanner or publication failure: preserve the previous cursor for retry.
- Missing impact evidence: stop at `needs_human`.
- Public prior-art match: hold as known match.
- Old path or delta: retain outside the active fresh-regression campaign.
- Telegram failure: keep the attention delivery pending for retry.
- GitHub-wide scheduler outage: visible only to an external supervisor; this
  cannot be solved by another workflow inside the same platform.

## Advanced capabilities and remaining deployment work

The next improvements should increase evidence quality and detection latency,
not raw alert volume.

### 1. Independent cloud scheduler and watchdog — implemented, deployment pending

`cloud/bugbounty-watchdog` contains a dependency-free Cloudflare Worker. Its
ten-minute Cron Trigger dispatches the change monitor, checks GitHub from an
independent provider, stores alert state in Workers KV, and sends one Telegram
failure/recovery notification per state transition. Deployment is necessarily
pending until a Cloudflare account, KV namespace, and fine-grained GitHub token
are supplied outside the repository.

### 2. Diff-aware semantic scanning for additional languages — safety layer implemented

The CodeQL adapter now filters SARIF to findings with a location in the exact
changed-file set and supports Java `none` mode. Go refuses to run without an
explicit approved build recipe. Automatic Go/Kotlin builds remain deliberately
disabled: their build systems execute third-party code and cannot be made
generically safe without target-specific dependency and build recipes.

### 3. Commit-bound proof proposals — implemented

`proof-recipe-proposer.mjs` generates a deterministic proposal bound to the
exact parent, candidate, runtime, changed files, expected markers, and harness
path. It never invents exploit logic: a human must implement and review the
finding-specific harness before the existing sandbox runs the same test on both
commits.

### 4. Deployment and release evidence adapters — implemented

Evidence recipes can verify npm `gitHead`, GitHub release tags including
annotated tags, and Go module proxy `Origin.Hash`. Only an exact 40-character
commit match produces `confidence=high`; mismatch or missing provenance fails
closed at `needs_human`.

### 5. Better outcome-calibrated detector ranking — foundation operational

Track precision by detector, language, program, boundary type, and evidence
grade. Use real duplicate/informative/false-positive outcomes to allocate
expensive analysis, while preserving hard safety and evidence gates.

### 6. Coverage and latency metrics — implemented

`operations-metrics.mjs` and `bugbounty-metrics.yml` measure authorized monitor
coverage, monitor lag, 24-hour and seven-day deltas, P50/P95 detection latency,
evidence retries, undelivered attention, and new findings. New and recovered
operational failures are deduplicated and sent to Telegram; Mission Control
includes the persisted metric snapshot.

## Responsible-use rule

Only research explicitly authorized assets under current program rules. Do not
use automation where a program prohibits it. Do not test production accounts,
users, or infrastructure beyond the exact permission granted by the program.
The pipeline's existence does not expand authorization.
