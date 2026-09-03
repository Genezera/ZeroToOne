// Integração com o Slither (Trail of Bits) -- analisador estático
// Solidity/Vyper maduro, gratuito, 100% local (pip install slither-analyzer,
// já presente neste ambiente). Recomendação direta da auditoria externa
// (seção 6.7): "não reimplementar sozinho tudo o que ferramentas maduras
// já fazem" -- as 4 heurísticas próprias em heuristics-solidity.mjs
// continuam existindo (são rápidas, zero dependência, cobrem os casos
// mais óbvios), mas Slither roda ~100 detectores reais contra o projeto
// COMPILADO de verdade (não regex em texto), incluindo classes que este
// projeto nunca teve capacidade de detectar sozinho.
//
// Fricção real encontrada construindo isto (documentada, não escondida):
// 1. Windows MAX_PATH: um clone raso com submódulo Foundry aninhado
//    profundo (`evm-xreserve-contracts` -> `evm-gateway-contracts` ->
//    `openzeppelin-contracts-upgradeable` -> `openzeppelin-contracts` ->
//    `erc4626-tests`) estoura o limite de 260 caracteres mesmo num
//    caminho-base curto (E:\dev-toolchains\...) -- `core.longpaths=true`
//    (config LOCAL do git, não config global, não é mudança de sistema)
//    ajuda mas não resolve todo caso; alguns repositórios com árvore de
//    submódulo excepcionalmente funda continuam fora do alcance sem
//    mudança de registro do Windows (fora do escopo -- exigiria admin).
// 2. Submódulo com URL SSH (`git@github.com:...`) falha em clone anônimo
//    sem chave configurada -- reescrito pra HTTPS diretamente no
//    `.gitmodules` antes do `submodule update` (truque padrão de CI,
//    nunca precisa de config global de git pra isso).
// 3. Slither SEMPRE sai com código de saída != 0 quando encontra
//    qualquer achado (mesmo só Informational) -- não é falha da
//    ferramenta, é o sinal esperado. Só tratado como falha de verdade
//    se o JSON de saída nunca foi escrito.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = path.resolve('E:/', 'dev-toolchains', 'slither-cache');

// Slither classifica por impacto (High/Medium/Low/Informational) --
// Informational sozinho é ~86% do volume real observado (109 de 127
// contra circlefin/evm-cctp-contracts) e é majoritariamente estilo/
// convenção (nomeação, dígitos demais em literal), não segurança.
// Medium é o piso padrão -- mesma filosofia de "menos ruído, não mais
// falso-positivo" já aplicada em quarantine.mjs.
const IMPACT_RANK = { High: 3, Medium: 2, Low: 1, Informational: 0 };
const DEFAULT_MIN_IMPACT = 'Medium';

// Mapeia pro vocabulário de `type` já usado pelas heurísticas próprias
// quando a classe é semanticamente a mesma (deixa o achado fluir pelos
// mesmos caminhos de dashboard/state-machine sem mudança nenhuma).
// Detector sem equivalente direto vira `slither_<check>` -- prefixo
// deixa a proveniência (ferramenta madura de terceiro, não regex
// caseira) rastreável só olhando o id.
const CHECK_TYPE_MAPPING = {
  'reentrancy-eth': 'reentrancy_risk',
  'reentrancy-no-eth': 'reentrancy_risk',
  'reentrancy-benign': 'reentrancy_risk',
  'reentrancy-events': 'reentrancy_risk',
  'reentrancy-unlimited-gas': 'reentrancy_risk',
  'unchecked-transfer': 'unchecked_call_return',
  'unused-return': 'unchecked_call_return',
  'tx-origin': 'tx_origin_auth_risk',
  'controlled-delegatecall': 'delegatecall_risk',
};

export function findingTypeForCheck(checkId) {
  return CHECK_TYPE_MAPPING[checkId] || `slither_${checkId.replace(/-/g, '_')}`;
}

/** Pura -- não toca disco/rede. Filtra por impacto mínimo e normaliza
 * pro shape de achado que o resto do pipeline (upsertFinding) espera. */
export function parseSlitherJson(json, { minImpact = DEFAULT_MIN_IMPACT } = {}) {
  const minRank = IMPACT_RANK[minImpact] ?? IMPACT_RANK[DEFAULT_MIN_IMPACT];
  const detectors = json?.results?.detectors || [];
  return detectors
    .filter((d) => (IMPACT_RANK[d.impact] ?? 0) >= minRank)
    .map((d) => {
      const primary = d.elements?.[0];
      const sourceMapping = primary?.source_mapping;
      return {
        check: d.check,
        type: findingTypeForCheck(d.check),
        impact: d.impact,
        confidence: d.confidence,
        description: (d.description || '').trim(),
        file: sourceMapping?.filename_relative || null,
        line: Array.isArray(sourceMapping?.lines) && sourceMapping.lines.length > 0 ? sourceMapping.lines[0] : null,
        function: primary?.name || null,
      };
    });
}

function sh(cmd, args, cwd, { shell = false } = {}) {
  return execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8', shell });
}

