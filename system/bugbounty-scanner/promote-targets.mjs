// Pipeline de promoção automática: pega os candidatos que discover-targets.mjs
// já enriqueceu (linguagem, estrelas, payout, idade de programa) e decide
// sozinho quais viram alvo ativo de varredura -- sem isso, o único jeito de
// um programa novo entrar no scanner era eu escolher manualmente um por um
// (o gargalo real por trás da "amplitude estreita" identificada em
// 31/08/2026: só 4 programas com achado, de milhares disponíveis no
// dataset HackerOne+Bugcrowd que a descoberta já cobre há semanas).
//
// Continua respeitando o limite original de discover-targets.mjs: NUNCA
// escreve nos targets-*.mjs curados à mão. Em vez disso gera um arquivo
// PRÓPRIO (targets-auto-promoted.mjs, ver writeAutoPromotedModule) que cada
// targets-<lang>.mjs importa e filtra por linguagem -- curadoria manual e
// promoção automática ficam sempre visualmente separadas, nunca misturadas
// na mesma lista escrita à mão.
//
// Continua honesto sobre o que NÃO cobre: monorepo grande demais pra
// escanear sem pathPrefixes curados (MAX_REPO_SIZE_KB) fica de fora e é
// listado à parte, não promovido às cegas nem descartado em silêncio --
// esse é exatamente o caso (misk/wire) que motivou o comentário original
// em discover-targets.mjs sobre curadoria de pathPrefix exigir julgamento
// humano. Programa bloqueado por política (program-policy.mjs) nunca é
// promovido, mas isso é só a segunda camada de defesa -- a de verdade é o
// gate em state-machine.mjs, que vale mesmo se algo escapar daqui.

import { getBlockReason } from './program-policy.mjs';

export const MAX_REPO_SIZE_KB = 20000; // ~20MB — acima disso, scan-runner.mjs já teria que truncar (ver MAX_FILES_PER_TARGET) sem pathPrefix curado escolhendo o que fica de fora; melhor sinalizar pra revisão manual que promover às cegas
// Bug real pego na primeira rodada ao vivo (31/08/2026): ranquear por score
// e pegar o topo-N não garante NENHUM sinal positivo -- só garante que é o
// "menos pior" do lote. Duas entradas (ExodusOSS/crypto, ExodusOSS/hydra)
// foram promovidas com score=0 e reasons=[] (candidato HackerOne sem
// payout conhecido -- HackerOne não expõe isso no dataset em massa, só
// Bugcrowd -- sem estrelas>=100, sem push recente registrado). "Melhor do
// que nada" não é o mesmo que "bom o bastante pra gastar orçamento de scan
// diário nele pra sempre". Qualquer score > 0 já teve PELO MENOS um sinal
// positivo real (ver scoreCandidate); score 0 vira `insufficient_signal`,
// nunca promovido, mas também nunca escondido (aparece no log de rodada).
export const MIN_SCORE_TO_PROMOTE = 0;
export const DEFAULT_MAX_PROMOTIONS_PER_RUN = 5; // orçamento de API do GitHub é compartilhado com o scan diário — crescer aos poucos, não inundar de uma vez
export const DEFAULT_MAX_TOTAL_PROMOTED = 40; // teto absoluto — cada alvo a mais é mais chamada de API por dia, pra sempre; ao atingir, promoção para e reporta em vez de crescer sem fim

// GitHub retorna a linguagem "primária" (mais bytes) detectada por linguist.
// Só mapeia pra um balde que scan-runner.mjs realmente sabe escanear hoje —
// qualquer coisa fora disso (Python, Rust, C++, Ruby, PHP, ...) fica de fora
// não porque seja menos importante, mas porque não existe heurística pra ela
// ainda (isso é um limite de cobertura de linguagem, um problema bem maior
// que este pipeline não tenta resolver escondido aqui).
const LANGUAGE_MAP = {
  JavaScript: 'js',
  TypeScript: 'js',
  Go: 'go',
  Kotlin: 'jvm',
  Java: 'jvm',
  Swift: 'swift',
  'Objective-C': 'swift',
  Solidity: 'solidity',
};

export function mapGithubLanguage(githubLanguage) {
  return LANGUAGE_MAP[githubLanguage] || null;
}

/** Entre os programas em que um candidato aparece (pode ser mais de um),
 * escolhe o de maior maxPayoutUsd conhecido; sem nenhum valor conhecido,
 * usa o primeiro (estável, não aleatório). Pura. */
export function pickBestProgram(programs) {
  if (!programs || programs.length === 0) return null;
  let best = programs[0];
  for (const p of programs) {
    if ((p.maxPayoutUsd || 0) > (best.maxPayoutUsd || 0)) best = p;
  }
  return best;
}

