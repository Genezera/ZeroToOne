// Integração com o OSV-Scanner (Google, Apache-2.0) -- binário gratuito,
// mantido por terceiro, roda 100% local (`go install`, sem conta/token).
// Recomendação direta da auditoria externa (seção 6.7): "não
// reimplementar sozinho tudo o que ferramentas maduras já fazem".
//
// Diferença real em relação a `dep-scanner.mjs` (que continua existindo,
// os dois se complementam): dep-scanner.mjs faz parsing caseiro de só 3
// formatos (package-lock.json/go.mod/build.gradle) via regex/JSON.parse
// manual, e consulta a API do OSV.dev arquivo por arquivo. OSV-Scanner
// reconhece MUITO mais formato (yarn.lock, requirements.txt, Cargo.lock,
// pom.xml, etc.), usa o matcher de versão mantido pelo próprio Google, e
// já resolve o bug real que `okg/NOTES.md` documentou nesta missão
// (parseGoMod descartava "// indirect", perdendo o sinal de dependência
// direta vs. transitiva).
//
// Instalado via `go install .../osv-scanner@latest` com GOPATH/GOBIN/
// GOMODCACHE/GOCACHE redirecionados pra E: (`go env -w` + `setx GOPATH`)
// -- nunca em C:, requisito explícito da missão. Binário referenciado
// pelo caminho completo abaixo, nunca via PATH (setx só afeta processo
// NOVO; esta sessão não reinicia o shell no meio do caminho).
//
// Decisão real de escopo, não escolha arbitrária: roda contra alvos
// JS/Go/JVM (mesmo escopo de dep-scanner.mjs), NUNCA contra os alvos
// Solidity. Testado ao vivo contra `evm-cctp-contracts`: um clone com
// submódulo Foundry inicializado (necessário pro Slither compilar)
// também expõe o `yarn.lock`/`package-lock.json` de CADA submódulo
// vendorizado (ex.: `lib/centre-tokens.git`, uma dependência de
// dependência) -- centenas de "vulnerabilidade" em dependência de DEV/
// TESTE de um submódulo de terceiro, nunca alcançável pelo contrato em
// si. Por isso o clone pra OSV-Scanner usa cache PRÓPRIO, separado do
// cache do Slither, e nunca inicializa submódulo.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const OSV_SCANNER_BIN = 'E:/dev-toolchains/go/bin/osv-scanner.exe';
const DEFAULT_CACHE_DIR = path.resolve('E:/', 'dev-toolchains', 'osv-scanner-cache');

// max_severity vem como string CVSS-like ("9.8", "" quando a OSV não
// tem score numérico pra essa vulnerabilidade). 7.0+ = High/Critical,
// mesmo piso conceitual do "Medium+" do Slither -- reduz ruído sem
// esconder o que realmente importa.
const DEFAULT_MIN_SEVERITY = 7.0;

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** Clona (ou atualiza) o repositório SEM inicializar submódulo de
 * propósito -- ver nota do módulo sobre ruído de dependência vendorizada
 * de terceiro. Cache próprio, nunca compartilhado com o do Slither. */
