// Cross-referência de dependência conhecida vulnerável, via OSV.dev (API
// pública, sem conta/token). Diferente das heurísticas de texto (que
// ADIVINHAM candidato a partir de padrão de código), isso bate contra CVE
// REAL e CONFIRMADO — maior confiança por construção.
//
// Só analisa manifesto com versão EXATA/resolvida (nunca faixa de semver):
// package-lock.json (npm), go.mod (Go — o próprio formato já fixa versão),
// build.gradle/.kts (Maven, só o padrão literal "grupo:artefato:versão",
// sem tentar resolver catálogo/variável — falso-negativo é aceitável aqui,
// falso-positivo por versão errada não é).
//
// Swift/CocoaPods FICA DE FORA — confirmado ao vivo contra a API do
// OSV.dev nesta sessão que "CocoaPods"/"SwiftPM" não são ecossistemas
// suportados (erro "invalid ecosystem"). Não é escolha, é limitação real
// da fonte de dado — documentado, não escondido.

import { listRepoFiles, fetchRawFile, isDependencyManifest } from './fetch-repo.mjs';
import { filterFilesToChangedPaths } from './delta-file-selection.mjs';

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns/';
const ECOSYSTEM_TO_LANGUAGE = { npm: 'js', Go: 'go', Maven: 'jvm' };

export function parsePackageLockJson(content) {
  let json;
  try {
    json = JSON.parse(content);
  } catch {
    return [];
  }
  const deps = [];
  if (json.packages && typeof json.packages === 'object') {
    // lockfile v2/v3: chave é o caminho ("", "node_modules/foo", "node_modules/@scope/foo")
    for (const [pkgPath, info] of Object.entries(json.packages)) {
      if (!pkgPath || !info?.version) continue; // "" é o próprio pacote raiz
      const name = pkgPath.replace(/^(.*\/)?node_modules\//, '');
      deps.push({ name, version: info.version, ecosystem: 'npm' });
    }
  } else if (json.dependencies && typeof json.dependencies === 'object') {
    // lockfile v1 (árvore aninhada) — só o nível top, mantém simples
    for (const [name, info] of Object.entries(json.dependencies)) {
      if (info?.version) deps.push({ name, version: info.version, ecosystem: 'npm' });
    }
  }
  return deps;
}

export function parseGoMod(content) {
  const deps = [];
  let inBlock = false;
  const blockLineRe = /^([a-zA-Z0-9._\-/]+)\s+(v[0-9][^\s]*)/;
  const singleLineRe = /^require\s+([a-zA-Z0-9._\-/]+)\s+(v[0-9][^\s]*)/;
  for (const raw of content.split('\n')) {
    const line = raw.split('//')[0].trim(); // remove comentário (ex.: // indirect)
    if (!line) continue;
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }
    if (inBlock) {
      const m = line.match(blockLineRe);
      if (m) deps.push({ name: m[1], version: m[2], ecosystem: 'Go' });
      continue;
    }
    const single = line.match(singleLineRe);
    if (single) deps.push({ name: single[1], version: single[2], ecosystem: 'Go' });
  }
  return deps;
}

