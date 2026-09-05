import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, sendTelegramMessage } from './telegram.mjs';
import { appendRuntimeEvent } from './runtime-event-log.mjs';
import {
  acquireLease, backoffMs, isJobDue, loadRuntimeState, saveRuntimeState,
} from './runtime-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const DEFAULT_RUNTIME_STATE_PATH = path.join(REPO_ROOT, 'logs', 'bugbounty-runtime-state.json');
export const DEFAULT_LOCK_PATH = path.join(REPO_ROOT, 'logs', 'bugbounty-service.lock');
export const DEFAULT_RUNTIME_EVENTS_PATH = path.join(REPO_ROOT, 'logs', 'bugbounty-runtime-events.jsonl');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const isCloudPrimary = () => process.env.ZERO2ONE_CLOUD_PRIMARY === '1';

export const SERVICE_JOBS = [
  {
    name: 'sync_reports', kind: 'light', intervalMs: 60 * MINUTE,
    timeoutMs: 5 * MINUTE,
    args: [path.join(__dirname, 'sync-reports-runner.mjs')],
    enabled: () => !isCloudPrimary() && !!(process.env.HACKERONE_USERNAME && process.env.HACKERONE_API_TOKEN),
    disabledReason: () => isCloudPrimary()
      ? 'delegado ao workflow cloud horário para evitar dois writers concorrentes'
      : 'credenciais HackerOne não configuradas neste processo',
  },
  {
    name: 'doctor', kind: 'light', intervalMs: 24 * HOUR,
    timeoutMs: 2 * MINUTE,
    args: [path.join(__dirname, 'readiness-audit.mjs')],
    enabled: () => true,
  },
  {
    name: 'cloud_health', kind: 'light', intervalMs: 30 * MINUTE,
    timeoutMs: 2 * MINUTE,
    args: [path.join(__dirname, 'cloud-workflow-health.mjs')],
    enabled: () => true,
  },
  {
    name: 'scan', kind: 'heavy', intervalMs: 6 * HOUR,
    timeoutMs: 2 * HOUR,
    args: [path.join(__dirname, 'scan-runner.mjs')],
    enabled: () => !isCloudPrimary(),
    disabledReason: () => 'delegado ao workflow cloud de 6 horas para evitar dois writers concorrentes',
  },
  {
    name: 'discovery', kind: 'heavy', intervalMs: 24 * HOUR,
    timeoutMs: 3 * HOUR,
    args: [path.join(__dirname, 'discovery-runner.mjs')],
    enabled: () => true,
  },
];

