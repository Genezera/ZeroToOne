import { getBlockReason } from './program-policy.mjs';
import { assetRefForFinding } from './scope-registry.mjs';
import { duplicateHistoryForFinding, repositoryFromFinding } from './outcome-intelligence.mjs';
import { MAX_VERIFIED_REGRESSION_AGE_MS, duplicateCheckGate } from './novelty-risk.mjs';
import { reportabilityGate } from './impact-assessment.mjs';
import { isTerminal, submissionReadinessGate } from './state-machine.mjs';
import { findingIdentityQuality, localRootCauseCollisions } from './finding-identity.mjs';

const ACTIVE_STATES = new Set(['candidate', 'corroborated_static', 'reproduced_local', 'scope_verified', 'human_ready']);
const TRUSTED_PATH_TOUCH_METHODS = new Set([
  'git_log_follow_latest_path_commit',
  'github_file_last_commit',
]);

function trustedPathTouchAge(evidence) {
  if (!evidence || !TRUSTED_PATH_TOUCH_METHODS.has(evidence.method)) return null;
  const days = Number(evidence.codeAgeDays);
  return Number.isInteger(days) && days >= 0 ? days : null;
}

/** A read-only work view, not a new finding state or an authorization grant.
 * Every record remains in the ledger/queue. A held finding may reappear only
 * when its evidence or the explicit campaign policy changes. No network I/O,
 * source-code reads, exploit execution or automatic submission occurs here. */
