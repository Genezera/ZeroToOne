export const IMPACT_LEVELS = new Set(['none', 'low', 'high']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length >= 3;
}

/** Validate facts needed to distinguish a real code defect from a reportable
 * security boundary violation. Non-reportable assessments are valid records;
 * this function reports malformed/missing evidence separately. */
export function validateImpactAssessment(assessment = {}) {
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
  return { ok: errors.length === 0, errors };
}

export function reportabilityGate(assessment = {}) {
  const shape = validateImpactAssessment(assessment);
  if (!shape.ok) return { ok: false, reason: `impactAssessment incompleto: ${shape.errors.join('; ')}` };
  if (assessment.technicalValidity !== 'confirmed') {
    return { ok: false, reason: `validade técnica não confirmada (${assessment.technicalValidity})` };
  }
  if (!assessment.reportable) return { ok: false, reason: 'impactAssessment marcou o achado como não-reportável' };
  if (assessment.impactScope === 'self_request_only') {
    return { ok: false, reason: 'impacto limitado à própria requisição não demonstra efeito de segurança contra outra vítima/sistema' };
  }
  if (assessment.confidentiality === 'none' && assessment.integrity === 'none' && assessment.availability === 'none') {
    return { ok: false, reason: 'nenhum impacto de confidencialidade, integridade ou disponibilidade foi demonstrado' };
  }
  return { ok: true, reason: `impacto reportável confirmado (${assessment.impactScope})` };
}

