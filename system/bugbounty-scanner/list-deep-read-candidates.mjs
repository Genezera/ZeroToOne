// Lista candidatos SEGUROS pra próxima rodada de leitura profunda --
// existe porque, sem isso, "escolher o que ler" ficava 100% a cargo do
// raciocínio de quem chama, e isso falhou 4 vezes em 2 dias (ver
// research/bugbounty/block-open-source/NOTES.md, seções "INCIDENTE" e
// "near-miss", 2026-08-31 a 2026-09-01): a sessão ia direto em
// deep-read-log.json escolher o repo menos lido, sem carregar
// program-policy.json antes, e acabava clonando/lendo Block Open Source
// (aiResearchBanned=true) mesmo já sabendo da regra. Sempre autocorrigido
// depois, nunca com dado vazado (o gate scope_verified->human_ready de
// state-machine.mjs já impede qualquer achado desses de avançar) -- mas a
// LEITURA em si já é violação da RoE da Bugcrowd, independente do
// resultado, e depender de disciplina de prompt já provou não bastar.
//
// A trava aqui é mecânica, não uma instrução a mais pra lembrar: o
// programa banido nunca aparece na lista `safe` de saída, não importa em
// que ordem quem chama olhe os dados -- e é mais fácil rodar isto do que
// cruzar deep-read-log.json com program-policy.json na mão, que é
// exatamente o objetivo (a ferramenta certa tem que ser o caminho mais
// curto, não só o mais seguro).
//
// Cruza deep-read-log.json (o que já foi lido, por repo) contra o MESMO
// dataset público que discover-targets.mjs já usa (hackerone_data.json +
// bugcrowd_data.json via arkadiyt/bounty-targets-data) pra descobrir o(s)
// programa(s) de cada repo -- não só os curados em targets-*.mjs, que
// cobrem só uma fração do que uma rodada de leitura profunda proativa já
// tocou (ex.: cashapp/misk, circlefin/malachite nunca estiveram em
// nenhum targets-*.mjs, mas aparecem em deep-read-log.json).
//
// 02/09/2026 -- terceiro achado seguido (depois de 2 outros já registrados
// no README principal) se revelando duplicata pública já conhecida: SSRF
// em packages/next/src/server/image-optimizer.ts (vercel/next.js),
// reportado como #3988959 na HackerOne, fechado como duplicata de
// #3943945 (um TERCEIRO report, #3971664, também já tinha sido fechado
// como duplicata do mesmo original -- pelo menos 3 pessoas acharam o
// mesmo bug de forma independente). O conserto de 31/08/2026 em
// discover-targets.mjs (priorizar programa mais novo) só afeta quais
// repositórios NOVOS entram pra lista rastreada -- vercel/next.js já
// estava rastreado muito antes disso existir, então não ajudou aqui. O
// gap real está NESTE arquivo: `selectDeepReadCandidates` sempre ordenou
// só por "quantos arquivos NÓS já lemos" -- zero noção de quão famoso ou
// escrutinado por OUTRA gente um repositório é. Duas camadas de sinal
// novo pra fechar esse gap, ambas opcionais (default `{}`, comportamento
// idêntico ao de antes se nenhuma for passada):
// 1. `stars` do GitHub (proxy estático de fama) via
//    loadRepoPopularityCache/refreshRepoPopularity.
// 2. Outcome real "duplicate" de plataforma, por repo, via
//    countKnownDuplicatesByRepo -- sinal empírico direto, mais forte que
//    qualquer proxy. Ver research/bugbounty/vercel-open-source/NOTES.md,
//    rodada 2026-09-02, pra narrativa completa incluindo uma
//    inconsistência real encontrada no banco (o achado do SSRF acima
//    nunca tinha sido de fato persistido via upsertFinding -- só existia
//    na narrativa da NOTES.md -- então o sinal de duplicata #2 ainda não
//    pega ESSE caso específico; vale pra achados registrados daqui pra
//    frente).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractGithubCandidates, fetchRepoMetadata } from './discover-targets.mjs';
import { githubHeaders } from './github-auth.mjs';
import { loadProgramPolicy, isProgramBanned } from './program-policy.mjs';
import { openDb, closeDb } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DEEP_READ_LOG_PATH = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'deep-read-log.json');
const DEFAULT_POPULARITY_CACHE_PATH = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'repo-popularity-cache.json');
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'zerotoone.db');
const HACKERONE_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/hackerone_data.json';
const BUGCROWD_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/bugcrowd_data.json';