export function buildResearchPlan(findings, {
  programPolicy = {}, submissions = [], contextFor = () => ({}), scopeFor = () => null,
  now = Date.now(),
} = {}) {
  const actionable = [];
  const held = [];
  const identities = new Map(findings.map((finding) => [finding.id, findingIdentityQuality(finding)]));
  const rootCauseOwners = new Map();
  for (const finding of findings) {
    const fingerprint = identities.get(finding.id)?.rootCauseFingerprint;
    if (!fingerprint) continue;
    const owners = rootCauseOwners.get(fingerprint) || [];
    owners.push(finding);
    rootCauseOwners.set(fingerprint, owners);
  }
  let historical = 0;
  for (const finding of findings) {
    if (isTerminal(finding.state) || !ACTIVE_STATES.has(finding.state)) { historical++; continue; }
    const item = {
      id: finding.id, program: finding.program, state: finding.state,
      asset: assetRefForFinding(finding), repository: repositoryFromFinding(finding),
    };
    const hold = (code, reason, extra = {}) => held.push({ ...item, code, reason, ...extra });
    const task = (action, reason, priority, extra = {}) => actionable.push({ ...item, action, reason, priority, ...extra });
    const blocked = getBlockReason(finding.program, programPolicy, { now });
    if (blocked) { hold('program_blocked', blocked); continue; }

    const linked = submissions.filter((submission) => (submission.findingIds || []).includes(finding.id));
    const related = submissions.filter((submission) => finding.semanticFingerprint
      && (submission.semanticFingerprints || []).includes(finding.semanticFingerprint));
    if (linked.length || related.length) {
      hold('previous_submission', 'há submissão vinculada ou fingerprint correspondente; revisar o outcome antes de qualquer nova investigação/envio', {
        submissionIds: [...new Set([...linked, ...related].map((submission) => submission.id))],
      });
      continue;
    }
    const duplicateHistory = duplicateHistoryForFinding(finding, submissions);
    if (duplicateHistory.priorDuplicateSubmissions > 0) {
      hold('campaign_duplicate_history', 'o gate atual exige zero duplicates anteriores no programa/repositório; pesquisa histórica não pode satisfazer essa regra', {
        submissionIds: duplicateHistory.matchingSubmissionIds,
      });
      continue;
    }

    const context = contextFor(finding) || {};
    const impact = context.impactAssessment;
    if (impact && (impact.reportable === false || impact.severityRating === 'low'
        || impact.attackerControlledInput === false || impact.impactScope === 'self_request_only')) {
      hold('below_campaign_impact', 'evidência atual não sustenta impacto Medium+ contra outra vítima/sistema; preservar o diagnóstico sem aumentar severidade');
      continue;
    }
    const duplicate = context.duplicateCheck;
    if (duplicate?.foundExisting === true) {
      hold('known_public_match', 'pesquisa anterior registrou correspondência pública; não repetir investigação sem evidência que a diferencie');
      continue;
    }
    // Só métodos que medem o último toque do caminho sustentam este corte.
    // O antigo "oldest path commit" e sinais legados sem proveniência podem
    // dizer há quanto tempo o arquivo existe, não quando ele mudou por último.
    const measuredCodeAgeDays = trustedPathTouchAge(context.codeAgeEvidence);
    if (!duplicate?.noveltyProof && measuredCodeAgeDays !== null
        && measuredCodeAgeDays * 86400000 > MAX_VERIFIED_REGRESSION_AGE_MS) {
      hold('outside_campaign_window', `o caminho não recebe alteração há ${measuredCodeAgeDays} dias; ele não pode conter regressão de caminho introduzida na janela exigida de 48h`);
      continue;
    }

    const change = finding.changeContext || finding.raw?.changeContext;
    const introducedAt = duplicate?.noveltyProof?.introducedAt || change?.introducedAt;
    const introducedMs = Date.parse(introducedAt);
    if (Number.isFinite(introducedMs) && now - introducedMs > MAX_VERIFIED_REGRESSION_AGE_MS) {
      hold('outside_campaign_window', 'a introdução/delta registrado excede a janela de 48h da campanha; aguardar mudança nova em vez de repetir o mesmo caso');
      continue;
    }
    const freshnessPriority = Number.isFinite(introducedMs) && introducedMs <= now
      ? Math.max(0, 5 - Math.floor((now - introducedMs) / 3600000)) : 0;
    const hasRecentExactChange = change?.directSingleCommit === true
      && Number.isFinite(introducedMs) && introducedMs <= now
      && now - introducedMs <= MAX_VERIFIED_REGRESSION_AGE_MS;
    // Propaga somente a proveniencia minima necessaria para o Evidence Worker
    // distinguir uma pendencia historica de um delta novo que pode perder a
    // janela anti-duplicate. Isto e prioridade de atencao, nao prova de bug.
    const attentionContext = hasRecentExactChange ? {
      recentExactChange: true,
      introducedAt,
      introducedCommit: duplicate?.noveltyProof?.introducedCommit || change?.introducedCommit || null,
    } : {};
    let scope;
    try { scope = scopeFor(finding, new Date(now).toISOString()); }
    catch { scope = null; }
    if (scope?.asset?.eligibleForSubmission === false) {
      hold('scope_excluded', 'ativo explicitamente excluído de submissão no snapshot atual');
      continue;
    }
    if (scope?.bountyEligible === false) {
      hold('bounty_ineligible', 'ativo explicitamente sem elegibilidade de bounty');
      continue;
    }
    if (scope?.allowed === false && scope.snapshotSourceType === 'hackerone_api_live') {
      hold('scope_not_confirmed', 'ativo exato ausente no escopo estruturado oficial atual; aguardar mudança de escopo ou revisão humana explícita em vez de repetir a pesquisa');
      continue;
    }
    if (!scope?.allowed || scope.bountyEligible == null) {
      task('verify_scope', scope?.reason || 'confirmar ativo exato e recompensa na fonte oficial antes de aprofundar pesquisa', 90 + freshnessPriority, attentionContext);
      continue;
    }
    if (!duplicate?.noveltyProof && measuredCodeAgeDays === null && !hasRecentExactChange) {
      task('measure_code_age', 'medir o último commit que tocou o caminho antes de investir em PoC; idade do arquivo ou busca pública vazia não provam regressão', 80 + freshnessPriority);
      continue;
    }
    const identity = identities.get(finding.id);
    if (!identity.ok) {
      task('structure_identity', `${identity.reason}; preencher campos estruturados, sem extrair automaticamente da prosa`, 88 + freshnessPriority, {
        ...attentionContext,
        missingFields: identity.missing,
      });
      continue;
    }
    const localIdentity = localRootCauseCollisions(finding, findings);
    if (localIdentity.collisionIds.length > 0) {
      const owners = rootCauseOwners.get(identity.rootCauseFingerprint) || [];
      const terminalOwnerExists = owners.some((candidate) => isTerminal(candidate.state) || candidate.state === 'submitted');
      const activePrimaryId = owners.filter((candidate) => ACTIVE_STATES.has(candidate.state)).map((candidate) => candidate.id).sort()[0];
      if (terminalOwnerExists || finding.id !== activePrimaryId) {
        hold('local_root_cause_collision', 'outro finding local tem a mesma causa raiz estruturada; consolidar ou provar mecanicamente a diferença antes de continuar', {
          rootCauseFingerprint: identity.rootCauseFingerprint,
          collisionFindingIds: localIdentity.collisionIds,
        });
        continue;
      }
    }
    const impactGate = reportabilityGate(impact);
    if (!impactGate.ok) {
      task('assess_impact', 'estabelecer controle pelo atacante, vítima, efeito observável e severidade justificada antes de construir outra PoC', 70 + freshnessPriority, {
        ...attentionContext,
        missingEvidence: impactGate.reason,
      });
      continue;
    }
    if (!duplicate?.noveltyProof) {
      task('establish_novelty', 'localizar a introdução no histórico e um baseline; um commit recente ou pesquisa pública vazia não prova novidade', 60 + freshnessPriority, attentionContext);
      continue;
    }
    const priorArt = duplicateCheckGate(duplicate, { now, repository: item.repository });
    if (!priorArt.ok) {
      task('verify_prior_art', priorArt.reason, 55 + freshnessPriority, attentionContext);
      continue;
    }
    const readiness = submissionReadinessGate(finding, {
      ...context, scopeGateResult: scope, programPolicy, now,
    });
    if (!readiness.ok) {
      task('complete_validation', readiness.reason, 50 + freshnessPriority, attentionContext);
      continue;
    }
    task('human_review', 'preflight satisfeito; revisão e decisão humana ainda obrigatórias', 100, attentionContext);
  }
  actionable.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  held.sort((a, b) => a.id.localeCompare(b.id));
  const heldByReason = {};
  for (const item of held) heldByReason[item.code] = (heldByReason[item.code] || 0) + 1;
  return {
    checkedAt: new Date(now).toISOString(),
    summary: { totalRecords: findings.length, historical, actionable: actionable.length, held: held.length, heldByReason },
    actionable, held,
    limitation: 'prioridade de pesquisa não é prova de novidade, severidade ou elegibilidade; reports privados continuam desconhecidos',
  };
}
