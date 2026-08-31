// Descoberta automática de alvo novo — vasculha o dataset público
// arkadiyt/bounty-targets-data (HackerOne + Bugcrowd, atualizado de hora
// em hora por automação própria daquele repo, sem conta/token necessário)
// por QUALQUER programa com alvo hospedado no GitHub, não só os 3 já
// rastreados. SÓ SUGERE — nunca escreve em targets-*.mjs sozinho: esses
// arquivos são escritos à mão com comentário explicando o porquê de cada
// escolha (mesmo padrão de todo NOTES.md do projeto), e curadoria de
// pathPrefixes pra monorepo grande exige julgamento que um script não
// replica com segurança a partir de metadado em massa.

const HACKERONE_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/hackerone_data.json';
const BUGCROWD_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/bugcrowd_data.json';
const MAX_METADATA_LOOKUPS = 30; // orçamento de API anônima do GitHub (60/hora) — rodada semanal própria, isolada do scan diário

const GITHUB_URL_RE = /^https?:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+?)(\.git)?\/?$/;

/** Extrai owner/repo de uma URL github.com — null se não for esse formato
 * (algumas entradas do dataset são domínio/app/API, não repo de código). */
export function parseGithubUrl(url) {
  if (!url) return null;
  const m = String(url).trim().match(GITHUB_URL_RE);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** Une candidatos do HackerOne + Bugcrowd num formato comum, deduplicado
 * por owner/repo (um mesmo repo pode aparecer em mais de um programa —
 * mantém a lista de todos). Só programas com offers_bounties/max_payout
 * verdadeiro entram (programa sem recompensa não interessa a esta missão). */
export function extractGithubCandidates(hackerOneData, bugcrowdData) {
  const byKey = new Map();

  for (const program of hackerOneData || []) {
    if (!program.offers_bounties) continue;
    for (const target of program.targets?.in_scope || []) {
      const parsed = parseGithubUrl(target.asset_identifier) || parseGithubUrl(target.uri) || parseGithubUrl(target.target);
      if (!parsed) continue;
      const key = `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`;
      const entry = byKey.get(key) || { owner: parsed.owner, repo: parsed.repo, programs: [] };
      entry.programs.push({ program: program.name, platform: 'HackerOne', url: program.url });
      byKey.set(key, entry);
    }
  }

  for (const program of bugcrowdData || []) {
    if (!program.max_payout || program.max_payout <= 0) continue;
    for (const target of program.targets?.in_scope || []) {
      const parsed = parseGithubUrl(target.target) || parseGithubUrl(target.uri) || parseGithubUrl(target.name);
      if (!parsed) continue;
      const key = `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`;
      const entry = byKey.get(key) || { owner: parsed.owner, repo: parsed.repo, programs: [] };
      entry.programs.push({ program: program.name, platform: 'Bugcrowd', url: program.url, maxPayoutUsd: program.max_payout });
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()];
}

/** Remove candidato que já está em algum dos targets-*.mjs rastreados. */
export function diffAgainstKnownTargets(candidates, knownTargetLists) {
  const known = new Set();
  for (const list of knownTargetLists) {
    for (const t of list) {
      if (t.owner && t.repo) known.add(`${t.owner.toLowerCase()}/${t.repo.toLowerCase()}`);
    }
  }
  return candidates.filter((c) => !known.has(`${c.owner.toLowerCase()}/${c.repo.toLowerCase()}`));
}

/** Ordena candidatos pra priorizar quem NUNCA teve metadado buscado —
 * sem isso, um orçamento de API fixo (MAX_METADATA_LOOKUPS) sempre pega
 * os mesmos primeiros N candidatos da lista, toda rodada, pra sempre (bug
 * real encontrado em 31/08/2026: 156 de 186 candidatos nunca tinham
 * recebido metadado em nenhuma rodada). `seenMap` é
 * `{ "owner/repo": ultimoTimestampISOEmQueFoiChecado }` — quem nunca
 * apareceu aí vem primeiro (na ordem original); quem já foi checado
 * antes vem depois, do mais antigo pro mais recente, então o orçamento
 * sobrando depois de cobrir tudo que é genuinamente novo passa a
 * refrescar as entradas mais velhas em vez de sempre as mesmas. */
export function prioritizeCandidates(candidates, seenMap = {}) {
  const neverSeen = [];
  const alreadySeen = [];
  for (const c of candidates) {
    const key = `${c.owner.toLowerCase()}/${c.repo.toLowerCase()}`;
    if (Object.prototype.hasOwnProperty.call(seenMap, key)) {
      alreadySeen.push(c);
    } else {
      neverSeen.push(c);
    }
  }
  alreadySeen.sort((a, b) => {
    const ta = seenMap[`${a.owner.toLowerCase()}/${a.repo.toLowerCase()}`];
    const tb = seenMap[`${b.owner.toLowerCase()}/${b.repo.toLowerCase()}`];
    return new Date(ta).getTime() - new Date(tb).getTime();
  });
  return [...neverSeen, ...alreadySeen];
}

async function fetchRepoMetadata(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: { 'User-Agent': 'ZeroToOne-bugbounty-scanner' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} buscando metadado de ${owner}/${repo}`);
  const json = await res.json();
  return { language: json.language || null, sizeKb: json.size ?? null, pushedAt: json.pushed_at || null, stars: json.stargazers_count ?? null, archived: json.archived ?? false };
}

/** Orquestra a rodada completa: busca os 2 datasets, deduplica contra o
 * que já rastreamos, prioriza quem nunca foi checado, busca metadado
 * (tamanho/linguagem/atividade) até o teto de orçamento de API.
 * `seenMap` (opcional) é `{ "owner/repo": ultimoTimestampISO }` — ver
 * `prioritizeCandidates`. Quem chama é responsável por persistir o
 * `checkedKeys` retornado de volta no `seenMap` entre rodadas; sem isso,
 * a rotação não funciona e o bug original (mesmos 30 pra sempre) volta. */
export async function runTargetDiscovery(knownTargetLists, seenMap = {}) {
  const [hackerOneRes, bugcrowdRes] = await Promise.all([fetch(HACKERONE_URL), fetch(BUGCROWD_URL)]);
  if (!hackerOneRes.ok) throw new Error(`HTTP ${hackerOneRes.status} buscando dataset HackerOne`);
  if (!bugcrowdRes.ok) throw new Error(`HTTP ${bugcrowdRes.status} buscando dataset Bugcrowd`);
  const hackerOneData = await hackerOneRes.json();
  const bugcrowdData = await bugcrowdRes.json();

  const allCandidates = extractGithubCandidates(hackerOneData, bugcrowdData);
  const newCandidates = diffAgainstKnownTargets(allCandidates, knownTargetLists);
  const prioritized = prioritizeCandidates(newCandidates, seenMap);

  const capped = prioritized.slice(0, MAX_METADATA_LOOKUPS);
  const truncatedCount = prioritized.length - capped.length;
  const neverSeenRemaining = capped.length < prioritized.length
    ? prioritized.slice(capped.length).filter((c) => !Object.prototype.hasOwnProperty.call(seenMap, `${c.owner.toLowerCase()}/${c.repo.toLowerCase()}`)).length
    : 0;

  const enriched = [];
  const checkedKeys = [];
  let metadataErrors = 0;
  for (const c of capped) {
    checkedKeys.push(`${c.owner.toLowerCase()}/${c.repo.toLowerCase()}`);
    try {
      const meta = await fetchRepoMetadata(c.owner, c.repo);
      if (meta.archived) continue; // repo arquivado não é candidato útil
      enriched.push({ ...c, ...meta });
    } catch (err) {
      metadataErrors++;
      enriched.push({ ...c, language: null, sizeKb: null, pushedAt: null, stars: null, metadataError: err.message });
    }
  }

  return {
    totalCandidatesInDatasets: allCandidates.length,
    newCandidatesFound: newCandidates.length,
    truncatedCount,
    neverSeenRemaining,
    metadataErrors,
    discovered: enriched,
    checkedKeys,
  };
}
