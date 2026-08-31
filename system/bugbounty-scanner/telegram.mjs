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
// exatamente o "não é nada", não precisa de aviso). human_ready e
// reproduced_local são o "achei algo real"; known_duplicate/duplicate/
// informative/rejected/triaged/paid/resolved são desfechos reais —
// bons ou ruins, valem saber.
export const NOTABLE_STATES = new Set([
  'reproduced_local',
  'scope_verified',
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

const STATE_EMOJI = {
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

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