/** Pontuação transparente e explicável -- cada componente vira uma frase em
 * `reasons`, pra nunca ser "score misterioso" (mesmo princípio de
 * evidence-grade.mjs/quarantine.mjs: nunca inventar confiança sem dizer de
 * onde ela vem). Pura -- recebe o candidato já enriquecido, não busca nada. */
export function scoreCandidate(candidate, now = Date.now()) {
  const reasons = [];
  let score = 0;
  const bestProgram = pickBestProgram(candidate.programs);

  if (bestProgram?.maxPayoutUsd) {
    const capped = Math.min(bestProgram.maxPayoutUsd, 100000);
    score += capped / 1000; // até 100 pontos, sem deixar um outlier (ex.: $1M) dominar tudo
    reasons.push(`teto de recompensa conhecido: US$${bestProgram.maxPayoutUsd.toLocaleString('en-US')}`);
  }

  if (candidate.newestProgramStartedAt) {
    const ageDays = (now - new Date(candidate.newestProgramStartedAt).getTime()) / 86400000;
    if (ageDays >= 0 && ageDays < 180) {
      score += 30 * (1 - ageDays / 180); // até 30 pontos, decai linear até 180 dias
      reasons.push(`programa lançado há ${Math.round(ageDays)} dia(s) — menos escrutinado por outros pesquisadores`);
    }
  }

  if (typeof candidate.stars === 'number' && candidate.stars >= 100) {
    score += 10;
    reasons.push(`${candidate.stars} estrelas no GitHub — indício de uso real, não projeto de brinquedo`);
  }

  if (candidate.pushedAt) {
    const daysSincePush = (now - new Date(candidate.pushedAt).getTime()) / 86400000;
    if (daysSincePush >= 0 && daysSincePush < 90) {
      score += 10;
      reasons.push('atividade recente (push nos últimos 90 dias) — código em manutenção ativa');
    }
  }

  return { score: Math.round(score * 10) / 10, reasons, bestProgram };
}

/**
 * Classifica UM candidato já enriquecido (de discover-targets.mjs) em
 * exatamente um veredito -- nunca promove e reporta ao mesmo tempo, sempre
 * um dos dois. Pura -- `programPolicy` já carregado é passado por quem
 * chama (io fica fora, mesmo padrão de state-machine.mjs).
 */
export function classifyCandidate(candidate, { programPolicy = {}, maxRepoSizeKb = MAX_REPO_SIZE_KB, minScoreToPromote = MIN_SCORE_TO_PROMOTE, now = Date.now() } = {}) {
  if (candidate.metadataError) {
    return { verdict: 'metadata_fetch_failed', candidate, reason: candidate.metadataError };
  }
  const bestProgram = pickBestProgram(candidate.programs);
  const programName = bestProgram?.program || null;
  const blockReason = programName ? getBlockReason(programName, programPolicy) : null;
  if (blockReason) {
    return { verdict: 'blocked_program', candidate, program: programName, reason: blockReason };
  }
  const language = mapGithubLanguage(candidate.language);
  if (!language) {
    return { verdict: 'unsupported_language', candidate, githubLanguage: candidate.language };
  }
  if (typeof candidate.sizeKb === 'number' && candidate.sizeKb > maxRepoSizeKb) {
    return { verdict: 'too_large', candidate, sizeKb: candidate.sizeKb, reason: `${candidate.sizeKb}KB > ${maxRepoSizeKb}KB — monorepo grande demais pra escanear sem pathPrefixes curados à mão; revisão manual recomendada, não descartado` };
  }
  const { score, reasons } = scoreCandidate(candidate, now);
  if (score <= minScoreToPromote) {
    return { verdict: 'insufficient_signal', candidate, score };
  }
  return { verdict: 'eligible', candidate, language, score, reasons, bestProgram };
}

/**
 * Orquestra a rodada de promoção inteira. `discoveredCandidates` é
 * `result.discovered` de runTargetDiscovery (discover-targets.mjs) --
 * mesma chamada de rede que a descoberta semanal já faz, não duplica
 * nenhuma busca. `existingPromotedKeys` é um Set de "owner/repo" (minúsculo)
 * já promovidos em rodadas anteriores, pra nunca promover o mesmo repo
 * duas vezes. Nunca lança por causa de UM candidato ruim -- cada um vira
 * exatamente uma entrada em `promoted` ou em algum balde de `skipped`,
 * nenhum desaparece em silêncio.
 */
