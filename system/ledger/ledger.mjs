import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// As 6 fases de ambiente exigidas pela missão, mais "audit" para decisões do
// risk-gate (não é PnL, é trilha de auditoria de checagens).
export const ENVIRONMENTS = [
  'research', 'simulation', 'paper', 'shadow', 'canary', 'production', 'audit',
];

function getLedgerDir() {
  return process.env.ZERO2ONE_LEDGER_DIR
    ? path.resolve(process.env.ZERO2ONE_LEDGER_DIR)
    : path.resolve(__dirname, '..', '..', 'ledger');
}

function ledgerFile(env) {
  if (!ENVIRONMENTS.includes(env)) {
    throw new Error(`Ambiente de ledger inválido: "${env}". Válidos: ${ENVIRONMENTS.join(', ')}`);
  }
  return path.join(getLedgerDir(), `ledger.${env}.jsonl`);
}

function lastHash(env) {
  const file = ledgerFile(env);
  if (!existsSync(file)) return '0'.repeat(64);
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return '0'.repeat(64);
  return JSON.parse(lines[lines.length - 1]).hash;
}

/**
 * Grava uma entrada imutável, encadeada por hash, no ledger do ambiente dado.
 * Nunca escreve dinheiro real fora de "canary"/"production" — isso é
 * responsabilidade de quem chama (risk-gate.mjs), não deste módulo.
 */
export function appendEntry(env, entry) {
  const dir = getLedgerDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const prevHash = lastHash(env);
  const record = {
    ...entry,
    ts: entry.ts || new Date().toISOString(),
    env,
    prevHash,
  };
  const hash = createHash('sha256').update(JSON.stringify(record)).digest('hex');
  const full = { ...record, hash };
  appendFileSync(ledgerFile(env), JSON.stringify(full) + '\n', 'utf8');
  return full;
}

export function readLedger(env) {
  const file = ledgerFile(env);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * Verifica a integridade da cadeia de hash — detecta adulteração de
 * qualquer entrada passada (mudar um valor sem recalcular a cadeia inteira
 * quebra a verificação).
 */
export function verifyChain(env) {
  const entries = readLedger(env);
  let prevHash = '0'.repeat(64);
  for (const entry of entries) {
    const { hash, ...rest } = entry;
    if (rest.prevHash !== prevHash) {
      return { valid: false, brokenAt: entry, reason: 'prevHash não bate com o hash anterior da cadeia' };
    }
    const expectedHash = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    if (expectedHash !== hash) {
      return { valid: false, brokenAt: entry, reason: 'hash não bate com o conteúdo (possível adulteração)' };
    }
    prevHash = hash;
  }
  return { valid: true, entries: entries.length };
}
