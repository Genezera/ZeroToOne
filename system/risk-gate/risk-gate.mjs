import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appendEntry, readLedger } from '../ledger/ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getLimitsPath() {
  return process.env.ZERO2ONE_RISK_LIMITS_PATH
    ? path.resolve(process.env.ZERO2ONE_RISK_LIMITS_PATH)
    : path.resolve(__dirname, '..', '..', 'checkpoint', 'risk_limits.json');
}

function loadLimits() {
  const p = getLimitsPath();
  if (!existsSync(p)) {
    throw new Error(`Arquivo de limites de risco não encontrado em ${p} — recusando operar sem limites definidos.`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

function sumRealizedLosses({ onlyToday }) {
  const today = new Date().toISOString().slice(0, 10);
  let loss = 0;
  for (const env of ['canary', 'production']) {
    for (const entry of readLedger(env)) {
      if (entry.type !== 'realized_pnl' || typeof entry.amountUsd !== 'number' || entry.amountUsd >= 0) continue;
      if (onlyToday && entry.ts.slice(0, 10) !== today) continue;
      loss += -entry.amountUsd;
    }
  }
  return loss;
}

/**
 * Gate obrigatório antes de QUALQUER ação com dinheiro real (canary/production).
 * Nunca se autoaprova: approvedByUser precisa vir de uma confirmação explícita
 * do usuário no chat, repassada por quem chama esta função — nunca inferida,
 * nunca assumida como "já aprovado antes".
 */
export function checkRealMoneyAction({ env, amountUsd, description, approvedByUser }) {
  const limits = loadLimits();
  const checks = [];
  let allowed = true;

  if (approvedByUser !== true) {
    allowed = false;
    checks.push('BLOQUEADO: nenhuma ação com dinheiro real é permitida sem approvedByUser === true, confirmado explicitamente pelo usuário no chat.');
  }

  if (limits.leverageAllowed === false && description && /alavanc|leverage|margin/i.test(description)) {
    allowed = false;
    checks.push('BLOQUEADO: descrição sugere alavancagem, proibida pelos limites de risco.');
  }

  if (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    allowed = false;
    checks.push('BLOQUEADO: amountUsd inválido (precisa ser número positivo).');
  } else if (amountUsd > limits.maxPerExperimentUsd) {
    allowed = false;
    checks.push(`BLOQUEADO: US$${amountUsd} excede o máximo por experimento (US$${limits.maxPerExperimentUsd}).`);
  }

  const lossToday = sumRealizedLosses({ onlyToday: true });
  if (lossToday >= limits.maxDailyLossUsd) {
    allowed = false;
    checks.push(`BLOQUEADO: perda realizada hoje (US$${lossToday.toFixed(2)}) já atingiu o limite diário (US$${limits.maxDailyLossUsd}).`);
  }

  const lossCumulative = sumRealizedLosses({ onlyToday: false });
  if (lossCumulative >= limits.cumulativeHardStopUsd) {
    allowed = false;
    checks.push(`BLOQUEADO: perda acumulada (US$${lossCumulative.toFixed(2)}) atingiu o hard stop (US$${limits.cumulativeHardStopUsd}) — pausar dinheiro real até revisão humana.`);
  }

  if (allowed) checks.push('Todas as checagens de risco passaram.');

  const auditEntry = appendEntry('audit', {
    type: 'risk_gate_check',
    requestedEnv: env,
    amountUsd,
    description,
    approvedByUser: approvedByUser === true,
    allowed,
    checks,
  });

  return { allowed, checks, auditEntry };
}

export function getRiskStatus() {
  const limits = loadLimits();
  const lossToday = sumRealizedLosses({ onlyToday: true });
  const lossCumulative = sumRealizedLosses({ onlyToday: false });
  return {
    limits,
    lossToday,
    lossCumulative,
    dailyStopTriggered: lossToday >= limits.maxDailyLossUsd,
    hardStopTriggered: lossCumulative >= limits.cumulativeHardStopUsd,
  };
}
