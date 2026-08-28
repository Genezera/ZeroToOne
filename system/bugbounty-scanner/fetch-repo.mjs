// Busca lista de arquivos e código-fonte real de repositórios GitHub
// públicos via API pública (sem conta, sem token — só limitada pelo rate
// limit anônimo do GitHub). Genérico por linguagem — usado para todos os
// alvos JS/TS, Go, Kotlin/Java e Swift/ObjC deste projeto.

const EXCLUDED_DIR = /(^|\/)(node_modules|dist|build|\.next|out|coverage|\.turbo|\.git|vendor|Pods|\.gradle|target)(\/|$)/;
const TEST_FILE_JS = /\.(test|spec)\.[jt]sx?$/;
const TEST_DIR = /(^|\/)(test|tests|__tests__|fixtures|testdata)(\/|$)/i;
const TEST_FILE_JVM = /(Test|Tests)\.(kt|java)$/;
const TEST_FILE_GO = /_test\.go$/;
const TEST_FILE_SWIFT = /(Tests?|Spec)\.(swift|m)$/;

const SOURCE_EXT_JS = /\.(js|jsx|ts|tsx|mjs|cjs)$/;
const SOURCE_EXT_GO = /\.go$/;
const SOURCE_EXT_JVM = /\.(kt|kts|java)$/;
const SOURCE_EXT_SWIFT = /\.(swift|m|h)$/;

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

const DEPENDENCY_MANIFEST_NAMES = new Set(['package-lock.json', 'go.mod', 'build.gradle', 'build.gradle.kts']);

/** Manifesto de dependência com versão EXATA (nunca faixa/range) — só isso
 * dá pra bater contra CVE real sem chute. package.json sozinho (sem
 * lockfile) fica de fora de propósito: tem faixa de versão (^1.2.3), não
 * versão resolvida. */
export function isDependencyManifest(path) {
  const base = path.split('/').pop();
  if (!DEPENDENCY_MANIFEST_NAMES.has(base)) return false;
  if (EXCLUDED_DIR.test(path)) return false;
  return true;
}

export async function listRepoFiles(owner, repo, branch, pathPrefixes) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZeroToOne-bugbounty-scanner' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} listando árvore de ${owner}/${repo}@${branch}`);
  const json = await res.json();
  if (!Array.isArray(json.tree)) throw new Error(`Resposta sem tree para ${owner}/${repo}: ${JSON.stringify(json).slice(0, 200)}`);
  let files = json.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha }));
  if (Array.isArray(pathPrefixes) && pathPrefixes.length > 0) {
    files = files.filter((f) => pathPrefixes.some((p) => f.path.startsWith(p)));
  }
  return files;
}

export async function fetchRawFile(owner, repo, branch, filePath) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} buscando ${owner}/${repo}/${filePath}`);
  return res.text();
}
