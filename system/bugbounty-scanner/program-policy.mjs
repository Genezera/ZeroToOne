// Registro de autorização de pesquisa por programa. É uma allowlist:
// somente `roeReviewed: true` com revisão ainda válida libera leitura.
// Os motivos de bloqueio são nomeados separadamente:
// `roeReviewNeeded` -- regras ainda não revisadas, logo pesquisa bloqueada
// de forma fail-closed; `aiResearchBanned` -- as próprias regras de
// engajamento do programa proíbem algo que este projeto faz por definição
// (pesquisa assistida por IA); `blocked` -- motivo genérico, tipicamente instrução direta
// do usuário pra não investir mais tempo ali (ex.: Circle BBP, 02/09/2026
// -- "não quero nada da circle", depois de já ter esgotado o ângulo
// investigativo principal e pedido explicitamente rotação pra outros
// programas). Nenhum dos campos exige o outro: um programa pode estar
// `blocked` sem ter RoE nenhuma contra IA.
// Existe porque pausar por ARQUIVO (targets-jvm/go/swift.mjs, 31/08/2026)
// não bastou sozinho -- uma rodada de leitura profunda do agente de nuvem
// rodou em Block Open Source HORAS depois da pausa ser publicada, provando
// que aquele sinal não é a única coisa que decide o que o agente de nuvem
// investiga. `programPolicy` é injetado automaticamente em TODA transição
// por `db.mjs::recordTransition` (não fica a cargo de quem chama lembrar
// de passar) e checado em `state-machine.mjs` no gate scope_verified->
// human_ready -- então nenhuma transição, de nenhum agente, em nenhuma
// conta, consegue levar um achado de programa bloqueado até human_ready,
// não importa qual sinal decidiu ler o código-fonte em primeiro lugar.
//
// Os runners de scan/descoberta e a seleção de leitura aplicam a mesma
// política antes de buscar código. A máquina de estados repete o gate como
// defesa em profundidade. Uma revisão expirada volta a bloquear o programa.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY_PATH = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'program-policy.json');

function isIsoCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** I/O isolado nesta única função -- state-machine.mjs consome o resultado
 * via ctx.programPolicy, nunca lê arquivo sozinho (mantém as precondições
 * puras/testáveis sem tocar disco). Nunca lança: arquivo ausente/inválido
 * vira "nenhum programa bloqueado", não uma falha que trava a transição. */
