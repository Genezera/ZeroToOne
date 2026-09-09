import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeDb, exportFindingsToQueueJsonl, getFinding, latestCodeAgeEvidence,
  listFindings, listValidations, openDb, recordCodeAgeEvidence,
  recordImpactAssessment, recordValidation,
} from './db.mjs';
import { cmdRefreshScopeLive, cmdResearchPlan, cmdSearchPriorArt } from './cli.mjs';
import { pullLatest, commitAndPush } from './git-sync.mjs';
import { getBlockReason, loadProgramPolicyStrict } from './program-policy.mjs';
import { migrateAll } from './migrate-to-v2.mjs';
import { MAX_VERIFIED_REGRESSION_AGE_MS } from './novelty-risk.mjs';
import { repositoryFromFinding } from './outcome-intelligence.mjs';
import { verifyRegression } from './regression-sandbox.mjs';
import { acquireLease, replaceFileAtomic } from './runtime-state.mjs';
import { assetRefForFinding, loadSnapshot, scopeGate } from './scope-registry.mjs';
import { validationConclusion } from './validation-semantics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const DB_PATH = path.join(BUGBOUNTY_DIR, 'zerotoone.db');
const QUEUE_PATH = path.join(BUGBOUNTY_DIR, 'queue.jsonl');
export const DEFAULT_EVIDENCE_STATE_PATH = path.join(BUGBOUNTY_DIR, 'evidence-worker-state.json');
export const DEFAULT_EVIDENCE_RECIPES_PATH = path.join(BUGBOUNTY_DIR, 'evidence-recipes.json');
export const DEFAULT_EVIDENCE_LOCK_PATH = path.join(REPO_ROOT, 'logs', 'bugbounty-evidence-worker.lock');
export const EVIDENCE_STATE_SCHEMA_VERSION = 1;

const DAY_MS = 86400000;
const MAX_RUN_HISTORY = 50;
const TRUSTED_PATH_TOUCH_METHODS = new Set([
  'git_log_follow_latest_path_commit',
  'github_file_last_commit',
]);

function isTrustedPathTouchEvidence(evidence) {
  return Boolean(evidence && TRUSTED_PATH_TOUCH_METHODS.has(evidence.method)
    && Number.isInteger(evidence.codeAgeDays) && evidence.codeAgeDays >= 0);
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedProgram(value) {
  return String(value || '').trim().toLowerCase();
}

export function emptyEvidenceState() {
  return { schemaVersion: EVIDENCE_STATE_SCHEMA_VERSION, workOrders: {}, runs: [] };
}

export function loadEvidenceState(statePath = DEFAULT_EVIDENCE_STATE_PATH) {
  if (!existsSync(statePath)) return emptyEvidenceState();
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyEvidenceState();
    return {
      schemaVersion: EVIDENCE_STATE_SCHEMA_VERSION,
      workOrders: parsed.workOrders && typeof parsed.workOrders === 'object' ? parsed.workOrders : {},
      runs: Array.isArray(parsed.runs) ? parsed.runs.slice(-MAX_RUN_HISTORY) : [],
    };
  } catch {
    return emptyEvidenceState();
  }
}

export function saveEvidenceState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  replaceFileAtomic(tempPath, statePath);
}

export function loadEvidenceRecipes(recipesPath = DEFAULT_EVIDENCE_RECIPES_PATH) {
  if (!existsSync(recipesPath)) return { schemaVersion: 1, programHandles: {}, findings: {} };
  const parsed = JSON.parse(readFileSync(recipesPath, 'utf8'));
  if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.findings !== 'object') {
    throw new Error('evidence-recipes.json inválido: schemaVersion=1 e findings={} são obrigatórios');
  }
  return { ...parsed, programHandles: parsed.programHandles || {}, findings: parsed.findings || {} };
}

function taskIdentity(item) {
  const inputDigest = digest({
    findingId: item.id, state: item.state, action: item.action,
    reason: item.reason, missingEvidence: item.missingEvidence || null,
    evidenceRecipeDigest: item.evidenceRecipeDigest || null,
  });
  return {
    taskId: `evidence:v1:${digest([item.id, item.action, inputDigest])}`,
    inputDigest,
  };
}

export function bindRecipesToPlan(plan, recipes) {
  return {
    ...(plan || {}),
    actionable: (plan?.actionable || []).map((item) => ({
      ...item,
      evidenceRecipeDigest: digest(recipes?.findings?.[item.id] || null),
    })),
  };
}

/** Materializa somente o plano já autorizado. Um novo motivo/ação gera
 * outro taskId; histórico antigo fica obsolete, nunca é silenciosamente
 * reaproveitado como prova para um achado diferente. */