function defaultRunner(job) {
  return spawnSync(process.execPath, job.args, {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: 'utf8',
    timeout: job.timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

function outputTail(result) {
  const combined = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim();
  return combined.slice(-4000);
}

function primeState(state, nowIso) {
  for (const job of SERVICE_JOBS) {
    state.jobs[job.name] = {
      ...(state.jobs[job.name] || {}),
      running: false,
      lastSuccessAt: state.jobs[job.name]?.lastSuccessAt || null,
      scheduleAnchorAt: state.jobs[job.name]?.scheduleAnchorAt || nowIso,
      consecutiveFailures: state.jobs[job.name]?.consecutiveFailures || 0,
    };
  }
  state.service = { status: 'healthy', pid: process.pid, startedAt: nowIso, lastHeartbeatAt: nowIso };
  return state;
}

async function runJob(job, state, { now, statePath, runner, notify, recordEvent }) {
  const startedAt = new Date(now()).toISOString();
  const previousFailures = state.jobs[job.name]?.consecutiveFailures || 0;
  state.jobs[job.name] = {
    ...(state.jobs[job.name] || {}), running: true, lastStartedAt: startedAt,
  };
  state.service.activeJob = job.name;
  state.service.activeJobStartedAt = startedAt;
  state.service.lastHeartbeatAt = startedAt;
  saveRuntimeState(statePath, state);

  let result;
  try {
    result = runner(job);
  } catch (error) {
    result = { status: null, stdout: '', stderr: '', error };
  }
  const finishedMs = now();
  const finishedAt = new Date(finishedMs).toISOString();
  const succeeded = result.status === 0 && !result.error;
  const lastOutput = outputTail(result);
  if (succeeded) {
    state.jobs[job.name] = {
      ...state.jobs[job.name], running: false, lastFinishedAt: finishedAt,
      lastSuccessAt: finishedAt, lastExitCode: 0, consecutiveFailures: 0,
      nextEligibleAt: null, lastOutput,
    };
    if (previousFailures > 0) {
      try {
        await notify(`✅ <b>ZeroToOne recuperado</b>\nJob <code>${escapeHtml(job.name)}</code> voltou a executar com sucesso após ${previousFailures} falha(s).`);
      } catch { /* notificação nunca invalida o resultado do job */ }
    }
  } else {
    const failures = previousFailures + 1;
    state.jobs[job.name] = {
      ...state.jobs[job.name], running: false, lastFinishedAt: finishedAt,
      lastFailureAt: finishedAt, lastExitCode: result.status ?? null,
      consecutiveFailures: failures,
      nextEligibleAt: new Date(finishedMs + backoffMs(failures)).toISOString(),
      lastOutput,
    };
    try {
      await notify([
        '❌ <b>ZeroToOne — falha operacional</b>',
        `Job: <code>${escapeHtml(job.name)}</code>`,
        `Falhas consecutivas: ${failures}`,
        lastOutput ? `<pre>${escapeHtml(lastOutput.slice(-1200))}</pre>` : 'Sem saída capturada.',
      ].join('\n'));
    } catch { /* notificação nunca invalida a persistência/backoff */ }
  }
  state.service.lastHeartbeatAt = finishedAt;
  state.service.activeJob = null;
  state.service.activeJobStartedAt = null;
  saveRuntimeState(statePath, state);
  recordEvent({
    type: 'bugbounty_runtime_job', schemaVersion: 1, job: job.name,
    status: succeeded ? 'success' : 'failure', exitCode: result.status ?? null,
    startedAt, finishedAt, consecutiveFailures: state.jobs[job.name].consecutiveFailures,
  });
  return succeeded;
}

/** Um ciclo curto. O Task Scheduler chama novamente a cada 5 minutos.
 * Roda todos os jobs leves vencidos e no máximo um job pesado por ciclo. */
export async function runServiceCycle({
  statePath = DEFAULT_RUNTIME_STATE_PATH,
  lockPath = DEFAULT_LOCK_PATH,
  initializeOnly = false,
  now = () => Date.now(),
  runner = defaultRunner,
  notify = sendTelegramMessage,
  recordEvent = (event) => appendRuntimeEvent(DEFAULT_RUNTIME_EVENTS_PATH, event),
} = {}) {
  const lease = acquireLease(lockPath, { now: now() });
  if (!lease.ok) return { ok: false, skipped: true, reason: lease.reason };
  try {
    const nowMs = now();
    const nowIso = new Date(nowMs).toISOString();
    const firstRun = !existsSync(statePath);
    const state = loadRuntimeState(statePath, { now: nowIso });
    if (initializeOnly || firstRun) {
      primeState(state, nowIso);
      saveRuntimeState(statePath, state);
      return { ok: true, initialized: true, state };
    }

    let recoveredOrphan = false;
    if (lease.recoveredStaleLock && state.service.activeJob) {
      const orphanName = state.service.activeJob;
      const failures = (state.jobs[orphanName]?.consecutiveFailures || 0) + 1;
      state.jobs[orphanName] = {
        ...(state.jobs[orphanName] || {}), running: false,
        lastFinishedAt: nowIso, lastFailureAt: nowIso, lastExitCode: null,
        consecutiveFailures: failures,
        nextEligibleAt: new Date(nowMs + backoffMs(failures)).toISOString(),
        lastOutput: 'processo anterior terminou sem liberar o lease; job recuperado como falha',
      };
      state.service.activeJob = null;
      state.service.activeJobStartedAt = null;
      state.service.lastError = `job órfão recuperado: ${orphanName}`;
      saveRuntimeState(statePath, state);
      try {
        await notify(`❌ <b>ZeroToOne — job órfão recuperado</b>\n<code>${escapeHtml(orphanName)}</code> terminou sem liberar o lease; backoff aplicado.`);
      } catch { /* persistência não depende da notificação */ }
      recordEvent({
        type: 'bugbounty_runtime_job', schemaVersion: 1, job: orphanName,
        status: 'failure', exitCode: null, startedAt: state.jobs[orphanName].lastStartedAt || null,
        finishedAt: nowIso, consecutiveFailures: failures, recoveredOrphan: true,
      });
      recoveredOrphan = true;
    }

    state.service = {
      ...state.service, status: 'running', pid: process.pid,
      lastHeartbeatAt: nowIso,
    };
    saveRuntimeState(statePath, state);

    const ran = [];
    let heavyRan = false;
    for (const job of SERVICE_JOBS) {
      if (!job.enabled()) {
        state.jobs[job.name] = {
          ...(state.jobs[job.name] || {}), running: false,
          disabledReason: typeof job.disabledReason === 'function' ? job.disabledReason() : job.disabledReason,
          lastCheckedAt: new Date(now()).toISOString(), consecutiveFailures: 0,
          nextEligibleAt: null,
        };
        continue;
      }
      if (!isJobDue(state.jobs[job.name], job.intervalMs, now())) continue;
      if (job.kind === 'heavy' && heavyRan) continue;
      const succeeded = await runJob(job, state, { now, statePath, runner, notify, recordEvent });
      ran.push({ job: job.name, succeeded });
      if (job.kind === 'heavy') heavyRan = true;
    }
    const failedThisCycle = ran.some((item) => !item.succeeded);
    const outstandingFailure = Object.values(state.jobs).some((job) => (job?.consecutiveFailures || 0) > 0);
    state.service.status = recoveredOrphan || failedThisCycle || outstandingFailure ? 'degraded' : 'healthy';
    if (state.service.status === 'healthy') state.service.lastError = null;
    state.service.lastHeartbeatAt = new Date(now()).toISOString();
    state.service.lastCycleAt = state.service.lastHeartbeatAt;
    saveRuntimeState(statePath, state);
    return {
      ok: !failedThisCycle,
      ran,
      state,
      reason: failedThisCycle ? 'um ou mais jobs falharam; veja state.jobs' : recoveredOrphan ? 'job órfão recuperado' : null,
    };
  } catch (err) {
    const state = loadRuntimeState(statePath);
    state.service = {
      ...state.service, status: 'failed', pid: process.pid,
      lastHeartbeatAt: new Date(now()).toISOString(), lastError: err.message,
    };
    saveRuntimeState(statePath, state);
    try {
      await notify(`❌ <b>ZeroToOne — serviço falhou</b>\n<pre>${escapeHtml(err.message.slice(0, 1500))}</pre>`);
    } catch { /* a falha original continua sendo o resultado */ }
    return { ok: false, reason: err.message };
  } finally {
    lease.release();
  }
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runServiceCycle({ initializeOnly: process.argv.includes('--initialize') }).then((result) => {
    console.log(JSON.stringify({
      ok: result.ok,
      initialized: result.initialized || false,
      skipped: result.skipped || false,
      reason: result.reason || null,
      ran: result.ran || [],
      heartbeatAt: result.state?.service?.lastHeartbeatAt || null,
    }));
    if (!result.ok && !result.skipped) process.exitCode = 1;
  });
}