export function promoteTargets(discoveredCandidates, {
  programPolicy = {},
  existingPromotedKeys = new Set(),
  maxPromotionsPerRun = DEFAULT_MAX_PROMOTIONS_PER_RUN,
  maxTotalPromoted = DEFAULT_MAX_TOTAL_PROMOTED,
  currentTotalPromoted = 0,
  maxRepoSizeKb = MAX_REPO_SIZE_KB,
  minScoreToPromote = MIN_SCORE_TO_PROMOTE,
  now = Date.now(),
} = {}) {
  const skipped = { blockedProgram: [], unsupportedLanguage: [], tooLarge: [], metadataFetchFailed: [], insufficientSignal: [], alreadyPromoted: 0 };
  const eligible = [];

  for (const candidate of discoveredCandidates) {
    const key = `${candidate.owner.toLowerCase()}/${candidate.repo.toLowerCase()}`;
    if (existingPromotedKeys.has(key)) {
      skipped.alreadyPromoted++;
      continue;
    }
    const result = classifyCandidate(candidate, { programPolicy, maxRepoSizeKb, minScoreToPromote, now });
    switch (result.verdict) {
      case 'blocked_program':
        skipped.blockedProgram.push({ owner: candidate.owner, repo: candidate.repo, program: result.program, reason: result.reason });
        break;
      case 'unsupported_language':
        skipped.unsupportedLanguage.push({ owner: candidate.owner, repo: candidate.repo, githubLanguage: result.githubLanguage });
        break;
      case 'too_large':
        skipped.tooLarge.push({ owner: candidate.owner, repo: candidate.repo, sizeKb: result.sizeKb });
        break;
      case 'metadata_fetch_failed':
        skipped.metadataFetchFailed.push({ owner: candidate.owner, repo: candidate.repo, reason: result.reason });
        break;
      case 'insufficient_signal':
        skipped.insufficientSignal.push({ owner: candidate.owner, repo: candidate.repo, score: result.score });
        break;
      case 'eligible':
        eligible.push(result);
        break;
    }
  }

  eligible.sort((a, b) => b.score - a.score);

  const remainingCapacity = Math.max(0, maxTotalPromoted - currentTotalPromoted);
  const takeCount = Math.min(maxPromotionsPerRun, remainingCapacity, eligible.length);
  const atCap = remainingCapacity === 0 && eligible.length > 0;
  const chosen = eligible.slice(0, takeCount);
  // Continua elegível, só não coube nesta rodada -- seja por já ter batido
  // no orçamento por rodada (maxPromotionsPerRun, o caso comum) ou no teto
  // absoluto (maxTotalPromoted, ver `atCap`). Nome não fala só de "cap
  // total" de propósito -- as duas causas levam a "espera a próxima
  // rodada", que é o que quem lê o relatório de promoção precisa saber.
  const deferredToNextRun = eligible.slice(takeCount);

  const promoted = chosen.map(({ candidate, language, score, reasons, bestProgram }) => ({
    program: bestProgram.program,
    platform: bestProgram.platform,
    owner: candidate.owner,
    repo: candidate.repo,
    branch: candidate.defaultBranch || 'main',
    maxBountyUsd: bestProgram.maxPayoutUsd ?? null,
    pathPrefixes: [],
    language,
    score,
    reasons,
    promotedAt: new Date(now).toISOString(),
  }));

  return {
    promoted,
    skipped: {
      ...skipped,
      deferredToNextRun: deferredToNextRun.map((r) => ({ owner: r.candidate.owner, repo: r.candidate.repo, score: r.score })),
      atCap,
    },
  };
}

/** Serializa a lista completa (acumulada entre rodadas) de alvos
 * auto-promovidos como módulo ES -- string pura, sem tocar disco (quem
 * chama grava com writeFileSync, mesmo padrão de todo *-runner.mjs deste
 * projeto). JSON.stringify de dado plano (string/número/array/null) já é
 * sintaxe de array/objeto literal válida em JS, não precisa de um
 * serializador próprio. */
export function renderAutoPromotedModule(entries) {
  return `// Gerado automaticamente por promote-targets.mjs (via discovery-runner.mjs)
// -- NÃO editar à mão, a próxima rodada de promoção sobrescreve este
// arquivo inteiro. Curadoria manual continua em targets-<linguagem>.mjs,
// nunca aqui. Cada entrada carrega score+reasons documentando por que foi
// promovida (mesmo princípio de evidence-grade.mjs/quarantine.mjs: nunca
// inventar confiança sem justificar de onde ela vem).
//
// Ver research/bugbounty/targets-auto-promoted-log.json para o histórico
// completo de toda rodada, incluindo o que foi CONSIDERADO e recusado
// (linguagem não suportada, repo grande demais, programa bloqueado) --
// nunca um corte silencioso.

export const AUTO_PROMOTED_TARGETS = ${JSON.stringify(entries, null, 2)};
`;
}
