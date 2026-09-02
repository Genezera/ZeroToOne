import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb, upsertFinding, getFinding, recordTransition, recordDeploymentEvidence, closeDb,
  recordPlatformOutcome, latestPlatformOutcome, latestDeploymentEvidence, recordValidation, listValidations, recordReport, latestReport,
} from './db.mjs';
import { loadSnapshot, scopeGate } from './scope-registry.mjs';
import { readLedger } from '../ledger/ledger.mjs';
import { deriveStatesFromLedger } from './state-machine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const QUEUE_PATH = path.join(BUGBOUNTY_DIR, 'queue.jsonl');
const DB_PATH = path.join(BUGBOUNTY_DIR, 'zerotoone.db');
const MIGRATION_LOG_PATH = path.join(REPO_ROOT, 'docs', 'zerotoone-v2', 'migration-log.json');

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
 * Restaura, de forma idempotente, as 4 tabelas satélite (platformOutcome,
 * deploymentEvidence, validationsHistory, report) quando presentes na
 * linha da fila — contraparte de `exportFindingsToQueueLines` em
 * db.mjs. Corrige o bug real de 02/09/2026: essas 4 tabelas nunca eram
 * exportadas, então esse dado sumia entre ambientes efêmeros exatamente
 * do mesmo jeito que `state` sumia antes da migração v1→v2 existir.
 *
 * Idempotente por comparação explícita contra o que já existe no banco
 * (não `INSERT` cego): rodar isto de novo pra uma linha sem mudança
 * nenhuma não duplica linha na tabela satélite nem gera evento novo no
 * ledger (as 4 funções record* abaixo anexam ledger a cada chamada
 * real — ver db.mjs). `platformOutcome`/`deploymentEvidence`/`report`
 * comparam contra o "latest" atual; `validationsHistory` (lista, não
 * singular) compara por `type+ts`, restaurando só as entradas que ainda
 * não existem.
 */
function restoreSatelliteData(db, findingId, entry) {
  const notes = [];

  if (entry.platformOutcome) {
    const current = latestPlatformOutcome(db, findingId);
    const same = current
      && current.state === entry.platformOutcome.state
      && current.platform === (entry.platformOutcome.platform || null)
      && current.external_report_id === (entry.platformOutcome.externalReportId || null);
    if (!same) {
      recordPlatformOutcome(db, findingId, entry.platformOutcome);
      notes.push(`platformOutcome restaurado da fila (state="${entry.platformOutcome.state}")`);
    }
  }

  if (entry.deploymentEvidence) {
    const current = latestDeploymentEvidence(db, findingId);
    const same = current
      && current.confidence === entry.deploymentEvidence.confidence
      && current.deployed_address === (entry.deploymentEvidence.deployedAddress || null)
      && current.commit_sha === (entry.deploymentEvidence.commit || null);
    if (!same) {
      recordDeploymentEvidence(db, findingId, entry.deploymentEvidence);
      notes.push('deploymentEvidence restaurado da fila');
    }
  }

  if (Array.isArray(entry.validationsHistory) && entry.validationsHistory.length > 0) {
    const existingKeys = new Set(listValidations(db, findingId).map((v) => `${v.type}|${v.ts}`));
    for (const v of entry.validationsHistory) {
      const key = `${v.type}|${v.ts}`;
      if (!existingKeys.has(key)) {
        recordValidation(db, findingId, v);
        notes.push(`validation "${v.type}" (${v.ts}) restaurada da fila`);
      }
    }
  }

  if (entry.report) {
    const current = latestReport(db, findingId);
    if (!current || current.path !== entry.report.path) {
      recordReport(db, findingId, entry.report.path);
      notes.push(`report restaurado da fila (${entry.report.path})`);
    }
  }

  return notes;
}

/**
 * Migra os N itens de queue.jsonl (schema v1: status/verdict) pro banco
 * v2 (schema state-machine.mjs), reproduzindo cada transição de verdade
 * pela máquina de estados — nunca setando `state` direto. Se uma
 * transição pretendida falhar a precondição, o item fica no estado mais
 * alto que a evidência REAL já registrada sustenta, e o motivo da
 * parada fica no log de migração (nunca escondido).
 */
