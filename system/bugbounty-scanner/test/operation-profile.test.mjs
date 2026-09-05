import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadOperationProfile, validateOperationProfile } from '../operation-profile.mjs';

const VALID = {
  schemaVersion: 1,
  primaryRuntime: 'github_actions',
  cloudSchedulesRequired: true,
  local: { automaticStart: false, requiredForOperation: false, mode: 'manual_only' },
};

test('operation profile aceita somente cloud primária com execução local manual', () => {
  const profile = validateOperationProfile(VALID);
  assert.equal(profile.primaryRuntime, 'github_actions');
  assert.equal(profile.local.automaticStart, false);
  assert.equal(profile.local.requiredForOperation, false);
  assert.equal(profile.local.mode, 'manual_only');
  assert.equal(Object.isFrozen(profile.local), true);
});

test('operation profile rejeita qualquer tentativa de reativar autostart local', () => {
  assert.throws(
    () => validateOperationProfile({ ...VALID, local: { ...VALID.local, automaticStart: true } }),
    /manual_only/,
  );
  assert.throws(
    () => validateOperationProfile({ ...VALID, local: { ...VALID.local, requiredForOperation: true } }),
    /manual_only/,
  );
  assert.throws(() => validateOperationProfile({ ...VALID, primaryRuntime: 'windows' }), /github_actions/);
});

test('loadOperationProfile falha fechado diante de arquivo inválido', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-operation-profile-'));
  const file = path.join(dir, 'operation-profile.json');
  writeFileSync(file, JSON.stringify({ ...VALID, cloudSchedulesRequired: false }), 'utf8');
  assert.throws(() => loadOperationProfile(file), /cloudSchedulesRequired/);
});
