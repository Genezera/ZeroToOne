import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb, listFindings } from './db.mjs';
import { getReviewValidityReason, loadProgramPolicyStrict } from './program-policy.mjs';
import { runToolchainDoctor } from './toolchain-doctor.mjs';
import { verifyChain } from '../ledger/ledger.mjs';
import { TARGETS } from './targets.mjs';
import { JS_TARGETS } from './targets-js.mjs';
import { GO_TARGETS } from './targets-go.mjs';
import { JVM_TARGETS } from './targets-jvm.mjs';
import { SWIFT_TARGETS } from './targets-swift.mjs';
import { SOLIDITY_TARGETS } from './targets-solidity.mjs';
import { loadOperationProfile } from './operation-profile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TARGET_PROGRAMS = [...new Set(
  [...TARGETS, ...JS_TARGETS, ...GO_TARGETS, ...JVM_TARGETS, ...SWIFT_TARGETS, ...SOLIDITY_TARGETS]
    .map((target) => target.program).filter(Boolean),
)];

export function auditQueueText(text) {
  const ids = new Set();
  const duplicates = new Set();
  const invalidLines = [];
  const rows = [];
  for (const [index, raw] of String(text || '').split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    let row;
    try { row = JSON.parse(raw); } catch (error) {
      invalidLines.push({ line: index + 1, reason: error.message });
      continue;
    }
    if (!row.id || typeof row.id !== 'string') {
      invalidLines.push({ line: index + 1, reason: 'id ausente ou inválido' });
      continue;
    }
    if (ids.has(row.id)) duplicates.add(row.id);
    ids.add(row.id);
    rows.push(row);
  }
  return { rows, uniqueIds: ids.size, duplicateIds: [...duplicates], invalidLines };
}

function check(name, ok, severity, detail) {
  return { name, ok: !!ok, severity, detail };
}

export function workflowContract(filePath) {
  if (!existsSync(filePath)) return { ok: false, detail: 'workflow ausente' };
  const text = readFileSync(filePath, 'utf8');
  const actionRefs = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+).*$/gm)].map((match) => match[1]);
  const unpinnedActions = actionRefs.filter((ref) => !/@[0-9a-f]{40}$/i.test(ref));
  const requirements = [
    ['schedule', /\bschedule\s*:/],
    ['manual dispatch', /\bworkflow_dispatch\s*:/],
    ['write permission explícita', /contents:\s*write/],
    ['concurrency global', /group:\s*zerotoone-bugbounty-writer/],
    ['não cancela writer concorrente', /cancel-in-progress:\s*false/],
    ['ao menos uma action declarada', actionRefs.length > 0],
    ['todas as actions pinadas por SHA', unpinnedActions.length === 0],
  ];
  const missing = requirements.filter(([, requirement]) => (
    requirement instanceof RegExp ? !requirement.test(text) : !requirement
  )).map(([label]) => label);
  if (unpinnedActions.length > 0) missing.push(`refs móveis: ${unpinnedActions.join(', ')}`);
  return { ok: missing.length === 0, detail: missing.length ? `faltando: ${missing.join(', ')}` : 'contrato de concorrência/permissão/pinning presente' };
}

/** Auditoria local, somente leitura. `critical` bloqueia a alegação de que o
 * sistema está pronto; `warning` registra falha operacional não bloqueante;
 * `limitation` explicita o que nenhuma automação consegue controlar. */
