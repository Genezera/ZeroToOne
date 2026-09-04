import { readFileSync } from 'node:fs';
import path from 'node:path';
import { githubHeaders } from './github-auth.mjs';
import { getHacktivityPage } from './h1-api.mjs';

const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function validatePriorArtConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('config precisa ser objeto JSON');
  const repository = String(input.repository || '').replace(/^https:\/\/github\.com\//i, '').replace(/\.git\/?$/i, '').replace(/\/$/, '');
  if (!REPOSITORY_RE.test(repository)) throw new Error('repository precisa ter formato owner/repo do GitHub');
  const queries = [...new Set((input.queries || []).map((query) => String(query).trim()).filter(Boolean))];
  if (queries.length < 3) throw new Error('informe pelo menos 3 queries distintas');
  if (queries.some((query) => query.length > 180 || /[\u0000\r\n]/.test(query))) {
    throw new Error('cada query precisa ter no máximo 180 caracteres e uma linha');
  }
  const programHandle = input.programHandle ? String(input.programHandle).trim().toLowerCase() : null;
  if (programHandle && !/^[a-z0-9_-]+$/.test(programHandle)) {
    throw new Error('programHandle contém caracteres inválidos');
  }
  return { repository, queries, ...(programHandle ? { programHandle } : {}) };
}

