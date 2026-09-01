// Integração com o Semgrep (r2c/Semgrep Inc., LGPL 2.1) -- analisador
// estático multi-linguagem gratuito, regras da comunidade (registro
// público, sem conta/API key pra rodar `--config p/...`). Instalado
// numa VENV PRÓPRIA em E: (`E:/dev-toolchains/venv-security`), nunca no
// Python global do sistema -- requisito explícito da missão de manter
// tudo em E:, mesmo cuidado já aplicado ao Go (ver README.md, seção
// "Toolchain Go inteiro estava indo pra C:").
//
// Recomendação direta da auditoria externa (seção 6.7): "Semgrep ou
// engine equivalente com regras locais versionadas". Runtime real
// testado: ~14s pra 1000 arquivos com 42 regras (`p/golang`) -- rápido
// o bastante pra rodar toda semana junto do Slither/OSV-Scanner.
//
// `p/security-audit` (ruleset amplo, cobre JS/TS/Go/Java/Python/etc.
// dentro do mesmo repositório, aplicando só a regra relevante por
// linguagem de arquivo) escolhido em vez de configs por linguagem
// separadas -- mais simples, e os 4 programas ativos hoje (JS/Go/JVM)
// cabem todos no mesmo ruleset sem precisar decidir de antemão qual
// linguagem cada repositório é.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isNonProductionPath } from './path-noise-filter.mjs';

const SEMGREP_BIN = 'E:/dev-toolchains/venv-security/Scripts/semgrep.exe';
const DEFAULT_CACHE_DIR = path.resolve('E:/', 'dev-toolchains', 'semgrep-cache');
const DEFAULT_RULESET = 'p/security-audit';

// INFO é majoritariamente estilo/convenção (mesmo padrão já visto no
// Slither/OSV-Scanner) -- WARNING+ERROR é o piso que reduz ruído sem
// esconder o que importa.
const SEVERITY_RANK = { ERROR: 3, WARNING: 2, INFO: 1 };
const DEFAULT_MIN_SEVERITY = 'WARNING';

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** Clona (ou atualiza) o repositório SEM inicializar submódulo -- mesmo
 * motivo do OSV-Scanner: evita ruído de dependência vendorizada de
 * terceiro. Cache próprio, nunca compartilhado com Slither/OSV-Scanner. */
export function prepareRepoForSemgrep(target, { cacheDir = DEFAULT_CACHE_DIR, log = () => {} } = {}) {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const repoDir = path.join(cacheDir, target.repo);
  const repoUrl = `https://github.com/${target.owner}/${target.repo}.git`;

  if (!existsSync(path.join(repoDir, '.git'))) {
    sh('git', ['clone', '--depth', '1', repoUrl, repoDir], cacheDir);
  } else {
    try {
      sh('git', ['fetch', 'origin'], repoDir);
      sh('git', ['reset', '--hard', 'origin/HEAD'], repoDir);
    } catch (err) {
      log(`AVISO: não consegui atualizar ${target.repo} (${err.message.split('\n')[0]}) -- usando cópia local existente`);
    }
  }
  return repoDir;
}

/** Pura -- não toca disco/rede. Filtra por severidade mínima e
 * normaliza pro shape de achado que o resto do pipeline usa. `repoDir`
 * (opcional) relativiza o caminho e troca `\` por `/` -- Semgrep no
 * Windows devolve caminho com separador nativo.
 *
 * Ignora path de teste/demo/fixture/mock (ver path-noise-filter.mjs) --
 * mesma causa raiz do bug real achado no OSV-Scanner contra
 * vercel/vercel (98% do achado bruto era `examples/`/`test/fixtures/`,
 * nunca alcançável por tráfego real); aplicado aqui também de saída,
 * não só depois de repetir o problema. */
