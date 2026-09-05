import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQueuedFinding, findingIdentity, parseChangeContexts, parseChangedRepositories, selectTargetsForRun,
} from '../scan-runner.mjs';

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

test('parseChangeContexts preserva proveniência verificável e recusa SHA incompleto', () => {
  const context = {
    repository: 'Vercel/Chat', previousSha: 'a'.repeat(40), introducedCommit: 'b'.repeat(40),
    parentCommit: 'a'.repeat(40), introducedAt: '2026-09-05T12:00:00Z', detectedAt: '2026-09-05T12:01:00Z',
    branch: 'main', directSingleCommit: true, title: 'auth regression',
  };
  const parsed = parseChangeContexts(JSON.stringify([context]));
  assert.equal(parsed.get('vercel/chat').introducedCommit, 'b'.repeat(40));
  assert.equal(parsed.get('vercel/chat').directSingleCommit, true);
  assert.throws(() => parseChangeContexts(JSON.stringify([{ ...context, introducedCommit: 'short' }])), /completos/);
});

test('findingIdentity mantém scan rotineiro estável e versiona delta pelo commit', () => {
  const finding = { program: 'P', file: 'owner/repo/a.js', function: 'handler', type: 'ssrf' };
  assert.equal(findingIdentity(finding), 'P::owner/repo/a.js::handler::ssrf');
  assert.equal(
    findingIdentity(finding, { introducedCommit: 'b'.repeat(40) }),
    `P::owner/repo/a.js::handler::ssrf::commit:${'b'.repeat(40)}`,
  );
});

test('buildQueuedFinding carrega contexto completo e identidade versionada para a fila', () => {
  const finding = { program: 'P', file: 'owner/repo/a.js', function: 'handler', type: 'ssrf' };
  const changeContext = {
    repository: 'owner/repo', previousSha: 'a'.repeat(40), introducedCommit: 'b'.repeat(40),
  };
  const queued = buildQueuedFinding(finding, {
    changeContext, foundAt: '2026-09-05T12:02:00Z', historicalConfidence: { sample: 5 },
  });
  assert.equal(queued.id, `P::owner/repo/a.js::handler::ssrf::commit:${'b'.repeat(40)}`);
  assert.deepEqual(queued.changeContext, changeContext);
  assert.deepEqual(queued.historicalConfidence, { sample: 5 });
  assert.equal(queued.status, 'pending');
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
