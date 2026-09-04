import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const REGRESSION_MARKERS = Object.freeze({
  vulnerable: 'ZTO_RESULT=VULNERABLE',
  notVulnerable: 'ZTO_RESULT=NOT_VULNERABLE',
});

export const RUNTIME_IMAGES = Object.freeze({
  node22: 'node:22-bookworm-slim',
  python313: 'python:3.13-slim',
  go127: 'golang:1.27-bookworm',
  jdk21: 'eclipse-temurin:21-jdk',
  foundry: 'ghcr.io/foundry-rs/foundry:stable',
});

const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_COMMAND_LENGTH = 4000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;

function commandResult(result, label) {
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = [stderr, stdout].filter(Boolean).join('\n').trim().slice(-4000);
    throw new Error(`${label} falhou (exit ${result.status})${detail ? `: ${detail}` : ''}`);
  }
  return { stdout, stderr };
}

export function findDockerExecutable({ env = process.env, exists = existsSync } = {}) {
  const candidates = [
    env.DOCKER_EXE,
    process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : null,
    'docker',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'docker' || exists(candidate)) return candidate;
  }
  return 'docker';
}

export function validateRegressionConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('config precisa ser um objeto JSON');
  }
  let repositoryUrl;
  try {
    const url = new URL(input.repositoryUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
      throw new Error('somente repositório público https://github.com é aceito');
    }
    const parts = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
    if (parts.length !== 2) throw new Error('repositoryUrl precisa ter formato https://github.com/owner/repo');
    repositoryUrl = `https://github.com/${parts[0]}/${parts[1]}.git`;
  } catch (error) {
    if (error.message.includes('somente') || error.message.includes('formato')) throw error;
    throw new Error(`repositoryUrl inválida: ${error.message}`);
  }

  const introducedCommit = String(input.introducedCommit || '').toLowerCase();
  const parentCommit = String(input.parentCommit || '').toLowerCase();
  if (!SHA_RE.test(introducedCommit) || !SHA_RE.test(parentCommit)) {
    throw new Error('introducedCommit e parentCommit precisam ser SHAs completos de 40 caracteres');
  }
  if (introducedCommit === parentCommit) throw new Error('introducedCommit e parentCommit precisam ser diferentes');

  const runtime = String(input.runtime || '');
  if (!Object.hasOwn(RUNTIME_IMAGES, runtime)) {
    throw new Error(`runtime não permitido; use: ${Object.keys(RUNTIME_IMAGES).join(', ')}`);
  }
  const command = String(input.command || '').trim();
  if (!command || command.length > MAX_COMMAND_LENGTH || /[\u0000\r\n]/.test(command)) {
    throw new Error(`command precisa ter 1-${MAX_COMMAND_LENGTH} caracteres e ocupar uma linha`);
  }

  const workdir = String(input.workdir || '.').replaceAll('\\', '/');
  if (path.posix.isAbsolute(workdir) || workdir.split('/').includes('..') || /[\u0000\r\n]/.test(workdir)) {
    throw new Error('workdir precisa ser relativo ao repositório e não pode conter ..');
  }

  let harnessPath = null;
  if (input.harnessPath) {
    const requested = path.resolve(String(input.harnessPath));
    if (!existsSync(requested)) throw new Error('harnessPath não existe');
    const resolved = realpathSync(requested);
    const stat = lstatSync(resolved);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('harnessPath precisa ser arquivo ou diretório');
    harnessPath = resolved;
  }

  const timeoutMs = input.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(input.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs precisa estar entre 1000 e ${MAX_TIMEOUT_MS}`);
  }
  const validationScope = input.validationScope || 'component';
  if (!['component', 'integration', 'end_to_end'].includes(validationScope)) {
    throw new Error('validationScope precisa ser component, integration ou end_to_end');
  }
  return { repositoryUrl, introducedCommit, parentCommit, runtime, command, workdir, harnessPath, timeoutMs, validationScope };
}

export function parseRegressionMarker(output) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim());
  const markers = new Set(lines.filter((line) => Object.values(REGRESSION_MARKERS).includes(line)));
  if (markers.size !== 1) {
    throw new Error(markers.size === 0
      ? 'teste não emitiu marcador ZTO_RESULT em linha isolada'
      : 'teste emitiu marcadores contraditórios');
  }
  return markers.has(REGRESSION_MARKERS.vulnerable) ? 'vulnerable' : 'not_vulnerable';
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function buildDockerArgs({ image, checkoutPath, command, workdir = '.', harnessPath = null }) {
  const containerWorkdir = workdir === '.' ? '/workspace' : `/workspace/${workdir}`;
  const bootstrap = `cp -a /input/. /workspace/ && cd ${shellQuote(containerWorkdir)} && ${command}`;
  const args = [
    'run', '--rm',
    '--network', 'none',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '128',
    '--cpus', '1',
    '--memory', '1g',
    '--user', '65534:65534',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,uid=65534,gid=65534,mode=1777',
    '--tmpfs', '/workspace:rw,nosuid,nodev,size=1g,uid=65534,gid=65534,mode=0755',
    '--env', 'HOME=/tmp',
    '--env', 'TMPDIR=/tmp',
    '--mount', `type=bind,src=${path.resolve(checkoutPath)},dst=/input,readonly`,
  ];
  if (harnessPath) args.push('--mount', `type=bind,src=${path.resolve(harnessPath)},dst=/harness,readonly`);
  args.push('--entrypoint', '/bin/sh', image, '-lc', bootstrap);
  return args;
}

export function runContainerCheck(config, checkoutPath, {
  docker = findDockerExecutable(),
  spawn = spawnSync,
} = {}) {
  const args = buildDockerArgs({
    image: RUNTIME_IMAGES[config.runtime], checkoutPath, command: config.command,
    workdir: config.workdir, harnessPath: config.harnessPath,
  });
  const startedAt = new Date().toISOString();
  const result = spawn(docker, args, {
    encoding: 'utf8', windowsHide: true, timeout: config.timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  });
  const { stdout, stderr } = commandResult(result, 'execução isolada');
  const combined = [stdout, stderr].filter(Boolean).join('\n');
  const inspected = spawn(docker, ['image', 'inspect', RUNTIME_IMAGES[config.runtime], '--format', '{{.Id}}'], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024, env: process.env,
  });
  const imageId = commandResult(inspected, 'inspeção da imagem Docker').stdout.trim();
  return {
    result: parseRegressionMarker(combined),
    observedOutcome: combined.trim().slice(-4000),
    startedAt,
    finishedAt: new Date().toISOString(),
    containerImage: RUNTIME_IMAGES[config.runtime],
    containerImageId: imageId,
    isolation: 'docker:no-network,read-only-root,cap-drop-all,no-new-privileges,cpu-memory-pid-limits',
  };
}

function git(gitExe, args, options = {}) {
  return commandResult(spawnSync(gitExe, args, {
    encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    ...options,
  }), `git ${args[0]}`);
}

export function verifyRegression(input, {
  gitExe = 'git', docker = findDockerExecutable(), workspaceRoot = tmpdir(),
  runCheck = runContainerCheck,
} = {}) {
  const config = validateRegressionConfig(input);
  const tempRoot = mkdtempSync(path.join(path.resolve(workspaceRoot), 'zto-regression-'));
  const repoDir = path.join(tempRoot, 'repo');
  const baselineDir = path.join(tempRoot, 'baseline');
  const candidateDir = path.join(tempRoot, 'candidate');
  try {
    git(gitExe, ['-c', 'core.hooksPath=NUL', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false',
      'clone', '--no-checkout', '--filter=blob:none', '--', config.repositoryUrl, repoDir]);
    git(gitExe, ['-C', repoDir, 'fetch', '--no-tags', '--depth=2', 'origin', config.introducedCommit]);
    const actualParent = git(gitExe, ['-C', repoDir, 'rev-parse', `${config.introducedCommit}^`]).stdout.trim().toLowerCase();
    if (actualParent !== config.parentCommit) {
      throw new Error(`parentCommit não é o parent real do commit introdutor (esperado ${actualParent})`);
    }
    try {
      git(gitExe, ['-C', repoDir, 'merge-base', '--is-ancestor', config.introducedCommit, 'origin/HEAD']);
    } catch {
      throw new Error('introducedCommit não está no histórico da branch padrão pública (origin/HEAD)');
    }
    const introducedAt = git(gitExe, ['-C', repoDir, 'show', '-s', '--format=%cI', config.introducedCommit]).stdout.trim();
    if (!Number.isFinite(new Date(introducedAt).getTime())) throw new Error('git retornou data inválida para o commit introdutor');
    const baselineTree = git(gitExe, ['-C', repoDir, 'rev-parse', `${config.parentCommit}^{tree}`]).stdout.trim();
    const candidateTree = git(gitExe, ['-C', repoDir, 'rev-parse', `${config.introducedCommit}^{tree}`]).stdout.trim();

    git(gitExe, ['-C', repoDir, 'worktree', 'add', '--detach', baselineDir, config.parentCommit]);
    git(gitExe, ['-C', repoDir, 'worktree', 'add', '--detach', candidateDir, config.introducedCommit]);
    const baseline = runCheck(config, baselineDir, { docker });
    const candidate = runCheck(config, candidateDir, { docker });
    if (baseline.result !== 'not_vulnerable' || candidate.result !== 'vulnerable') {
      throw new Error(`resultado não comprova regressão: baseline=${baseline.result}, candidate=${candidate.result}`);
    }
    return {
      ok: true,
      repositoryUrl: config.repositoryUrl,
      runtime: config.runtime,
      noveltyProof: {
        kind: 'verified_regression',
        introducedCommit: config.introducedCommit,
        parentCommit: config.parentCommit,
        introducedAt,
        baseline: {
          ref: config.parentCommit, result: baseline.result, command: config.command,
          observedOutcome: baseline.observedOutcome,
        },
        candidate: {
          ref: config.introducedCommit, result: candidate.result, command: config.command,
          observedOutcome: candidate.observedOutcome,
        },
        execution: {
          verifiedAt: new Date().toISOString(),
          containerImage: baseline.containerImage,
          containerImageId: baseline.containerImageId,
          isolation: baseline.isolation,
          validationScope: config.validationScope,
          baselineTree,
          candidateTree,
        },
      },
    };
  } finally {
    const resolved = path.resolve(tempRoot);
    const allowedRoot = path.resolve(workspaceRoot) + path.sep;
    if (resolved.startsWith(allowedRoot) && path.basename(resolved).startsWith('zto-regression-')) {
      rmSync(resolved, { recursive: true, force: true });
    }
  }
}

export function loadRegressionConfig(configPath) {
  if (!configPath) throw new Error('informe --config=<arquivo.json>');
  return JSON.parse(readFileSync(path.resolve(configPath), 'utf8'));
}

export function validateLongstandingExposureConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('config precisa ser um objeto JSON');
  }
  let repositoryUrl;
  try {
    const url = new URL(input.repositoryUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
      throw new Error('somente repositório público https://github.com é aceito');
    }
    const parts = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
    if (parts.length !== 2) throw new Error('repositoryUrl precisa ter formato https://github.com/owner/repo');
    repositoryUrl = `https://github.com/${parts[0]}/${parts[1]}.git`;
  } catch (error) {
    if (error.message.includes('somente') || error.message.includes('formato')) throw error;
    throw new Error(`repositoryUrl inválida: ${error.message}`);
  }
  const introducedCommit = String(input.introducedCommit || '').toLowerCase();
  if (!SHA_RE.test(introducedCommit)) {
    throw new Error('introducedCommit precisa ser um SHA completo de 40 caracteres');
  }
  return { repositoryUrl, introducedCommit };
}

