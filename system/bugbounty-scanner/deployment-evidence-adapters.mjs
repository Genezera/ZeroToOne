function exactSha(value) { return /^[0-9a-f]{40}$/i.test(String(value || '')); }

async function json(fetchFn, url, init = {}) {
  const response = await fetchFn(url, { ...init, headers: { Accept: 'application/json', ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function githubHeaders(token) {
  return token ? { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' } : {};
}

async function peelGitHubTag(fetchFn, repository, tag, token) {
  const encoded = encodeURIComponent(tag);
  const ref = await json(fetchFn, `https://api.github.com/repos/${repository}/git/ref/tags/${encoded}`, { headers: githubHeaders(token) });
  let object = ref.object;
  for (let i = 0; i < 3 && object?.type === 'tag'; i++) {
    object = (await json(fetchFn, `https://api.github.com/repos/${repository}/git/tags/${object.sha}`, { headers: githubHeaders(token) })).object;
  }
  return object?.type === 'commit' ? String(object.sha).toLowerCase() : null;
}

function escapeGoModule(value) {
  return [...String(value)].map((char) => /[A-Z]/.test(char) ? `!${char.toLowerCase()}` : char).join('');
}

export async function verifyDeploymentRecipe(recipe, finding, { fetchFn = fetch, githubToken = process.env.GITHUB_TOKEN } = {}) {
  const change = finding?.changeContext || finding?.raw?.changeContext;
  const commit = String(change?.introducedCommit || recipe?.commit || '').toLowerCase();
  const repository = finding.repository || finding.asset;
  if (!exactSha(commit)) return { ok: false, reason: 'exact introduced commit is required' };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) return { ok: false, reason: 'GitHub owner/repo is required' };

  if (recipe?.kind === 'github_release') {
    if (!recipe.tag) return { ok: false, reason: 'github_release requires tag' };
    const release = await json(fetchFn, `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(recipe.tag)}`, { headers: githubHeaders(githubToken) });
    const tagCommit = await peelGitHubTag(fetchFn, repository, recipe.tag, githubToken);
    if (tagCommit !== commit) return { ok: false, reason: `release tag resolves to ${tagCommit || 'no commit'}, not ${commit}` };
    return { ok: true, confidence: 'high', repo: repository, commit,
      branchOrTag: recipe.tag, packageOrContract: recipe.packageOrContract || release.name || recipe.tag,
      notes: `GitHub release ${release.html_url || recipe.tag} resolves exactly to the observed commit.` };
  }

  if (recipe?.kind === 'npm_registry') {
    if (!recipe.package || !recipe.version) return { ok: false, reason: 'npm_registry requires package and version' };
    const metadata = await json(fetchFn, `https://registry.npmjs.org/${encodeURIComponent(recipe.package)}/${encodeURIComponent(recipe.version)}`);
    const gitHead = String(metadata.gitHead || '').toLowerCase();
    if (gitHead !== commit) return { ok: false, reason: `npm gitHead is ${gitHead || 'missing'}, not ${commit}` };
    return { ok: true, confidence: 'high', repo: repository, commit,
      branchOrTag: metadata.version, packageOrContract: `${recipe.package}@${metadata.version}`,
      notes: 'The npm registry gitHead matches the observed commit exactly.' };
  }

  if (recipe?.kind === 'go_module_proxy') {
    if (!recipe.module || !recipe.version) return { ok: false, reason: 'go_module_proxy requires module and version' };
    const modulePath = escapeGoModule(recipe.module);
    const version = escapeGoModule(recipe.version);
    const metadata = await json(fetchFn, `https://proxy.golang.org/${modulePath}/@v/${version}.info`);
    const originHash = String(metadata.Origin?.Hash || '').toLowerCase();
    if (originHash !== commit) return { ok: false, reason: `Go proxy Origin.Hash is ${originHash || 'missing'}, not ${commit}` };
    return { ok: true, confidence: 'high', repo: repository, commit,
      branchOrTag: metadata.Version, packageOrContract: `${recipe.module}@${metadata.Version}`,
      notes: 'The Go module proxy Origin.Hash matches the observed commit exactly.' };
  }
  return { ok: false, reason: `unsupported deployment recipe kind: ${recipe?.kind || 'missing'}` };
}

