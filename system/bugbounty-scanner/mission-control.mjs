import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb, stateCounts, listFindings, listSubmissions, latestImpactAssessment, latestDuplicateCheck, latestReport, latestDeploymentEvidence, latestCodeAgeEvidence, listValidations } from './db.mjs';
import { computeStatsFromSubmissions, enrichSubmissionsWithFindings } from './outcome-intelligence.mjs';
import { runReadinessAudit } from './readiness-audit.mjs';
import { checkCloudWorkflowHealth } from './cloud-workflow-health.mjs';
import { loadRuntimeState, summarizeRuntimeHealth } from './runtime-state.mjs';
import { DEFAULT_RUNTIME_STATE_PATH } from './service-runner.mjs';
import { migrateAll } from './migrate-to-v2.mjs';
import { loadOperationProfile } from './operation-profile.mjs';
import { buildResearchPlan } from './research-plan.mjs';
import { loadProgramPolicyStrict } from './program-policy.mjs';
import { assetRefForFinding, loadSnapshot, scopeGate } from './scope-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_PATH = path.join(REPO_ROOT, 'research', 'bugbounty', 'zerotoone.db');

export function buildMissionControlSnapshot({ readiness, cloud, runtimeHealth, counts = {}, outcomeStats = {}, researchPlan = null, operationsMetrics = null, profile = loadOperationProfile() }) {
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
  for (const alert of operationsMetrics?.activeAlerts || []) attention.push(`metrics:${alert}`);
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
      storedHumanReady: Number(counts.human_ready || 0),
      readyForHumanReview: researchPlan
        ? researchPlan.actionable.filter((item) => item.action === 'human_review').length
        : Number(counts.human_ready || 0),
      researchWork: researchPlan?.summary || null,
      operationsMetrics,
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
  let researchPlan = null;
  let operationsMetrics = null;
  const metricsPath = path.join(REPO_ROOT, 'research', 'bugbounty', 'operations-metrics.json');
  if (existsSync(metricsPath)) {
    try { operationsMetrics = JSON.parse(readFileSync(metricsPath, 'utf8')); }
    catch { operationsMetrics = { activeAlerts: ['metrics_file_invalid'] }; }
  }
  if (existsSync(dbPath)) {
    const db = openDb(dbPath);
    try {
      counts = stateCounts(db);
      const findings = listFindings(db);
      const submissions = enrichSubmissionsWithFindings(listSubmissions(db), findings);
      outcomeStats = computeStatsFromSubmissions(submissions);
      let programPolicy = {};
      try { programPolicy = loadProgramPolicyStrict(); } catch { /* audit already reports invalid policy; all research stays held */ }
      researchPlan = buildResearchPlan(findings, {
        programPolicy, submissions,
        scopeFor: (finding, now) => scopeGate(loadSnapshot(finding.program), assetRefForFinding(finding), now),
        contextFor: (finding) => ({
          impactAssessment: latestImpactAssessment(db, finding.id), duplicateCheck: latestDuplicateCheck(db, finding.id),
          report: latestReport(db, finding.id), deploymentEvidence: latestDeploymentEvidence(db, finding.id),
          validations: listValidations(db, finding.id), codeAgeEvidence: latestCodeAgeEvidence(db, finding.id),
        }),
      });
    } finally { closeDb(db); }
  }
  return buildMissionControlSnapshot({ readiness, cloud, runtimeHealth, counts, outcomeStats, researchPlan, operationsMetrics, profile });
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
