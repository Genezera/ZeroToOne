import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { isNonProductionPath } from './path-noise-filter.mjs';

const DEFAULT_CODEQL = 'E:\\dev-toolchains\\codeql-2.26.4\\codeql\\codeql.exe';
const DEFAULT_CACHE_DIR = 'E:\\dev-toolchains\\codeql-cache';
const DEFAULT_SUITE = 'codeql/javascript-queries:codeql-suites/javascript-security-extended.qls';
const LANGUAGE_PROFILES = Object.freeze({
  javascript: { codeqlLanguage: 'javascript', suite: DEFAULT_SUITE, buildMode: null, requiresBuild: false },
  java: { codeqlLanguage: 'java-kotlin', suite: 'codeql/java-queries:codeql-suites/java-security-extended.qls', buildMode: 'none', requiresBuild: false },
  go: { codeqlLanguage: 'go', suite: 'codeql/go-queries:codeql-suites/go-security-extended.qls', buildMode: null, requiresBuild: true },
});

function command(bin, args, { cwd, timeout = 30 * 60 * 1000 } = {}) {
  return execFileSync(bin, args, {
    cwd, encoding: 'utf8', stdio: 'pipe', timeout, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

export function findCodeqlExecutable({ env = process.env, exists = existsSync } = {}) {
  const candidates = [env.CODEQL_EXE, DEFAULT_CODEQL, 'codeql'].filter(Boolean);
  return candidates.find((candidate) => candidate === 'codeql' || exists(candidate)) || 'codeql';
}

export function parseCodeqlSarif(sarif, { repoDir = null, minSecuritySeverity = 7, changedFiles = null } = {}) {
  const changed = changedFiles ? new Set([...changedFiles].map((file) => String(file).replaceAll('\\', '/'))) : null;
  const findings = [];
  for (const run of sarif?.runs || []) {
    const rules = new Map((run.tool?.driver?.rules || []).map((rule) => [rule.id, rule]));
    for (const result of run.results || []) {
      const rule = rules.get(result.ruleId) || {};
      const properties = { ...(rule.properties || {}), ...(result.properties || {}) };
      const securitySeverity = Number(properties['security-severity']);
      if (!Number.isFinite(securitySeverity) || securitySeverity < minSecuritySeverity) continue;
      const normalizedLocations = (result.locations || []).map((location) => {
        const physicalLocation = location.physicalLocation;
        let uri = physicalLocation?.artifactLocation?.uri || null;
        if (uri) {
          try { uri = decodeURIComponent(uri.replace(/^file:\/\//, '')); } catch { /* keep original */ }
          if (repoDir && path.isAbsolute(uri)) uri = path.relative(repoDir, uri);
          uri = uri.replaceAll('\\', '/').replace(/^\.\//, '');
        }
        return { physicalLocation, uri };
      });
      if (changed && !normalizedLocations.some((location) => changed.has(location.uri))) continue;
      const physical = normalizedLocations[0]?.physicalLocation;
      let file = physical?.artifactLocation?.uri || null;
      if (file) {
        try { file = decodeURIComponent(file.replace(/^file:\/\//, '')); } catch { /* mantém URI original */ }
        if (repoDir && path.isAbsolute(file)) file = path.relative(repoDir, file);
        file = file.replaceAll('\\', '/').replace(/^\.\//, '');
      }
      if (isNonProductionPath(file)) continue;
      const tags = properties.tags || [];
      const cwe = tags.find((tag) => /^external\/cwe\/cwe-/i.test(tag))?.split('/').at(-1)?.toUpperCase() || null;
      findings.push({
        ruleId: result.ruleId,
        file,
        line: physical?.region?.startLine ?? null,
        message: result.message?.text || rule.shortDescription?.text || 'CodeQL finding',
        securitySeverity,
        precision: properties.precision || null,
        cwe,
      });
    }
  }
  return findings;
}

export function prepareRepoForCodeql(target, { cacheDir = DEFAULT_CACHE_DIR, log = () => {} } = {}) {
  const sourcesDir = path.join(cacheDir, 'sources');
  mkdirSync(sourcesDir, { recursive: true });
  const repoDir = path.join(sourcesDir, `${target.owner}__${target.repo}`);
  const repoUrl = `https://github.com/${target.owner}/${target.repo}.git`;
  if (!existsSync(path.join(repoDir, '.git'))) {
    command('git', ['clone', '--depth', '1', '--no-recurse-submodules', repoUrl, repoDir], { cwd: sourcesDir });
  } else {
    command('git', ['fetch', '--depth', '1', 'origin', target.branch || 'HEAD'], { cwd: repoDir });
    command('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: repoDir });
    command('git', ['clean', '-ffd'], { cwd: repoDir });
  }
  const headSha = command('git', ['rev-parse', 'HEAD'], { cwd: repoDir }).trim();
  log(`CodeQL preparou ${target.owner}/${target.repo}@${headSha.slice(0, 12)} sem submódulos.`);
  return { repoDir, headSha };
}

/** JavaScript extraction is buildless: third-party package scripts are never run. */
export function runCodeqlOnRepo(repoDir, {
  codeql = findCodeqlExecutable(), cacheDir = DEFAULT_CACHE_DIR,
  suite = null, language = 'javascript', minSecuritySeverity = 7,
  changedFiles = null, allowTargetBuild = false, buildCommand = null,
} = {}) {
  const profile = LANGUAGE_PROFILES[language];
  if (!profile) return { ok: false, reason: `CodeQL language profile not supported: ${language}` };
  if (profile.requiresBuild && (!allowTargetBuild || !buildCommand)) {
    return { ok: false, reason: `${language} requires an explicitly approved isolated build recipe` };
  }
  const safeName = path.basename(repoDir).replace(/[^a-z0-9_.-]/gi, '_');
  const runsDir = path.join(cacheDir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  // A fixed database path made two concurrent test/manual runs delete each
  // other's live CodeQL database on Windows. Each analysis is disposable,
  // so isolate it in a unique run directory and clean it best-effort.
  const runDir = mkdtempSync(path.join(runsDir, `${safeName}-`));
  const databaseDir = path.join(runDir, 'database');
  const outputPath = path.join(runDir, 'result.sarif');
  let outcome;
  try {
    const createArgs = ['database', 'create', databaseDir, `--language=${profile.codeqlLanguage}`,
      `--source-root=${repoDir}`, '--overwrite', '--threads=0'];
    if (profile.buildMode) createArgs.push(`--build-mode=${profile.buildMode}`);
    if (profile.requiresBuild) createArgs.push(`--command=${buildCommand}`);
    command(codeql, createArgs, { cwd: repoDir });
    command(codeql, ['database', 'analyze', databaseDir, suite || profile.suite,
      '--format=sarif-latest', `--output=${outputPath}`, '--threads=0', '--rerun'], { cwd: repoDir });
    if (!existsSync(outputPath)) {
      outcome = { ok: false, reason: 'CodeQL não gerou SARIF' };
    } else {
      const sarif = JSON.parse(readFileSync(outputPath, 'utf8'));
      outcome = {
        ok: true,
        findings: parseCodeqlSarif(sarif, { repoDir, minSecuritySeverity, changedFiles }),
        rawResultCount: (sarif.runs || []).reduce((sum, run) => sum + (run.results || []).length, 0),
      };
    }
  } catch (error) {
    outcome = { ok: false, reason: error.message.split('\n').slice(0, 4).join(' | ') };
  } finally {
    try { rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch { /* diretório único evita colisão; limpeza residual é best-effort */ }
  }
  return outcome;
}

export function runCodeqlAgainstTarget(target, opts = {}) {
  const prepared = prepareRepoForCodeql(target, opts);
  return { ...runCodeqlOnRepo(prepared.repoDir, opts), headSha: prepared.headSha };
}

export function toQueueFindings(target, codeqlFindings) {
  const repoKey = `${target.owner}/${target.repo}`;
  return codeqlFindings.map((finding) => {
    const file = finding.file ? `${repoKey}/${finding.file}` : repoKey;
    const fn = finding.line ? `line:${finding.line}` : 'unknown';
    const suffix = finding.ruleId.split('/').at(-1).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const type = `codeql_${suffix}`;
    return {
      id: `${target.program}::${file}::${fn}::${type}`,
      program: target.program, platform: target.platform, file, function: fn,
      line: finding.line, language: target.language || 'js', type, state: 'candidate',
      reasoning: `CodeQL (${finding.ruleId}, security-severity ${finding.securitySeverity}${finding.precision ? `, precision ${finding.precision}` : ''}${finding.cwe ? `, ${finding.cwe}` : ''}): ${finding.message}`.slice(0, 4000),
    };
  });
}
