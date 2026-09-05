import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChangedRepositories, selectTargetsForRun } from '../scan-runner.mjs';

const configured = {
  js: [
    { owner: 'vercel', repo: 'chat', program: 'Vercel' },
    { owner: 'mattermost', repo: 'mattermost', program: 'Mattermost' },
  ],
  go: [{ owner: 'blocked', repo: 'private', program: 'Blocked' }],
};
const policy = {
  Vercel: { roeReviewed: true, reviewedAt: '2026-09-01', nextReviewAt: '2099-01-01' },
  Mattermost: { roeReviewed: true, reviewedAt: '2026-09-01', nextReviewAt: '2099-01-01' },
  Blocked: { blocked: true, reason: 'fora de escopo' },
};
const history = {
  vercel: { submissions: 2, duplicateRate: 1 },
  mattermost: { submissions: 1, duplicateRate: 0 },
};

test('parseChangedRepositories exige array JSON não-vazio de owner/repo', () => {
  assert.equal(parseChangedRepositories(undefined), null);
  assert.deepEqual([...parseChangedRepositories('["Vercel/Chat", "mattermost/mattermost"]')], ['vercel/chat', 'mattermost/mattermost']);
  assert.throws(() => parseChangedRepositories('[]'), /não-vazio/);
  assert.throws(() => parseChangedRepositories('não-json'), /inválido/);
  assert.throws(() => parseChangedRepositories('["sem-barra"]'), /owner\/repo inválido/);
});

test('scan rotineiro deixa programa saturado em monitor-only e mantém permitido não saturado', () => {
  const result = selectTargetsForRun(configured, policy, history);
  assert.deepEqual(result.targetLists.js.map((target) => target.repo), ['mattermost']);
  assert.deepEqual(result.targetLists.go, []);
  assert.equal(result.duplicateRiskSkipped, 1);
  assert.equal(result.policyBlocked, 1);
});

test('scan delta seleciona só repositório alterado e reinspeciona mesmo programa saturado', () => {
  const changed = parseChangedRepositories('["vercel/chat"]');
  const result = selectTargetsForRun(configured, policy, history, changed);
  assert.deepEqual(result.targetLists.js.map((target) => target.repo), ['chat']);
  assert.deepEqual(result.targetLists.go, []);
  assert.equal(result.duplicateRiskSkipped, 0);
  assert.equal(result.policyBlocked, 1);
  assert.equal(result.deltaFiltered, 1);
});