/** Clona (ou atualiza) o repositório, corrige submódulo SSH->HTTPS
 * quando existir, inicializa submódulo com longpaths, `npm install`
 * best-effort (alguns repositórios têm package.json quebrado -- não
 * derruba a análise, Slither ainda funciona nas partes só-Foundry). */
export function prepareRepoForSlither(target, { cacheDir = DEFAULT_CACHE_DIR, log = () => {} } = {}) {
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

  const gitmodulesPath = path.join(repoDir, '.gitmodules');
  if (existsSync(gitmodulesPath)) {
    const content = readFileSync(gitmodulesPath, 'utf8');
    const fixed = content.replace(/git@github\.com:/g, 'https://github.com/');
    if (fixed !== content) writeFileSync(gitmodulesPath, fixed, 'utf8');
    try {
      sh('git', ['submodule', 'sync'], repoDir);
      sh('git', ['-c', 'core.longpaths=true', 'submodule', 'update', '--init', '--recursive'], repoDir);
    } catch (err) {
      log(`AVISO: submódulo de ${target.repo} não inicializou por completo (${err.message.split('\n')[0]}) -- Slither roda mesmo assim no que conseguir resolver`);
    }
  }

  if (existsSync(path.join(repoDir, 'package.json'))) {
    try {
      // No Windows `npm` é um .cmd, não um .exe -- execFileSync sem
      // shell (o padrão, correto pra `git`/`py`, binários de verdade)
      // dá ENOENT; `npm.cmd` direto dá EINVAL (bug conhecido do Node
      // no Windows com alvo .cmd via execFileSync). `shell:true` é a
      // única combinação que realmente funciona neste ambiente,
      // confirmado rodando contra evm-cctp-contracts. Seguro aqui
      // apesar do aviso de depreciação do Node sobre args não
      // escapados: o único argumento é a string literal 'install',
      // nunca dado externo/variável.
      sh('npm', ['install'], repoDir, { shell: true });
    } catch (err) {
      log(`AVISO: npm install falhou em ${target.repo} (${err.message.split('\n')[0]}) -- Slither roda mesmo assim, pode perder contrato que depende disso`);
    }
  }

  return repoDir;
}

/** Roda Slither de verdade contra um repositório já preparado. Nunca
 * trata saída != 0 como falha por si só -- Slither sempre sai != 0
 * quando encontra QUALQUER achado (até Informational); só é falha de
 * verdade se o JSON nunca foi escrito. */
export function runSlitherOnRepo(repoDir, { minImpact = DEFAULT_MIN_IMPACT, outputFileName = 'slither-output.json' } = {}) {
  const outputPath = path.join(repoDir, outputFileName);
  try {
    execFileSync('py', ['-m', 'slither', '.', '--json', outputPath], { cwd: repoDir, stdio: 'pipe' });
  } catch (err) {
    if (!existsSync(outputPath)) {
      const diagnostic = [err.message, err.stderr, err.stdout]
        .filter(Boolean)
        .join('\n')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, 60)
        .join(' | ');
      return { ok: false, reason: `slither não gerou saída (provável falha de compilação): ${diagnostic}` };
    }
  }
  let json;
  try {
    json = JSON.parse(readFileSync(outputPath, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `saída do slither não é JSON válido: ${err.message}` };
  }
  const findings = parseSlitherJson(json, { minImpact });
  return { ok: true, findings, rawResultCount: json?.results?.detectors?.length ?? 0 };
}

/** Ponta a ponta: prepara o repositório + roda Slither. Separado em
 * duas funções pra permitir testar o parser (`parseSlitherJson`) sem
 * precisar de rede/clone/toolchain de verdade. */
export function runSlitherAgainstTarget(target, opts = {}) {
  const repoDir = prepareRepoForSlither(target, opts);
  return runSlitherOnRepo(repoDir, opts);
}

/** Converte achado do Slither pro mesmo formato de finding que o resto
 * do pipeline usa (mesma convenção de id de `scan-runner.mjs::fingerprint`:
 * `${program}::${file}::${function}::${type}`, `file` com prefixo
 * `owner/repo/`, `function` cai pra `line:N` quando Slither não dá nome).
 * Determinístico -- mesmo achado real gera o mesmo id em toda rodada,
 * então upsertFinding naturalmente evita duplicar sem precisar de cache
 * de "seen" separado. */
export function toQueueFindings(target, slitherFindings) {
  const repoKey = `${target.owner}/${target.repo}`;
  return slitherFindings.map((f) => {
    const file = f.file ? `${repoKey}/${f.file}` : repoKey;
    const fn = f.function || (f.line ? `line:${f.line}` : 'unknown');
    return {
      id: `${target.program}::${file}::${fn}::${f.type}`,
      program: target.program,
      platform: target.platform,
      file,
      function: fn,
      line: f.line,
      type: f.type,
      language: 'solidity',
      state: 'candidate',
      reasoning: `Slither (check=${f.check}, impact=${f.impact}, confidence=${f.confidence}): ${f.description}`.slice(0, 4000),
    };
  });
}
