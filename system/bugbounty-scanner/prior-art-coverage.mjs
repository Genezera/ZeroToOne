/** Structural coverage check, not a signature or proof of search relevance.
 * The operator still reviews matches; private reports remain unknowable. */
export function priorArtCoverageGate(check, { repository = null } = {}) {
  const evidence = check?.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return { ok: false, reason: 'busca pública sem evidência de paginação; execute search-prior-art novamente' };
  }
  const queries = check.queries || (check.query ? [check.query] : []);
  if (!Array.isArray(queries) || queries.some((query) => typeof query !== 'string' || !query.trim())) {
    return { ok: false, reason: 'consultas de evidência inválidas' };
  }
  const expected = [
    ...queries.flatMap((query) => ['github_issues', 'github_commits'].map((source) => ({ source, query }))),
    { source: 'github_advisories' },
  ];
  let observedRepository = repository?.toLowerCase() || null;
  for (const target of expected) {
    const pages = evidence.filter((item) => item?.source === target.source && item.query === target.query);
    if (pages.length !== 1) return { ok: false, reason: `cobertura ausente ou ambígua de ${target.source}` };
    const item = pages[0];
    if (item.complete !== true || !Number.isInteger(item.pagesScanned) || item.pagesScanned < 1
        || !Number.isSafeInteger(item.totalCount) || item.totalCount < 0 || item.retrievedCount !== item.totalCount
        || !Array.isArray(item.apiUrls) || item.apiUrls.length !== item.pagesScanned
        || new Set(item.apiUrls).size !== item.apiUrls.length || item.apiUrl !== item.apiUrls[0]) {
      return { ok: false, reason: `cobertura incompleta ou inválida de ${target.source}` };
    }
    for (const rawUrl of item.apiUrls) {
      let url;
      try { url = new URL(rawUrl); } catch { return { ok: false, reason: 'URL de evidência inválida' }; }
      if (url.origin !== 'https://api.github.com' || url.username || url.password || url.hash) {
        return { ok: false, reason: 'URL de evidência fora da API oficial do GitHub' };
      }
      let repo;
      if (target.source === 'github_advisories') {
        repo = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/security-advisories$/)?.[1];
        if (url.searchParams.get('state') !== 'published') repo = null;
      } else {
        const endpoint = target.source === 'github_issues' ? 'issues' : 'commits';
        const q = url.searchParams.get('q');
        repo = q?.match(/^repo:([^\s]+) /)?.[1];
        if (url.pathname !== `/search/${endpoint}` || q !== `repo:${repo} ${target.query}`) repo = null;
      }
      if (!repo || (observedRepository && observedRepository !== repo.toLowerCase())) {
        return { ok: false, reason: 'evidência de busca não corresponde à consulta/repositório do finding' };
      }
      observedRepository = repo.toLowerCase();
    }
  }
  return { ok: true, repository: observedRepository, reason: 'cobertura paginada registrada para as consultas públicas' };
}
