import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectMonitoredRepositories, fetchRepositoryChangedFiles, pollRepositoryChanges } from '../change-monitor.mjs';
import { buildDeltaScanEnvironment, loadAuthorizedMonitorTargets, runChangeMonitor } from '../change-monitor-runner.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('buildDeltaScanEnvironment entrega repositórios e contexto completo ao scanner', () => {
  const changes = [{
    repository: 'acme/api', previousSha: A, introducedCommit: B,
    parentCommit: A, detectedAt: '2026-09-05T12:01:00Z', changedFiles: ['src/auth.js'],
  }];
  const env = buildDeltaScanEnvironment(changes, { KEEP: 'yes' });
  assert.equal(env.KEEP, 'yes');
  assert.deepEqual(JSON.parse(env.ZERO2ONE_CHANGED_REPOSITORIES), ['acme/api']);
  assert.deepEqual(JSON.parse(env.ZERO2ONE_CHANGE_CONTEXT), changes);
});

test('fetchRepositoryChangedFiles preserva somente caminhos ativos e falha fechado no limite', async () => {
  const target = { owner: 'acme', repo: 'api' };
  const result = await fetchRepositoryChangedFiles(target, A, B, { fetchImpl: async () => ({
    ok: true, json: async () => ({ html_url: 'https://github.com/acme/api/compare/a...b', files: [
      { filename: 'src/auth.js', status: 'modified' },
      { filename: 'src/old.js', status: 'removed' },
    ] }),
  }) });
  assert.deepEqual(result.changedFiles, ['src/auth.js']);
  assert.deepEqual(result.removedFiles, ['src/old.js']);
  await assert.rejects(() => fetchRepositoryChangedFiles(target, A, B, { fetchImpl: async () => ({
    ok: true, json: async () => ({ files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}.js`, status: 'modified' })) }),
  }) }), /limite de 300/);
});

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
  assert.equal(result.stateChanged, true);
  assert.deepEqual(result.addedRepositories, ['acme/api']);
  assert.deepEqual(result.removedRepositories, []);
  assert.equal(result.nextState.repos['acme/api'].sha, A);
});

test('pollRepositoryChanges registra delta direto com parent e instante de detecção', async () => {
  const repos = [{ owner: 'acme', repo: 'api', programs: ['P'], languages: ['js'] }];
  const previous = { schemaVersion: 1, repos: { 'acme/api': { sha: A } } };
  const result = await pollRepositoryChanges(repos, previous, {
    fetchHead: async () => ({ sha: B, parentSha: A, branch: 'main', committedAt: '2026-09-04T12:00:00Z', title: 'auth change' }),
    fetchChangedFiles: async () => ({ changedFiles: ['src/auth.js'], removedFiles: [], compareUrl: 'https://example/compare' }),
    now: () => new Date('2026-09-04T12:01:00Z'),
  });
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].directSingleCommit, true);
  assert.equal(result.changes[0].parentCommit, A);
  assert.equal(result.changes[0].introducedCommit, B);
  assert.deepEqual(result.changes[0].changedFiles, ['src/auth.js']);
  assert.equal(result.stateChanged, true);
});

test('collectMonitoredRepositories inclui radar metadata-only e revalida todos os programas', () => {
  const policy = {
    Allowed: { roeReviewed: true, reviewedAt: '2026-09-01', nextReviewAt: '2099-01-01' },
    Blocked: { blocked: true, reason: 'fora de escopo' },
  };
  const repos = collectMonitoredRepositories({ monitor: [
    { owner: 'large', repo: 'unknown-language', programs: [{ program: 'Allowed', platform: 'HackerOne' }] },
    { owner: 'shared', repo: 'unsafe', programs: [{ program: 'Allowed' }, { program: 'Blocked' }] },
  ] }, policy);
  assert.deepEqual(repos.map((item) => `${item.owner}/${item.repo}`), ['large/unknown-language']);
  assert.deepEqual(repos[0].programs, ['Allowed']);
  assert.deepEqual(repos[0].languages, []);
});

test('loadAuthorizedMonitorTargets falha fechado em arquivo corrompido', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-monitor-registry-'));
  const filePath = path.join(dir, 'registry.json');
  try {
    writeFileSync(filePath, '{broken', 'utf8');
    assert.throws(() => loadAuthorizedMonitorTargets(filePath), /inválido/);
    writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, repositories: [{ owner: 'acme', repo: 'api', programs: [{ program: 'P' }] }] }), 'utf8');
    assert.equal(loadAuthorizedMonitorTargets(filePath).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pollRepositoryChanges não avança quando a lista exata do diff falha', async () => {
  const repos = [{ owner: 'acme', repo: 'api', programs: ['P'], languages: ['js'] }];
  const previous = { schemaVersion: 1, repos: { 'acme/api': { sha: A } } };
  const result = await pollRepositoryChanges(repos, previous, {
    fetchHead: async () => ({ sha: B, parentSha: A, branch: 'main', committedAt: '2026-09-04T12:00:00Z' }),
    fetchChangedFiles: async () => { throw new Error('compare indisponível'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.failures[0].reason, /compare indisponível/);
});

test('pollRepositoryChanges mantém estado byte-estável quando o head não mudou', async () => {
  const repos = [{ owner: 'acme', repo: 'api', programs: ['P'], languages: ['js'] }];
  const previous = {
    schemaVersion: 1,
    checkedAt: '2026-09-04T11:00:00.000Z',
    repos: {
      'acme/api': {
        sha: A, parentSha: B, branch: 'main', observedAt: '2026-09-04T11:00:00.000Z',
        programs: ['P'], languages: ['js'],
      },
    },
  };
  const result = await pollRepositoryChanges(repos, previous, {
    fetchHead: async () => ({ sha: A, parentSha: B, branch: 'main', committedAt: '2026-09-04T10:00:00Z' }),
    now: () => new Date('2026-09-04T12:01:00Z'),
  });
  assert.equal(result.stateChanged, false);
  assert.deepEqual(result.addedRepositories, []);
  assert.deepEqual(result.removedRepositories, []);
  assert.deepEqual(result.nextState, previous);
});

test('pollRepositoryChanges registra expansão e remoção do baseline sem inventar delta', async () => {
  const repos = [{ owner: 'new', repo: 'repo', programs: ['P'], languages: ['go'] }];
  const previous = {
    schemaVersion: 1,
    checkedAt: '2026-09-04T11:00:00.000Z',
    repos: { 'old/repo': { sha: A, programs: ['P'], languages: ['js'] } },
  };
  const result = await pollRepositoryChanges(repos, previous, {
    fetchHead: async () => ({ sha: B, parentSha: A, branch: 'main', committedAt: '2026-09-04T12:00:00Z' }),
    now: () => new Date('2026-09-04T12:01:00Z'),
  });
  assert.equal(result.stateChanged, true);
  assert.deepEqual(result.addedRepositories, ['new/repo']);
  assert.deepEqual(result.removedRepositories, ['old/repo']);
  assert.equal(result.changes.length, 0);
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
    addedRepositories: [], removedRepositories: [], stateChanged: true,
    nextState: { schemaVersion: 1, repos: { 'acme/api': { sha: B } } },
  });
  const base = {
    statePath, eventsPath, poll, authorizedMonitorTargetsPath: path.join(dir, 'absent-registry.json'),
    policy: { P: { roeReviewed: true, reviewedAt: '2026-09-01', nextReviewAt: '2099-01-01' } },
    targetLists: { js: [{ owner: 'acme', repo: 'api', program: 'P', language: 'js' }] },
    pull: () => ({ ok: true }), publish: () => ({ ok: true }), log: () => {},
  };
  try {
    await assert.rejects(() => runChangeMonitor({ ...base, scan: () => ({ status: 1, stderr: 'falhou' }) }), /cursor não avançou/);
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).repos['acme/api'].sha, A);

    let scannedChanges = null;
    const result = await runChangeMonitor({ ...base, scan: (changes) => {
      scannedChanges = changes;
      return { status: 0, stdout: 'ok' };
    } });
    assert.equal(result.scanTriggered, true);
    assert.equal(scannedChanges[0].repository, 'acme/api');
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).repos['acme/api'].sha, B);
    assert.equal(JSON.parse(readFileSync(eventsPath, 'utf8').trim()).introducedCommit, B);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner sem mudança não reescreve nem publica o estado', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-change-monitor-stable-'));
  const statePath = path.join(dir, 'state.json');
  const eventsPath = path.join(dir, 'events.jsonl');
  const previousText = `${JSON.stringify({ schemaVersion: 1, checkedAt: '2026-09-04T11:00:00.000Z', repos: { 'acme/api': { sha: A } } }, null, 2)}\n`;
  writeFileSync(statePath, previousText, 'utf8');
  let publishes = 0;
  let scans = 0;
  try {
    const result = await runChangeMonitor({
      statePath, eventsPath,
      authorizedMonitorTargetsPath: path.join(dir, 'absent-registry.json'),
      policy: { P: { roeReviewed: true, reviewedAt: '2026-09-01', nextReviewAt: '2099-01-01' } },
      targetLists: { js: [{ owner: 'acme', repo: 'api', program: 'P', language: 'js' }] },
      pull: () => ({ ok: true }),
      publish: () => { publishes += 1; return { ok: true }; },
      scan: () => { scans += 1; return { status: 0 }; },
      poll: async () => ({
        ok: true, baseline: false, checked: 1, failures: [], changes: [],
        addedRepositories: [], removedRepositories: [], stateChanged: false,
        nextState: JSON.parse(previousText),
      }),
      log: () => {},
    });
    assert.equal(result.scanTriggered, false);
    assert.equal(scans, 0);
    assert.equal(publishes, 0);
    assert.equal(readFileSync(statePath, 'utf8'), previousText);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
