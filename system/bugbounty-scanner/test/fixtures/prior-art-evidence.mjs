// Synthetic coverage metadata; only for gate tests, never production evidence.
export function publicSearchEvidence(queries, repository = 'acme/api') {
  const evidence = queries.flatMap((query) => ['issues', 'commits'].map((endpoint) => ({
    source: `github_${endpoint}`, query,
    apiUrl: `https://api.github.com/search/${endpoint}?${new URLSearchParams({ q: `repo:${repository} ${query}`, per_page: '100', page: '1' })}`,
  })));
  evidence.push({ source: 'github_advisories', apiUrl: `https://api.github.com/repos/${repository}/security-advisories?state=published&per_page=100` });
  return evidence.map((item) => ({ ...item, apiUrls: [item.apiUrl], complete: true, pagesScanned: 1, totalCount: 0, retrievedCount: 0 }));
}
