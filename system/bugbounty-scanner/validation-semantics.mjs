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

// `supports` describes the conclusion of many different evidence sources. A
// clean prior-art search can support novelty and a specification review can
// support an interpretation, but neither executes the affected behavior. Keep
// the reproduction gate fail-closed and require a validation type whose name
// explicitly identifies an executable PoC/test/reproduction/benchmark/harness.
const REPRODUCTION_TYPE = /(^|_)(poc|repro|reproduction|test|benchmark|harness|regression)(_|$)/i;

export function validationProvesLocalReproduction(validation = {}) {
  return validationSupports(validation)
    && typeof validation.type === 'string'
    && REPRODUCTION_TYPE.test(validation.type);
}
