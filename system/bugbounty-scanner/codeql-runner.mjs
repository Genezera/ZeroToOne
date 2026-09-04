import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { isNonProductionPath } from './path-noise-filter.mjs';

const DEFAULT_CODEQL = 'E:\\dev-toolchains\\codeql-2.26.4\\codeql\\codeql.exe';
const DEFAULT_CACHE_DIR = 'E:\\dev-toolchains\\codeql-cache';
const DEFAULT_SUITE = 'codeql/javascript-queries:codeql-suites/javascript-security-extended.qls';

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

export function parseCodeqlSarif(sarif, { repoDir = null, minSecuritySeverity = 7 } = {}) {
  const findings = [];
  for (const run of sarif?.runs || []) {
    const rules = new Map((run.tool?.driver?.rules || []).map((rule) => [rule.id, rule]));
    for (const result of run.results || []) {
      const rule = rules.get(result.ruleId) || {};
      const properties = { ...(rule.properties || {}), ...(result.properties || {}) };
      const securitySeverity = Number(properties['security-severity']);
      if (!Number.isFinite(securitySeverity) || securitySeverity < minSecuritySeverity) continue;
      const physical = result.locations?.[0]?.physicalLocation;
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
  suite = DEFAULT_SUITE, minSecuritySeverity = 7,
} = {}) {
  const safeName = path.basename(repoDir).replace(/[^a-z0-9_.-]/gi, '_');
  const databaseDir = path.join(cacheDir, 'databases', safeName);
  const outputDir = path.join(cacheDir, 'results');
  const outputPath = path.join(outputDir, `${safeName}.sarif`);
  mkdirSync(path.dirname(databaseDir), { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  if (existsSync(databaseDir)) rmSync(databaseDir, { recursive: true, force: true });
  try {
    command(codeql, ['database', 'create', databaseDir, '--language=javascript', `--source-root=${repoDir}`, '--overwrite', '--threads=0'], { cwd: repoDir });
    command(codeql, ['database', 'analyze', databaseDir, suite, '--format=sarif-latest', `--output=${outputPath}`, '--threads=0', '--rerun'], { cwd: repoDir });
  } catch (error) {
    return { ok: false, reason: error.message.split('\n').slice(0, 4).join(' | ') };
  }
  if (!existsSync(outputPath)) return { ok: false, reason: 'CodeQL não gerou SARIF' };
  const sarif = JSON.parse(readFileSync(outputPath, 'utf8'));
  return {
    ok: true,
    findings: parseCodeqlSarif(sarif, { repoDir, minSecuritySeverity }),
    rawResultCount: (sarif.runs || []).reduce((sum, run) => sum + (run.results || []).length, 0),
  };
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
      line: finding.line, language: 'js', type, state: 'candidate',
      reasoning: `CodeQL (${finding.ruleId}, security-severity ${finding.securitySeverity}${finding.precision ? `, precision ${finding.precision}` : ''}${finding.cwe ? `, ${finding.cwe}` : ''}): ${finding.message}`.slice(0, 4000),
    };
  });
}