export function parseGradleDeps(content) {
  const deps = [];
  const regex = /["']([a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+):([0-9][a-zA-Z0-9._+-]*)["']/g;
  let m;
  while ((m = regex.exec(content))) {
    deps.push({ name: m[1], version: m[2], ecosystem: 'Maven' });
  }
  return deps;
}

export function parseManifest(filePath, content) {
  const base = filePath.split('/').pop();
  if (base === 'package-lock.json') return parsePackageLockJson(content);
  if (base === 'go.mod') return parseGoMod(content);
  if (base === 'build.gradle' || base === 'build.gradle.kts') return parseGradleDeps(content);
  return [];
}

export async function queryOsvBatch(deps) {
  if (deps.length === 0) return [];
  const body = { queries: deps.map((d) => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version })) };
  const res = await fetch(OSV_BATCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status} consultando OSV.dev (batch)`);
  const json = await res.json();
  return json.results || [];
}

export async function fetchVulnDetail(id) {
  const res = await fetch(OSV_VULN_URL + id);
  if (!res.ok) throw new Error(`HTTP ${res.status} buscando detalhe de ${id}`);
  return res.json();
}

/** Molda o achado no MESMO formato usado pelo resto do pipeline
 * (heuristics-*.mjs) — cai na mesma fila/fingerprint/dedup/ledger, não é
 * um pipeline paralelo. */
export function buildDependencyFinding(dep, vulnDetail, filePath, extraVulnCount = 0) {
  const extra = extraVulnCount > 0 ? ` (+ ${extraVulnCount} outra(s) vulnerabilidade(s) na mesma dependência)` : '';
  return {
    type: 'known_vulnerable_dependency',
    file: filePath,
    function: `${dep.name}@${dep.version}`,
    severity: 'a_investigar',
    note: `Dependência ${dep.name}@${dep.version} (${dep.ecosystem}) tem vulnerabilidade PUBLICADA e CONHECIDA: ${vulnDetail.id} — ${vulnDetail.summary || 'sem resumo disponível'}.${extra}`,
    osvId: vulnDetail.id,
    language: ECOSYSTEM_TO_LANGUAGE[dep.ecosystem] || 'unknown',
  };
}

/** Varre manifestos de dependência dos alvos de UMA linguagem, consulta o
 * OSV.dev em lote, e retorna achados prontos pra entrar na fila. Reusa o
 * MESMO dict repoShas que o scan de código-fonte já usa — sem cache novo,
 * chave é o caminho do arquivo (manifesto e código-fonte nunca colidem). */
export async function runDependencyScan(targets, repoShas, {
  changedFilesByRepo = null, immutableRefsByRepo = null,
} = {}) {
  let filesChecked = 0;
  let fetchErrors = 0;
  const findings = [];

  for (const target of targets) {
    const repoKey = `${target.owner}/${target.repo}`;
    const scanRef = immutableRefsByRepo?.get(repoKey.toLowerCase()) || target.branch;
    let files;
    try {
      // Propositalmente SEM target.pathPrefixes: manifesto de dependência
      // quase sempre mora na raiz de cada módulo, não dentro das pastas
      // restritas escolhidas pra escanear código-fonte (ex.: "packages/"
      // no vercel/flags) — reusar o mesmo prefixo estreito perderia quase
      // todo manifesto real. O filtro por nome de arquivo logo abaixo já
      // mantém isso barato (só busca conteúdo do que bate no nome).
      files = await listRepoFiles(target.owner, target.repo, scanRef);
    } catch (err) {
      fetchErrors++;
      continue;
    }
    files = files.filter((f) => isDependencyManifest(f.path));

    if (changedFilesByRepo) {
      const changedPaths = changedFilesByRepo.get(repoKey.toLowerCase()) || new Set();
      files = filterFilesToChangedPaths(files, changedPaths);
    }
    repoShas[repoKey] = repoShas[repoKey] || {};

    const depsWithSource = [];
    for (const file of files) {
      if (repoShas[repoKey][file.path] === file.sha) continue; // sem mudança
      let source;
      try {
        source = await fetchRawFile(target.owner, target.repo, scanRef, file.path);
      } catch (err) {
        fetchErrors++;
        continue;
      }
      filesChecked++;
      repoShas[repoKey][file.path] = file.sha;
      const deps = parseManifest(file.path, source);
      for (const dep of deps) depsWithSource.push({ dep, filePath: `${repoKey}/${file.path}` });
    }

    if (depsWithSource.length === 0) continue;

    let results;
    try {
      results = await queryOsvBatch(depsWithSource.map((x) => x.dep));
    } catch (err) {
      fetchErrors++;
      continue;
    }

    for (let i = 0; i < results.length; i++) {
      const hits = results[i]?.vulns || [];
      if (hits.length === 0) continue;
      const { dep, filePath } = depsWithSource[i];
      let detail;
      try {
        detail = await fetchVulnDetail(hits[0].id);
      } catch (err) {
        fetchErrors++;
        detail = { id: hits[0].id, summary: null };
      }
      const finding = buildDependencyFinding(dep, detail, filePath, hits.length - 1);
      findings.push({ ...finding, program: target.program, platform: target.platform, maxBountyUsd: target.maxBountyUsd });
    }
  }

  return { filesChecked, fetchErrors, findings };
}
