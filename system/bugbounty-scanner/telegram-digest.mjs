// Resumo de atividade pro Telegram, lido do LEDGER compartilhado
// (git-sincronizado), não do banco SQLite local -- diferença crítica.
//
// Por que isso precisava existir: o achado do usuário ("só recebo
// coisas da Circle BBP no Telegram") tem uma causa mecânica real, não
// é impressão. `recordTransition` (db.mjs) só notifica em estados
// "notáveis" (ver NOTABLE_STATES em telegram.mjs) -- e até hoje só
// Solidity (Circle BBP) tinha validador de PoC local capaz de fazer um
// achado sair de corroborated_static, o único jeito de chegar num
// estado notável. Vercel/OKG tiveram MUITO trabalho de investigação
// real, mas todo esse trabalho terminou em false_positive/inconclusive
// -- deliberadamente silenciosos por design (evitar ruído de "não é
// nada"), então nunca dispararam nada.
//
// Mas tem uma segunda causa, mais séria: a sessão de nuvem roda numa
// conta/ambiente separado que NÃO tem TELEGRAM_BOT_TOKEN configurado
// (credencial só existe via `setx` nesta máquina Windows -- o sandbox
// de nuvem não tem acesso a isso). Ou seja: mesmo quando a nuvem
// avança um achado pra um estado notável sozinha, a notificação em
// tempo real (fire-and-forget dentro de recordTransition) falha
// silenciosamente por falta de credencial -- nunca chega em lugar
// nenhum. Só transições que eu (sessão local, com credencial de
// verdade) executei diretamente notificaram.
//
// Este módulo não tenta consertar o ambiente de nuvem (não dá, não
// tenho acesso a configurar variável de ambiente lá). Em vez disso,
// lê o LEDGER real -- que É git-sincronizado, reflete transição de
// QUALQUER ambiente -- desde o último checkpoint, e manda pro Telegram
// a partir daqui (ambiente local, com credencial de verdade). Rodado
// pela mesma tarefa agendada diária que já tem acesso à credencial.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLedger } from '../ledger/ledger.mjs';
import { NOTABLE_STATES, STATE_EMOJI, escapeHtml, sendTelegramMessage } from './telegram.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CHECKPOINT_PATH = path.join(REPO_ROOT, 'research', 'bugbounty', 'telegram-digest-checkpoint.json');

// Acima disso, manda um resumo agrupado por programa em vez de uma
// mensagem por transição -- nunca deixa uma rodada que acumulou muita
// coisa (ex.: primeira vez rodando isso, ou um dia sem checagem) virar
// spam de dezenas de mensagens.
const MAX_INDIVIDUAL_MESSAGES = 6;

export function loadCheckpoint(checkpointPath = DEFAULT_CHECKPOINT_PATH) {
  if (!existsSync(checkpointPath)) return { lastHash: null };
  try {
    const parsed = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { lastHash: null };
  } catch {
    return { lastHash: null };
  }
}

export function saveCheckpoint(checkpoint, checkpointPath = DEFAULT_CHECKPOINT_PATH) {
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2) + '\n', 'utf8');
}

function programOf(findingId) {
  return (findingId || '').split('::')[0] || 'programa desconhecido';
}

/** Pura -- toda transição notável no ledger DEPOIS do hash de
 * checkpoint (de qualquer ator/ambiente). Se o hash não for encontrado
 * (ledger foi recriado/truncado), processa desde o início -- melhor
 * notificar de novo algo já visto do que nunca notificar por um
 * checkpoint órfão. */
export function findNewNotableTransitions(entries, lastHash) {
  let startIdx = 0;
  if (lastHash) {
    const idx = entries.findIndex((e) => e.hash === lastHash);
    if (idx !== -1) startIdx = idx + 1;
  }
  return entries.slice(startIdx).filter((e) => e.type === 'bugbounty_state_transition' && NOTABLE_STATES.has(e.to));
}

export function groupByProgram(transitions) {
  const byProgram = {};
  for (const t of transitions) {
    const program = programOf(t.findingId);
    byProgram[program] = byProgram[program] || [];
    byProgram[program].push(t);
  }
  return byProgram;
}

export function formatIndividualMessage(t) {
  const emoji = STATE_EMOJI[t.to] || '🔔';
  return [
    `${emoji} <b>ZeroToOne</b> — ${escapeHtml(programOf(t.findingId))}`,
    `<code>${escapeHtml(t.findingId || '')}</code>`,
    `${escapeHtml(t.from || '?')} → <b>${escapeHtml(t.to)}</b>`,
    t.rationale ? escapeHtml(String(t.rationale).slice(0, 240)) : null,
    `Por: ${escapeHtml(t.actor || 'desconhecido')}`,
  ].filter(Boolean).join('\n');
}

export function formatGroupedDigest(transitions) {
  const byProgram = groupByProgram(transitions);
  const lines = [`📊 <b>ZeroToOne — resumo de atividade</b> (${transitions.length} transições notáveis desde a última checagem, todos os programas/ambientes)`];
  for (const [program, ts] of Object.entries(byProgram)) {
    const counts = {};
    for (const t of ts) counts[t.to] = (counts[t.to] || 0) + 1;
    const countsStr = Object.entries(counts).map(([s, n]) => `${s}: ${n}`).join(', ');
    lines.push(`• <b>${escapeHtml(program)}</b> — ${countsStr}`);
  }
  return lines.join('\n');
}

/** Roda o digest de verdade: lê o ledger real, acha transição notável
 * nova de QUALQUER ambiente, manda pro Telegram, avança o checkpoint.
 * `sendFn`/`ledgerEnv`/`checkpointPath` injetáveis só pra teste. */
export async function runTelegramDigest({
  checkpointPath = DEFAULT_CHECKPOINT_PATH,
  ledgerEnv = 'research',
  sendFn = sendTelegramMessage,
  readLedgerFn = readLedger,
} = {}) {
  const entries = readLedgerFn(ledgerEnv);
  const checkpoint = loadCheckpoint(checkpointPath);
  const notable = findNewNotableTransitions(entries, checkpoint.lastHash);
  const latestHash = entries.length ? entries[entries.length - 1].hash : (checkpoint.lastHash ?? null);

  let sent = 0;
  if (notable.length > 0) {
    if (notable.length <= MAX_INDIVIDUAL_MESSAGES) {
      for (const t of notable) {
        const res = await sendFn(formatIndividualMessage(t));
        if (res.ok) sent++;
      }
    } else {
      const res = await sendFn(formatGroupedDigest(notable));
      if (res.ok) sent = 1;
    }
  }

  saveCheckpoint({ lastHash: latestHash, lastCheckedAt: new Date().toISOString() }, checkpointPath);
  return { sent, notable: notable.length };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runTelegramDigest().then((result) => {
    console.log(`Digest do Telegram: ${result.notable} transição(ões) notável(is) encontrada(s), ${result.sent} mensagem(ns) enviada(s).`);
  });
}
