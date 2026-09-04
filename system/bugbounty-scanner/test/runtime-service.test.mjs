import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  acquireLease, backoffMs, emptyRuntimeState, isJobDue, loadRuntimeState,
  replaceFileAtomic, saveRuntimeState, summarizeRuntimeHealth,
} from '../runtime-state.mjs';
import { runServiceCycle } from '../service-runner.mjs';
import { runWatchdog } from '../watchdog-runner.mjs';
import { appendRuntimeEvent } from '../runtime-event-log.mjs';

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-runtime-test-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('runtime state usa round-trip atômico e recupera JSON inválido sem lançar', async () => {
  await withTempDir((dir) => {
    const statePath = path.join(dir, 'state.json');
    const state = emptyRuntimeState('2026-09-03T12:00:00Z');
    state.service.status = 'healthy';
    saveRuntimeState(statePath, state);
    assert.equal(loadRuntimeState(statePath).service.status, 'healthy');
    writeFileSync(statePath, '{ quebrado', 'utf8');
    assert.equal(loadRuntimeState(statePath).service.status, 'initializing');
  });
});

test('telemetria de runtime fica em JSONL local independente do ledger de pesquisa', async () => {
  await withTempDir((dir) => {
    const eventPath = path.join(dir, 'logs', 'runtime-events.jsonl');
    appendRuntimeEvent(eventPath, { type: 'bugbounty_runtime_job', job: 'scan', status: 'failure' }, {
      now: () => new Date('2026-09-04T10:00:00Z'),
    });
    const event = JSON.parse(readFileSync(eventPath, 'utf8').trim());
    assert.equal(event.job, 'scan');
    assert.equal(event.status, 'failure');
    assert.equal(event.ts, '2026-09-04T10:00:00.000Z');
  });
});

test('substituição atômica repete bloqueio transitório do Windows sem apagar o target', () => {
  const calls = [];
  let renameAttempts = 0;
  replaceFileAtomic('temp', 'target', {
    rename: () => {
      calls.push('rename');
      renameAttempts += 1;
      if (renameAttempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    },
    wait: (ms) => calls.push(`wait:${ms}`),
    attempts: 4,
    retryDelayMs: 7,
  });
  assert.deepEqual(calls, ['rename', 'wait:7', 'rename', 'wait:7', 'rename']);
  assert.throws(() => replaceFileAtomic('temp', 'target', {
    rename: () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
    wait: () => { throw new Error('não deve esperar'); },
  }), /disk full/);
});

test('lease impede sobreposição e recupera lock stale de PID morto', async () => {
  await withTempDir((dir) => {
    const lockPath = path.join(dir, 'service.lock');
    const first = acquireLease(lockPath, { now: Date.parse('2026-09-03T12:00:00Z') });
    assert.equal(first.ok, true);
    assert.equal(acquireLease(lockPath, { now: Date.parse('2026-09-03T12:01:00Z') }).ok, false);
    first.release();
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, acquiredAt: '2026-09-03T00:00:00Z' }), 'utf8');
    const recovered = acquireLease(lockPath, {
      now: Date.parse('2026-09-03T12:00:00Z'), processAlive: () => false,
    });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.recoveredStaleLock, true);
    recovered.release();
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, acquiredAt: '2026-09-03T11:59:59Z' }), 'utf8');
    const freshButDead = acquireLease(lockPath, {
      now: Date.parse('2026-09-03T12:00:00Z'), processAlive: () => false,
    });
    assert.equal(freshButDead.ok, true, 'PID comprovadamente morto deve ser recuperado sem esperar quatro horas');
    freshButDead.release();
    writeFileSync(lockPath, '{incompleto', 'utf8');
    const incompleteFresh = acquireLease(lockPath, { now: Date.now(), processAlive: () => false });
    assert.equal(incompleteFresh.ok, false, 'lock recém-criado e ainda incompleto não pode ser removido numa corrida');
  });
});