// Acima deste tanto de estrelas, o repositório já é "todo mundo conhece".
// Não é ciência exata -- é o ponto em que um repo claramente passou de
// "biblioteca de nicho" pra "todo dev JS já ouviu falar" (next.js tem
// 100 mil+; a maioria das bibliotecas médias tem centenas a poucos
// milhares), então a chance de já ter sido lido por muita gente de fora é
// alta o bastante pra valer a pena esgotar o que é menos óbvio primeiro.
export const POPULAR_REPO_STAR_THRESHOLD = 10000;

/** I/O isolado nesta função -- nunca lança: arquivo ausente/inválido vira
 * `{}` (nenhum repo já lido), não uma falha que trava a listagem. */
export function loadDeepReadLog(logPath = DEFAULT_DEEP_READ_LOG_PATH) {
  if (!logPath) return {};
  try {
    const parsed = JSON.parse(readFileSync(logPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Mesmo padrão defensivo de loadDeepReadLog: cache ausente ou inválido
 * vira `{}` (nenhum dado de popularidade conhecido), nunca lança. Formato:
 * `{ "owner/repo": { stars: number|null, fetchedAt: ISOString } }`. */
export function loadRepoPopularityCache(cachePath = DEFAULT_POPULARITY_CACHE_PATH) {
  if (!cachePath) return {};
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Busca `stars` só de quem está ausente do cache OU mais velho que
 * `staleDays` -- pra uma dúzia de repos rastreados isso nunca chega perto
 * do limite de 60 req/hora da API anônima do GitHub, bem diferente do
 * problema da descoberta semanal (centenas de candidatos novos por
 * rodada, teto de 30 buscas). `fetchMeta` é injeção de dependência (default
 * = fetchRepoMetadata real, reexportada de discover-targets.mjs), mesmo
 * padrão de `getProgramInfo` em discover-targets.mjs, pra testar sem rede.
 * Pura quanto a I/O: recebe o cache já carregado, devolve o cache
 * atualizado -- quem chama decide se/quando persistir em disco (mesmo
 * contrato de runTargetDiscovery com checkedKeys). Melhor esforço sempre:
 * erro de rede num repo mantém o valor velho do cache (se houver) em vez
 * de apagar um dado bom por causa de uma falha transitória. */
export async function refreshRepoPopularity(repoKeys, existingCache = {}, { fetchMeta = fetchRepoMetadata, staleDays = 30 } = {}) {
  const cache = { ...existingCache };
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const repoKey of repoKeys) {
    const cached = cache[repoKey];
    const isStale = !cached || !cached.fetchedAt || now - new Date(cached.fetchedAt).getTime() > staleMs;
    if (!isStale) continue;
    const [owner, repo] = repoKey.split('/');
    if (!owner || !repo) continue;
    try {
      const meta = await fetchMeta(owner, repo);
      cache[repoKey] = { stars: meta.stars ?? null, fetchedAt: new Date().toISOString() };
    } catch (err) {
      if (!cached) cache[repoKey] = { stars: null, fetchedAt: new Date().toISOString(), error: err.message };
    }
  }
  return cache;
}

/** Conta, por repositório rastreado, quantos achados já enviados a alguma
 * plataforma voltaram com outcome real "duplicate" -- sinal empírico
 * direto de repo requeimado, mais forte que qualquer proxy estático
 * (estrelas, idade de programa). Casamento por substring no `id` composto
 * (`Programa::path::fn::tipo`) em vez de igualdade exata contra
 * `file`/`asset`: o formato desses dois campos não é 100% consistente
 * entre achados antigos (alguns prefixam com owner/repo, outros não --
 * ver NOTES.md do Vercel Open Source, rodada 2026-09-02), então substring
 * tolera essa inconsistência ao custo teórico de um falso positivo raro
 * se dois repos rastreados tiverem nome um substring do outro. Toca banco
 * de propósito (não é pura) -- mesmo padrão de fetchDatasets: rede/disco
 * isolados numa função própria, decisão de prioridade em outra, testável
 * sem nenhum dos dois. */
export function countKnownDuplicatesByRepo(db, repoKeys) {
  const counts = {};
  const stmt = db.prepare(`
    SELECT COUNT(DISTINCT f.id) AS cnt
    FROM findings f
    JOIN platform_outcomes po ON po.finding_id = f.id
    WHERE po.state = 'duplicate' AND f.id LIKE ?
  `);
  for (const repoKey of repoKeys) {
    const row = stmt.get(`%${repoKey}%`);
    counts[repoKey] = row?.cnt ?? 0;
  }
  return counts;
}

/** owner/repo (minúsculo) -> array de nome de programa que lista esse
 * repo em escopo. Pura -- recebe os dois datasets já buscados, nunca faz
 * rede sozinha (rede fica isolada em fetchDatasets, só chamada pelo
 * runner principal). */
export function buildRepoProgramIndex(hackerOneData, bugcrowdData) {
  const candidates = extractGithubCandidates(hackerOneData || [], bugcrowdData || []);
  const index = new Map();
  for (const c of candidates) {
    const key = `${c.owner}/${c.repo}`.toLowerCase();
    index.set(key, c.programs.map((p) => p.program));
  }
  return index;
}

/** Núcleo puro (testável sem rede/disco): recebe o log já carregado, o
 * índice repo->programas já construído, e (opcionais, default `{}`) o
 * cache de popularidade e a contagem de duplicatas conhecidas -- devolve
 * a seleção pronta.
 *
 * Falha fechado em duas frentes independentes:
 * 1. Repo com QUALQUER programa associado banido -- excluído mesmo que
 *    outro programa do mesmo repo não esteja banido (um repo pode
 *    aparecer no escopo de mais de um programa ao mesmo tempo).
 * 2. Repo que não bate com NENHUM programa conhecido no dataset público
 *    atual -- vai pra `unresolved`, nunca pra `safe` em silêncio. Dataset
 *    desatualizado ou repo removido do escopo público são os dois
 *    motivos mais prováveis; qualquer um dos dois merece checagem manual
 *    antes de ler, não a suposição de "não achei = seguro pra ler".
 *
 * Dentro de `safe`, três camadas (02/09/2026), do que vale mais a pena
 * ler primeiro pro que vale menos:
 * 1. `clean` -- sem duplicata conhecida E não é mega-popular (ou
 *    estrelas desconhecidas). É aqui que a chance de achar algo
 *    genuinamente inédito é maior.
 * 2. `popular` -- sem duplicata conhecida, mas >=
 *    POPULAR_REPO_STAR_THRESHOLD estrelas. Ainda vale ler, só depois de
 *    esgotar o que é menos óbvio.
 * 3. `flagged` -- já voltou "duplicate" de verdade pelo menos uma vez.
 *    Sinal mais forte que existe (não é proxy, é resultado real); vai
 *    pro fim da fila, pior ofensor primeiro dentro do próprio grupo.
 * Dentro de cada camada, ordena do menos lido pro mais lido -- mesmo
 * critério de sempre, só que agora camada por camada em vez da lista
 * inteira de uma vez. Sem dado de popularidade/duplicata (os dois
 * defaults `{}`), as três camadas colapsam numa só e o comportamento é
 * idêntico ao de antes desta mudança. */
export function selectDeepReadCandidates(deepReadLog, repoProgramIndex, policy = {}, popularity = {}, knownDuplicates = {}) {
  const safe = [];
  const blocked = [];
  const unresolved = [];

  for (const [repoKey, filesRead] of Object.entries(deepReadLog || {})) {
    const count = Array.isArray(filesRead) ? filesRead.length : 0;
    const programs = repoProgramIndex.get(repoKey.toLowerCase());

    if (!programs || programs.length === 0) {
      unresolved.push({ repo: repoKey, filesRead: count });
      continue;
    }

    const bannedProgram = programs.find((p) => isProgramBanned(p, policy));
    if (bannedProgram) {
      blocked.push({ repo: repoKey, filesRead: count, program: bannedProgram });
      continue;
    }

    const stars = popularity[repoKey]?.stars ?? null;
    const duplicates = knownDuplicates[repoKey] ?? 0;
    safe.push({ repo: repoKey, filesRead: count, programs, stars, knownDuplicates: duplicates });
  }

  const clean = [];
  const popular = [];
  const flagged = [];
  for (const s of safe) {
    if (s.knownDuplicates > 0) flagged.push(s);
    else if (s.stars !== null && s.stars >= POPULAR_REPO_STAR_THRESHOLD) popular.push(s);
    else clean.push(s);
  }
  clean.sort((a, b) => a.filesRead - b.filesRead);
  popular.sort((a, b) => a.filesRead - b.filesRead);
  flagged.sort((a, b) => b.knownDuplicates - a.knownDuplicates || a.filesRead - b.filesRead);

  return { safe: [...clean, ...popular, ...flagged], blocked, unresolved };
}

/** Único ponto de rede deste módulo pros datasets HackerOne/Bugcrowd --
 * mesmas URLs públicas que discover-targets.mjs já usa (sem custo, sem
 * token obrigatório). */
export async function fetchDatasets() {
  const [hackerOneRes, bugcrowdRes] = await Promise.all([
    fetch(HACKERONE_URL, { headers: githubHeaders() }),
    fetch(BUGCROWD_URL, { headers: githubHeaders() }),
  ]);
  return [await hackerOneRes.json(), await bugcrowdRes.json()];
}

async function main() {
  const [hackerOneData, bugcrowdData] = await fetchDatasets();
  const index = buildRepoProgramIndex(hackerOneData, bugcrowdData);
  const policy = loadProgramPolicy();
  const log = loadDeepReadLog();
  const repoKeys = Object.keys(log || {});

  // Popularidade: melhor esforço, nunca trava a listagem. Erro de rede
  // no lote inteiro (ex.: sem internet) ainda deixa `main` rodar com o
  // que já estava cacheado antes.
  let popularityCache = loadRepoPopularityCache();
  try {
    popularityCache = await refreshRepoPopularity(repoKeys, popularityCache);
    writeFileSync(DEFAULT_POPULARITY_CACHE_PATH, JSON.stringify(popularityCache, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn(`Aviso: não consegui atualizar o cache de popularidade (${err.message}) -- seguindo só com o que já estava cacheado.`);
  }

  // Duplicatas conhecidas: melhor esforço também -- banco ausente/travado
  // por outro processo não deveria impedir a listagem, só empobrecer a
  // priorização pra "sem esse sinal desta vez".
  let duplicateCounts = {};
  try {
    const db = openDb(DEFAULT_DB_PATH);
    try {
      duplicateCounts = countKnownDuplicatesByRepo(db, repoKeys);
    } finally {
      closeDb(db);
    }
  } catch (err) {
    console.warn(`Aviso: não consegui consultar duplicatas conhecidas no banco (${err.message}) -- seguindo sem esse sinal.`);
  }

  const { safe, blocked, unresolved } = selectDeepReadCandidates(log, index, policy, popularityCache, duplicateCounts);

  console.log(`=== ${safe.length} candidato(s) seguro(s) pra leitura profunda -- não-popular/sem duplicata primeiro, mega-popular depois, já-visto-como-duplicata por último ===`);
  for (const s of safe.slice(0, 30)) {
    const starsLabel = s.stars !== null ? `${s.stars}★` : '?★';
    const dupLabel = s.knownDuplicates > 0 ? ` [${s.knownDuplicates}x já voltou duplicate]` : '';
    console.log(`${String(s.filesRead).padStart(3, ' ')} arquivo(s) já lido(s), ${starsLabel} -- ${s.repo} (${s.programs.join(', ')})${dupLabel}`);
  }
  if (safe.length > 30) console.log(`... e mais ${safe.length - 30} candidato(s)`);

  if (blocked.length > 0) {
    console.log(`\n=== ${blocked.length} repositório(s) EXCLUÍDO(S) por programa banido -- NUNCA leia estes ===`);
    for (const b of blocked) console.log(`${b.repo} -- programa "${b.program}" tem aiResearchBanned=true em program-policy.json`);
  }

  if (unresolved.length > 0) {
    console.log(`\n=== ${unresolved.length} repositório(s) sem programa reconhecido no dataset público atual -- revise à mão antes de ler ===`);
    for (const u of unresolved) console.log(u.repo);
  }
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((err) => {
    console.error('Erro fatal em list-deep-read-candidates:', err);
    process.exit(1);
  });
}
