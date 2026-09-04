import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync,
  statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const RUNTIME_SCHEMA_VERSION = 1;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Windows pode manter um handle de leitura por alguns milissegundos e
 * fazer rename(..., targetExistente) devolver EPERM/EACCES. Repetimos só
 * erros transitórios; nunca removemos o target antes, preservando a
 * propriedade de o leitor enxergar o JSON antigo ou o novo, não um gap. */
export function replaceFileAtomic(tempPath, targetPath, {
  rename = renameSync,
  wait = sleepSync,
  attempts = 20,
  retryDelayMs = 50,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rename(tempPath, targetPath);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === attempts) throw error;
      wait(retryDelayMs);
    }
  }
}

export function emptyRuntimeState(now = new Date().toISOString()) {
  return {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    service: { status: 'initializing', pid: null, startedAt: now, lastHeartbeatAt: now },
    jobs: {},
  };
}

export function loadRuntimeState(statePath, { now = new Date().toISOString() } = {}) {
  if (!existsSync(statePath)) return emptyRuntimeState(now);
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyRuntimeState(now);
    return {
      ...emptyRuntimeState(now),
      ...parsed,
      service: { ...emptyRuntimeState(now).service, ...(parsed.service || {}) },
      jobs: parsed.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {},
    };
  } catch {
    return emptyRuntimeState(now);
  }
}

/** Escrita atômica: o watchdog nunca observa meio JSON enquanto o serviço
 * atualiza o heartbeat. O arquivo temporário fica na mesma pasta para o
 * rename continuar atômico no mesmo volume. */
export function saveRuntimeState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  replaceFileAtomic(tempPath, statePath);
}

export function isJobDue(job = {}, intervalMs, now = Date.now()) {
  if (job.running) return false;
  const retryAt = new Date(job.nextEligibleAt || 0).getTime();
  if (Number.isFinite(retryAt) && retryAt > now) return false;
  const last = new Date(job.lastSuccessAt || 0).getTime();
  return !Number.isFinite(last) || now - last >= intervalMs;
}

export function backoffMs(consecutiveFailures, {
  baseMs = 5 * 60 * 1000,
  maxMs = 6 * 60 * 60 * 1000,
} = {}) {
  const failures = Math.max(1, Number(consecutiveFailures) || 1);
  return Math.min(maxMs, baseMs * (2 ** (failures - 1)));
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Lease local via criação exclusiva. Um lock só é removido se estiver velho
 * E o PID não existir mais; nunca mata outro processo. */
export function acquireLease(lockPath, {
  now = Date.now(),
  staleAfterMs = 4 * 60 * 60 * 1000,
  processAlive = defaultProcessAlive,
} = {}) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const attempt = () => {
    const fd = openSync(lockPath, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date(now).toISOString() }), 'utf8');
    closeSync(fd);
    let released = false;
    return {
      ok: true,
      release() {
        if (released) return;
        released = true;
        try { unlinkSync(lockPath); } catch { /* já liberado */ }
      },
    };
  };

  try {
    return attempt();
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  let existing = null;
  try { existing = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { /* lock inválido = candidato a stale */ }
  const declaredAt = new Date(existing?.acquiredAt).getTime();
  let lockTimestamp = declaredAt;
  if (!Number.isFinite(lockTimestamp)) {
    try { lockTimestamp = statSync(lockPath).mtimeMs; } catch { lockTimestamp = now; }
  }
  const stale = now - lockTimestamp > staleAfterMs;
  const validPid = Number.isInteger(existing?.pid) && existing.pid > 0;
  if ((validPid && processAlive(existing.pid)) || (!validPid && !stale)) {
    return { ok: false, reason: `serviço já está ativo (pid=${existing?.pid || 'desconhecido'})` };
  }
  try { unlinkSync(lockPath); } catch (err) {
    return { ok: false, reason: `lock stale não pôde ser removido: ${err.message}` };
  }
  try {
    const lease = attempt();
    return { ...lease, recoveredStaleLock: true };
  } catch (err) {
    return { ok: false, reason: `corrida ao recuperar lock: ${err.message}` };
  }
}

export function summarizeRuntimeHealth(state, {
  now = Date.now(),
  maxHeartbeatAgeMs = 20 * 60 * 1000,
  maxActiveJobAgeMs = 4 * 60 * 60 * 1000,
} = {}) {
  const reasons = [];
  const heartbeat = new Date(state?.service?.lastHeartbeatAt || 0).getTime();
  const activeStarted = new Date(state?.service?.activeJobStartedAt || 0).getTime();
  const activeWithinDeadline = !!state?.service?.activeJob
    && Number.isFinite(activeStarted)
    && now - activeStarted <= maxActiveJobAgeMs;
  if ((!Number.isFinite(heartbeat) || now - heartbeat > maxHeartbeatAgeMs) && !activeWithinDeadline) {
    reasons.push('heartbeat ausente ou atrasado');
  }
  if (state?.service?.activeJob && !activeWithinDeadline) reasons.push(`job ${state.service.activeJob} excedeu o limite operacional`);
  if (state?.service?.status === 'failed') reasons.push('último ciclo do serviço falhou');
  if (state?.service?.status === 'degraded') reasons.push('serviço está degradado');
  for (const [name, job] of Object.entries(state?.jobs || {})) {
    if ((job.consecutiveFailures || 0) > 0) {
      reasons.push(`${name} falhou ${job.consecutiveFailures} vezes consecutivas`);
    }
  }
  return { healthy: reasons.length === 0, reasons };
}
