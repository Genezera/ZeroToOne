// Rastreia quantos envios ainda restam por programa quando existe um
// limite real (imposto pela plataforma ou auto-imposto pelo usuário por
// prudência) -- não é bloqueio automático como program-policy.mjs (não
// sei os mecanismos exatos de cada limite pra transformar isso num gate
// rígido com segurança), é um AVISO persistente, visível antes de gastar
// um envio, pra não depender de eu lembrar disso numa sessão futura.
//
// Motivo de existir: 31/08/2026, os 2 primeiros envios ao Circle BBP
// (arc-remote-signer, o achado de denylist do Solana) fecharam como
// duplicate contra pesquisador terceiro, sem pagamento -- usuário avisou
// que só restam mais 2 envios pro programa. Com orçamento escasso,
// "achei um `require!` faltando" deixa de ser suficiente sozinho antes
// de gastar um dos 2 -- ver a nota gravada no JSON.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'program-submission-budget.json');

export function loadSubmissionBudget(budgetPath = DEFAULT_PATH) {
  if (!existsSync(budgetPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(budgetPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** null se não há orçamento rastreado pra esse programa (a maioria dos
 * programas não tem limite conhecido) -- nunca inventa um número. */
export function getSubmissionBudget(program, budget = {}) {
  return budget[program] || null;
}