export function reconcileWorkOrders(state, plan, now = new Date().toISOString()) {
  const next = structuredClone(state || emptyEvidenceState());
  next.schemaVersion = EVIDENCE_STATE_SCHEMA_VERSION;
  next.workOrders ||= {};
  next.runs ||= [];
  const live = new Set();
  for (const item of plan?.actionable || []) {
    const identity = taskIdentity(item);
    live.add(identity.taskId);
    if (!next.workOrders[identity.taskId]) {
      next.workOrders[identity.taskId] = {
        ...identity, findingId: item.id, program: item.program, repository: item.repository,
        action: item.action, priority: item.priority, status: 'pending', attempts: 0,
        reason: item.reason, createdAt: now,
      };
    }
  }
  for (const order of Object.values(next.workOrders)) {
    if (!live.has(order.taskId) && !['completed', 'obsolete'].includes(order.status)) {
      order.status = 'obsolete';
      order.finishedAt = now;
      order.result = { reason: 'o research-plan não pede mais esta ação' };
    }
  }
  return next;
}

function nextRetryAt(attempts, nowMs) {
  const delay = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.max(0, attempts - 1)));
  return new Date(nowMs + delay).toISOString();
}

function runnableOrders(state, nowMs) {
  return Object.values(state.workOrders || {})
    .filter((order) => order.status === 'pending'
      || (order.status === 'retry' && Date.parse(order.nextEligibleAt || 0) <= nowMs))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0)
      || String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** Pure orchestration shell: claims, records and backs off. The injected
 * executor owns evidence semantics and is tested independently. */
export async function runEvidenceCycle({ state, plan, executor, maxTasks = 4, now = () => new Date() }) {
  const started = now();
  const next = reconcileWorkOrders(state, plan, started.toISOString());
  const selected = runnableOrders(next, started.getTime()).slice(0, Math.max(0, maxTasks));
  const summary = { planned: plan?.actionable?.length || 0, claimed: selected.length, completed: 0, needsHuman: 0, failed: 0 };
  let evidenceMutated = false;
  let queueMutated = false;
  for (const order of selected) {
    const attemptedAt = now();
    order.status = 'running';
    order.attempts += 1;
    order.lastAttemptAt = attemptedAt.toISOString();
    order.lease = { owner: `pid:${process.pid}`, expiresAt: new Date(attemptedAt.getTime() + 60 * 60 * 1000).toISOString() };
    try {
      const result = await executor(order);
      evidenceMutated ||= result?.evidenceMutated === true;
      queueMutated ||= result?.queueMutated === true;
      order.result = {
        reason: String(result?.reason || 'executor não informou resultado').slice(0, 2000),
        ...(result?.evidence ? { evidence: result.evidence } : {}),
      };
      if (result?.status === 'completed') {
        order.status = 'completed';
        summary.completed += 1;
      } else if (result?.status === 'needs_human') {
        order.status = 'needs_human';
        summary.needsHuman += 1;
      } else {
        throw new Error(`status inválido do executor: ${result?.status || 'ausente'}`);
      }
    } catch (error) {
      order.status = 'retry';
      order.nextEligibleAt = nextRetryAt(order.attempts, now().getTime());
      order.result = { reason: String(error.message || error).slice(0, 2000) };
      summary.failed += 1;
    }
    delete order.lease;
    order.finishedAt = now().toISOString();
  }
  const changed = JSON.stringify(next) !== JSON.stringify(state || emptyEvidenceState());
  if (selected.length > 0 || changed) {
    next.runs = [...(next.runs || []), {
      runId: `evidence-run:v1:${digest([started.toISOString(), process.pid, summary])}`,
      startedAt: started.toISOString(), finishedAt: now().toISOString(), ...summary,
    }].slice(-MAX_RUN_HISTORY);
  }
  return { state: next, summary, changed: JSON.stringify(next) !== JSON.stringify(state || emptyEvidenceState()), evidenceMutated, queueMutated };
}