export function loadProgramPolicy(policyPath = DEFAULT_POLICY_PATH) {
  if (!existsSync(policyPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(policyPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Variante fail-closed para qualquer caminho que possa iniciar pesquisa,
 * avançar estado ou autorizar submissão. Política ausente/corrompida não
 * pode significar silenciosamente "ninguém está bloqueado". */
export function loadProgramPolicyStrict(policyPath = DEFAULT_POLICY_PATH) {
  if (!existsSync(policyPath)) throw new Error(`program policy obrigatória ausente: ${policyPath}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch (error) {
    throw new Error(`program policy inválida em ${policyPath}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`program policy precisa ser objeto JSON: ${policyPath}`);
  }
  const flags = [
    'roeReviewed', 'roeReviewNeeded', 'aiResearchBanned', 'blocked',
    'aiDisclosureRequired', 'manualValidationRequired', 'scannerOnlyIneligible',
    'productionTestingProhibited', 'localForkRequired', 'priorAuditCheckRequired',
  ];
  for (const [program, entry] of Object.entries(parsed)) {
    if (!program.trim() || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`entrada inválida na program policy: ${program || '(nome vazio)'}`);
    }
    for (const flag of flags) {
      if (flag in entry && typeof entry[flag] !== 'boolean') {
        throw new Error(`program policy ${program}.${flag} precisa ser boolean`);
      }
    }
    const decisions = ['roeReviewed', 'roeReviewNeeded', 'aiResearchBanned', 'blocked']
      .filter((flag) => entry[flag] === true);
    if (decisions.length === 0) {
      throw new Error(`program policy ${program} não contém decisão explícita de RoE`);
    }
    if (entry.roeReviewed === true && decisions.length > 1) {
      throw new Error(`program policy ${program} é contraditória: roeReviewed não pode coexistir com ${decisions.filter((flag) => flag !== 'roeReviewed').join(', ')}`);
    }
    if (entry.roeReviewed === true) {
      for (const field of ['reviewedAt', 'nextReviewAt']) {
        if (!isIsoCalendarDate(entry[field])) {
          throw new Error(`program policy ${program}.${field} precisa ser data ISO YYYY-MM-DD`);
        }
      }
      if (entry.nextReviewAt < entry.reviewedAt) {
        throw new Error(`program policy ${program}.nextReviewAt não pode preceder reviewedAt`);
      }
      if (typeof entry.policyUrl !== 'string' || !/^https:\/\//i.test(entry.policyUrl)) {
        throw new Error(`program policy ${program}.policyUrl precisa apontar para a página oficial HTTPS`);
      }
      if (typeof entry.reviewMethod !== 'string' || entry.reviewMethod.trim().length < 5) {
        throw new Error(`program policy ${program}.reviewMethod precisa registrar como a revisão foi feita`);
      }
    }
    if ('maxRequestsPerSecond' in entry && (!Number.isFinite(entry.maxRequestsPerSecond) || entry.maxRequestsPerSecond <= 0)) {
      throw new Error(`program policy ${program}.maxRequestsPerSecond precisa ser número positivo`);
    }
  }
  return parsed;
}

export function getReviewValidityReason(entry, { now = Date.now() } = {}) {
  if (entry?.roeReviewed !== true) return null;
  if (!isIsoCalendarDate(entry.nextReviewAt)) {
    return 'revisão de RoE sem nextReviewAt válido';
  }
  const validThrough = Date.parse(`${entry.nextReviewAt}T23:59:59.999Z`);
  if (Number.isNaN(validThrough)) return 'revisão de RoE com nextReviewAt inválido';
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return 'instante de validação de RoE inválido';
  return nowMs > validThrough
    ? `revisão de RoE expirou em ${entry.nextReviewAt}; nova revisão obrigatória antes de pesquisar`
    : null;
}

/** null se o programa não está bloqueado; string com o motivo se está.
 * RoE pendente é avaliada primeiro porque ausência de autorização precisa
 * falhar fechado; depois vêm proibição explícita de IA e bloqueio genérico.
 * Pura -- recebe a policy
 * já carregada, não faz I/O. */
export function getBlockReason(program, policy = {}, options = {}) {
  const entry = policy[program];
  if (!entry) return 'programa sem decisão explícita de RoE no registro local';
  if (entry.roeReviewNeeded) {
    return entry.reason || 'regras de engajamento ainda não revisadas; pesquisa bloqueada até revisão explícita';
  }
  if (entry.aiResearchBanned) {
    return entry.reason || 'pesquisa assistida por IA proibida pelas regras deste programa';
  }
  if (entry.blocked) {
    return entry.reason || 'programa bloqueado para este pipeline';
  }
  if (entry.roeReviewed !== true) {
    return 'entrada de política sem roeReviewed=true; pesquisa bloqueada até revisão explícita';
  }
  const reviewIssue = getReviewValidityReason(entry, options);
  if (reviewIssue) return reviewIssue;
  return null;
}

/** Wrapper booleano de getBlockReason -- pra quem só precisa de sim/não,
 * sem o motivo (ex.: filtrar uma lista antes de decidir o que ler). Pura. */
export function isProgramBanned(program, policy = {}) {
  return getBlockReason(program, policy) !== null;
}

/** Filtra fora todo candidato cujo `.program` não tenha decisão explícita
 * de RoE liberando pesquisa -- gate
 * MECÂNICO pra usar ANTES de escolher o que ler, não só depois de já ter
 * lido (ver list-deep-read-candidates.mjs, criado depois de 4 incidentes
 * em 2 dias de leitura de Block Open Source por não checar isto primeiro
 * -- ver research/bugbounty/block-open-source/NOTES.md, "INCIDENTE").
 * Espera candidato no formato `{program, ...}` (o mesmo já usado em
 * targets-*.mjs/queue.jsonl) -- pra candidato com `programs: [...]`
 * (plural, formato de extractGithubCandidates), filtre chamando
 * isProgramBanned em cada item da lista, não isto aqui. Pura. */
export function filterBannedTargets(candidates, policy = {}) {
  return candidates.filter((c) => !isProgramBanned(c.program, policy));
}
