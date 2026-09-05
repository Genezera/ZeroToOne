import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb, stateCounts, listFindings, listSubmissions } from './db.mjs';
import { computeStatsFromSubmissions, enrichSubmissionsWithFindings } from './outcome-intelligence.mjs';
import { runReadinessAudit } from './readiness-audit.mjs';
import { checkCloudWorkflowHealth } from './cloud-workflow-health.mjs';
import { loadRuntimeState, summarizeRuntimeHealth } from './runtime-state.mjs';
import { DEFAULT_RUNTIME_STATE_PATH } from './service-runner.mjs';
import { migrateAll } from './migrate-to-v2.mjs';
import { loadOperationProfile } from './operation-profile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_PATH = path.join(REPO_ROOT, 'research', 'bugbounty', 'zerotoone.db');

export function buildMissionControlSnapshot({ readiness, cloud, runtimeHealth, counts = {}, outcomeStats = {}, profile = loadOperationProfile() }) {
  const attention = [];
  for (const item of readiness.checks || []) {
    if (!item.ok && item.severity !== 'limitation') attention.push(`audit:${item.name}: ${item.detail}`);
  }
  for (const item of cloud.checks || []) {
    if (!item.ok) attention.push(`cloud:${item.label}: ${item.reasons.join('; ')}`);
  }
  if (profile.local.requiredForOperation) {
    for (const reason of runtimeHealth.reasons || []) attention.push(`local:${reason}`);
  }
  const operational = readiness.fullyOperational === true && cloud.ok === true
    && (!profile.local.requiredForOperation || runtimeHealth.healthy === true);
  return {
    operational,
    checkedAt: new Date().toISOString(),
    components: {
      repositoryAndPolicy: readiness.fullyOperational === true,
      cloudWorkflows: cloud.ok === true,
      localService: profile.local.requiredForOperation ? runtimeHealth.healthy === true : true,
      localServiceRequired: profile.local.requiredForOperation,
      localServiceObservedHealthy: runtimeHealth.healthy === true,
    },
    pipeline: {
      stateCounts: counts,
      activeInvestigations: ['corroborated_static', 'reproduced_local', 'scope_verified', 'human_ready']
        .reduce((sum, state) => sum + Number(counts[state] || 0), 0),
      readyForHumanReview: Number(counts.human_ready || 0),
    },
    outcomes: {
      submissions: Number(outcomeStats.totalSubmissions || 0),
      duplicates: Number(outcomeStats.duplicateSubmissions || 0),
      duplicateRate: outcomeStats.duplicateRate ?? null,
    },
    attention,
    limitation: 'reports privados permanecem invisíveis; risco zero de duplicate não pode ser garantido',
    readiness,
    cloud,
    runtime: runtimeHealth,
    operationProfile: profile,
  };
}

export async function runMissionControl({
  dbPath = DEFAULT_DB_PATH,
  runtimeStatePath = DEFAULT_RUNTIME_STATE_PATH,
  readiness = null,
  cloudPromise = null,
  profile = loadOperationProfile(),
  hydrate = migrateAll,
} = {}) {
  hydrate({
    queuePath: path.join(REPO_ROOT, 'research', 'bugbounty', 'queue.jsonl'),
    dbPath, writeLog: false, emitLedger: false,
  });
  readiness ||= runReadinessAudit({ profile });
  cloudPromise ||= checkCloudWorkflowHealth();
  const cloud = await cloudPromise;
  const runtimeHealth = summarizeRuntimeHealth(loadRuntimeState(runtimeStatePath));
  let counts = {};
  let outcomeStats = {};
  if (existsSync(dbPath)) {
    const db = openDb(dbPath);
    try {
      counts = stateCounts(db);
      const submissions = enrichSubmissionsWithFindings(listSubmissions(db), listFindings(db));
      outcomeStats = computeStatsFromSubmissions(submissions);
    } finally { closeDb(db); }
  }
  return buildMissionControlSnapshot({ readiness, cloud, runtimeHealth, counts, outcomeStats, profile });
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  runMissionControl().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.operational) process.exitCode = 1;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
