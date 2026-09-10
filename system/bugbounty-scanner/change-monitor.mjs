import { githubFetch } from './github-auth.mjs';
import { getBlockReason } from './program-policy.mjs';

export const CHANGE_MONITOR_SCHEMA_VERSION = 1;

function repoKey(target) {
  return `${target.owner}/${target.repo}`.toLowerCase();
}

/** Build one policy-safe repository list from all language target lists. */
export function collectMonitoredRepositories(targetLists, programPolicy) {
  const byRepo = new Map();
  for (const target of Object.values(targetLists || {}).flat()) {
    if (!target?.owner || !target?.repo) continue;
    const programNames = Array.isArray(target.programs)
      ? target.programs.map((entry) => typeof entry === 'string' ? entry : entry?.program).filter(Boolean)
      : [target.program].filter(Boolean);
    // Fail closed for malformed/no-program entries and shared repositories:
    // every associated program must still be allowed by today's policy.
    if (programNames.length === 0 || programNames.some((program) => getBlockReason(program, programPolicy))) continue;
    const key = repoKey(target);
    const current = byRepo.get(key);
    if (!current) {
      byRepo.set(key, {
        owner: target.owner, repo: target.repo, branch: target.branch || null,
        programs: [...new Set(programNames)].sort(), languages: [target.language].filter(Boolean),
      });
      continue;
    }
    for (const program of programNames) if (!current.programs.includes(program)) current.programs.push(program);
    current.programs.sort();
    if (target.language && !current.languages.includes(target.language)) current.languages.push(target.language);
  }
  return [...byRepo.values()].sort((a, b) => repoKey(a).localeCompare(repoKey(b)));
}

async function githubJson(url, { fetchImpl }) {
  const response = await githubFetch(url, { fetchImpl });
  if (!response.ok) throw new Error(`GitHub ${response.status} em ${url}`);
  return response.json();
}

function validateRepositoryPath(rawPath, source) {
  const filePath = String(rawPath || '').replaceAll('\\', '/');
  if (!filePath || filePath.startsWith('/') || filePath.split('/').includes('..') || /[\u0000\r\n]/.test(filePath)) {
    throw new Error(`${source} devolveu caminho inválido`);
  }
  return filePath;
}

/** GitHub's compare response exposes at most 300 files. For larger deltas,
 * compare the two complete recursive Git trees instead. This remains
 * fail-closed: a truncated tree is never treated as an exact diff. */
async function fetchRepositoryTreeIndex(target, commitSha, { fetchImpl }) {
  const base = `https://api.github.com/repos/${target.owner}/${target.repo}`;
  const commit = await githubJson(`${base}/git/commits/${commitSha}`, { fetchImpl });
  const treeSha = String(commit?.tree?.sha || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(treeSha)) throw new Error('GitHub commit não devolveu tree SHA válido');
  const tree = await githubJson(`${base}/git/trees/${treeSha}?recursive=1`, { fetchImpl });
  if (tree?.truncated === true) throw new Error('GitHub tree recursiva foi truncada; diff completo não comprovado');
  if (!Array.isArray(tree?.tree)) throw new Error('GitHub tree não devolveu lista de entradas');
  const index = new Map();
  for (const entry of tree.tree) {
    if (entry?.type !== 'blob') continue;
    const filePath = validateRepositoryPath(entry.path, 'GitHub tree');
    const sha = String(entry.sha || '').toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('GitHub tree devolveu blob SHA inválido');
    index.set(filePath, sha);
  }
  return index;
}

async function fetchChangedFilesFromTrees(target, baseSha, headSha, { fetchImpl }) {
  const [baseTree, headTree] = await Promise.all([
    fetchRepositoryTreeIndex(target, baseSha, { fetchImpl }),
    fetchRepositoryTreeIndex(target, headSha, { fetchImpl }),
  ]);
  const changedFiles = [];
  const removedFiles = [];
  for (const [filePath, sha] of headTree) {
    if (baseTree.get(filePath) !== sha) changedFiles.push(filePath);
  }
  for (const filePath of baseTree.keys()) {
    if (!headTree.has(filePath)) removedFiles.push(filePath);
  }
  return { changedFiles: changedFiles.sort(), removedFiles: removedFiles.sort() };
}

