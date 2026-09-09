import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationConclusion, validationSupports } from '../validation-semantics.mjs';

test('legado é interpretado conservadoramente', () => {
  assert.equal(validationConclusion({ result:'pass' }), 'supports');
  assert.equal(validationConclusion({ result:'fail' }), 'refutes');
  assert.equal(validationConclusion({ result:'not_applicable' }), 'inconclusive');
});

test('conclusão explícita separa status do processo da hipótese de segurança', () => {
  assert.equal(validationSupports({ result:'fail', conclusion:'supports' }), true);
  assert.equal(validationSupports({ result:'pass', conclusion:'refutes' }), false);
});