async function githubJson(url, { fetchImpl }) {
  const response = await fetchImpl(url, {
    headers: githubHeaders({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  });
  if (!response.ok) {
    const remaining = response.headers?.get?.('x-ratelimit-remaining');
    throw new Error(`GitHub API HTTP ${response.status}${remaining === '0' ? ' (rate limit esgotado)' : ''}`);
  }
  return response.json();
}

function searchUrl(endpoint, repository, query) {
  const params = new URLSearchParams({ q: `repo:${repository} ${query}`, per_page: '10' });
  return `https://api.github.com/search/${endpoint}?${params}`;
}

function normalizedTerms(value) {
  const stop = new Set(['the', 'and', 'with', 'from', 'para', 'com', 'sem', 'uma', 'por']);
  return [...new Set(String(value).toLowerCase().match(/[a-z0-9_.$-]{3,}/g) || [])]
    .filter((term) => !stop.has(term));
}

export function advisoryMatchesQueries(advisory, queries) {
  const haystack = [advisory.summary, advisory.description, ...(advisory.cwe_ids || [])].filter(Boolean).join(' ').toLowerCase();
  return queries.some((query) => {
    const phrase = query.toLowerCase();
    if (haystack.includes(phrase)) return true;
    const terms = normalizedTerms(query);
    if (terms.length < 2) return false;
    const overlap = terms.filter((term) => haystack.includes(term)).length;
    return overlap >= Math.max(2, Math.ceil(terms.length * 0.6));
  });
}

function textMatchesQueries(value, queries) {
  const haystack = String(value || '').toLowerCase();
  return queries.some((query) => {
    const phrase = query.toLowerCase();
    if (haystack.includes(phrase)) return true;
    const terms = normalizedTerms(query);
    if (terms.length < 2) return false;
    return terms.filter((term) => haystack.includes(term)).length >= Math.max(2, Math.ceil(terms.length * 0.6));
  });
}

/** Pesquisa uma janela recente do feed público global. `complete=false` é
 * evidência insuficiente e jamais vira método aprovado no gate: significa
 * que o teto de páginas foi atingido antes do limite temporal. Reports
 * privados continuam invisíveis mesmo quando `complete=true`. */
export async function searchRecentHacktivity({
  programHandle, queries, since,
}, {
  getPage = getHacktivityPage, now = () => new Date(), maxPages = 50, pageSize = 50,
} = {}) {
  if (!programHandle) throw new Error('programHandle é obrigatório para pesquisar Hacktivity');
  const sinceMs = new Date(since || (now().getTime() - 7 * 86400000)).getTime();
  if (!Number.isFinite(sinceMs)) throw new Error('since precisa ser timestamp válido');
  const matches = new Map();
  let scanned = 0;
  let pagesScanned = 0;
  let reachedBoundary = false;
  let oldestActivityAt = null;
  for (let page = 1; page <= maxPages; page++) {
    const items = await getPage(page, pageSize);
    pagesScanned += 1;
    scanned += items.length;
    if (items.length === 0) {
      reachedBoundary = true;
      break;
    }
    for (const item of items) {
      const activityMs = new Date(item.latestActivityAt || item.submittedAt).getTime();
      if (Number.isFinite(activityMs) && (!oldestActivityAt || activityMs < new Date(oldestActivityAt).getTime())) {
        oldestActivityAt = new Date(activityMs).toISOString();
      }
      if (Number.isFinite(activityMs) && activityMs < sinceMs) reachedBoundary = true;
      if (String(item.programHandle || '').toLowerCase() !== programHandle.toLowerCase()) continue;
      const searchable = [item.title, item.vulnerabilityInformation, item.cwe, ...(item.cveIds || [])].filter(Boolean).join(' ');
      if (!textMatchesQueries(searchable, queries)) continue;
      matches.set(item.id, {
        source: 'hacktivity', candidate: true, disposition: 'unreviewed',
        reportId: item.id, title: item.title, url: item.url,
        programHandle: item.programHandle, submittedAt: item.submittedAt,
        latestActivityAt: item.latestActivityAt,
      });
    }
    if (reachedBoundary || items.length < pageSize) break;
  }
  return {
    complete: reachedBoundary,
    since: new Date(sinceMs).toISOString(),
    pagesScanned, scanned, oldestActivityAt,
    results: [...matches.values()],
  };
}

/** Busca pública rastreável. Qualquer hit fica `unreviewed` e bloqueia o
 * gate até uma pessoa classificá-lo como `ruled_out`; ausência de hit
 * continua sendo private_unknown, nunca prova exclusividade. */
export async function searchPublicPriorArt(input, {
  fetchImpl = fetch, now = () => new Date(), hacktivitySearch = searchRecentHacktivity,
} = {}) {
  const { repository, queries, programHandle } = validatePriorArtConfig(input);
  const issueResults = [];
  const commitResults = [];
  const evidence = [];
  for (const query of queries) {
    const issuesUrl = searchUrl('issues', repository, query);
    const commitsUrl = searchUrl('commits', repository, query);
    const [issues, commits] = await Promise.all([
      githubJson(issuesUrl, { fetchImpl }),
      githubJson(commitsUrl, { fetchImpl }),
    ]);
    evidence.push({ source: 'github_issues', query, apiUrl: issuesUrl, totalCount: issues.total_count || 0 });
    evidence.push({ source: 'github_commits', query, apiUrl: commitsUrl, totalCount: commits.total_count || 0 });
    for (const item of issues.items || []) {
      issueResults.push({
        source: 'github_issues', query, candidate: true, disposition: 'unreviewed',
        kind: item.pull_request ? 'pull_request' : 'issue', number: item.number,
        title: item.title, state: item.state, url: item.html_url,
      });
    }
    for (const item of commits.items || []) {
      commitResults.push({
        source: 'github_commits', query, candidate: true, disposition: 'unreviewed',
        sha: item.sha, title: String(item.commit?.message || '').split(/\r?\n/)[0], url: item.html_url,
      });
    }
  }

  const advisoriesUrl = `https://api.github.com/repos/${repository}/security-advisories?state=published&per_page=100`;
  const advisories = await githubJson(advisoriesUrl, { fetchImpl });
  evidence.push({ source: 'github_advisories', apiUrl: advisoriesUrl, totalCount: advisories.length });
  const advisoryResults = advisories.filter((item) => advisoryMatchesQueries(item, queries)).map((item) => ({
    source: 'github_advisories', candidate: true, disposition: 'unreviewed',
    ghsaId: item.ghsa_id, cveId: item.cve_id || null, title: item.summary,
    state: item.state, url: item.html_url,
  }));
  let hacktivity = null;
  if (programHandle) {
    hacktivity = await hacktivitySearch({ programHandle, queries, since: input.since }, { now });
    evidence.push({
      source: 'hacktivity', programHandle, since: hacktivity.since,
      pagesScanned: hacktivity.pagesScanned, scanned: hacktivity.scanned,
      oldestActivityAt: hacktivity.oldestActivityAt, complete: hacktivity.complete,
    });
  }
  const results = [...issueResults, ...commitResults, ...advisoryResults, ...(hacktivity?.results || [])];
  const ts = now().toISOString();
  const methods = ['github_issues', 'github_commits', 'github_advisories'];
  if (hacktivity?.complete) methods.push('hacktivity');
  return {
    ok: true,
    repository,
    checkedAt: ts,
    candidateCount: results.length,
    requiresHumanReview: results.length > 0,
    manualSourcesStillRequired: hacktivity?.complete ? [] : ['hacktivity_or_independent_web_search'],
    duplicateCheckDraft: {
      methods,
      queries,
      evidence,
      results,
      foundExisting: results.length > 0,
      noveltyStatus: 'private_unknown',
      ts,
    },
  };
}

export function loadPriorArtConfig(configPath) {
  if (!configPath) throw new Error('informe --config=<arquivo.json>');
  return JSON.parse(readFileSync(path.resolve(configPath), 'utf8'));
}
