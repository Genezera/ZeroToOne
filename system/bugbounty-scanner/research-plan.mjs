import { getBlockReason } from './program-policy.mjs';
import { assetRefForFinding } from './scope-registry.mjs';
import { duplicateHistoryForFinding, repositoryFromFinding } from './outcome-intelligence.mjs';
import { MAX_VERIFIED_REGRESSION_AGE_MS, duplicateCheckGate } from './novelty-risk.mjs';
import { reportabilityGate } from './impact-assessment.mjs';
import { isTerminal, submissionReadinessGate } from './state-machine.mjs';

const ACTIVE_STATES = new Set(['candidate', 'corroborated_static', 'reproduced_local', 'scope_verified', 'human_ready']);

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

    // A ausência de uma regression proof não deve manter código antigo na
    // fila para sempre. Se até a alteração mais recente do arquivo já é mais
    // velha que a janela da campanha, uma regressão de <=48h é impossível.
    // Aceitamos tanto a evidência normalizada quanto o sinal legado que já
    // foi persistido dentro do duplicateCheck.
    const measuredCodeAgeDays = Number(
      context.codeAgeEvidence?.codeAgeDays ?? duplicate?.signals?.codeAgeDays,
    );
    if (!duplicate?.noveltyProof && Number.isFinite(measuredCodeAgeDays)
        && measuredCodeAgeDays * 86400000 > MAX_VERIFIED_REGRESSION_AGE_MS) {
      hold('outside_campaign_window', `código observado há ${measuredCodeAgeDays} dias; a campanha exige regressão verificada em até 48h`);
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
    if (!scope?.allowed || scope.bountyEligible == null) {
      task('verify_scope', scope?.reason || 'confirmar ativo exato e recompensa na fonte oficial antes de aprofundar pesquisa', 90 + freshnessPriority);
      continue;
    }
    const impactGate = reportabilityGate(impact);
    if (!impactGate.ok) {
      task('assess_impact', 'estabelecer controle pelo atacante, vítima, efeito observável e severidade justificada antes de construir outra PoC', 70 + freshnessPriority, {
        missingEvidence: impactGate.reason,
      });
      continue;
    }
    if (!duplicate?.noveltyProof) {
      task('establish_novelty', 'localizar a introdução no histórico e um baseline; um commit recente ou pesquisa pública vazia não prova novidade', 60 + freshnessPriority);
      continue;
    }
    const priorArt = duplicateCheckGate(duplicate, { now, repository: item.repository });
    if (!priorArt.ok) {
      task('verify_prior_art', priorArt.reason, 55 + freshnessPriority);
      continue;
    }
    const readiness = submissionReadinessGate(finding, {
      ...context, scopeGateResult: scope, programPolicy, now,
    });
    if (!readiness.ok) {
      task('complete_validation', readiness.reason, 50 + freshnessPriority);
      continue;
    }
    task('human_review', 'preflight satisfeito; revisão e decisão humana ainda obrigatórias', 100);
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
