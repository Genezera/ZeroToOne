// Cliente fino pra Bot API do Telegram (api.telegram.org/bot<TOKEN>/...).
// Credenciais NUNCA em arquivo — só via variável de ambiente (setx local,
// nunca commitado), mesmo padrão de h1-api.mjs.
//
// Diferença importante em relação a h1-api.mjs: uma falha de notificação
// NUNCA pode derrubar a lógica real (scan, transição de estado) que a
// chamou. sendTelegramMessage nunca lança — sempre devolve {ok, reason}
// e, na pior hipótese, só perde o aviso (registrado no console), nunca o
// trabalho de verdade.

const API_BASE = 'https://api.telegram.org';

function getCredentials() {
  // Achado real (03/09/2026): usuário recebeu ~17 notificações reais no
  // Telegram real dele com dado de fixture de teste ("Circle BBP" /
  // "p::f::fn::type") -- cada `npm test` que passa por uma transição pra
  // `duplicate`/etc. disparava sendTelegramMessage de verdade, porque
  // nada aqui nunca soube que estava rodando dentro de teste. `npm test`
  // seta `npm_lifecycle_event=test` automaticamente (comportamento do
  // próprio npm, sem dependência nova) -- travar nisso aqui é a defesa
  // que vale pra QUALQUER teste, mesmo um escrito no futuro que esqueça
  // de neutralizar as credenciais no próprio setup (que também foi
  // corrigido, ver withTempEnv nos arquivos de teste -- duas camadas,
  // mesmo princípio de defesa-em-profundidade de program-policy.mjs).
  if (process.env.npm_lifecycle_event === 'test') return null;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

/** Envia uma mensagem de texto pro chat configurado. Nunca lança —
 * ausência de credencial ou falha de rede só vira {ok:false, reason}. */
export async function sendTelegramMessage(text) {
  const creds = getCredentials();
  if (!creds) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID não configurados — notificação pulada:', text.slice(0, 80));
    return { ok: false, reason: 'credenciais não configuradas' };
  }
  try {
    const res = await fetch(`${API_BASE}/bot${creds.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: creds.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      const reason = body?.description || `HTTP ${res.status}`;
      console.warn('[telegram] falha ao enviar notificação:', reason);
      return { ok: false, reason };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[telegram] erro de rede enviando notificação:', err.message);
    return { ok: false, reason: err.message };
  }
}

/** Só pra configuração inicial: acha o chat_id de quem mandou mensagem
 * mais recentemente pro bot (o usuário precisa ter mandado ALGO pro bot
 * antes — bot nunca pode iniciar conversa no Telegram). */
export async function getLatestChatId() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  const res = await fetch(`${API_BASE}/bot${token}/getUpdates`);
  const body = await res.json();
  if (!body.ok) throw new Error(`Telegram getUpdates falhou: ${JSON.stringify(body)}`);
  if (!body.result.length) return null;
  const last = body.result[body.result.length - 1];
  return last.message?.chat?.id ?? null;
}

// Estados que valem uma notificação em tempo real quando um achado
// TRANSICIONA pra eles. Deliberadamente NÃO inclui candidate/
// corroborated_static (cedo demais — a maioria vira false_positive
// logo depois, seria ruído) nem false_positive/inconclusive (é
// exatamente o "não é nada", não precisa de aviso).
//
// Correção real (01/09/2026, usuário reportou "recebendo a mesma
// coisa várias vezes, só de Circle"): `reproduced_local` e
// `scope_verified` SAIRAM desta lista de propósito. Não eram
// duplicata de verdade (cada evento no ledger é único, conferido) —
// era pior pro usuário na prática: um achado real passa por
// `corroborated_static -> reproduced_local -> scope_verified ->
// human_ready` inteiro em SEGUNDOS (às vezes MILISSEGUNDOS — achado
// real no ledger: duas transições 8ms uma da outra), então cada
// achado de verdade virava 3 notificações separadas em sequência
// imediata. 16 dos 19 pushes já enviados eram Circle BBP (único
// programa com investigação real até agora, causa raiz já
// documentada) — sem essas duas serem notáveis, isso vira 1 push por
// achado (`human_ready`, quando fica pronto pra revisão de verdade),
// não 3. O painel continua mostrando o funil completo (todas as
// transições, notáveis ou não) pra quem quiser o detalhe granular —
// isso só afeta o que interrompe o celular do usuário.
export const NOTABLE_STATES = new Set([
  'human_ready',
  'known_duplicate',
  'duplicate',
  'informative',
  'rejected',
  'triaged',
  'paid',
  'resolved',
]);

export function shouldNotifyForTransition(toState) {
  return NOTABLE_STATES.has(toState);
}

export const STATE_EMOJI = {
  reproduced_local: '🧪',
  scope_verified: '📍',
  human_ready: '🚨',
  known_duplicate: '📎',
  duplicate: '📎',
  informative: 'ℹ️',
  rejected: '❌',
  triaged: '👀',
  paid: '💰',
  resolved: '✅',
};

/** Monta o texto da notificação de transição de estado. Pura — não faz
 * rede, só formata a partir do que já se sabe sobre a transição. */
export function formatTransitionMessage(finding, toState, reason) {
  const emoji = STATE_EMOJI[toState] || '🔔';
  const program = finding.program || 'programa desconhecido';
  const asset = finding.asset || finding.file || finding.id;
  const reasonLine = reason ? String(reason).slice(0, 240) : '';
  return [
    `${emoji} <b>ZeroToOne</b> — ${program}`,
    `<code>${escapeHtml(asset)}</code>`,
    `Estado: <b>${toState}</b>`,
    reasonLine ? escapeHtml(reasonLine) : null,
  ].filter(Boolean).join('\n');
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
