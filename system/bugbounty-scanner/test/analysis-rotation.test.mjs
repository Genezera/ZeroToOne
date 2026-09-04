import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordRotationResult, selectTargetsForRotation } from '../analysis-rotation.mjs';

const targets = [
  { owner: 'acme', repo: 'old' }, { owner: 'acme', repo: 'never' }, { owner: 'acme', repo: 'recent' },
];

test('rotação escolhe nunca analisado e depois o sucesso mais antigo', () => {
  const state = {
    'acme/old': { lastSuccessAt: '2026-08-01T00:00:00Z' },
    'acme/recent': { lastSuccessAt: '2026-09-01T00:00:00Z' },
  };
  assert.equal(selectTargetsForRotation(targets, state)[0].repo, 'never');
  assert.deepEqual(selectTargetsForRotation(targets.filter((target) => target.repo !== 'never'), state, { limit: 2 }).map((target) => target.repo), ['old', 'recent']);
});

test('falha registra tentativa sem fingir sucesso; sucesso avança cursor', () => {
  const failed = recordRotationResult({}, targets[0], { ok: false, reason: 'CodeQL falhou' }, { now: () => new Date('2026-09-04T01:00:00Z') });
  assert.equal(failed['acme/old'].lastSuccessAt, undefined);
  assert.match(failed['acme/old'].lastError, /falhou/);
  const passed = recordRotationResult(failed, targets[0], { ok: true, headSha: 'a'.repeat(40) }, { now: () => new Date('2026-09-04T02:00:00Z') });
  assert.equal(passed['acme/old'].lastSuccessAt, '2026-09-04T02:00:00.000Z');
  assert.equal(passed['acme/old'].lastError, null);
});