export function runReadinessAudit({
  repoRoot = DEFAULT_REPO_ROOT,
  doctor = runToolchainDoctor,
  verifyLedger = verifyChain,
  git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }),
  targetPrograms = DEFAULT_TARGET_PROGRAMS,
  now = Date.now(),
  profile = loadOperationProfile(),
} = {}) {
  const checks = [];
  const queuePath = path.join(repoRoot, 'research', 'bugbounty', 'queue.jsonl');
  const dbPath = path.join(repoRoot, 'research', 'bugbounty', 'zerotoone.db');
  const policyPath = path.join(repoRoot, 'research', 'bugbounty', 'program-policy.json');

  const queue = existsSync(queuePath) ? auditQueueText(readFileSync(queuePath, 'utf8')) : null;
  checks.push(check('queue_parse', !!queue && queue.invalidLines.length === 0, 'critical', queue ? `${queue.invalidLines.length} linha(s) inválida(s)` : 'queue.jsonl ausente'));
  checks.push(check('queue_unique_ids', !!queue && queue.duplicateIds.length === 0, 'critical', queue ? `${queue.duplicateIds.length} id(s) duplicado(s)` : 'queue.jsonl ausente'));

  let dbCount = null;
  if (!existsSync(dbPath)) {
    checks.push(check('database_readable', false, 'critical', 'zerotoone.db ausente; execute migrate-to-v2.mjs --hydrate'));
  } else {
    try {
      const db = openDb(dbPath);
      try { dbCount = listFindings(db).length; } finally { closeDb(db); }
      checks.push(check('database_readable', true, 'critical', `${dbCount} finding(s)`));
    } catch (error) {
      checks.push(check('database_readable', false, 'critical', error.message));
    }
  }
  checks.push(check('queue_database_cardinality', dbCount !== null && queue && dbCount === queue.uniqueIds, 'critical', `queue=${queue?.uniqueIds ?? 'ausente'}, db=${dbCount ?? 'ilegível'}`));

  let policy = null;
  try {
    policy = loadProgramPolicyStrict(policyPath);
    checks.push(check('program_policy', true, 'critical', `${Object.keys(policy).length} programa(s) com política explícita`));
  } catch (error) {
    checks.push(check('program_policy', false, 'critical', error.message));
  }
  const unregisteredPrograms = policy
    ? [...new Set(targetPrograms)].filter((program) => !Object.hasOwn(policy, program))
    : [...new Set(targetPrograms)];
  checks.push(check(
    'target_policy_coverage', unregisteredPrograms.length === 0, 'critical',
    unregisteredPrograms.length > 0
      ? `sem decisão de RoE: ${unregisteredPrograms.join(', ')}`
      : `${new Set(targetPrograms).size} programa(s) ativo(s) coberto(s) pelo registro`,
  ));
  const expiredReviews = policy
    ? Object.entries(policy)
      .map(([program, entry]) => ({ program, reason: getReviewValidityReason(entry, { now }) }))
      .filter((item) => item.reason)
    : [];
  checks.push(check(
    'program_policy_review_freshness', !!policy && expiredReviews.length === 0, 'critical',
    expiredReviews.length > 0
      ? expiredReviews.map((item) => `${item.program}: ${item.reason}`).join('; ')
      : 'todas as liberações de pesquisa têm revisão de RoE vigente',
  ));

  try {
    const ledger = verifyLedger('research');
    checks.push(check('research_ledger', ledger.valid === true, 'critical', ledger.valid ? `${ledger.entries} evento(s), cadeia válida` : ledger.reason));
  } catch (error) {
    checks.push(check('research_ledger', false, 'critical', error.message));
  }

  try {
    const toolchain = doctor(profile.local.requiredForOperation
      ? {}
      : { requiredTools: ['node', 'git'], requiredIntegrations: [] });
    checks.push(check('toolchain_and_integrations', toolchain.ok, 'critical', toolchain.ok
      ? profile.local.requiredForOperation
        ? `${Object.keys(toolchain.tools || {}).length} ferramenta(s), integrações configuradas`
        : `núcleo cloud/manual disponível; runtime local não é obrigatório (${(toolchain.unavailableTools || []).join(', ') || 'todas as ferramentas locais disponíveis'})`
      : `faltando: ${[...(toolchain.failedTools || []), ...(toolchain.missingIntegrations || [])].join(', ')}`));
  } catch (error) {
    checks.push(check('toolchain_and_integrations', false, 'critical', error.message));
  }

  for (const workflow of ['bugbounty-scan.yml', 'bugbounty-report-sync.yml', 'bugbounty-change-monitor.yml', 'bugbounty-target-discovery.yml']) {
    try {
      const contract = workflowContract(path.join(repoRoot, '.github', 'workflows', workflow));
      checks.push(check(`workflow_${workflow}`, contract.ok, 'critical', contract.detail));
    } catch (error) {
      checks.push(check(`workflow_${workflow}`, false, 'critical', error.message));
    }
  }

  try {
    const dirty = git(['status', '--porcelain']).trim();
    checks.push(check('git_worktree_clean', !dirty, 'warning', dirty ? 'há mudanças locais ainda não publicadas' : 'worktree limpo'));
  } catch (error) {
    checks.push(check('git_status', false, 'warning', error.message));
  }

  checks.push(check(
    'private_report_visibility', false, 'limitation',
    'limitação externa inevitável: reports privados permanecem invisíveis; nenhum sistema pode garantir zero duplicates',
  ));
  const criticalFailures = checks.filter((item) => item.severity === 'critical' && !item.ok);
  const warnings = checks.filter((item) => item.severity === 'warning' && !item.ok);
  const limitations = checks.filter((item) => item.severity === 'limitation');
  return {
    ok: criticalFailures.length === 0,
    fullyOperational: criticalFailures.length === 0 && warnings.length === 0,
    checkedAt: new Date().toISOString(),
    summary: { checks: checks.length, criticalFailures: criticalFailures.length, warnings: warnings.length, limitations: limitations.length },
    checks,
    operationProfile: profile,
  };
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const result = runReadinessAudit();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
