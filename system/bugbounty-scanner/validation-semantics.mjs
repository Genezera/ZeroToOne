export const VALIDATION_RESULTS = new Set(['pass', 'fail', 'not_applicable']);
export const VALIDATION_CONCLUSIONS = new Set(['supports', 'refutes', 'inconclusive']);

/** Legacy rows used result as both command status and security verdict.
 * Preserve their conservative meaning: pass supports, fail refutes, and
 * not_applicable is inconclusive. New callers may state both explicitly. */
export function validationConclusion(validation = {}) {
  if (VALIDATION_CONCLUSIONS.has(validation.conclusion)) return validation.conclusion;
  if (validation.result === 'pass') return 'supports';
  if (validation.result === 'fail') return 'refutes';
  return 'inconclusive';
}

export function validationSupports(validation = {}) {
  return validationConclusion(validation) === 'supports';
}
