# ZeroToOne

An automated bug bounty research pipeline. It finds eligible open-source
targets, analyzes their real source code for vulnerabilities, verifies
each candidate with actual proof-of-concept execution (never a
fabricated or purely theoretical claim), and prepares evidence-backed
reports for human review. Submission to a bug bounty program is always a
deliberate human action; the automation never files a report by itself.

## How it works

1. **Discover** — pull each program's public scope (structured dataset
   or the program's own API/page), track which repositories are
   in-scope and bounty-eligible, and pick new candidate targets on a
   rotation that favors less-popular, less-already-audited
   repositories over heavily-scrutinized ones.
2. **Scan** — clone the target and run it through language-specific
   heuristic detectors (JS/TS, Go, JVM, Solidity, Swift) plus
   established third-party tools (Slither for Solidity, OSV-Scanner
   for known-vulnerable dependencies, Semgrep for common weakness
   patterns, and buildless CodeQL for JS/TS). A lightweight monitor
   checks allowed repositories every 15 minutes and triggers a delta scan
   of exactly the repositories whose HEAD changed. Programs with at least
   two submissions and an 80%+ duplicate rate are excluded from routine
   historical scans, but remain monitored and are re-enabled automatically
   for a fresh commit. Delta findings carry the observed base/new commit and
   use a commit-versioned identity, so a past false positive in the same
   function cannot hide a real regression. Raw findings are noisy by design
   at this stage.
3. **Corroborate** — candidates that survive the policy, freshness, scope,
   identity, and impact gates require a manual code-reading pass tracing the
   actual call chain end to end, then, wherever
   feasible, a real, executed proof of concept — a local reproduction,
   or an isolated replica environment when testing the real target's
   infrastructure directly isn't allowed. Findings that can't survive
   this step are marked false positive rather than shipped.
   Evidence types are separated: a clean prior-art search or supporting
   specification review can never be mistaken for an executable PoC or promote
   a finding to the reproduced state.
4. **Review and submit** — a corroborated finding becomes a report draft
   (call chain, evidence, PoC, suggested fix), passes fail-closed impact,
   scope, non-expired program-policy, E4 end-to-end regression,
   positive bounty eligibility, Medium+ impact, high-confidence deployment
   and prior-art gates,
   and waits for explicit human approval. Every finding's lifecycle (candidate → corroborated →
   reproduced → submitted → the program's actual decision) is tracked
   in a small state machine, backed by a tamper-evident, hash-chained
   append-only ledger — nothing gets silently dropped or rewritten
   after the fact.

### Target selection and the low-competition path

Scoring targets by popularity steers the scanner toward heavily-audited
repositories, where independent researchers are likely to have already
filed the same finding — and a bounty platform never lets you see another
researcher's private report, so that collision is invisible until your own
report is closed as a duplicate. Requiring a verified sub-48h regression
proof as the sole novelty filter compounds this: it holds every finding in
long-standing code indefinitely, which for some bug classes guarantees
nothing is ever submitted.

A program may therefore be marked `competitionLevel: "low"` in
`program-policy.json` — a deliberate, per-program, human-audited decision,
never an automatic dataset heuristic. For such a program a finding can
reach human review on its own merits — Medium+ impact, exact scope and
bounty eligibility, structured identity with no local root-cause
collision, an attested and coverage-checked public prior-art search that
came back clean with zero prior duplicate submissions, and a real executed
reproduction — **without** a fresh regression proof, since that program's
duplicate risk has already been judged low and its risk-score proxies
(code age, repo popularity) no longer apply. Every one of those real
protections stays enforced; only the regression-specific interlocks are
lifted, and the finding is labelled so the consciously-accepted duplicate
risk is explicit. The human-approval gate before submission is unchanged —
nothing is ever auto-submitted. The relaxation is additive and dormant
until a program carries the flag, so every other program behaves
identically.

GitHub Actions is the primary runtime. Scheduled cloud workflows own the
15-minute change monitor, daily target discovery/promotion, six-hour
safety scan, two-hour evidence worker, half-hour operations metrics and health
checks, and hourly HackerOne outcome sync. The local Windows environment is manual-only: no
service, boot trigger, login task, or local heartbeat is required. Both
manual and cloud runs use the same version-controlled `queue.jsonl`,
submissions, and ledger; fail-closed Git preflight prevents a stale or dirty
worker from silently overwriting shared state.

`mission-control` joins those components into one live health view: it checks
the latest real GitHub Actions outcomes against each cadence,
repository/policy invariants, pipeline state counts, and submission outcomes.
Cloud health runs every 30 minutes and after operational workflows. Because
a GitHub-wide scheduler outage cannot be detected from inside GitHub itself,
a separate external supervisor runs as a Cloudflare Worker
(`cloud/bugbounty-watchdog/`) on its own 10-minute cron: it independently
checks pipeline health and alerts over Telegram when the primary runtime
goes quiet. Its deployment config stays local; the versioned template is
`wrangler.example.jsonc`, and its secrets live only in the Worker.

## Where to look

- [`system/bugbounty-scanner/`](system/bugbounty-scanner/README.md) —
  the pipeline itself: scanners, target discovery, the state machine,
  report generation, and the CLI bridge both runtimes use. Its README
  is the detailed, continuously-updated technical reference.
- [`system/bugbounty-scanner/README.en.md`](system/bugbounty-scanner/README.en.md)
  — detailed English architecture, cloud operations, alert behavior,
  anti-duplicate controls, failure modes, and roadmap.
- [`docs/zerotoone-v2/IMPLEMENTATION_STATE.md`](docs/zerotoone-v2/IMPLEMENTATION_STATE.md)
  — the target architecture and an honest account of what's actually
  built versus deferred, and why.
- [`research/bugbounty/`](research/bugbounty/) — per-program research
  notes, submitted reports, and captured scope snapshots.

## Running it

```bash
npm test
```

runs the full test suite. The pipeline's own commands (discovery, scan,
report generation, syncing report status with the platform) are
documented in `system/bugbounty-scanner/README.md`.

```bash
node system/bugbounty-scanner/cli.mjs mission-control
```

returns the end-to-end operational view. It exits non-zero when a required
local or cloud component is unhealthy.