export function prepareRepoForOsvScanner(target, { cacheDir = DEFAULT_CACHE_DIR, log = () => {} } = {}) {
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

function severityOf(pkg) {
  const raw = pkg.groups?.[0]?.max_severity;
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Pura (não toca rede) -- só toca `path` pra relativizar contra
 * `repoDir` quando informado. Filtra por severidade mínima (CVSS-like,
 * "" ou ausente conta como 0 -- nunca promove por omissão) e normaliza
 * pro shape de achado que o resto do pipeline usa, um por PACOTE
 * vulnerável (não um por vulnerabilidade individual -- um pacote com
 * várias CVEs vira um achado só, citando todas).
 *
 * `repoDir`: `result.source.path` do OSV-Scanner vem ABSOLUTO
 * (`E:/dev-toolchains/osv-scanner-cache/<repo>/go.mod`) -- sem
 * relativizar, o id do achado vaza o caminho local desta máquina pro
 * banco/queue.jsonl COMPARTILHADO (git), e nunca bate com o id que
 * dep-scanner.mjs já usa pro mesmo pacote (quebra a proteção contra
 * reabrir achado já resolvido). Achado real, pego rodando isto pela
 * primeira vez contra okx/go-wallet-sdk. */
export function parseOsvScannerJson(json, { minSeverity = DEFAULT_MIN_SEVERITY, repoDir = null } = {}) {
  const findings = [];
  for (const result of json?.results || []) {
    let filePath = result.source?.path || null;
    if (filePath && repoDir) {
      filePath = path.relative(repoDir, filePath).split(path.sep).join('/');
    }
    for (const pkg of result.packages || []) {
      const severity = severityOf(pkg);
      if ((severity ?? 0) < minSeverity) continue;
      const vulnIds = (pkg.vulnerabilities || []).map((v) => v.id);
      const firstVuln = pkg.vulnerabilities?.[0];
      findings.push({
        name: pkg.package?.name,
        version: pkg.package?.version,
        ecosystem: pkg.package?.ecosystem,
        file: filePath,
        severity,
        vulnIds,
        vulnCount: vulnIds.length,
        summary: firstVuln?.summary || firstVuln?.details?.split('\n')[0] || null,
      });
    }
  }
  return findings;
}

/** Roda o OSV-Scanner de verdade. Código de saída != 0 quando encontra
 * QUALQUER vulnerabilidade é o comportamento documentado da ferramenta
 * (mesmo padrão já visto no Slither) -- só é falha de verdade se o JSON
 * de saída nunca foi escrito. */
export function runOsvScannerOnRepo(repoDir, { minSeverity = DEFAULT_MIN_SEVERITY, outputFileName = 'osv-output.json', binPath = OSV_SCANNER_BIN } = {}) {
  const outputPath = path.join(repoDir, outputFileName);
  try {
    execFileSync(binPath, ['scan', 'source', '-r', '.', '--format', 'json', '--output-file', outputPath], { cwd: repoDir, stdio: 'pipe' });
  } catch (err) {
    if (!existsSync(outputPath)) {
      return { ok: false, reason: `osv-scanner não gerou saída: ${err.message.split('\n').slice(0, 3).join(' | ')}` };
    }
  }
  let json;
  try {
    json = JSON.parse(readFileSync(outputPath, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `saída do osv-scanner não é JSON válido: ${err.message}` };
  }
  const findings = parseOsvScannerJson(json, { minSeverity, repoDir });
  const rawPackageCount = (json?.results || []).reduce((sum, r) => sum + (r.packages?.length || 0), 0);
  return { ok: true, findings, rawPackageCount };
}

export function runOsvScannerAgainstTarget(target, opts = {}) {
  const repoDir = prepareRepoForOsvScanner(target, opts);
  return runOsvScannerOnRepo(repoDir, opts);
}

/** Mesma convenção de id de scan-runner.mjs::fingerprint e de
 * slither-runner.mjs::toQueueFindings -- acha achado real de dependência
 * vulnerável entra na MESMA fila/dedup/estado que qualquer outro.
 *
 * Achado real testando contra okx/go-wallet-sdk: pra ecosystem "Go", o
 * OSV-Scanner devolve a versão SEM o prefixo "v" (`1.1.2`), mas
 * `dep-scanner.mjs::parseGoMod` (regex sobre o texto cru do go.mod, que
 * tem o "v" literal) sempre preserva `v1.1.2` -- sem normalizar aqui,
 * os dois scanners geram ids DIFERENTES pro MESMO pacote, e a proteção
 * "não reabrir achado já resolvido" (ver discovery-runner.mjs) nunca
 * encontra o achado antigo pra comparar. */
export function toQueueFindings(target, osvFindings) {
  const repoKey = `${target.owner}/${target.repo}`;
  return osvFindings.map((f) => {
    const file = f.file ? `${repoKey}/${f.file}` : repoKey;
    const version = f.ecosystem === 'Go' && !f.version.startsWith('v') ? `v${f.version}` : f.version;
    const fn = `${f.name}@${version}`;
    const language = { npm: 'js', Go: 'go', Maven: 'jvm' }[f.ecosystem] || 'unknown';
    const extra = f.vulnCount > 1 ? ` (+ ${f.vulnCount - 1} outra(s) vulnerabilidade(s) na mesma dependência)` : '';
    return {
      id: `${target.program}::${file}::${fn}::known_vulnerable_dependency`,
      program: target.program,
      platform: target.platform,
      file,
      function: fn,
      type: 'known_vulnerable_dependency',
      language,
      state: 'candidate',
      reasoning: `OSV-Scanner: ${fn} (${f.ecosystem}) tem vulnerabilidade PUBLICADA (${f.vulnIds.join(', ')}, severidade ${f.severity ?? '?'}): ${f.summary || 'sem resumo disponível'}.${extra} Presença no manifesto NÃO confirma alcançabilidade -- precisa confirmar se o código vulnerável é de fato importado/chamado antes de qualquer veredito (mesma lição já documentada em research/bugbounty/okg/NOTES.md).`.slice(0, 4000),
    };
  });
}
