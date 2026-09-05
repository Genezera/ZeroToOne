import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDockerExecutable } from './regression-sandbox.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function firstLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function executable(candidates) {
  return candidates.find((candidate) => candidate && (candidate === path.basename(candidate) || existsSync(candidate)))
    || candidates.filter(Boolean)[0];
}

export function runToolchainDoctor({
  spawn = spawnSync,
  env = process.env,
  requiredTools = ['node', 'git', 'semgrep', 'osv_scanner', 'slither', 'forge', 'docker_engine', 'codeql'],
  requiredIntegrations = ['githubTokenConfigured', 'hackerOneConfigured', 'telegramConfigured'],
} = {}) {
  const semgrep = executable([env.SEMGREP_EXE, 'E:\\dev-toolchains\\venv-security\\Scripts\\semgrep.exe', 'semgrep']);
  const osv = executable([env.OSV_SCANNER_EXE, 'E:\\dev-toolchains\\go\\bin\\osv-scanner.exe', 'osv-scanner']);
  const docker = findDockerExecutable({ env });
  const codeql = executable([env.CODEQL_EXE, 'E:\\dev-toolchains\\codeql-2.26.4\\codeql\\codeql.exe', 'codeql']);
  const definitions = [
    ['node', process.execPath, ['--version']],
    ['git', 'git', ['--version']],
    ['semgrep', semgrep, ['--version']],
    ['osv_scanner', osv, ['--version']],
    ['slither', 'py', ['-m', 'slither', '--version']],
    ['forge', 'forge', ['--version']],
    ['docker_engine', docker, ['info', '--format', '{{.ServerVersion}}']],
    ['codeql', codeql, ['version', '--format=terse']],
  ];
  const tools = {};
  for (const [name, command, args] of definitions) {
    const result = spawn(command, args, {
      cwd: REPO_ROOT, env, encoding: 'utf8', windowsHide: true,
      timeout: name === 'docker_engine' ? 15_000 : 30_000,
      maxBuffer: 1024 * 1024,
    });
    tools[name] = {
      ok: result.status === 0 && !result.error,
      version: firstLine(result.stdout) || firstLine(result.stderr),
      error: result.error?.message || (result.status === 0 ? null : `exit ${result.status}`),
    };
  }
  const integrations = {
    githubTokenConfigured: !!env.GITHUB_TOKEN,
    hackerOneConfigured: !!(env.HACKERONE_USERNAME && env.HACKERONE_API_TOKEN),
    telegramConfigured: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  };
  const unknownTools = requiredTools.filter((name) => !Object.hasOwn(tools, name));
  const unknownIntegrations = requiredIntegrations.filter((name) => !Object.hasOwn(integrations, name));
  if (unknownTools.length || unknownIntegrations.length) {
    throw new Error(`requisito de doctor desconhecido: ${[...unknownTools, ...unknownIntegrations].join(', ')}`);
  }
  const unavailableTools = Object.entries(tools).filter(([, value]) => !value.ok).map(([name]) => name);
  const unavailableIntegrations = Object.entries(integrations).filter(([, value]) => !value).map(([name]) => name);
  const failedTools = requiredTools.filter((name) => !tools[name].ok);
  const missingIntegrations = requiredIntegrations.filter((name) => !integrations[name]);
  return {
    ok: failedTools.length === 0 && missingIntegrations.length === 0,
    checkedAt: new Date().toISOString(),
    tools,
    integrations,
    failedTools,
    missingIntegrations,
    unavailableTools,
    unavailableIntegrations,
    requirements: { tools: requiredTools, integrations: requiredIntegrations },
  };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  const result = runToolchainDoctor();
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
