import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOperationProfile } from '../operation-profile.mjs';

const scannerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('contrato local permanece manual e sem registro ou disparo automático de tarefas', () => {
  const profile = loadOperationProfile();
  const installer = readFileSync(path.join(scannerDir, 'install-service-tasks.ps1'), 'utf8');
  assert.equal(profile.local.automaticStart, false);
  assert.equal(profile.local.requiredForOperation, false);
  assert.equal(profile.local.mode, 'manual_only');
  for (const forbidden of [
    /Register-ScheduledTask/i,
    /Start-ScheduledTask/i,
    /New-ScheduledTaskTrigger/i,
    /AtLogOn/i,
    /AtStartup/i,
  ]) assert.doesNotMatch(installer, forbidden);
  assert.match(installer, /Disable-ScheduledTask/);
  assert.match(installer, /\[switch\]\$RunOnce/);
});
