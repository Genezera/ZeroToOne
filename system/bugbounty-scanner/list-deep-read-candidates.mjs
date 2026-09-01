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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractGithubCandidates } from './discover-targets.mjs';
import { githubHeaders } from './github-auth.mjs';
import { loadProgramPolicy, isProgramBanned } from './program-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DEEP_READ_LOG_PATH = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'deep-read-log.json');
const HACKERONE_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/hackerone_data.json';
const BUGCROWD_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/bugcrowd_data.json';

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

/** Núcleo puro (testável sem rede/disco): recebe o log já carregado e o
 * índice repo->programas já construído, devolve a seleção pronta.
 *
 * Falha fechado em duas frentes independentes:
 * 1. Repo com QUALQUER programa associado banido -- excluído mesmo que
 *    outro programa do mesmo repo não esteja banido (um repo pode
 *    aparecer no escopo de mais de um programa ao mesmo tempo).
 * 2. Repo que não bate com NENHUM programa conhecido no dataset público
 *    atual -- vai pra `unresolved`, nunca pra `safe` em silêncio. Dataset
 *    desatualizado ou repo removido do escopo público são os dois
 *    motivos mais prováveis; qualquer um dos dois merece checagem manual
 *    antes de ler, não a suposição de "não achei = seguro pra ler". */
export function selectDeepReadCandidates(deepReadLog, repoProgramIndex, policy = {}) {
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

    safe.push({ repo: repoKey, filesRead: count, programs });
  }

  safe.sort((a, b) => a.filesRead - b.filesRead);
  return { safe, blocked, unresolved };
}

/** Único ponto de rede deste módulo -- mesmas URLs públicas que
 * discover-targets.mjs já usa (sem custo, sem token obrigatório). */
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
  const { safe, blocked, unresolved } = selectDeepReadCandidates(log, index, policy);

  console.log(`=== ${safe.length} candidato(s) seguro(s) pra leitura profunda, do menos lido pro mais lido ===`);
  for (const s of safe.slice(0, 30)) {
    console.log(`${String(s.filesRead).padStart(3, ' ')} arquivo(s) já lido(s) -- ${s.repo} (${s.programs.join(', ')})`);
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
