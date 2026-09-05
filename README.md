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
   checks allowed repositories every 15 minutes and triggers this scan
   when it observes a new HEAD. Raw findings are noisy by design at this stage.
3. **Corroborate** — every candidate finding gets a manual code-reading
   pass tracing the actual call chain end to end, then, wherever
   feasible, a real, executed proof of concept — a local reproduction,
   or an isolated replica environment when testing the real target's
   infrastructure directly isn't allowed. Findings that can't survive
   this step are marked false positive rather than shipped.
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

It runs in complementary roles: scheduled cloud workflows own the
15-minute change monitor, daily target discovery/promotion, six-hour
safety scan and hourly HackerOne outcome sync, while the local Windows
service owns heavier analyzer runs, diagnostics and watchdog duties.
Both exchange the same version-controlled `queue.jsonl`, submissions and
ledger; fail-closed Git preflight prevents a stale or dirty worker from
silently overwriting shared state.

## Where to look

- [`system/bugbounty-scanner/`](system/bugbounty-scanner/README.md) —
  the pipeline itself: scanners, target discovery, the state machine,
  report generation, and the CLI bridge both runtimes use. Its README
  is the detailed, continuously-updated technical reference.
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
