// Grau de evidência explícito (seção 6.12 da auditoria externa) — E0 a
// E5. Não é uma fonte de dado nova: deriva do que já existe no banco
// (filesRead, validations, platformOutcome) pra dar um rótulo objetivo,
// consultável, em vez de só citar "grau E2"/"grau E3" em prosa dentro
// do campo `reasoning` (como o sistema já vinha fazendo informalmente).
//
// | Grau | Significado                                            |
// |------|---------------------------------------------------------|
// | E0   | Só padrão textual, nenhum arquivo lido                  |
// | E1   | 1 arquivo lido, confirma condição suspeita isolada      |
// | E2   | 2+ arquivos lidos (cadeia cross-file) OU corroborated_static |
// | E3   | Validação real com conclusion="supports" OU reproduced_local+ |
// | E4   | Regressão end-to-end em sandbox isolado, com imagem e     |
// |      | baseline/candidate registrados                            |
// | E5   | Resultado real de plataforma: triaged/paid/resolved      |

// Reaching ANY of these proves E3 was achieved at some point, even if the
// finding's CURRENT state is a later terminal outcome (duplicate/
// informative/rejected/triaged/paid/resolved) that isn't itself in this
// list -- the state machine's own human_ready gate already required a
// passing validation before any of these could be reached at all. Real
// bug caught testing this live: arc-remote-signer (submitted, closed as
// duplicate) came back E2 before this fix, even though it has a real
// passing Go-test PoC -- its CURRENT state ("duplicate") just wasn't in
// the set, so the check silently fell through to the file-count rule.
import { validationSupports } from './validation-semantics.mjs';

const E3_PLUS_STATES = new Set([
  'reproduced_local', 'scope_verified', 'human_ready', 'submitted',
  'triaged', 'duplicate', 'informative', 'rejected', 'paid', 'resolved',
]);
const E5_OUTCOME_STATES = new Set(['triaged', 'paid', 'resolved']);

/** Pura -- computa o grau a partir de fatos já conhecidos, nunca toca
 * disco/banco. `platformOutcomeState` é o ÚLTIMO outcome real importado
 * (null se nunca foi submetido). Um outcome negativo real (duplicate/
 * informative/rejected) NÃO rebaixa o grau -- o comportamento pode
 * continuar real, só deixou de ser elegível; grau de evidência mede
 * "quão bem provado", não "quão pagável". */
export function computeEvidenceGrade({ state, filesReadCount = 0, hasPassingValidation = false, hasIsolatedEndToEndValidation = false, platformOutcomeState = null }) {
  if (platformOutcomeState && E5_OUTCOME_STATES.has(platformOutcomeState)) return 'E5';
  if (hasIsolatedEndToEndValidation) return 'E4';
  if (hasPassingValidation || E3_PLUS_STATES.has(state)) return 'E3';
  if (filesReadCount >= 2 || state === 'corroborated_static') return 'E2';
  if (filesReadCount >= 1) return 'E1';
  return 'E0';
}

/** Submission-grade E4 evidence must come from the reserved regression
 * executor and carry the complete isolated end-to-end contract. When an
 * expected proof is supplied, it must be the exact proof used by the
 * duplicate gate, not an unrelated passing sandbox run. */
export function isIsolatedEndToEndValidation(validation, { expectedNoveltyProof = null } = {}) {
  const proof = validation?.evidence?.noveltyProof;
  const execution = proof?.execution;
  if (!(validationSupports(validation)
    && validation?.type === 'isolated_regression'
    && validation?.evidence?.provenance === 'regression-sandbox'
    && execution?.validationScope === 'end_to_end'
    && typeof execution?.containerImageId === 'string'
    && execution.containerImageId.length > 0
    && String(execution?.isolation || '').includes('no-network')
    && proof?.baseline?.result === 'not_vulnerable'
    && proof?.candidate?.result === 'vulnerable')) return false;

  if (!expectedNoveltyProof) return true;
  return proof.introducedCommit === expectedNoveltyProof.introducedCommit
    && proof.parentCommit === expectedNoveltyProof.parentCommit
    && proof.baseline?.ref === expectedNoveltyProof.baseline?.ref
    && proof.candidate?.ref === expectedNoveltyProof.candidate?.ref
    && proof.baseline?.command === expectedNoveltyProof.baseline?.command
    && proof.candidate?.command === expectedNoveltyProof.candidate?.command;
}

export function explainGrade(grade) {
  const explanations = {
    E0: 'Só padrão textual — nenhum arquivo real lido ainda.',
    E1: 'Um arquivo real lido, confirma condição suspeita isolada.',
    E2: 'Cadeia cross-file confirmada (2+ arquivos) ou marcado corroborated_static.',
    E3: 'Reprodução determinística local real (validação com conclusion=supports) ou avançado além disso.',
    E4: 'Regressão reproduzida end-to-end em sandbox isolado, com imagem, baseline e candidate registrados.',
    E5: 'Validado por resultado real de plataforma (triaged, paid ou resolved).',
  };
  return explanations[grade] || 'Grau desconhecido.';
}

/** Wrapper de I/O fino: busca os fatos do banco pro finding e computa o
 * grau. Não exige coluna nova no schema -- lê o que já existe. */
export function getEvidenceGrade(db, findingId, { getFinding, listValidations, latestPlatformOutcome }) {
  const finding = getFinding(db, findingId);
  if (!finding) return null;
  const validations = listValidations(db, findingId) || [];
  const hasPassingValidation = validations.some(validationSupports);
  const hasIsolatedEndToEndValidation = validations.some((validation) => isIsolatedEndToEndValidation(validation));
  const outcome = latestPlatformOutcome(db, findingId);
  return computeEvidenceGrade({
    state: finding.state,
    filesReadCount: (finding.filesRead || []).length,
    hasPassingValidation,
    hasIsolatedEndToEndValidation,
    platformOutcomeState: outcome?.state || null,
  });
}
