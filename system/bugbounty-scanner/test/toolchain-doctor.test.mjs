import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runToolchainDoctor } from '../toolchain-doctor.mjs';

const configuredEnv = {
  ...process.env,
  GITHUB_TOKEN: 'present',
  HACKERONE_USERNAME: 'present',
  HACKERONE_API_TOKEN: 'present',
  TELEGRAM_BOT_TOKEN: 'present',
  TELEGRAM_CHAT_ID: 'present',
};

test('doctor exige ferramentas e integrações sem expor valores das credenciais', () => {
  const calls = [];
  const result = runToolchainDoctor({
    env: configuredEnv,
    spawn: (command, args) => {
      calls.push([command, args]);
      return { status: 0, stdout: `${args.includes('--version') ? 'v1.2.3' : '29.7.2'}\n`, stderr: '' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 8);
  assert.deepEqual(result.integrations, {
    githubTokenConfigured: true, hackerOneConfigured: true, telegramConfigured: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /present/);
});

test('doctor falha fechado e nomeia ferramenta e integração ausentes', () => {
  const env = { ...configuredEnv };
  delete env.HACKERONE_API_TOKEN;
  const result = runToolchainDoctor({
    env,
    spawn: (command, args) => command === 'forge'
      ? { status: 1, stdout: '', stderr: 'not found' }
      : { status: 0, stdout: `${args.includes('--version') ? 'v1' : 'ok'}\n`, stderr: '' },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failedTools, ['forge']);
  assert.deepEqual(result.missingIntegrations, ['hackerOneConfigured']);
});