export function migrateEntry(db, entry, { scopeSnapshots = {}, ledgerStates = new Map() } = {}) {
  const log = { id: entry.id, steps: [] };

  // Idempotência precisa de DUAS checagens independentes, cobrindo os
  // dois jeitos que este script roda de verdade:
  //
  // 1. `entry.state` na PRÓPRIA LINHA da fila — sinal que sobrevive
  //    entre ambientes efêmeros (o agente de nuvem começa cada rodada
  //    com um banco local vazio; só queue.jsonl, clonado do Git, carrega
  //    o estado real entre uma rodada e outra depois que export-queue
  //    grava `state` de volta nele).
  // 2. Estado já existente no BANCO pro mesmo id — sinal que protege
  //    reexecução manual no MESMO ambiente persistente (Windows local)
  //    antes de export-queue ter rodado em cima do arquivo real.
  //
  // Faltar a (1) faz o agente de nuvem duplicar entrada no ledger toda
  // vez que reconstrói o banco do zero. Faltar a (2) faz uma reexecução
  // manual local duplicar antes do primeiro export-queue. Os dois casos
  // já aconteceram de verdade nesta sessão enquanto eu testava — por
  // isso as duas checagens, não uma só.
  if (entry.state && entry.state !== 'candidate') {
    // O ledger é a fonte de verdade (append-only, nunca sofre a corrida
    // de exportação entre ambientes efêmeros concorrentes — ver
    // deriveStatesFromLedger). Se ele registra uma transição pra este id
    // diferente do que a linha da fila diz, o ledger vence: a linha da
    // fila pode ser um `state` mais velho que sobrescreveu por cima de
    // um mais novo numa corrida real de export (já aconteceu nesta
    // missão — Vercel SSO voltou de inconclusive pra corroborated_static
    // silenciosamente).
    const ledgerTruth = ledgerStates.get(entry.id);
    const driftDetected = ledgerTruth && ledgerTruth.state !== entry.state;
    const finalState = driftDetected ? ledgerTruth.state : entry.state;

    upsertFinding(db, {
      id: entry.id, exactFingerprint: entry.id, program: entry.program, platform: entry.platform,
      asset: assetRefFor(entry), type: entry.type, language: entry.language, file: entry.file, function: entry.function,
      state: finalState, confidence: entry.confidence, historicalConfidence: entry.historicalConfidence,
      reasoning: entry.reasoning, filesRead: entry.filesRead || [], pocRun: !!entry.pocRun, pocResult: entry.pocResult || null,
      createdAt: entry.createdAt || entry.foundAt,
    });
    const satelliteNotes = restoreSatelliteData(db, entry.id, entry);
    for (const note of satelliteNotes) log.steps.push({ note });
    log.finalState = finalState;
    if (driftDetected) {
      log.steps.push({
        to: finalState, ok: true,
        reason: `DRIFT CORRIGIDO: fila trazia "${entry.state}", ledger registra "${ledgerTruth.state}" (${ledgerTruth.ts}) — ledger prevaleceu`,
      });
    } else {
      log.steps.push({ to: entry.state, ok: true, reason: 'linha da fila já vinha com `state` de uma exportação v2 anterior — só sincronizado, não reprocessado' });
    }
    return log;
  }
  const existing = getFinding(db, entry.id);
  if (existing && existing.state && existing.state !== 'candidate') {
    const satelliteNotes = restoreSatelliteData(db, entry.id, entry);
    for (const note of satelliteNotes) log.steps.push({ note });
    log.finalState = existing.state;
    log.steps.push({ to: existing.state, ok: true, reason: 'já migrado anteriormente (banco já tem este id além de "candidate") — não reprocessado' });
    return log;
  }

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
  const satelliteNotes = restoreSatelliteData(db, entry.id, entry);
  for (const note of satelliteNotes) log.steps.push({ note });

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

export function migrateAll({ queuePath = QUEUE_PATH, dbPath = DB_PATH, writeLog = true, ledgerEnv = 'research' } = {}) {
  const entries = readQueue(queuePath);
  const db = openDb(dbPath);
  const scopeSnapshots = {
    'Circle BBP': loadSnapshot('Circle BBP'),
    'Vercel Open Source': loadSnapshot('Vercel Open Source'),
    'Block Open Source': loadSnapshot('Block Open Source'),
    'StackingDAO': loadSnapshot('StackingDAO'),
  };
  let ledgerStates = new Map();
  try {
    ledgerStates = deriveStatesFromLedger(readLedger(ledgerEnv));
  } catch {
    // Sem ledger legível (ex.: ambiente de teste isolado) — segue sem
    // reconciliação, mesmo comportamento de antes desta função existir.
  }
  const logs = entries.map((e) => migrateEntry(db, e, { scopeSnapshots, ledgerStates }));
  closeDb(db);

  const driftCount = logs.filter((l) => l.steps.some((s) => s.reason && s.reason.startsWith('DRIFT CORRIGIDO'))).length;

  if (writeLog) {
    const dir = path.dirname(MIGRATION_LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(MIGRATION_LOG_PATH, JSON.stringify({ migratedAt: new Date().toISOString(), total: entries.length, driftCorrected: driftCount, logs }, null, 2) + '\n', 'utf8');
  }
  if (driftCount > 0) {
    console.warn(`[migrate-to-v2] ${driftCount} finding(s) tinham drift entre queue.jsonl e o ledger — corrigido a favor do ledger. Ver migration-log.json.`);
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
