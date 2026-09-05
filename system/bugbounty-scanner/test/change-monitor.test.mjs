import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectMonitoredRepositories, pollRepositoryChanges } from '../change-monitor.mjs';
import { runChangeMonitor } from '../change-monitor-runner.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('collectMonitoredRepositories deduplica e exclui programa bloqueado antes da rede', () => {
  const targets = {
    js: [
      { owner: 'acme', repo: 'api', program: 'Allowed', language: 'js' },
      { owner: 'ACME', repo: 'API', program: 'Allowed', language: 'jvm' },
      { owner: 'blocked', repo: 'secret', program: 'Blocked', language: 'js' },
    ],
  };
  const policy = {
    Allowed: { roeReviewed: true, reviewedAt: '2026-09-01', nextReviewAt: '2099-01-01' },
    Blocked: { blocked: true, reason: 'fora de escopo' },
  };
  const repos = collectMonitoredRepositories(targets, policy);
  assert.equal(repos.length, 1);
  assert.equal(`${repos[0].owner}/${repos[0].repo}`.toLowerCase(), 'acme/api');
  assert.deepEqual(repos[0].languages.sort(), ['js', 'jvm']);
});

test('pollRepositoryChanges cria baseline sem chamar mudança de vulnerabilidade', async () => {
  const repos = [{ owner: 'acme', repo: 'api', programs: ['P'], languages: ['js'] }];
  const result = await pollRepositoryChanges(repos, {}, {
    fetchHead: async () => ({ sha: A, parentSha: B, branch: 'main', committedAt: '2026-09-04T12:00:00Z' }),
    now: () => new Date('2026-09-04T12:01:00Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.baseline, true);
  assert.equal(result.changes.length, 0);
  assert.equal(result.nextState.repos['acme/api'].sha, A);
});

test('pollRepositoryChanges registra delta direto com parent e instante de detecção', async () => {
  const repos = [{ owner: 'acme', repo: 'api', programs: ['P'], languages: ['js'] }];
  const previous = { schemaVersion: 1, repos: { 'acme/api': { sha: A } } };
  const result = await pollRepositoryChanges(repos, previous, {
    fetchHead: async () => ({ sha: B, parentSha: A, branch: 'main', committedAt: '2026-09-04T12:00:00Z', title: 'auth change' }),
    now: () => new Date('2026-09-04T12:01:00Z'),
  });
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].directSingleCommit, true);
  assert.equal(result.changes[0].parentCommit, A);
  assert.equal(result.changes[0].introducedCommit, B);
});

test('runner só avança cursor depois que scan orientado à mudança passa', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-change-monitor-'));
  const statePath = path.join(dir, 'state.json');
  const eventsPath = path.join(dir, 'events.jsonl');
  const previous = { schemaVersion: 1, repos: { 'acme/api': { sha: A } } };
  writeFileSync(statePath, JSON.stringify(previous), 'utf8');
  const poll = async () => ({
    ok: true, baseline: false, checked: 1, failures: [],
    changes: [{ repository: 'acme/api', previousSha: A, introducedCommit: B }],
    nextState: { schemaVersion: 1, repos: { 'acme/api': { sha: B } } },
  });
  const base = {
    statePath, eventsPath, poll,
    policy: { P: { roeReviewed: true, reviewedAt: '2026-09-01', nextReviewAt: '2099-01-01' } },
    targetLists: { js: [{ owner: 'acme', repo: 'api', program: 'P', language: 'js' }] },
    pull: () => ({ ok: true }), publish: () => ({ ok: true }), log: () => {},
  };
  try {
    await assert.rejects(() => runChangeMonitor({ ...base, scan: () => ({ status: 1, stderr: 'falhou' }) }), /cursor não avançou/);
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).repos['acme/api'].sha, A);

    const result = await runChangeMonitor({ ...base, scan: () => ({ status: 0, stdout: 'ok' }) });
    assert.equal(result.scanTriggered, true);
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).repos['acme/api'].sha, B);
    assert.equal(JSON.parse(readFileSync(eventsPath, 'utf8').trim()).introducedCommit, B);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
