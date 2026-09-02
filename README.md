# ZeroToOne

An automated bug bounty research pipeline. It finds eligible open-source
targets, analyzes their real source code for vulnerabilities, verifies
each candidate with actual proof-of-concept execution (never a
fabricated or purely theoretical claim), and submits real reports to
bug bounty programs (HackerOne, Bugcrowd, Immunefi).

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
   patterns). Raw findings are noisy by design at this stage.
3. **Corroborate** — every candidate finding gets a manual code-reading
   pass tracing the actual call chain end to end, then, wherever
   feasible, a real, executed proof of concept — a local reproduction,
   or an isolated replica environment when testing the real target's
   infrastructure directly isn't allowed. Findings that can't survive
   this step are marked false positive rather than shipped.
4. **Submit** — a corroborated finding becomes a full report (call
   chain, evidence, PoC, suggested fix) and gets filed with the
   program. Every finding's lifecycle (candidate → corroborated →
   reproduced → submitted → the program's actual decision) is tracked
   in a small state machine, backed by a tamper-evident, hash-chained
   append-only ledger — nothing gets silently dropped or rewritten
   after the fact.

It runs from two places at once: a local session on this machine, and
a cloud routine triggered by pushes to this repository. Both read and
write the same shared state — a plain-text `queue.jsonl` export and
the ledger, both version-controlled — so either side can pick up
exactly where the other left off.

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