export function parseSemgrepJson(json, { minSeverity = DEFAULT_MIN_SEVERITY, repoDir = null } = {}) {
  const minRank = SEVERITY_RANK[minSeverity] ?? SEVERITY_RANK[DEFAULT_MIN_SEVERITY];
  const findings = [];
  for (const r of json?.results || []) {
    const severity = r.extra?.severity || null;
    if ((SEVERITY_RANK[severity] ?? 0) < minRank) continue;
    let filePath = r.path || null;
    if (filePath && repoDir) {
      filePath = path.isAbsolute(filePath) ? path.relative(repoDir, filePath) : filePath;
    }
    if (filePath) filePath = filePath.split('\\').join('/');
    if (isNonProductionPath(filePath)) continue;
    findings.push({
      checkId: r.check_id,
      file: filePath,
      line: r.start?.line ?? null,
      severity,
      message: (r.extra?.message || '').replace(/\s+/g, ' ').trim(),
      cwe: r.extra?.metadata?.cwe || null,
    });
  }
  return findings;
}

/** Roda o Semgrep de verdade. Código de saída != 0 quando encontra
 * achado bloqueante é comportamento documentado (mesmo padrão já visto
 * no Slither/OSV-Scanner) -- só é falha de verdade se o JSON nunca foi
 * escrito. */
export function runSemgrepOnRepo(repoDir, { minSeverity = DEFAULT_MIN_SEVERITY, ruleset = DEFAULT_RULESET, outputFileName = 'semgrep-output.json', binPath = SEMGREP_BIN } = {}) {
  const outputPath = path.join(repoDir, outputFileName);
  try {
    execFileSync(binPath, ['--config', ruleset, '--json', '--output', outputPath, '--metrics', 'off', '.'], { cwd: repoDir, stdio: 'pipe', timeout: 300000 });
  } catch (err) {
    if (!existsSync(outputPath)) {
      return { ok: false, reason: `semgrep não gerou saída: ${err.message.split('\n').slice(0, 3).join(' | ')}` };
    }
  }
  let json;
  try {
    json = JSON.parse(readFileSync(outputPath, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `saída do semgrep não é JSON válido: ${err.message}` };
  }
  const findings = parseSemgrepJson(json, { minSeverity, repoDir });
  return { ok: true, findings, rawResultCount: (json?.results || []).length };
}

export function runSemgrepAgainstTarget(target, opts = {}) {
  const repoDir = prepareRepoForSemgrep(target, opts);
  return runSemgrepOnRepo(repoDir, opts);
}

// Mapeia detector conhecido pro vocabulário já usado pelas heurísticas
// próprias quando a classe é a mesma -- deixa o achado fluir pelos
// mesmos caminhos de dashboard/state-machine sem mudança nenhuma.
// Semgrep tem MUITO mais detector do que Slither -- sem tentar mapear
// tudo, só os mais comuns; o resto vira `semgrep_<check-id-curto>`.
function findingTypeForCheck(checkId) {
  const last = checkId.split('.').pop();
  const KNOWN = {
    'use-of-rc4': 'weak_crypto_risk',
    'unsafe-deserialization-interface': 'insecure_deserialization',
    'sql-injection': 'sql_injection_risk',
    'command-injection': 'command_injection_risk',
    'path-traversal': 'path_traversal_risk',
    'ssrf': 'ssrf_risk',
    'prototype-pollution': 'prototype_pollution_risk',
    'hardcoded-secret': 'hardcoded_secret_risk',
  };
  for (const [needle, type] of Object.entries(KNOWN)) {
    if (last.includes(needle) || checkId.includes(needle)) return type;
  }
  return `semgrep_${last.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
}

/** Mesma convenção de id de scan-runner.mjs::fingerprint e dos outros
 * runners de ferramenta externa (slither/osv-scanner) -- acha achado
 * real entra na MESMA fila/dedup/estado que qualquer outro. */
export function toQueueFindings(target, semgrepFindings) {
  const repoKey = `${target.owner}/${target.repo}`;
  return semgrepFindings.map((f) => {
    const file = f.file ? `${repoKey}/${f.file}` : repoKey;
    const fn = f.line ? `line:${f.line}` : 'unknown';
    const type = findingTypeForCheck(f.checkId);
    return {
      id: `${target.program}::${file}::${fn}::${type}`,
      program: target.program,
      platform: target.platform,
      file,
      function: fn,
      line: f.line,
      type,
      state: 'candidate',
      reasoning: `Semgrep (${f.checkId}, severidade ${f.severity}${f.cwe ? `, ${Array.isArray(f.cwe) ? f.cwe.join('/') : f.cwe}` : ''}): ${f.message}`.slice(0, 4000),
    };
  });
}
