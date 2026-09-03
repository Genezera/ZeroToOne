import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSemanticFingerprint, semanticFingerprintPayload } from '../semantic-fingerprint.mjs';

test('fingerprint semântico ignora programa, linha e prosa mutável', () => {
  const base = {
    program: 'Programa A', repository: 'Acme/Api', file: 'Acme/Api/src/auth.ts',
    function: 'authorize', type: 'command injection', line: 10,
    source: 'req.body.command', sink: 'exec(command)', missingControl: 'argument array',
    reasoning: 'primeira redação',
  };
  const changed = { ...base, program: 'Programa B', line: 999, reasoning: 'texto completamente diferente' };
  assert.equal(deriveSemanticFingerprint(base), deriveSemanticFingerprint(changed));
});

test('fingerprint muda quando source, sink ou controle ausente muda', () => {
  const base = {
    repository: 'acme/api', file: 'acme/api/src/auth.ts', function: 'authorize',
    type: 'ssrf_risk', source: 'req.query.url', sink: 'fetch(url)', missingControl: 'allowlist',
  };
  assert.notEqual(deriveSemanticFingerprint(base), deriveSemanticFingerprint({ ...base, sink: 'axios.get(url)' }));
  assert.notEqual(deriveSemanticFingerprint(base), deriveSemanticFingerprint({ ...base, source: 'req.body.webhook' }));
});

test('aliases de detector convergem para a mesma fraqueza canônica', () => {
  const common = { repository: 'acme/api', file: 'acme/api/src/run.ts', function: 'run' };
  const a = semanticFingerprintPayload({ ...common, type: 'command injection' });
  const b = semanticFingerprintPayload({ ...common, type: 'semgrep_detect_child_process' });
  assert.equal(a.weakness, 'command_injection');
  assert.equal(a.weakness, b.weakness);
});

