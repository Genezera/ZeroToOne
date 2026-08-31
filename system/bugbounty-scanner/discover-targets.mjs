// Descoberta automática de alvo novo — vasculha o dataset público
// arkadiyt/bounty-targets-data (HackerOne + Bugcrowd, atualizado de hora
// em hora por automação própria daquele repo, sem conta/token necessário)
// por QUALQUER programa com alvo hospedado no GitHub, não só os 3 já
// rastreados. SÓ SUGERE — nunca escreve em targets-*.mjs sozinho: esses
// arquivos são escritos à mão com comentário explicando o porquê de cada
// escolha (mesmo padrão de todo NOTES.md do projeto), e curadoria de
// pathPrefixes pra monorepo grande exige julgamento que um script não
// replica com segurança a partir de metadado em massa.

import { githubHeaders } from './github-auth.mjs';

const HACKERONE_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/hackerone_data.json';
const BUGCROWD_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/bugcrowd_data.json';
const MAX_METADATA_LOOKUPS = 30; // orçamento de API anônima do GitHub (60/hora) — rodada semanal própria, isolada do scan diário
const PROGRAM_AGE_CONCURRENCY = 5; // Hacker API não documenta limite de taxa concorrente; 5 é conservador o bastante pra não arriscar 429 e ainda cortar o tempo sequencial em ~5x

/** `Promise.all` com um teto de quantas promessas ficam em voo ao mesmo
 * tempo — sem isso, N chamadas de rede lentas em série somam os tempos
 * (achado real: 23 handles a ~3s de média cada passava de 1 minuto só
 * buscando idade de programa). Nunca lança por causa de um item — cada
 * `fn` é responsável por capturar seu próprio erro se quiser. */
export async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

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
      entry.programs.push({ program: program.name, platform: 'HackerOne', url: program.url, handle: program.handle });
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
 * apareceu aí vem primeiro; dentro de quem nunca apareceu, quem está no
 * programa mais NOVO (`newestProgramStartedAt` mais recente, ver
 * `attachProgramAge`) vem primeiro ainda — programa mais novo tende a
 * estar menos escrutinado por outros pesquisadores, é sinal real de
 * oportunidade, não só "é novo pra nós". Quem já foi checado antes vem
 * por último, do mais antigo pro mais recente, então o orçamento sobrando
 * depois de cobrir tudo que é genuinamente novo passa a refrescar as
 * entradas mais velhas em vez de sempre as mesmas. */
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
  // Sort estável: quem tem newestProgramStartedAt vem antes de quem não
  // tem (sem dado de idade não é "nem novo nem velho", é desconhecido —
  // não deveria furar fila na frente de quem sabemos ser novo), e entre
  // quem tem dado, mais recente primeiro. Array.prototype.sort do V8/Node
  // moderno é estável, então candidatos sem dado mantêm a ordem original
  // entre si (mesma garantia que já existia antes desta mudança).
  neverSeen.sort((a, b) => {
    const ta = a.newestProgramStartedAt ? new Date(a.newestProgramStartedAt).getTime() : null;
    const tb = b.newestProgramStartedAt ? new Date(b.newestProgramStartedAt).getTime() : null;
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  });
  alreadySeen.sort((a, b) => {
    const ta = seenMap[`${a.owner.toLowerCase()}/${a.repo.toLowerCase()}`];
    const tb = seenMap[`${b.owner.toLowerCase()}/${b.repo.toLowerCase()}`];
    return new Date(ta).getTime() - new Date(tb).getTime();
  });
  return [...neverSeen, ...alreadySeen];
}

/** Extrai os handles distintos de programa HackerOne presentes nos
 * candidatos (só HackerOne tem handle consultável pela Hacker API —
 * Bugcrowd não tem endpoint equivalente disponível aqui). */
export function distinctHackerOneHandles(candidates) {
  const handles = new Set();
  for (const c of candidates) {
    for (const p of c.programs || []) {
      if (p.platform === 'HackerOne' && p.handle) handles.add(p.handle);
    }
  }
  return [...handles];
}

/** Anexa `newestProgramStartedAt` a cada candidato: a data de lançamento
 * (started_accepting_at) mais recente entre os programas HackerOne em
 * que ele está listado, usando `ageByHandle` (`{handle: startedAcceptingAt}`,
 * de `getProgram` em h1-api.mjs). Pura — quem chama já buscou os dados. */
