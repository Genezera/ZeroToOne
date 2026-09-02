// Registro de programas fora de alcance para este pipeline, por dois
// motivos distintos e nomeados separadamente (nunca misturados sob o
// mesmo campo, pra quem ler o JSON no futuro saber exatamente qual é):
// `aiResearchBanned` -- as próprias regras de engajamento do programa
// proíbem algo que este projeto faz por definição (pesquisa assistida
// por IA); `blocked` -- motivo genérico, tipicamente instrução direta
// do usuário pra não investir mais tempo ali (ex.: Circle BBP, 02/09/2026
// -- "não quero nada da circle", depois de já ter esgotado o ângulo
// investigativo principal e pedido explicitamente rotação pra outros
// programas). Nenhum dos dois exige o outro: um programa pode estar
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
// Limite honesto: isso não IMPEDE a pesquisa em si (que já aconteceu antes
// de qualquer chamada a `transition`) -- só impede o achado de avançar no
// nosso próprio pipeline. Continua valendo mesmo assim: é o único ponto
// que TODO caminho (CLI local, CLI do agente de nuvem) atravessa igual.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY_PATH = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'program-policy.json');

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

/** null se o programa não está bloqueado; string com o motivo se está.
 * Checa os dois campos independentemente -- `aiResearchBanned` primeiro
 * só porque é o mais específico/informativo quando os dois por acaso
 * estivessem presentes, não por prioridade real (um programa nunca
 * precisou dos dois ao mesmo tempo até agora). Pura -- recebe a policy
 * já carregada, não faz I/O. */
export function getBlockReason(program, policy = {}) {
  const entry = policy[program];
  if (!entry) return null;
  if (entry.aiResearchBanned) {
    return entry.reason || 'pesquisa assistida por IA proibida pelas regras deste programa';
  }
  if (entry.blocked) {
    return entry.reason || 'programa bloqueado para este pipeline';
  }
  return null;
}

/** Wrapper booleano de getBlockReason -- pra quem só precisa de sim/não,
 * sem o motivo (ex.: filtrar uma lista antes de decidir o que ler). Pura. */
export function isProgramBanned(program, policy = {}) {
  return getBlockReason(program, policy) !== null;
}

/** Filtra fora todo candidato cujo `.program` esteja bloqueado -- gate
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