test('due/backoff e health são fail-closed, mas job pesado ativo não gera falso alarme', () => {
  const now = Date.parse('2026-09-03T12:00:00Z');
  assert.equal(isJobDue({}, 60_000, now), true);
  assert.equal(isJobDue({ lastSuccessAt: '2026-09-03T11:59:30Z' }, 60_000, now), false);
  assert.equal(backoffMs(1), 5 * 60_000);
  assert.equal(backoffMs(4), 40 * 60_000);
  const stale = emptyRuntimeState('2026-09-03T00:00:00Z');
  assert.equal(summarizeRuntimeHealth(stale, { now }).healthy, false);
  stale.service.activeJob = 'scan';
  stale.service.activeJobStartedAt = '2026-09-03T11:00:00Z';
  assert.equal(summarizeRuntimeHealth(stale, { now }).healthy, true);
  stale.service.status = 'degraded';
  assert.equal(summarizeRuntimeHealth(stale, { now }).healthy, false);
  stale.service.status = 'healthy';
  stale.jobs.scan = { consecutiveFailures: 1 };
  assert.equal(summarizeRuntimeHealth(stale, { now }).healthy, false);
});

test('service inicializa sem disparar carga e depois roda leves + no máximo um pesado', async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, 'state.json');
    const lockPath = path.join(dir, 'service.lock');
    let now = Date.parse('2026-09-03T12:00:00Z');
    const originalUser = process.env.HACKERONE_USERNAME;
    const originalToken = process.env.HACKERONE_API_TOKEN;
    process.env.HACKERONE_USERNAME = 'configured-for-test';
    process.env.HACKERONE_API_TOKEN = 'configured-for-test';
    try {
      const initial = await runServiceCycle({ statePath, lockPath, now: () => now, runner: () => { throw new Error('não deveria rodar'); }, notify: async () => ({ ok: true }), recordEvent: () => {} });
      assert.equal(initial.initialized, true);
      now += 25 * 60 * 60 * 1000;
      const ran = [];
      const events = [];
      const result = await runServiceCycle({
        statePath, lockPath, now: () => now,
        runner: (job) => { ran.push(job.name); return { status: 0, stdout: `${job.name} ok`, stderr: '' }; },
        notify: async () => ({ ok: true }), recordEvent: (event) => events.push(event),
      });
      assert.deepEqual(ran, ['sync_reports', 'doctor', 'scan']);
      assert.equal(result.ok, true);
      assert.equal(events.length, 3);
      assert.equal(result.state.jobs.discovery.lastSuccessAt, '2026-09-03T12:00:00.000Z');
    } finally {
      if (originalUser === undefined) delete process.env.HACKERONE_USERNAME; else process.env.HACKERONE_USERNAME = originalUser;
      if (originalToken === undefined) delete process.env.HACKERONE_API_TOKEN; else process.env.HACKERONE_API_TOKEN = originalToken;
    }
  });
});

test('modo cloud-primary desliga scan/sync locais e mantém doctor + discovery', async () => {
  withTempDir(async (dir) => {
    const originalCloudPrimary = process.env.ZERO2ONE_CLOUD_PRIMARY;
    const originalUser = process.env.HACKERONE_USERNAME;
    const originalToken = process.env.HACKERONE_API_TOKEN;
    process.env.ZERO2ONE_CLOUD_PRIMARY = '1';
    process.env.HACKERONE_USERNAME = 'user';
    process.env.HACKERONE_API_TOKEN = 'token';
    try {
      const statePath = path.join(dir, 'state.json');
      const lockPath = path.join(dir, 'service.lock');
      let current = Date.parse('2026-09-03T12:00:00.000Z');
      await runServiceCycle({ statePath, lockPath, initializeOnly: true, now: () => current });
      current += 25 * 60 * 60 * 1000;
      const ran = [];
      const result = await runServiceCycle({
        statePath, lockPath, now: () => current,
        runner: (job) => { ran.push(job.name); return { status: 0, stdout: 'ok', stderr: '' }; },
        notify: async () => ({ ok: true }), recordEvent: () => {},
      });
      assert.deepEqual(ran, ['doctor', 'discovery']);
      assert.match(result.state.jobs.sync_reports.disabledReason, /workflow cloud/);
      assert.match(result.state.jobs.scan.disabledReason, /workflow cloud/);
      assert.equal(result.state.jobs.sync_reports.consecutiveFailures, 0);
      assert.equal(result.state.jobs.scan.consecutiveFailures, 0);
    } finally {
      if (originalCloudPrimary === undefined) delete process.env.ZERO2ONE_CLOUD_PRIMARY; else process.env.ZERO2ONE_CLOUD_PRIMARY = originalCloudPrimary;
      if (originalUser === undefined) delete process.env.HACKERONE_USERNAME; else process.env.HACKERONE_USERNAME = originalUser;
      if (originalToken === undefined) delete process.env.HACKERONE_API_TOKEN; else process.env.HACKERONE_API_TOKEN = originalToken;
    }
  });
});

