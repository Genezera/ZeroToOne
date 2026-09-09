import path from 'node:path';

const RUNTIMES = {
  js: { runtime: 'node22', command: 'node regression-harness.mjs', harness: 'regression-harness.mjs' },
  javascript: { runtime: 'node22', command: 'node regression-harness.mjs', harness: 'regression-harness.mjs' },
  typescript: { runtime: 'node22', command: 'node regression-harness.mjs', harness: 'regression-harness.mjs' },
  go: { runtime: 'go127', command: 'go test ./...', harness: 'regression_test.go' },
  jvm: { runtime: 'jdk21', command: './gradlew test --no-daemon', harness: 'RegressionTest.java' },
  java: { runtime: 'jdk21', command: './gradlew test --no-daemon', harness: 'RegressionTest.java' },
  kotlin: { runtime: 'jdk21', command: './gradlew test --no-daemon', harness: 'RegressionTest.kt' },
  solidity: { runtime: 'foundry', command: 'forge test', harness: 'Regression.t.sol' },
  python: { runtime: 'python313', command: 'python regression_harness.py', harness: 'regression_harness.py' },
};

function safeSlug(value) {
  return String(value || 'finding').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export function proposeRegressionRecipe(finding) {
  const change = finding?.changeContext || finding?.raw?.changeContext;
  if (change?.directSingleCommit !== true) return { ok: false, reason: 'exact directSingleCommit change context is required' };
  if (!/^[0-9a-f]{40}$/i.test(change.introducedCommit || '') || !/^[0-9a-f]{40}$/i.test(change.parentCommit || '')) {
    return { ok: false, reason: 'full candidate and parent commit SHAs are required' };
  }
  const language = String(finding.language || '').toLowerCase();
  const profile = RUNTIMES[language];
  if (!profile) return { ok: false, reason: `no safe regression runtime profile for ${language || 'unknown language'}` };
  const repository = finding.repository || finding.asset;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) return { ok: false, reason: 'GitHub owner/repo is required' };
  const proposalDir = `research/bugbounty/proof-proposals/${safeSlug(finding.id)}`;
  return {
    ok: true,
    status: 'requires_human_harness',
    proposal: {
      kind: 'verified_regression', repositoryUrl: `https://github.com/${repository}.git`,
      parentCommit: change.parentCommit.toLowerCase(), introducedCommit: change.introducedCommit.toLowerCase(),
      runtime: profile.runtime, workdir: '.', command: profile.command,
      harnessPath: path.posix.join(proposalDir, profile.harness),
      expectedMarkers: ['ZTO_RESULT=NOT_VULNERABLE', 'ZTO_RESULT=VULNERABLE'],
      changedFiles: [...new Set(change.changedFiles || [])],
      reviewRequired: true,
      instructions: 'Implement one deterministic harness that emits exactly one marker on each commit; review it before adding this proposal to evidence-recipes.json.',
    },
  };
}

