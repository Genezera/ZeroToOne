import { githubHeaders } from './github-auth.mjs';
import { filterBannedTargets } from './program-policy.mjs';

export const CHANGE_MONITOR_SCHEMA_VERSION = 1;

function repoKey(target) {
  return `${target.owner}/${target.repo}`.toLowerCase();
}

/** Build one policy-safe repository list from all language target lists. */
export function collectMonitoredRepositories(targetLists, programPolicy) {
  const allowed = filterBannedTargets(Object.values(targetLists || {}).flat(), programPolicy);
  const byRepo = new Map();
  for (const target of allowed) {
    if (!target?.owner || !target?.repo) continue;
    const key = repoKey(target);
    const current = byRepo.get(key);
    if (!current) {
      byRepo.set(key, {
        owner: target.owner, repo: target.repo, branch: target.branch || null,
        programs: [target.program], languages: [target.language].filter(Boolean),
      });
      continue;
    }
    if (target.program && !current.programs.includes(target.program)) current.programs.push(target.program);
    if (target.language && !current.languages.includes(target.language)) current.languages.push(target.language);
  }
  return [...byRepo.values()].sort((a, b) => repoKey(a).localeCompare(repoKey(b)));
}

async function githubJson(url, { fetchImpl }) {
  const response = await fetchImpl(url, { headers: githubHeaders() });
  if (!response.ok) throw new Error(`GitHub ${response.status} em ${url}`);
  return response.json();
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

/** Poll only metadata. A changed head is not called a vulnerability; it is a
 * time-sensitive signal that tells the normal scanner to inspect the delta. */
export async function pollRepositoryChanges(repositories, previousState = {}, {
  fetchHead = fetchRepositoryHead,
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