test('falha de job gera backoff, persiste erro e notifica; watchdog só avisa na mudança', async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, 'state.json');
    const lockPath = path.join(dir, 'service.lock');
    const watchdogPath = path.join(dir, 'watchdog.json');
    let now = Date.parse('2026-09-03T12:00:00Z');
    const originalUser = process.env.HACKERONE_USERNAME;
    const originalToken = process.env.HACKERONE_API_TOKEN;
    delete process.env.HACKERONE_USERNAME;
    delete process.env.HACKERONE_API_TOKEN;
    try {
      await runServiceCycle({ statePath, lockPath, now: () => now, notify: async () => ({ ok: true }), recordEvent: () => {} });
      now += 7 * 60 * 60 * 1000;
      const messages = [];
      const failed = await runServiceCycle({
        statePath, lockPath, now: () => now,
        runner: () => { throw new Error('falha sintética'); },
        notify: async (message) => { messages.push(message); return { ok: true }; },
        recordEvent: () => {},
      });
      assert.equal(failed.state.jobs.scan.consecutiveFailures, 1);
      assert.equal(failed.ok, false, 'falha de filho precisa chegar ao exit code do coordenador');
      assert.equal(failed.state.service.status, 'degraded');
      assert.match(failed.state.jobs.scan.lastOutput, /falha sintética/);
      assert.equal(messages.length, 1);

      failed.state.jobs.scan.consecutiveFailures = 2;
      saveRuntimeState(statePath, failed.state);
      const watchdogMessages = [];
      const notify = async (message) => { watchdogMessages.push(message); return { ok: true }; };
      assert.equal((await runWatchdog({ runtimeStatePath: statePath, watchdogStatePath: watchdogPath, now, notify })).ok, false);
      assert.equal((await runWatchdog({ runtimeStatePath: statePath, watchdogStatePath: watchdogPath, now, notify })).ok, false);
      assert.equal(watchdogMessages.length, 1, 'estado inalterado não deve repetir alerta');
    } finally {
      if (originalUser === undefined) delete process.env.HACKERONE_USERNAME; else process.env.HACKERONE_USERNAME = originalUser;
      if (originalToken === undefined) delete process.env.HACKERONE_API_TOKEN; else process.env.HACKERONE_API_TOKEN = originalToken;
    }
  });
});

test('novo ciclo recupera imediatamente job órfão de processo morto e aplica backoff', async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, 'state.json');
    const lockPath = path.join(dir, 'service.lock');
    let now = Date.parse('2026-09-03T12:00:00Z');
    await runServiceCycle({ statePath, lockPath, now: () => now, notify: async () => ({ ok: true }), recordEvent: () => {} });
    const state = loadRuntimeState(statePath);
    state.service.activeJob = 'scan';
    state.service.activeJobStartedAt = new Date(now).toISOString();
    state.jobs.scan.running = true;
    state.jobs.scan.lastStartedAt = new Date(now).toISOString();
    saveRuntimeState(statePath, state);
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, acquiredAt: new Date(now).toISOString() }), 'utf8');
    now += 60_000;
    const messages = [];
    const events = [];
    const result = await runServiceCycle({
      statePath, lockPath, now: () => now,
      runner: () => { throw new Error('job em backoff não deveria rodar'); },
      notify: async (message) => { messages.push(message); return { ok: true }; },
      recordEvent: (event) => events.push(event),
    });
    assert.equal(result.ok, true);
    assert.equal(result.state.service.status, 'degraded');
    assert.equal(result.state.jobs.scan.running, false);
    assert.equal(result.state.jobs.scan.consecutiveFailures, 1);
    assert.ok(result.state.jobs.scan.nextEligibleAt);
    assert.equal(messages.length, 1);
    assert.equal(events[0].recoveredOrphan, true);
  });
});
