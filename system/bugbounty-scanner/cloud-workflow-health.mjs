import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubHeaders } from './github-auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOUR = 60 * 60 * 1000;

export const WORKFLOW_EXPECTATIONS = [
  { file: 'bugbounty-change-monitor.yml', label: 'change_monitor', maxSuccessAgeMs: 1 * HOUR },
  { file: 'bugbounty-report-sync.yml', label: 'report_sync', maxSuccessAgeMs: 4 * HOUR },
  { file: 'bugbounty-scan.yml', label: 'safety_scan', maxSuccessAgeMs: 18 * HOUR },
  { file: 'bugbounty-target-discovery.yml', label: 'target_discovery', maxSuccessAgeMs: 48 * HOUR },
  { file: 'bugbounty-evidence.yml', label: 'evidence_worker', maxSuccessAgeMs: 4 * HOUR },
  { file: 'bugbounty-metrics.yml', label: 'operations_metrics', maxSuccessAgeMs: 2 * HOUR },
  { file: 'bugbounty-health.yml', label: 'health_monitor', maxSuccessAgeMs: 3 * HOUR },
];

export function workflowExpectations({ operationalOnly = false } = {}) {
  // The supervisor cannot require its own current run to have succeeded.
  // Mission Control and manual invocations still check the supervisor too.
  return operationalOnly ? WORKFLOW_EXPECTATIONS.filter((item) => item.label !== 'health_monitor') : WORKFLOW_EXPECTATIONS;
}

export function parseGitHubRepository(value) {
  const text = String(value || '').trim();
  const envMatch = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (envMatch) return `${envMatch[1]}/${envMatch[2]}`;
  const remoteMatch = text.match(/github\.com(?::|\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i);
  return remoteMatch ? `${remoteMatch[1]}/${remoteMatch[2]}` : null;
}

export function resolveGitHubRepository({ env = process.env, repoRoot = REPO_ROOT, git = execFileSync } = {}) {
  const fromEnv = parseGitHubRepository(env.GITHUB_REPOSITORY);
  if (fromEnv) return fromEnv;
  try {
    const remote = git('git', ['config', '--get', 'remote.origin.url'], {
      cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true,
    });
    const parsed = parseGitHubRepository(remote);
    if (parsed) return parsed;
  } catch { /* erro detalhado abaixo */ }
  throw new Error('não foi possível resolver owner/repo por GITHUB_REPOSITORY nem remote.origin.url');
}

function runTime(run) {
  const value = Date.parse(run?.updated_at || run?.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

/** Interpreta o histórico real, não só a presença do YAML. Uma execução em
 * andamento é saudável somente quando o último terminal foi sucesso e ainda
 * está fresco; falha terminal ou silêncio além da tolerância falham fechado. */
export function assessWorkflowRuns(expectation, runs = [], { now = Date.now(), workflowState = null } = {}) {
  const ordered = [...runs].sort((a, b) => runTime(b) - runTime(a));
  const active = ordered.find((run) => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status)) || null;
  const latestTerminal = ordered.find((run) => run.status === 'completed') || null;
  const latestSuccess = ordered.find((run) => run.status === 'completed' && run.conclusion === 'success') || null;
  const reasons = [];
  if (workflowState !== 'active') reasons.push(`workflow está ${workflowState || 'sem estado'}, não active`);
  if (!latestTerminal) reasons.push('nenhuma execução terminal observada');
  else if (latestTerminal.conclusion !== 'success') reasons.push(`última execução terminou como ${latestTerminal.conclusion || 'sem conclusão'}`);
  if (!latestSuccess) reasons.push('nenhum sucesso observado');
  else if (now - runTime(latestSuccess) > expectation.maxSuccessAgeMs) {
    reasons.push(`último sucesso excedeu ${Math.round(expectation.maxSuccessAgeMs / HOUR)}h`);
  }
  if (active && now - runTime(active) > expectation.maxSuccessAgeMs) reasons.push('execução ativa excedeu a janela operacional');
  return {
    file: expectation.file,
    label: expectation.label,
    workflowState: workflowState || null,
    ok: reasons.length === 0,
    status: reasons.length === 0 ? (active ? 'running' : 'healthy') : 'unhealthy',
    reasons,
    latestRun: ordered[0] ? normalizeRun(ordered[0]) : null,
    latestSuccess: latestSuccess ? normalizeRun(latestSuccess) : null,
  };
}

function normalizeRun(run) {
  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion || null,
    event: run.event || null,
    headSha: run.head_sha || null,
    createdAt: run.created_at || null,
    updatedAt: run.updated_at || null,
    url: run.html_url || null,
  };
}

export async function checkCloudWorkflowHealth({
  repository = resolveGitHubRepository(),
  expectations = WORKFLOW_EXPECTATIONS,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  const checks = await Promise.all(expectations.map(async (expectation) => {
    const workflowUrl = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(expectation.file)}`;
    const runsUrl = `${workflowUrl}/runs?per_page=10`;
    try {
      const request = {
        headers: githubHeaders({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }),
        signal: AbortSignal.timeout(15000),
      };
      const [workflowResponse, runsResponse] = await Promise.all([
        fetchImpl(workflowUrl, request),
        fetchImpl(runsUrl, request),
      ]);
      if (!workflowResponse.ok) throw new Error(`GitHub workflow metadata ${workflowResponse.status}`);
      if (!runsResponse.ok) throw new Error(`GitHub workflow runs ${runsResponse.status}`);
      const [workflow, runsBody] = await Promise.all([workflowResponse.json(), runsResponse.json()]);
      if (!Array.isArray(runsBody?.workflow_runs)) throw new Error('GitHub workflow runs sem lista válida');
      return assessWorkflowRuns(expectation, runsBody.workflow_runs || [], { now, workflowState: workflow.state });
    } catch (error) {
      return {
        file: expectation.file, label: expectation.label, ok: false,
        workflowState: null, status: 'unreachable', reasons: [error.message], latestRun: null, latestSuccess: null,
      };
    }
  }));
  return {
    ok: checks.every((item) => item.ok),
    checkedAt: new Date(now).toISOString(),
    repository,
    checks,
  };
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  checkCloudWorkflowHealth({ expectations: workflowExpectations({ operationalOnly: process.argv.includes('--operational-only') }) }).then((result) => {
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
