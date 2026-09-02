// Busca lista de arquivos e código-fonte real de repositórios GitHub
// públicos via API pública (token opcional via GITHUB_TOKEN -- ver
// github-auth.mjs -- sem ele, cai no limite anônimo de 60 req/hora).
// Genérico por linguagem — usado para todos os alvos JS/TS, Go,
// Kotlin/Java e Swift/ObjC deste projeto.

import { githubHeaders } from './github-auth.mjs';

const EXCLUDED_DIR = /(^|\/)(node_modules|dist|build|\.next|out|coverage|\.turbo|\.git|vendor|Pods|\.gradle|target)(\/|$)/;
const TEST_FILE_JS = /\.(test|spec)\.[jt]sx?$/;
const TEST_DIR = /(^|\/)(test|tests|__tests__|fixtures|testdata)(\/|$)/i;
const TEST_FILE_JVM = /(Test|Tests)\.(kt|java)$/;
const TEST_FILE_GO = /_test\.go$/;
const TEST_FILE_SWIFT = /(Tests?|Spec)\.(swift|m)$/;
const TEST_FILE_SOLIDITY = /\.t\.sol$/; // convenção Foundry: MeuContrato.t.sol

const SOURCE_EXT_JS = /\.(js|jsx|ts|tsx|mjs|cjs)$/;
const SOURCE_EXT_GO = /\.go$/;
const SOURCE_EXT_JVM = /\.(kt|kts|java)$/;
const SOURCE_EXT_SWIFT = /\.(swift|m|h)$/;
const SOURCE_EXT_SOLIDITY = /\.sol$/;

function isScannable(path, ext, testFile) {
  if (!ext.test(path)) return false;
  if (EXCLUDED_DIR.test(path)) return false;
  if (TEST_DIR.test(path)) return false;
  if (testFile.test(path)) return false;
  return true;
}

export function isScannableFile(path) {
  return isScannable(path, SOURCE_EXT_JS, TEST_FILE_JS);
}

export function isScannableGoFile(path) {
  return isScannable(path, SOURCE_EXT_GO, TEST_FILE_GO);
}

export function isScannableJvmFile(path) {
  return isScannable(path, SOURCE_EXT_JVM, TEST_FILE_JVM);
}

export function isScannableSwiftFile(path) {
  return isScannable(path, SOURCE_EXT_SWIFT, TEST_FILE_SWIFT);
}

export function isScannableSolidityFile(path) {
  return isScannable(path, SOURCE_EXT_SOLIDITY, TEST_FILE_SOLIDITY);
}

const DEPENDENCY_MANIFEST_NAMES = new Set(['package-lock.json', 'go.mod', 'build.gradle', 'build.gradle.kts']);

/** Manifesto de dependência com versão EXATA (nunca faixa/range) — só isso
 * dá pra bater contra CVE real sem chute. package.json sozinho (sem
 * lockfile) fica de fora de propósito: tem faixa de versão (^1.2.3), não
 * versão resolvida. */
export function isDependencyManifest(path) {
  const base = path.split('/').pop();
  if (!DEPENDENCY_MANIFEST_NAMES.has(base)) return false;
  if (EXCLUDED_DIR.test(path)) return false;
  if (TEST_DIR.test(path)) return false; // ex.: fixture de teste de plugin Gradle não é dependência real do produto
  return true;
}

/** Devolve o Set de paths tocados por commit nos últimos `sinceDays` dias
 * (default 90) em `branch`, ou `null` se não der pra determinar (repo sem
 * nenhum commit antes do corte -- comum em repo recém-criado -- ou erro de
 * rede, sempre melhor esforço). Fama do REPOSITÓRIO inteiro não diz nada
 * sobre um ARQUIVO específico: um PR mesclado mês passado teve muito menos
 * tempo de escrutínio externo que uma rotina estável de anos, mesmo dentro
 * do repo mais famoso que existe -- ver
 * research/bugbounty/vercel-open-source/NOTES.md, rodada 2026-09-02.
 *
 * Só 2 chamadas de API, custo constante independente do tamanho do repo
 * (a alternativa óbvia -- 1 chamada de "último commit" por arquivo --
 * escalaria com o número de arquivos, inviável pra repo grande sob o
 * limite anônimo de 60 req/hora):
 * 1. `GET .../commits?until=<corte>&per_page=1` acha o commit mais recente
 *    ANTES do corte -- essa é a "linha de base" pra comparar contra.
 * 2. `GET .../compare/{linhaDeBase}...{branch}` devolve `files[]` com todo
 *    path tocado entre os dois, num response só.
 *
 * Limitação real, confirmada ao vivo em 02/09/2026 contra vercel/next.js
 * (1297 commits em 90 dias): o array `files` da API de compare trunca em
 * 300 entradas sem paginação disponível pra esse endpoint especificamente
 * -- pra repo MUITO ativo, isso é só uma AMOSTRA do que mudou, não a lista
 * completa. Isso não inverte o sinal (um arquivo fora da amostra não vira
 * "comprovadamente antigo", só "sem dado" -- tratado como não-recente por
 * quem chama, o mesmo que já acontecia antes desta função existir), só
 * limita quantos arquivos recentes um repo hiperativo consegue sinalizar
 * de uma vez. */
