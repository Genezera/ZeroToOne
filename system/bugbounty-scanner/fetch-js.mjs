// Busca lista de arquivos e código-fonte real de repositórios GitHub
// públicos via API pública (sem conta, sem token — só limitada pelo rate
// limit anônimo do GitHub). Usado para repos JS/TS de programas de bug
// bounty hospedados na HackerOne (ex.: Vercel Open Source).

const EXCLUDED_DIR = /(^|\/)(node_modules|dist|build|\.next|out|coverage|\.turbo|\.git)(\/|$)/;
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
const TEST_DIR = /(^|\/)(test|tests|__tests__|fixtures)(\/|$)/;
const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs)$/;

export function isScannableFile(path) {
  if (!SOURCE_EXT.test(path)) return false;
  if (EXCLUDED_DIR.test(path)) return false;
  if (TEST_FILE.test(path)) return false;
  if (TEST_DIR.test(path)) return false;
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