function command(gitExe, args, options = {}) {
  const result = spawnSync(gitExe, args, {
    encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n').trim().slice(-2000);
    throw new Error(`git ${args[0]} falhou${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

export function inspectGitFileAge({ repository, file }, {
  gitExe = 'git', workspaceRoot = tmpdir(), now = () => new Date(), run = command,
} = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || ''))) {
    throw new Error('repository precisa ter formato owner/repo do GitHub');
  }
  const normalizedFile = String(file || '').replaceAll('\\', '/');
  if (!normalizedFile || path.posix.isAbsolute(normalizedFile) || normalizedFile.split('/').includes('..')
      || /[\u0000\r\n]/.test(normalizedFile)) {
    throw new Error('file precisa ser caminho relativo seguro dentro do repositório');
  }
  const tempRoot = mkdtempSync(path.join(path.resolve(workspaceRoot), 'zto-evidence-age-'));
  const repoDir = path.join(tempRoot, 'repo');
  try {
    run(gitExe, ['-c', 'core.hooksPath=NUL', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false',
      'clone', '--quiet', '--no-checkout', '--filter=blob:none', '--', `https://github.com/${repository}.git`, repoDir]);
    const history = run(gitExe, ['-C', repoDir, 'log', '--follow', '--format=%H%x09%cI', '--', normalizedFile]);
    const rows = history.split(/\r?\n/).filter(Boolean).map((line) => {
      const [commit, committedAt] = line.split('\t');
      if (!/^[0-9a-f]{40}$/i.test(commit) || !Number.isFinite(Date.parse(committedAt))) {
        throw new Error('git log devolveu histórico inválido');
      }
      return { commit: commit.toLowerCase(), committedAt };
    });
    if (rows.length === 0) throw new Error('arquivo não encontrado no histórico da branch padrão');
    const oldest = rows.at(-1);
    const newest = rows[0];
    const nowMs = now().getTime();
    const oldestMs = Date.parse(oldest.committedAt);
    const newestMs = Date.parse(newest.committedAt);
    if (!Number.isFinite(nowMs) || oldestMs > nowMs || newestMs > nowMs) {
      throw new Error('data do histórico está no futuro');
    }
    return {
      repository, file: normalizedFile, introducedCommit: oldest.commit,
      introducedAt: oldest.committedAt, latestTouchCommit: newest.commit,
      latestTouchAt: newest.committedAt, codeAgeDays: Math.floor((nowMs - newestMs) / DAY_MS),
      pathHistoryAgeDays: Math.floor((nowMs - oldestMs) / DAY_MS),
      historyEntries: rows.length, method: 'git_log_follow_latest_path_commit',
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function programHandleFor(finding, recipes, snapshot) {
  const wanted = normalizedProgram(finding.program);
  for (const [program, handle] of Object.entries(recipes.programHandles || {})) {
    if (normalizedProgram(program) === wanted && /^[a-z0-9_-]+$/i.test(String(handle))) return String(handle);
  }
  try {
    const url = new URL(snapshot?.officialUrl);
    const handle = url.hostname.toLowerCase() === 'hackerone.com' ? url.pathname.split('/').filter(Boolean)[0] : null;
    return /^[a-z0-9_-]+$/i.test(handle || '') ? handle : null;
  } catch { return null; }
}

function resolvedRegressionRecipe(recipe, repoRoot) {
  const { kind: _kind, ...config } = recipe;
  if (config.harnessPath) config.harnessPath = path.resolve(repoRoot, config.harnessPath);
  return config;
}

export function createEvidenceExecutor({
  db, recipes, policy, repoRoot = REPO_ROOT,
  refreshScope = cmdRefreshScopeLive,
  readSnapshot = loadSnapshot,
  verifyRegressionFn = verifyRegression,
  inspectAge = inspectGitFileAge,
  searchPriorArt = cmdSearchPriorArt,
  recordAge = recordCodeAgeEvidence,
  recordImpact = recordImpactAssessment,
  recordValidationFn = recordValidation,
  now = () => new Date(),
} = {}) {
  const refreshedScopePrograms = new Set();
  return async (order) => {
    const finding = getFinding(db, order.findingId);
    if (!finding) return { status: 'completed', reason: 'finding não existe mais no banco materializado' };
    const blocked = getBlockReason(finding.program, policy, { now: now().getTime() });
    if (blocked) return { status: 'completed', reason: `programa bloqueado antes da execução: ${blocked}` };
    const recipe = recipes.findings?.[finding.id] || {};

    if (order.action === 'verify_scope') {
      const before = readSnapshot(finding.program);
      const handle = programHandleFor(finding, recipes, before);
      if (!handle) return { status: 'needs_human', reason: 'program handle oficial não configurado; nenhuma busca de escopo foi feita' };
      const programKey = normalizedProgram(finding.program);
      if (!refreshedScopePrograms.has(programKey)) {
        await refreshScope(finding.program, handle);
        refreshedScopePrograms.add(programKey);
      }
      const checked = scopeGate(readSnapshot(finding.program), assetRefForFinding(finding), now().toISOString());
      if (checked.allowed && checked.bountyEligible === true) {
        return { status: 'completed', evidenceMutated: true, reason: 'escopo oficial atualizado: ativo elegível para submissão e bounty',
          evidence: { officialUrl: checked.officialUrl, snapshotContentHash: checked.snapshotContentHash, bountyEligible: true } };
      }
      if (checked.allowed && checked.bountyEligible == null) {
        return { status: 'needs_human', evidenceMutated: true, reason: checked.reason,
          evidence: { officialUrl: checked.officialUrl, snapshotContentHash: checked.snapshotContentHash, bountyEligible: null } };
      }
      return { status: 'completed', evidenceMutated: true, reason: checked.reason,
        evidence: { officialUrl: checked.officialUrl || null, bountyEligible: checked.bountyEligible ?? null } };
    }

    const impactRecipe = recipe.impactAssessment;
    if (order.action === 'assess_impact' && impactRecipe?.kind === 'validated_negative_assessment') {
      const required = impactRecipe.requiresValidation || {};
      if (impactRecipe.assessment?.reportable !== false) {
        return { status: 'needs_human', reason: 'receita negativa só pode registrar reportable=false' };
      }
      if (typeof required.type !== 'string' || required.conclusion !== 'refutes') {
        return { status: 'needs_human', reason: 'receita negativa exige uma validação específica com conclusion=refutes' };
      }
      const validation = listValidations(db, finding.id)
        .find((item) => item.type === required.type && validationConclusion(item) === required.conclusion);
      if (!validation) {
        return { status: 'needs_human', reason: `validação negativa ${required.type}/refutes não encontrada; nenhuma conclusão foi inferida` };
      }
      const assessment = recordImpact(db, finding.id, {
        ...impactRecipe.assessment,
        evidenceBasis: {
          kind: 'recorded_negative_validation', validationType: validation.type,
          validationResult: validation.result, validationConclusion: validationConclusion(validation), validationTimestamp: validation.ts,
        },
      });
      return {
        status: 'completed', evidenceMutated: true, queueMutated: true,
        reason: 'avaliação negativa registrada a partir da validação indicada; o finding fica preservado, mas fora da campanha Medium+',
        evidence: { reportable: assessment.reportable, technicalValidity: assessment.technicalValidity,
          validationType: validation.type, validationTimestamp: validation.ts },
      };
    }

    const regressionRecipe = recipe.regression;
    if (regressionRecipe?.kind === 'verified_regression'
        && ['assess_impact', 'establish_novelty', 'complete_validation'].includes(order.action)) {
      const proof = verifyRegressionFn(resolvedRegressionRecipe(regressionRecipe, repoRoot));
      recordValidationFn(db, finding.id, {
        type: 'isolated_regression', result: 'pass', command: proof.noveltyProof.candidate.command,
        rawOutput: proof.noveltyProof.candidate.observedOutcome,
        evidence: { provenance: 'regression-sandbox', repositoryUrl: proof.repositoryUrl,
          runtime: proof.runtime, noveltyProof: proof.noveltyProof },
      });
      const needsImpact = order.action === 'assess_impact';
      return {
        status: needsImpact ? 'needs_human' : 'completed', evidenceMutated: true, queueMutated: true,
        reason: needsImpact
          ? 'regressão reproduzida isoladamente; controle do atacante, vítima e impacto ainda exigem avaliação explícita'
          : 'regressão verificada automaticamente no parent e no commit introdutor com o mesmo teste',
        evidence: { kind: proof.noveltyProof.kind, introducedCommit: proof.noveltyProof.introducedCommit,
          parentCommit: proof.noveltyProof.parentCommit, validationScope: proof.noveltyProof.execution.validationScope },
      };
    }

    if (order.action === 'measure_code_age' || order.action === 'establish_novelty') {
      let age = latestCodeAgeEvidence(db, finding.id);
      if (!isTrustedPathTouchEvidence(age)) {
        const inspected = inspectAge({ repository: repositoryFromFinding(finding), file: finding.file });
        age = recordAge(db, finding.id, {
          repository: inspected.repository, path: inspected.file, ref: null,
          lastCommitSha: inspected.latestTouchCommit, lastCommitDate: inspected.latestTouchAt,
          codeAgeDays: inspected.codeAgeDays, method: inspected.method,
          limitation: `metadado git: último commit que tocou o caminho com --follow; histórico do caminho remonta a ${inspected.pathHistoryAgeDays} dia(s), com ${inspected.historyEntries} entrada(s); não prova quais linhas mudaram nem ausência de report privado`,
          checkedAt: now().toISOString(),
        });
      }
      if (Number(age.codeAgeDays) * DAY_MS > MAX_VERIFIED_REGRESSION_AGE_MS) {
        return { status: 'completed', evidenceMutated: true, queueMutated: true,
          reason: `o caminho não recebe alteração há ${age.codeAgeDays} dias; está fora da janela anti-duplicate de 48h para uma regressão de caminho`,
          evidence: { method: age.method, codeAgeDays: age.codeAgeDays, commit: age.lastCommitSha } };
      }
      if (order.action === 'measure_code_age') {
        return { status: 'completed', evidenceMutated: true, queueMutated: true,
          reason: `último toque do caminho medido em ${age.codeAgeDays} dia(s); isso permite avaliar impacto, mas não prova a introdução exata da falha`,
          evidence: { method: age.method, codeAgeDays: age.codeAgeDays, commit: age.lastCommitSha } };
      }
      return { status: 'needs_human', evidenceMutated: true, queueMutated: true,
        reason: 'o caminho foi tocado recentemente, mas falta receita de regressão que compare parent e commit introdutor com o mesmo teste' };
    }

    if (order.action === 'verify_prior_art') {
      if (!recipe.priorArt) return { status: 'needs_human', reason: 'faltam três queries específicas e programHandle em evidence-recipes.json' };
      const result = await searchPriorArt(db, finding.id, recipe.priorArt);
      return { status: 'needs_human', evidenceMutated: true, queueMutated: true,
        reason: result.candidateCount
          ? `${result.candidateCount} correspondência(s) pública(s) exigem classificação humana`
          : 'busca pública completa sem correspondência; ainda falta vincular noveltyProof e risco, e reports privados permanecem invisíveis',
        evidence: { candidateCount: result.candidateCount, checkedAt: result.checkedAt, attestationDigest: result.searchAttestation?.digest || null } };
    }

    if (order.action === 'assess_impact') {
      return { status: 'needs_human', reason: 'nenhuma prova registrada demonstra automaticamente atacante, vítima e fronteira; adicione uma receita isolada ou registre uma avaliação sustentada por evidência' };
    }
    if (order.action === 'human_review') {
      return { status: 'needs_human', reason: 'revisão e decisão de envio pertencem obrigatoriamente a uma pessoa' };
    }
    return { status: 'needs_human', reason: `ação ${order.action} ainda não possui executor seguro registrado` };
  };
}

export async function runEvidenceWorker({
  repoRoot = REPO_ROOT, statePath = DEFAULT_EVIDENCE_STATE_PATH,
  recipesPath = DEFAULT_EVIDENCE_RECIPES_PATH, lockPath = DEFAULT_EVIDENCE_LOCK_PATH,
  dbPath = DB_PATH, queuePath = QUEUE_PATH, maxTasks = Number(process.env.ZERO2ONE_EVIDENCE_MAX_TASKS || 4),
  pull = pullLatest, publish = commitAndPush, log = console.log, now = () => new Date(),
} = {}) {
  const lease = acquireLease(lockPath, { now: now().getTime() });
  if (!lease.ok) return { ok: false, skipped: true, reason: lease.reason };
  let db;
  try {
    const synced = pull(repoRoot, log);
    if (!synced.ok) throw new Error(`preflight do evidence worker falhou: ${synced.reason}`);
    migrateAll({ dbPath, writeLog: false, emitLedger: false });
    db = openDb(dbPath);
    const policy = loadProgramPolicyStrict();
    const plan = cmdResearchPlan(db, { programPolicy: policy, now: now().getTime() });
    const recipes = loadEvidenceRecipes(recipesPath);
    const boundPlan = bindRecipesToPlan(plan, recipes);
    const initial = loadEvidenceState(statePath);
    const executor = createEvidenceExecutor({ db, recipes, policy, repoRoot, now });
    const cycle = await runEvidenceCycle({ state: initial, plan: boundPlan, executor, maxTasks, now });
    if (cycle.queueMutated) exportFindingsToQueueJsonl(db, queuePath);
    if (cycle.changed || cycle.evidenceMutated) saveEvidenceState(statePath, cycle.state);
    closeDb(db);
    db = null;
    let publication = { ok: true, committed: false };
    if (cycle.changed || cycle.evidenceMutated) {
      publication = publish(repoRoot,
        `Bug bounty evidence: ${cycle.summary.completed} concluída(s), ${cycle.summary.needsHuman} humana(s), ${cycle.summary.failed} falha(s)`, log);
      if (!publication.ok) throw new Error(`evidence worker não publicou: ${publication.reason}`);
    }
    return { ok: true, plan: plan.summary, ...cycle.summary, publication };
  } finally {
    if (db) closeDb(db);
    lease.release();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runEvidenceWorker().then((result) => {
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
