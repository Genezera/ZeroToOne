import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeRegressionRecipe } from '../proof-recipe-proposer.mjs';
import { verifyDeploymentRecipe } from '../deployment-evidence-adapters.mjs';

const SHA = 'a'.repeat(40);
const PARENT = 'b'.repeat(40);
const finding = { id: 'P::acme/api/src/a.js::run::idor', repository: 'acme/api', language: 'js',
  changeContext: { directSingleCommit: true, introducedCommit: SHA, parentCommit: PARENT, changedFiles: ['src/a.js'] } };

test('proof proposer binds one reviewed harness to parent and candidate', () => {
  const result = proposeRegressionRecipe(finding);
  assert.equal(result.ok, true);
  assert.equal(result.proposal.runtime, 'node22');
  assert.equal(result.proposal.introducedCommit, SHA);
  assert.equal(result.proposal.parentCommit, PARENT);
  assert.equal(result.proposal.reviewRequired, true);
});

test('proof proposer refuses range changes and incomplete SHAs', () => {
  assert.equal(proposeRegressionRecipe({ ...finding, changeContext: { ...finding.changeContext, directSingleCommit: false } }).ok, false);
  assert.equal(proposeRegressionRecipe({ ...finding, changeContext: { ...finding.changeContext, parentCommit: 'short' } }).ok, false);
});

test('npm adapter grants high confidence only for an exact gitHead', async () => {
  const good = await verifyDeploymentRecipe({ kind: 'npm_registry', package: '@acme/api', version: '1.2.3' }, finding, {
    fetchFn: async () => Response.json({ version: '1.2.3', gitHead: SHA }),
  });
  assert.equal(good.ok, true);
  assert.equal(good.confidence, 'high');
  const bad = await verifyDeploymentRecipe({ kind: 'npm_registry', package: '@acme/api', version: '1.2.3' }, finding, {
    fetchFn: async () => Response.json({ version: '1.2.3', gitHead: PARENT }),
  });
  assert.equal(bad.ok, false);
});

test('GitHub release adapter peels annotated tag and requires exact commit', async () => {
  const result = await verifyDeploymentRecipe({ kind: 'github_release', tag: 'v1.0.0' }, finding, {
    githubToken: 'x', fetchFn: async (url) => {
      if (url.includes('/releases/tags/')) return Response.json({ name: 'v1', html_url: 'https://example/release' });
      if (url.includes('/git/ref/tags/')) return Response.json({ object: { type: 'tag', sha: 'c'.repeat(40) } });
      return Response.json({ object: { type: 'commit', sha: SHA } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.commit, SHA);
});