export async function fetchRepositoryHead(target, { fetchImpl = fetch } = {}) {
  const base = `https://api.github.com/repos/${target.owner}/${target.repo}`;
  let branch = target.branch;
  if (!branch) {
    const repo = await githubJson(base, { fetchImpl });
    branch = repo.default_branch;
  }
  if (!branch) throw new Error(`${target.owner}/${target.repo} não informou branch e a API não devolveu default_branch`);
  const commit = await githubJson(`${base}/commits/${encodeURIComponent(branch)}`, { fetchImpl });
  const sha = String(commit.sha || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${target.owner}/${target.repo} devolveu SHA inválido`);
  return {
    sha,
    branch,
    parentSha: /^[0-9a-f]{40}$/i.test(commit.parents?.[0]?.sha || '')
      ? commit.parents[0].sha.toLowerCase() : null,
    committedAt: commit.commit?.committer?.date || commit.commit?.author?.date || null,
    url: commit.html_url || null,
    title: String(commit.commit?.message || '').split(/\r?\n/)[0].slice(0, 300),
  };
}

/** Resolve the actual paths changed between the last observed head and the
 * new head. A repository-level head change is not evidence that every
 * uncached file changed. GitHub caps compare.files at 300, so larger deltas
 * fall back to an exact recursive-tree comparison. */
export async function fetchRepositoryChangedFiles(target, baseSha, headSha, { fetchImpl = fetch } = {}) {
  if (!/^[0-9a-f]{40}$/i.test(baseSha || '') || !/^[0-9a-f]{40}$/i.test(headSha || '')) {
    throw new Error('compare exige baseSha e headSha completos');
  }
  const url = `https://api.github.com/repos/${target.owner}/${target.repo}/compare/${baseSha}...${headSha}`;
  const comparison = await githubJson(url, { fetchImpl });
  if (!Array.isArray(comparison.files)) throw new Error('GitHub compare não devolveu lista de arquivos');
  if (comparison.files.length >= 300) {
    const treeDiff = await fetchChangedFilesFromTrees(target, baseSha, headSha, { fetchImpl });
    return { ...treeDiff, compareUrl: comparison.html_url || null };
  }
  const changedFiles = [];
  const removedFiles = [];
  for (const file of comparison.files) {
    const filename = validateRepositoryPath(file?.filename, 'GitHub compare');
    if (file.status === 'removed') removedFiles.push(filename);
    else changedFiles.push(filename);
  }
  return {
    changedFiles: [...new Set(changedFiles)].sort(),
    removedFiles: [...new Set(removedFiles)].sort(),
    compareUrl: comparison.html_url || null,
  };
}

/** Poll only metadata. A changed head is not called a vulnerability; it is a
 * time-sensitive signal that tells the normal scanner to inspect the delta. */
export async function pollRepositoryChanges(repositories, previousState = {}, {
  fetchHead = fetchRepositoryHead,
  fetchChangedFiles = fetchRepositoryChangedFiles,
  now = () => new Date(),
  concurrency = 4,
} = {}) {
  const observedAt = now().toISOString();
  const priorRepos = previousState.repos || {};
  const nextRepos = {};
  const changes = [];
  const failures = [];
  let cursor = 0;

  async function worker() {
    while (cursor < repositories.length) {
      const target = repositories[cursor++];
      const key = repoKey(target);
      try {
        const head = await fetchHead(target);
        const previous = priorRepos[key] || null;
        nextRepos[key] = previous?.sha === head.sha
          ? { ...previous, programs: target.programs, languages: target.languages }
          : { ...head, observedAt, programs: target.programs, languages: target.languages };
        if (previous?.sha && previous.sha !== head.sha) {
          const diff = await fetchChangedFiles(target, previous.sha, head.sha);
          changes.push({
            repository: key,
            programs: target.programs,
            languages: target.languages,
            previousSha: previous.sha,
            introducedCommit: head.sha,
            parentCommit: head.parentSha,
            introducedAt: head.committedAt,
            branch: head.branch,
            commitUrl: head.url,
            title: head.title,
            changedFiles: diff.changedFiles,
            removedFiles: diff.removedFiles,
            compareUrl: diff.compareUrl,
            directSingleCommit: head.parentSha === previous.sha,
            detectedAt: observedAt,
          });
        }
      } catch (error) {
        failures.push({ repository: key, reason: error.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, repositories.length || 1)) }, () => worker()));
  const currentKeys = new Set(repositories.map(repoKey));
  const addedRepositories = repositories.map(repoKey).filter((key) => !priorRepos[key]).sort();
  const removedRepositories = Object.keys(priorRepos).filter((key) => !currentKeys.has(key)).sort();
  const orderedNextRepos = Object.fromEntries(Object.entries(nextRepos).sort(([a], [b]) => a.localeCompare(b)));
  const orderedPriorRepos = Object.fromEntries(Object.entries(priorRepos).sort(([a], [b]) => a.localeCompare(b)));
  const stateChanged = JSON.stringify(orderedNextRepos) !== JSON.stringify(orderedPriorRepos);
  return {
    ok: failures.length === 0,
    baseline: Object.keys(priorRepos).length === 0,
    checked: repositories.length,
    changes: changes.sort((a, b) => a.repository.localeCompare(b.repository)),
    addedRepositories,
    removedRepositories,
    stateChanged,
    failures,
    nextState: {
      schemaVersion: CHANGE_MONITOR_SCHEMA_VERSION,
      checkedAt: stateChanged ? observedAt : (previousState.checkedAt || observedAt),
      repos: orderedNextRepos,
    },
  };
}
