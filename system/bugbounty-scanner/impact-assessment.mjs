export const IMPACT_LEVELS = new Set(['none', 'low', 'high']);
export const SEVERITY_RATINGS = new Set(['low', 'medium', 'high', 'critical']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length >= 3;
}

/** Validate facts needed to distinguish a real code defect from a reportable
 * security boundary violation. Non-reportable assessments are valid records;
 * this function reports malformed/missing evidence separately. */
export function validateImpactAssessment(assessment = {}, { allowLegacyUnassessed = false } = {}) {
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) assessment = {};
  const errors = [];
  if (!['confirmed', 'refuted', 'inconclusive'].includes(assessment.technicalValidity)) {
    errors.push('technicalValidity precisa ser confirmed|refuted|inconclusive');
  }
  if (typeof assessment.attackerControlledInput !== 'boolean') {
    errors.push('attackerControlledInput precisa ser boolean explícito');
  }
  for (const field of ['attacker', 'victim', 'securityBoundary', 'observableOutcome', 'rationale']) {
    if (!nonEmpty(assessment[field])) errors.push(`${field} precisa ser descrito`);
  }
  for (const field of ['confidentiality', 'integrity', 'availability']) {
    if (!IMPACT_LEVELS.has(assessment[field])) errors.push(`${field} precisa ser none|low|high`);
  }
  if (!['self_request_only', 'other_user', 'other_system', 'systemic'].includes(assessment.impactScope)) {
    errors.push('impactScope precisa ser self_request_only|other_user|other_system|systemic');
  }
  if (typeof assessment.reportable !== 'boolean') errors.push('reportable precisa ser boolean explícito');
  if (assessment.reportable === true) {
    if (!allowLegacyUnassessed && !SEVERITY_RATINGS.has(assessment.severityRating)) {
      errors.push('severityRating precisa ser low|medium|high|critical quando reportable=true');
    }
    if (!allowLegacyUnassessed && !nonEmpty(assessment.severityRationale)) {
      errors.push('severityRationale precisa justificar a severidade quando reportable=true');
    }
  } else {
    if (assessment.severityRating != null && !SEVERITY_RATINGS.has(assessment.severityRating)) {
      errors.push('severityRating precisa ser low|medium|high|critical quando informado');
    }
    if (assessment.severityRationale != null && !nonEmpty(assessment.severityRationale)) {
      errors.push('severityRationale informado precisa ser descrito');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function reportabilityGate(assessment = {}) {
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) assessment = {};
  const shape = validateImpactAssessment(assessment);
  if (!shape.ok) return { ok: false, reason: `impactAssessment incompleto: ${shape.errors.join('; ')}` };
  if (assessment.technicalValidity !== 'confirmed') {
    return { ok: false, reason: `validade técnica não confirmada (${assessment.technicalValidity})` };
  }
  if (assessment.attackerControlledInput !== true) {
    return { ok: false, reason: 'não foi comprovada entrada controlada pelo atacante' };
  }
  if (!assessment.reportable) return { ok: false, reason: 'impactAssessment marcou o achado como não-reportável' };
  if (assessment.severityRating === 'low') {
    return { ok: false, reason: 'modo profissional desta campanha exige severidade estimada Medium+; Low permanece documentado, mas não vai para envio' };
  }
  if (assessment.impactScope === 'self_request_only') {
    return { ok: false, reason: 'impacto limitado à própria requisição não demonstra efeito de segurança contra outra vítima/sistema' };
  }
  if (assessment.confidentiality === 'none' && assessment.integrity === 'none' && assessment.availability === 'none') {
    return { ok: false, reason: 'nenhum impacto de confidencialidade, integridade ou disponibilidade foi demonstrado' };
  }
  return { ok: true, reason: `impacto reportável ${assessment.severityRating} confirmado (${assessment.impactScope})` };
}