/** Evidência informativa de idade para código que nunca foi seguro -- não
 * uma regressão recente (ver verifyRegression). Não tenta provar ausência
 * de report privado; confirma apenas fatos objetivos: o commit introdutor é
 * real, continua ancestral da branch padrão pública e tem determinada
 * idade. O gate anti-duplicate não aceita longa exposição como novidade:
 * código antigo teve mais tempo para ser descoberto e reportado, inclusive
 * de forma privada. */
export function verifyLongstandingExposure(input, {
  gitExe = 'git', workspaceRoot = tmpdir(), now = () => new Date(),
} = {}) {
  const config = validateLongstandingExposureConfig(input);
  const tempRoot = mkdtempSync(path.join(path.resolve(workspaceRoot), 'zto-longstanding-'));
  const repoDir = path.join(tempRoot, 'repo');
  try {
    git(gitExe, ['-c', 'core.hooksPath=NUL', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false',
      'clone', '--no-checkout', '--filter=blob:none', '--', config.repositoryUrl, repoDir]);
    git(gitExe, ['-C', repoDir, 'fetch', '--no-tags', '--depth=2', 'origin', config.introducedCommit]);
    try {
      git(gitExe, ['-C', repoDir, 'merge-base', '--is-ancestor', config.introducedCommit, 'origin/HEAD']);
    } catch {
      throw new Error('introducedCommit não está no histórico da branch padrão pública (origin/HEAD) -- pode ter sido revertido, não conta como exposição contínua');
    }
    const introducedAt = git(gitExe, ['-C', repoDir, 'show', '-s', '--format=%cI', config.introducedCommit]).stdout.trim();
    const introducedAtMs = new Date(introducedAt).getTime();
    if (!Number.isFinite(introducedAtMs)) throw new Error('git retornou data inválida para o commit introdutor');
    const nowMs = now().getTime();
    if (introducedAtMs > nowMs) throw new Error('commit introdutor tem data no futuro');
    const ageDays = Math.floor((nowMs - introducedAtMs) / 86400000);
    return {
      ok: true,
      repositoryUrl: config.repositoryUrl,
      longstandingExposureProof: {
        kind: 'verified_longstanding_exposure',
        repositoryUrl: config.repositoryUrl,
        introducedCommit: config.introducedCommit,
        introducedAt,
        ageDays,
        stillPresentOnDefaultBranch: true,
        verifiedAt: new Date(nowMs).toISOString(),
      },
    };
  } finally {
    const resolved = path.resolve(tempRoot);
    const allowedRoot = path.resolve(workspaceRoot) + path.sep;
    if (resolved.startsWith(allowedRoot) && path.basename(resolved).startsWith('zto-longstanding-')) {
      rmSync(resolved, { recursive: true, force: true });
    }
  }
}

export function loadLongstandingExposureConfig(configPath) {
  if (!configPath) throw new Error('informe --config=<arquivo.json>');
  return JSON.parse(readFileSync(path.resolve(configPath), 'utf8'));
}