export function attachProgramAge(candidates, ageByHandle = {}) {
  return candidates.map((c) => {
    let newest = null;
    for (const p of c.programs || []) {
      if (p.platform !== 'HackerOne' || !p.handle) continue;
      const startedAt = ageByHandle[p.handle];
      if (!startedAt) continue;
      if (!newest || new Date(startedAt).getTime() > new Date(newest).getTime()) newest = startedAt;
    }
    return newest ? { ...c, newestProgramStartedAt: newest } : c;
  });
}

async function fetchRepoMetadata(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status} buscando metadado de ${owner}/${repo}`);
  const json = await res.json();
  return {
    language: json.language || null,
    sizeKb: json.size ?? null,
    pushedAt: json.pushed_at || null,
    stars: json.stargazers_count ?? null,
    archived: json.archived ?? false,
    // Precisado por promote-targets.mjs -- um target sem branch não dá pra
    // listRepoFiles buscar nada. Ausente até 31/08/2026 porque discovery
    // só existia pra SUGERIR pra revisão manual (que já sabe o branch por
    // ter olhado o repo); virou obrigatório com a promoção automática.
    defaultBranch: json.default_branch || null,
  };
}

/** Orquestra a rodada completa: busca os 2 datasets, deduplica contra o
 * que já rastreamos, busca a idade dos programas HackerOne envolvidos
 * (sinal de concorrência — melhor esforço, nunca fatal), prioriza quem
 * nunca foi checado (programa mais novo primeiro), busca metadado
 * (tamanho/linguagem/atividade) até o teto de orçamento de API do GitHub.
 * `seenMap` (opcional) é `{ "owner/repo": ultimoTimestampISO }` — ver
 * `prioritizeCandidates`. Quem chama é responsável por persistir o
 * `checkedKeys` retornado de volta no `seenMap` entre rodadas; sem isso,
 * a rotação não funciona e o bug original (mesmos 30 pra sempre) volta.
 * `getProgramInfo` (opcional, injeção de dependência pra testar sem rede/
 * credencial real) é `async (handle) => ({ startedAcceptingAt, ... })` —
 * default é `getProgram` de h1-api.mjs; se as credenciais da Hacker API
 * não estiverem configuradas, todo esse passo é pulado com honestidade
 * (sem idade de programa, não trava a rodada inteira por isso). */
export async function runTargetDiscovery(knownTargetLists, seenMap = {}, getProgramInfo = null) {
  const [hackerOneRes, bugcrowdRes] = await Promise.all([fetch(HACKERONE_URL, { headers: githubHeaders() }), fetch(BUGCROWD_URL, { headers: githubHeaders() })]);
  if (!hackerOneRes.ok) throw new Error(`HTTP ${hackerOneRes.status} buscando dataset HackerOne`);
  if (!bugcrowdRes.ok) throw new Error(`HTTP ${bugcrowdRes.status} buscando dataset Bugcrowd`);
  const hackerOneData = await hackerOneRes.json();
  const bugcrowdData = await bugcrowdRes.json();

  const allCandidates = extractGithubCandidates(hackerOneData, bugcrowdData);
  const newCandidates = diffAgainstKnownTargets(allCandidates, knownTargetLists);

  let ageByHandle = {};
  let programAgeErrors = 0;
  let programAgeSkippedReason = null;
  if (getProgramInfo) {
    const handles = distinctHackerOneHandles(newCandidates);
    // Medido ao vivo em 31/08/2026: a Hacker API leva de ~0,3s a ~9,7s por
    // handle -- sequencial (23 handles reais numa rodada normal) passava
    // de 2 minutos só nisso. PROGRAM_AGE_CONCURRENCY chamadas por vez
    // corta isso pro tempo da mais lenta do lote, não da soma de todas.
    const results = await mapWithConcurrency(handles, PROGRAM_AGE_CONCURRENCY, async (handle) => {
      try {
        const info = await getProgramInfo(handle);
        return { handle, info, error: null };
      } catch (err) {
        return { handle, info: null, error: err };
      }
    });
    for (const { handle, info, error } of results) {
      if (error) {
        programAgeErrors++;
        if (/HACKERONE_USERNAME|HACKERONE_API_TOKEN/.test(error.message)) {
          programAgeSkippedReason = error.message;
        }
        continue;
      }
      if (info && info.startedAcceptingAt) ageByHandle[handle] = info.startedAcceptingAt;
    }
  } else {
    programAgeSkippedReason = 'getProgramInfo não foi passado (chamador optou por não buscar idade de programa)';
  }

  const withAge = attachProgramAge(newCandidates, ageByHandle);
  const prioritized = prioritizeCandidates(withAge, seenMap);

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
    programAgeErrors,
    programAgeSkippedReason,
    programsWithAgeFound: Object.keys(ageByHandle).length,
    discovered: enriched,
    checkedKeys,
  };
}