export async function listRecentlyChangedFiles(owner, repo, branch, sinceDays = 90) {
  const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const boundaryRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&until=${sinceIso}&per_page=1`, { headers: githubHeaders() });
  if (!boundaryRes.ok) throw new Error(`HTTP ${boundaryRes.status} buscando commit-limite de ${owner}/${repo}`);
  const boundaryJson = await boundaryRes.json();
  if (!Array.isArray(boundaryJson) || boundaryJson.length === 0) return null;
  const boundarySha = boundaryJson[0].sha;

  const cmpRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/compare/${boundarySha}...${branch}`, { headers: githubHeaders() });
  if (!cmpRes.ok) throw new Error(`HTTP ${cmpRes.status} comparando ${boundarySha}...${branch} em ${owner}/${repo}`);
  const cmpJson = await cmpRes.json();
  return new Set((cmpJson.files || []).map((f) => f.filename));
}

export async function listRepoFiles(owner, repo, branch, pathPrefixes) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status} listando árvore de ${owner}/${repo}@${branch}`);
  const json = await res.json();
  if (!Array.isArray(json.tree)) throw new Error(`Resposta sem tree para ${owner}/${repo}: ${JSON.stringify(json).slice(0, 200)}`);
  let files = json.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha }));
  if (Array.isArray(pathPrefixes) && pathPrefixes.length > 0) {
    files = files.filter((f) => pathPrefixes.some((p) => f.path.startsWith(p)));
  }
  return files;
}

/** Ordena a lista de arquivo pra priorizar quem NUNCA foi escaneado antes
 * -- sem isso, um teto fixo de arquivo por rodada (MAX_FILES_PER_TARGET em
 * scan-runner.mjs) sempre pega os mesmos primeiros N na ordem da git tree
 * (que é estável entre chamadas, confirmado ao vivo), pra sempre. Mesmo
 * bug, mesmo formato, do já corrigido em discover-targets.mjs::
 * prioritizeCandidates -- descoberto em 31/08/2026 quando
 * okx/go-wallet-sdk (1001 arquivos Go escaneáveis) revelou que 551 nunca
 * eram lidos, 435 deles (79%) em caminho com nome de moeda/wallet/signing
 * (Stellar, Tezos, TON inteiros, nunca vistos). `seenPaths` é um Set de
 * paths já vistos ANTES desta rodada (de repoShas[repoKey], que já
 * existe por outro motivo -- cache de SHA pra não rebuscar o que não
 * mudou).
 *
 * `recentlyChanged` (opcional, default `null` -- comportamento idêntico a
 * antes desta mudança quando omitido) é o Set devolvido por
 * `listRecentlyChangedFiles`: dentro do grupo "nunca visto", arquivo
 * tocado recentemente vem primeiro. Ver o comentário de
 * `listRecentlyChangedFiles` acima pro raciocínio completo -- resumo:
 * fama do repo inteiro não diz nada sobre um arquivo específico.
 *
 * Pura -- não sabe de onde `seenPaths`/`recentlyChanged` vieram. */
export function prioritizeFilesForScan(files, seenPaths = new Set(), recentlyChanged = null) {
  const neverSeen = [];
  const alreadySeen = [];
  for (const f of files) {
    (seenPaths.has(f.path) ? alreadySeen : neverSeen).push(f);
  }
  if (!recentlyChanged) return [...neverSeen, ...alreadySeen];

  const recent = [];
  const stable = [];
  for (const f of neverSeen) {
    (recentlyChanged.has(f.path) ? recent : stable).push(f);
  }
  return [...recent, ...stable, ...alreadySeen];
}

export async function fetchRawFile(owner, repo, branch, filePath) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status} buscando ${owner}/${repo}/${filePath}`);
  return res.text();
}
