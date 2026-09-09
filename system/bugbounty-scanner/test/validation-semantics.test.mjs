import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationConclusion, validationProvesLocalReproduction, validationSupports } from '../validation-semantics.mjs';

test('legado é interpretado conservadoramente', () => {
  assert.equal(validationConclusion({ result:'pass' }), 'supports');
  assert.equal(validationConclusion({ result:'fail' }), 'refutes');
  assert.equal(validationConclusion({ result:'not_applicable' }), 'inconclusive');
});

test('conclusão explícita separa status do processo da hipótese de segurança', () => {
  assert.equal(validationSupports({ result:'fail', conclusion:'supports' }), true);
  assert.equal(validationSupports({ result:'pass', conclusion:'refutes' }), false);
});

test('only executable validation types prove local reproduction', () => {
  assert.equal(validationProvesLocalReproduction({ type: 'go_manual_poc', result: 'pass', conclusion: 'supports' }), true);
  assert.equal(validationProvesLocalReproduction({ type: 'expected_failure_harness', result: 'fail', conclusion: 'supports' }), true);
  assert.equal(validationProvesLocalReproduction({ type: 'timing_benchmark', result: 'pass', conclusion: 'supports' }), true);
  assert.equal(validationProvesLocalReproduction({ type: 'prior_art_search', result: 'pass', conclusion: 'supports' }), false);
  assert.equal(validationProvesLocalReproduction({ type: 'specification_recheck', result: 'pass', conclusion: 'supports' }), false);
  assert.equal(validationProvesLocalReproduction({ type: 'manual_review', result: 'pass', conclusion: 'supports' }), false);
});
