// Registro de programas cujas próprias regras de engajamento proíbem algo
// que este projeto faz por definição (hoje: pesquisa assistida por IA).
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
 * Pura -- recebe a policy já carregada, não faz I/O. */
export function getBlockReason(program, policy = {}) {
  const entry = policy[program];
  if (entry && entry.aiResearchBanned) {
    return entry.reason || 'pesquisa assistida por IA proibida pelas regras deste programa';
  }
  return null;
}
