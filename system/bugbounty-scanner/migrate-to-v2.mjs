import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openDb, upsertFinding, getFinding, recordTransition, recordDeploymentEvidence, closeDb } from './db.mjs';
import { loadSnapshot, scopeGate } from './scope-registry.mjs';

const BUGBOUNTY_DIR = path.join('research', 'bugbounty');
const QUEUE_PATH = path.join(BUGBOUNTY_DIR, 'queue.jsonl');
const DB_PATH = path.join(BUGBOUNTY_DIR, 'zerotoone.db');
const MIGRATION_LOG_PATH = path.join('docs', 'zerotoone-v2', 'migration-log.json');

function readQueue(queuePath = QUEUE_PATH) {
  if (!existsSync(queuePath)) return [];
  return readFileSync(queuePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function assetRefFor(entry) {
  // O campo `file` de achado não-Clarity já é "owner/repo/caminho..." ou
  // uma URL raw — scope-registry.assetInScope faz match por substring de
  // owner/repo, então basta o valor bruto.
  return entry.file || entry.id;
}

/**
 * Migra os N itens de queue.jsonl (schema v1: status/verdict) pro banco
 * v2 (schema state-machine.mjs), reproduzindo cada transição de verdade
 * pela máquina de estados — nunca setando `state` direto. Se uma
 * transição pretendida falhar a precondição, o item fica no estado mais
 * alto que a evidência REAL já registrada sustenta, e o motivo da
 * parada fica no log de migração (nunca escondido).
 */
export function migrateEntry(db, entry, { scopeSnapshots = {} } = {}) {
  const log = { id: entry.id, steps: [] };
  const finding = {
    id: entry.id,
    exactFingerprint: entry.id,
    program: entry.program,
    platform: entry.platform,
    asset: assetRefFor(entry),
    type: entry.type,
    language: entry.language,
    file: entry.file,
    function: entry.function,
    state: 'candidate',
    confidence: entry.confidence,
    historicalConfidence: entry.historicalConfidence,
    reasoning: entry.reasoning || entry.note || '(sem reasoning registrado no v1)',
    filesRead: entry.filesRead && entry.filesRead.length ? entry.filesRead : (entry.file ? [entry.file] : []),
    pocRun: !!entry.pocRun,
    pocResult: entry.pocResult || null,
    createdAt: entry.foundAt,
  };
  upsertFinding(db, finding);
  log.steps.push({ to: 'candidate', ok: true, reason: 'estado inicial de todo finding migrado' });

  const verdict = entry.verdict;
  if (!verdict || entry.status === 'pending') {
    log.finalState = 'candidate';
    return log;
  }

  if (verdict === 'falso_positivo') {
    const r = recordTransition(db, entry.id, 'false_positive', { actor: 'migration-v1-to-v2', context: {} });
    log.steps.push({ to: 'false_positive', ...r });
    log.finalState = r.ok ? 'false_positive' : 'candidate';
    return log;
  }
  if (verdict === 'inconclusivo') {
    const r = recordTransition(db, entry.id, 'inconclusive', { actor: 'migration-v1-to-v2', context: {} });
    log.steps.push({ to: 'inconclusive', ...r });
    log.finalState = r.ok ? 'inconclusive' : 'candidate';
    return log;
  }

  if (verdict === 'confirmado') {
    // Tenta subir o mais alto que a evidência REAL hoje sustenta —
    // documentando cada degrau, inclusive onde parou e por quê.
    const step1 = recordTransition(db, entry.id, 'corroborated_static', {
      actor: 'migration-v1-to-v2',
      context: { filesRead: finding.filesRead },
    });
    log.steps.push({ to: 'corroborated_static', ...step1 });
    if (!step1.ok) { log.finalState = 'candidate'; return log; }

    const step2 = recordTransition(db, entry.id, 'reproduced_local', {
      actor: 'migration-v1-to-v2',
      context: {
        validations: finding.pocRun && finding.pocResult
          ? [{ type: 'foundry_poc', result: finding.pocResult, ts: entry.foundAt }]
          : [],
      },
    });
    log.steps.push({ to: 'reproduced_local', ...step2 });

    const currentState = step2.ok ? 'reproduced_local' : 'corroborated_static';
    if (currentState === 'reproduced_local') {
      const snapshot = scopeSnapshots[entry.program] || null;
      const gate = scopeGate(snapshot, assetRefFor(entry));
      recordDeploymentEvidence(db, entry.id, {
        repo: (entry.file || '').split('/').slice(0, 2).join('/') || null,
        confidence: 'unverified',
        notes: 'Migração v1→v2: nenhuma verificação de deploy/release real foi feita para este achado ainda — vínculo repo→release→deploy não confirmado.',
      });
      const step3 = recordTransition(db, entry.id, 'scope_verified', {
        actor: 'migration-v1-to-v2',
        context: { scopeGateResult: gate, deploymentEvidence: { confidence: 'unverified' } },
      });
      log.steps.push({ to: 'scope_verified', ...step3 });
    }
    log.finalState = getFinding(db, entry.id).state;
    return log;
  }

  log.finalState = 'candidate';
  log.steps.push({ note: `verdict "${verdict}" não reconhecido pela migração — ficou em candidate` });
  return log;
}

export function migrateAll({ queuePath = QUEUE_PATH, dbPath = DB_PATH, writeLog = true } = {}) {
  const entries = readQueue(queuePath);
  const db = openDb(dbPath);
  const scopeSnapshots = {
    'Circle BBP': loadSnapshot('Circle BBP'),
    'Vercel Open Source': loadSnapshot('Vercel Open Source'),
    'Block Open Source': loadSnapshot('Block Open Source'),
    'StackingDAO': loadSnapshot('StackingDAO'),
  };
  const logs = entries.map((e) => migrateEntry(db, e, { scopeSnapshots }));
  closeDb(db);

  if (writeLog) {
    const dir = path.dirname(MIGRATION_LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(MIGRATION_LOG_PATH, JSON.stringify({ migratedAt: new Date().toISOString(), total: entries.length, logs }, null, 2) + '\n', 'utf8');
  }
  return logs;
}

const isMain = process.argv[1] && process.argv[1].endsWith('migrate-to-v2.mjs');
if (isMain) {
  const logs = migrateAll();
  const byFinal = {};
  for (const l of logs) byFinal[l.finalState] = (byFinal[l.finalState] || 0) + 1;
  console.log(`Migrados ${logs.length} findings de queue.jsonl -> ${DB_PATH}`);
  console.log('Estado final v2, por contagem:', JSON.stringify(byFinal, null, 2));
  console.log(`Log completo em ${MIGRATION_LOG_PATH}`);
}
