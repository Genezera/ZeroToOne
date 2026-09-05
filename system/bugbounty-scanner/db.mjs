import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { transition as smTransition } from './state-machine.mjs';
import { appendEntry } from '../ledger/ledger.mjs';
import { sendTelegramMessage, shouldNotifyForTransition, formatTransitionMessage } from './telegram.mjs';
import { loadProgramPolicyStrict } from './program-policy.mjs';
import { deriveSemanticFingerprint } from './semantic-fingerprint.mjs';
import { validateImpactAssessment } from './impact-assessment.mjs';
import { investigationIdFor } from './investigation-id.mjs';
import { assetRefForFinding, loadSnapshot, scopeGate } from './scope-registry.mjs';

// Estado operacional local (SQLite/WAL) — substitui queue.jsonl como
// fonte de verdade para leitura/escrita concorrente (seção 6.5 da
// auditoria). O ledger hash-chain (system/ledger/ledger.mjs) CONTINUA
// sendo a trilha de auditoria tamper-evident — este módulo não duplica
// aquele mecanismo, só grava um evento no ledger a cada transição real e
// guarda o hash resultante junto da linha operacional, pra as duas
// fontes ficarem cruzáveis sem ficarem redundantes.

// Lacuna #8 da revisão de 03/09/2026: "cada evento precisa de contrato
// versionado". Não construímos um barramento de eventos novo (o ledger
// hash-chain já cumpre "estruturado, imutável, consumível" -- ninguém
// pediu pra rodar um message bus além disso); isto é o pedaço proporcional
// que faltava: um número de versão em cada evento bugbounty_* gravado, pra
// um consumidor futuro (dashboard, outro ambiente lendo o ledger) saber
// tratar o formato mudando sem adivinhar pela presença/ausência de campos.
// correlationId liga validation/code-age/report/duplicateCheck/
// impactAssessment/outcome pelo id determinístico de investigação, estável
// entre o worker local e checkouts efêmeros.
export const LEDGER_SCHEMA_VERSION = 1;

let LEDGER_WRITE_SUPPRESSION_DEPTH = 0;

/** Restauração de uma materialized view local não é um novo evento de
 * pesquisa. Este escopo síncrono permite hidratar o SQLite a partir dos
 * arquivos versionados sem reapensar centenas de fatos já existentes. */
export function withoutLedgerWrites(callback) {
  LEDGER_WRITE_SUPPRESSION_DEPTH += 1;
  try { return callback(); }
  finally { LEDGER_WRITE_SUPPRESSION_DEPTH -= 1; }
}

function appendFindingLedger(findingId, entry) {
  if (LEDGER_WRITE_SUPPRESSION_DEPTH > 0) return { hash: null, suppressed: true };
  return appendEntry('research', {
    ...entry,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    findingId,
    correlationId: investigationIdFor(findingId),
  });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  exact_fingerprint TEXT NOT NULL,
  semantic_fingerprint TEXT,
  program TEXT NOT NULL,
  platform TEXT,
  asset TEXT,
  type TEXT NOT NULL,
  language TEXT,
  file TEXT,
  fn TEXT,
  line TEXT,
  state TEXT NOT NULL,
  confidence TEXT,
  historical_confidence REAL,
  reasoning TEXT,
  files_read_json TEXT,
  poc_run INTEGER,
  poc_result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS state_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor TEXT NOT NULL,
  rationale TEXT NOT NULL,
  ts TEXT NOT NULL,
  context_json TEXT,
  ledger_hash TEXT
);

CREATE TABLE IF NOT EXISTS validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  type TEXT NOT NULL,
  command TEXT,
  result TEXT NOT NULL,
  raw_output TEXT,
  evidence_json TEXT,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  repo TEXT,
  commit_sha TEXT,
  branch_or_tag TEXT,
  package_or_contract TEXT,
  deployed_address TEXT,
  chain_id TEXT,
  block_number TEXT,
  bytecode_hash TEXT,
  confidence TEXT NOT NULL,
  notes TEXT,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  platform TEXT,
  external_report_id TEXT,
  submitted_at TEXT,
  state TEXT NOT NULL,
  severity_final TEXT,
  bounty_amount TEXT,
  original_report_id TEXT,
  original_submitted_at TEXT,
  original_state TEXT,
  comments TEXT,
  updated_at TEXT NOT NULL
);

-- Checagem obrigatória de duplicata antes de human_ready (state-machine.mjs,
-- gate adicionado 31/08/2026 depois de 2 achados seguidos se revelarem
-- duplicata pública já conhecida sem essa checagem). Tabela própria (não só
-- context_json de state_transitions) pelo mesmo motivo de validations/
-- deployment_evidence: precisa ser consultável sem reconstruir o histórico.
CREATE TABLE IF NOT EXISTS duplicate_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  methods_json TEXT NOT NULL,
  query TEXT,
  queries_json TEXT,
  results_json TEXT,
  evidence_json TEXT,
  signals_json TEXT,
  novelty_proof_json TEXT,
  found_existing INTEGER NOT NULL DEFAULT 0,
  found_existing_ref TEXT,
  novelty_status TEXT,
  risk_score REAL,
  risk_level TEXT,
  notes TEXT,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS impact_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  assessment_json TEXT NOT NULL,
  reportable INTEGER NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_age_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  repository TEXT NOT NULL,
  path TEXT NOT NULL,
  ref TEXT,
  method TEXT NOT NULL,
  commit_sha TEXT,
  commit_date TEXT,
  age_days INTEGER,
  limitation TEXT,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  external_report_id TEXT NOT NULL,
  program TEXT,
  repository TEXT,
  title TEXT,
  submitted_at TEXT,
  state TEXT,
  original_report_id TEXT,
  original_submitted_at TEXT,
  original_state TEXT,
  severity_final TEXT,
  bounty_amount TEXT,
  comments TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, external_report_id)
);

CREATE TABLE IF NOT EXISTS submission_findings (
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  finding_id TEXT NOT NULL REFERENCES findings(id),
  PRIMARY KEY (submission_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_findings_state ON findings(state);
CREATE INDEX IF NOT EXISTS idx_findings_program ON findings(program);
CREATE INDEX IF NOT EXISTS idx_transitions_finding ON state_transitions(finding_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_checks_finding ON duplicate_checks(finding_id);
CREATE INDEX IF NOT EXISTS idx_impact_assessments_finding ON impact_assessments(finding_id);
CREATE INDEX IF NOT EXISTS idx_code_age_evidence_finding ON code_age_evidence(finding_id);
CREATE INDEX IF NOT EXISTS idx_submission_findings_finding ON submission_findings(finding_id);
`;

const DB_PATHS = new WeakMap();
const IMPORTING_SUBMISSIONS = new WeakSet();

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function openDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  DB_PATHS.set(db, path.resolve(dbPath));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // CREATE TABLE IF NOT EXISTS não acrescenta colunas a bancos locais já
  // existentes. Estas migrações aditivas mantêm ambientes persistentes e
  // bancos novos com o mesmo contrato.
  for (const [table, column, definition] of [
    ['platform_outcomes', 'original_report_id', 'TEXT'],
    ['platform_outcomes', 'original_submitted_at', 'TEXT'],
    ['platform_outcomes', 'original_state', 'TEXT'],
    ['duplicate_checks', 'queries_json', 'TEXT'],
    ['duplicate_checks', 'results_json', 'TEXT'],
    ['duplicate_checks', 'evidence_json', 'TEXT'],
    ['duplicate_checks', 'signals_json', 'TEXT'],
    ['duplicate_checks', 'novelty_proof_json', 'TEXT'],
    ['duplicate_checks', 'novelty_status', 'TEXT'],
    ['duplicate_checks', 'risk_score', 'REAL'],
    ['duplicate_checks', 'risk_level', 'TEXT'],
    ['submissions', 'repository', 'TEXT'],
    ['validations', 'evidence_json', 'TEXT'],
  ]) ensureColumn(db, table, column, definition);
  importSubmissionsFromJsonl(db, path.join(dir, 'submissions.jsonl'));
  backfillSemanticFingerprints(db);
  return db;
}

export function backfillSemanticFingerprints(db) {
  const rows = db.prepare('SELECT * FROM findings WHERE semantic_fingerprint IS NULL OR semantic_fingerprint = ?').all('');
  const update = db.prepare('UPDATE findings SET semantic_fingerprint = ? WHERE id = ?');
  for (const row of rows) {
    const finding = rowToFinding(row);
    const fingerprint = deriveSemanticFingerprint({ ...finding.raw, ...finding });
    update.run(fingerprint, finding.id);
  }
  return rows.length;
}

export function upsertFinding(db, finding) {
  const now = finding.updatedAt || new Date().toISOString();
  const existing = getFinding(db, finding.id);
  const createdAt = existing ? existing.createdAt : (finding.createdAt || now);
  const semanticFingerprint = finding.semanticFingerprint || deriveSemanticFingerprint(finding);
  db.prepare(`
    INSERT INTO findings (id, exact_fingerprint, semantic_fingerprint, program, platform, asset, type, language, file, fn, line, state, confidence, historical_confidence, reasoning, files_read_json, poc_run, poc_result, created_at, updated_at, raw_json)
    VALUES (@id, @exact_fingerprint, @semantic_fingerprint, @program, @platform, @asset, @type, @language, @file, @fn, @line, @state, @confidence, @historical_confidence, @reasoning, @files_read_json, @poc_run, @poc_result, @created_at, @updated_at, @raw_json)
    ON CONFLICT(id) DO UPDATE SET
      semantic_fingerprint=excluded.semantic_fingerprint,
      state=excluded.state, confidence=excluded.confidence, historical_confidence=excluded.historical_confidence,
      reasoning=excluded.reasoning, files_read_json=excluded.files_read_json, poc_run=excluded.poc_run,
      poc_result=excluded.poc_result, updated_at=excluded.updated_at, raw_json=excluded.raw_json
  `).run({
    id: finding.id,
    exact_fingerprint: finding.exactFingerprint || finding.id,
    semantic_fingerprint: semanticFingerprint,
    program: finding.program,
    platform: finding.platform || null,
    asset: finding.asset || finding.file || null,
    type: finding.type,
    language: finding.language || null,
    file: finding.file || null,
    fn: finding.function || null,
    line: finding.line != null ? String(finding.line) : null,
    state: finding.state || 'candidate',
    confidence: finding.confidence || null,
    // O scanner produz `{fpRate,sampleSize}`; bancos antigos também podem
    // conter um número. SQLite aceita JSON textual na coluna legada REAL,
    // mas o driver não aceita bind direto de objeto.
    historical_confidence: finding.historicalConfidence == null
      ? null
      : (typeof finding.historicalConfidence === 'object'
        ? JSON.stringify(finding.historicalConfidence)
        : finding.historicalConfidence),
    reasoning: finding.reasoning || null,
    files_read_json: JSON.stringify(finding.filesRead || []),
    poc_run: finding.pocRun ? 1 : 0,
    poc_result: finding.pocResult || null,
    created_at: createdAt,
    updated_at: now,
    raw_json: JSON.stringify(finding),
  });
  return getFinding(db, finding.id);
}

function rowToFinding(row) {
  if (!row) return null;
  const raw = JSON.parse(row.raw_json);
  let historicalConfidence = row.historical_confidence;
  if (typeof historicalConfidence === 'string' && /^[{[]/.test(historicalConfidence.trim())) {
    try { historicalConfidence = JSON.parse(historicalConfidence); } catch { /* mantém valor legado */ }
  }
  return {
    id: row.id,
    correlationId: investigationIdFor(row.id),
    exactFingerprint: row.exact_fingerprint,
    semanticFingerprint: row.semantic_fingerprint,
    program: row.program,
    platform: row.platform,
    asset: row.asset,
    type: row.type,
    language: row.language,
    file: row.file,
    function: row.fn,
    line: row.line,
    state: row.state,
    confidence: row.confidence,
    historicalConfidence,
    reasoning: row.reasoning,
    filesRead: JSON.parse(row.files_read_json || '[]'),
    pocRun: !!row.poc_run,
    pocResult: row.poc_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    changeContext: raw.changeContext || null,
    raw,
  };
}

export function getFinding(db, id) {
  const row = db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
  return rowToFinding(row);
}

export function listFindings(db, { state, program } = {}) {
  let sql = 'SELECT * FROM findings WHERE 1=1';
  const params = [];
  if (state) { sql += ' AND state = ?'; params.push(state); }
  if (program) { sql += ' AND program = ?'; params.push(program); }
  sql += ' ORDER BY updated_at DESC';
  return db.prepare(sql).all(...params).map(rowToFinding);
}

/**
 * Única forma legítima de mudar o estado de um finding. Valida contra
 * state-machine.mjs, e SÓ SE a transição for válida: atualiza a linha,
 * grava o histórico em state_transitions, E anexa um evento no ledger
 * hash-chain (ambiente 'research') — nunca muda estado silenciosamente.
 */
export function recordTransition(db, findingId, toState, { actor, context = {}, notify = true } = {}) {
  const finding = getFinding(db, findingId);
  if (!finding) return { ok: false, reason: `finding "${findingId}" não existe no banco` };
  // programPolicy é injetado aqui, não deixado a cargo de quem chama --
  // é o único jeito de o bloqueio valer pra QUALQUER chamador (CLI local,
  // CLI do agente de nuvem) sem depender de cada um lembrar de checar.
  // Fica fora do context_json persistido abaixo (é dado de sistema, não
  // evidência que o chamador forneceu) -- usa `context`, não `fullContext`.
  // Evidências de prontidão são carregadas do banco por padrão. Assim um
  // chamador não consegue contornar o gate omitindo/forjando contexto, e um
  // finding human_ready antigo é rechecado no momento de submeter.
  const finalSubmissionGate = toState === 'human_ready' || toState === 'submitted';
  const scopeRequired = toState === 'scope_verified' || finalSubmissionGate;
  const storedDeploymentEvidence = latestDeploymentEvidence(db, findingId);
  const storedValidations = listValidations(db, findingId);
  const fullContext = {
    ...context,
    report: latestReport(db, findingId),
    duplicateCheck: latestDuplicateCheck(db, findingId),
    impactAssessment: latestImpactAssessment(db, findingId),
    // Final readiness can only consume persisted evidence. Earlier migration
    // transitions retain their legacy context compatibility.
    deploymentEvidence: finalSubmissionGate
      ? storedDeploymentEvidence
      : (context.deploymentEvidence || storedDeploymentEvidence),
    validations: finalSubmissionGate
      ? storedValidations
      : (context.validations || storedValidations),
    scopeGateResult: scopeRequired
      ? scopeGate(loadSnapshot(finding.program), assetRefForFinding(finding))
      : context.scopeGateResult,
    programPolicy: loadProgramPolicyStrict(),
  };
  const result = smTransition(finding, toState, fullContext);
  if (!result.ok) return result;

  const ts = new Date().toISOString();
  const ledgerEntry = appendFindingLedger(findingId, {
    type: 'bugbounty_state_transition',
    from: result.from,
    to: result.to,
    actor,
    rationale: result.reason,
  });

  db.prepare(`
    INSERT INTO state_transitions (finding_id, from_state, to_state, actor, rationale, ts, context_json, ledger_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(findingId, result.from, result.to, actor, result.reason, ts, JSON.stringify(context), ledgerEntry.hash);

  db.prepare('UPDATE findings SET state = ?, updated_at = ? WHERE id = ?').run(toState, ts, findingId);

  // Best-effort, nunca aguardado: notificação de Telegram nunca pode
  // atrasar nem quebrar uma transição real (função permanece síncrona de
  // propósito — os dois automatismos, scanner local e agente de nuvem,
  // chamam isso por processos que rodam até o fim naturalmente, sem
  // process.exit() no caminho de sucesso, então a promessa solta tem
  // tempo de completar antes do Node encerrar).
  //
  // `notify=false` existe pra operação em lote (achado real, 03/09/2026):
  // cmdAutoTriageKnownCve fechou 181 achados numa só chamada -- sem isto,
  // dispara 181 mensagens reais em sequência quase imediata, estourando o
  // rate limit do próprio Telegram ("Too Many Requests") e inundando o
  // usuário. Notificação individual continua sendo o padrão (default
  // notify=true) pro caso comum de UM achado avançando sozinho, que é
  // exatamente o que vale a pena interromper o celular do usuário.
  if (notify && shouldNotifyForTransition(toState)) {
    sendTelegramMessage(formatTransitionMessage(finding, toState, result.reason)).catch(() => {});
  }

  return { ...result, correlationId: investigationIdFor(findingId), ts, ledgerHash: ledgerEntry.hash };
}

export function recordValidation(db, findingId, { type, command, result, rawOutput, evidence = null, ts: suppliedTs }) {
  const ts = suppliedTs || new Date().toISOString();
  db.prepare('INSERT INTO validations (finding_id, type, command, result, raw_output, evidence_json, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(findingId, type, command || null, result, rawOutput || null, evidence ? JSON.stringify(evidence) : null, ts);
  // Ledger backing (02/09/2026): recordTransition sempre anexou evento
  // real; as outras 4 funções record* nunca tocaram o ledger, então essa
  // evidência só sobrevivia no stdout do momento ou em prosa que uma
  // sessão lembrasse de copiar pra NOTES.md -- achado real investigando
  // o outcome do SSRF (image-optimizer.ts, HackerOne #3988959) sumindo
  // entre ambientes. Ver docs/zerotoone-v2/IMPLEMENTATION_STATE.md, seção
  // "Bug real encontrado (2026-09-02)", item (c).
  const execution = evidence?.noveltyProof?.execution;
  const ledgerEntry = appendFindingLedger(findingId, {
    type: 'bugbounty_validation', validationType: type, result,
    evidence: evidence ? {
      provenance: evidence.provenance || null,
      validationScope: execution?.validationScope || null,
      containerImage: execution?.containerImage || null,
      containerImageId: execution?.containerImageId || null,
      isolation: execution?.isolation || null,
    } : null,
    ts,
  });
  return { findingId, correlationId: investigationIdFor(findingId), type, result, ts, ledgerHash: ledgerEntry.hash };
}

export function listValidations(db, findingId) {
  return db.prepare('SELECT * FROM validations WHERE finding_id = ? ORDER BY ts ASC').all(findingId).map((row) => ({
    ...row,
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null,
  }));
}

export function recordDeploymentEvidence(db, findingId, evidence) {
  const ts = evidence.ts || new Date().toISOString();
  db.prepare(`
    INSERT INTO deployment_evidence (finding_id, repo, commit_sha, branch_or_tag, package_or_contract, deployed_address, chain_id, block_number, bytecode_hash, confidence, notes, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(findingId, evidence.repo || null, evidence.commit || null, evidence.branchOrTag || null, evidence.packageOrContract || null,
    evidence.deployedAddress || null, evidence.chainId || null, evidence.blockNumber || null, evidence.bytecodeHash || null,
    evidence.confidence, evidence.notes || null, ts);
  // Ledger backing -- ver comentário em recordValidation.
  const ledgerEntry = appendFindingLedger(findingId, { type: 'bugbounty_deployment_evidence', confidence: evidence.confidence, deployedAddress: evidence.deployedAddress || null, ts });
  return { findingId, correlationId: investigationIdFor(findingId), ...evidence, ts, ledgerHash: ledgerEntry.hash };
}

export function latestDeploymentEvidence(db, findingId) {
  // ORDER BY ts DESC sozinho empata quando 2 chamadas caem no mesmo
  // milissegundo (achado real testando duplicate_checks) -- id DESC
  // desempata por ordem de inserção real, não por timestamp de string.
  return db.prepare('SELECT * FROM deployment_evidence WHERE finding_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(findingId) || null;
}

export function recordCodeAgeEvidence(db, findingId, evidence) {
  if (!getFinding(db, findingId)) throw new Error(`finding "${findingId}" não existe no banco`);
  if (!evidence?.repository || !evidence?.path) throw new Error('code age evidence exige repository e path');
  if (evidence.codeAgeDays !== null && evidence.codeAgeDays !== undefined
    && (!Number.isInteger(evidence.codeAgeDays) || evidence.codeAgeDays < 0)) {
    throw new Error('codeAgeDays precisa ser inteiro não-negativo ou null');
  }
  const checkedAt = evidence.checkedAt || new Date().toISOString();
  const method = evidence.method || 'github_file_last_commit';
  db.prepare(`
    INSERT INTO code_age_evidence (
      finding_id, repository, path, ref, method, commit_sha, commit_date,
      age_days, limitation, checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    findingId, evidence.repository, evidence.path, evidence.ref || null, method,
    evidence.lastCommitSha || null, evidence.lastCommitDate || null,
    evidence.codeAgeDays ?? null, evidence.limitation || null, checkedAt,
  );
  const ledgerEntry = appendFindingLedger(findingId, {
    type: 'bugbounty_code_age', repository: evidence.repository, path: evidence.path,
    ref: evidence.ref || null, method, lastCommitSha: evidence.lastCommitSha || null,
    lastCommitDate: evidence.lastCommitDate || null, codeAgeDays: evidence.codeAgeDays ?? null,
    checkedAt,
  });
  return {
    findingId, correlationId: investigationIdFor(findingId), ...evidence,
    method, checkedAt, ledgerHash: ledgerEntry.hash,
  };
}

export function latestCodeAgeEvidence(db, findingId) {
  const row = db.prepare('SELECT * FROM code_age_evidence WHERE finding_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1').get(findingId);
  if (!row) return null;
  return {
    findingId: row.finding_id, correlationId: investigationIdFor(row.finding_id),
    repository: row.repository, path: row.path, ref: row.ref, method: row.method,
    lastCommitSha: row.commit_sha, lastCommitDate: row.commit_date,
    codeAgeDays: row.age_days, limitation: row.limitation, checkedAt: row.checked_at,
  };
}

export function recordDuplicateCheck(db, findingId, {
  methods, query, queries, results, evidence, signals, noveltyProof, foundExisting, foundExistingRef,
  noveltyStatus, riskScore, riskLevel, notes, ts: suppliedTs,
}) {
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new Error('recordDuplicateCheck precisa de "methods" (array não-vazio, ex.: ["github_issues"])');
  }
  if (typeof foundExisting !== 'boolean') throw new Error('recordDuplicateCheck precisa de foundExisting boolean explícito');
  const normalizedQueries = Array.isArray(queries) ? queries : (query ? [query] : []);
  const ts = suppliedTs || new Date().toISOString();
  db.prepare(`
    INSERT INTO duplicate_checks (
      finding_id, methods_json, query, queries_json, results_json, evidence_json, signals_json, novelty_proof_json,
      found_existing, found_existing_ref, novelty_status, risk_score,
      risk_level, notes, ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    findingId, JSON.stringify(methods), query || normalizedQueries[0] || null,
    JSON.stringify(normalizedQueries), JSON.stringify(results || []), JSON.stringify(evidence || []),
    JSON.stringify(signals || {}), JSON.stringify(noveltyProof || null),
    foundExisting ? 1 : 0, foundExistingRef || null, noveltyStatus || null,
    Number.isFinite(riskScore) ? riskScore : null, riskLevel || null,
    notes || null, ts,
  );
  const ledgerEntry = appendFindingLedger(findingId, {
    type: 'bugbounty_duplicate_check', methods, queries: normalizedQueries, evidence: evidence || [],
    foundExisting: !!foundExisting, noveltyStatus: noveltyStatus || null,
    riskScore: Number.isFinite(riskScore) ? riskScore : null,
    signals: signals || {}, noveltyProof: noveltyProof || null, ts,
  });
  return {
    findingId, correlationId: investigationIdFor(findingId), methods, query: query || normalizedQueries[0] || null,
    queries: normalizedQueries, results: results || [], evidence: evidence || [], signals: signals || {},
    noveltyProof: noveltyProof || null, foundExisting: !!foundExisting,
    foundExistingRef: foundExistingRef || null, noveltyStatus: noveltyStatus || null,
    riskScore: Number.isFinite(riskScore) ? riskScore : null,
    riskLevel: riskLevel || null, notes: notes || null, ts,
    ledgerHash: ledgerEntry.hash,
  };
}

export function latestDuplicateCheck(db, findingId) {
  const row = db.prepare('SELECT * FROM duplicate_checks WHERE finding_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(findingId);
  if (!row) return null;
  return {
    findingId: row.finding_id,
    methods: JSON.parse(row.methods_json),
    query: row.query,
    queries: row.queries_json ? JSON.parse(row.queries_json) : (row.query ? [row.query] : []),
    results: row.results_json ? JSON.parse(row.results_json) : [],
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : [],
    signals: row.signals_json ? JSON.parse(row.signals_json) : {},
    noveltyProof: row.novelty_proof_json ? JSON.parse(row.novelty_proof_json) : null,
    foundExisting: !!row.found_existing,
    foundExistingRef: row.found_existing_ref,
    noveltyStatus: row.novelty_status,
    riskScore: row.risk_score,
    riskLevel: row.risk_level,
    notes: row.notes,
    ts: row.ts,
  };
}

export function recordImpactAssessment(db, findingId, assessment, { allowLegacyUnassessed = false } = {}) {
  const { ts: suppliedTs, ledgerHash: _ignoredLedgerHash, ...payload } = assessment;
  const validation = validateImpactAssessment(payload, { allowLegacyUnassessed });
  if (!validation.ok) throw new Error(`impact assessment inválido: ${validation.errors.join('; ')}`);
  const ts = suppliedTs || new Date().toISOString();
  db.prepare(`
    INSERT INTO impact_assessments (finding_id, assessment_json, reportable, ts)
    VALUES (?, ?, ?, ?)
  `).run(findingId, JSON.stringify(payload), payload.reportable ? 1 : 0, ts);
  const ledgerEntry = appendFindingLedger(findingId, {
    type: 'bugbounty_impact_assessment',
    technicalValidity: payload.technicalValidity,
    reportable: payload.reportable,
    impactScope: payload.impactScope,
    confidentiality: payload.confidentiality,
    integrity: payload.integrity,
    availability: payload.availability,
    severityRating: payload.severityRating || null,
    ts,
  });
  return { findingId, correlationId: investigationIdFor(findingId), ...payload, ts, ledgerHash: ledgerEntry.hash };
}

export function latestImpactAssessment(db, findingId) {
  const row = db.prepare('SELECT * FROM impact_assessments WHERE finding_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(findingId);
  if (!row) return null;
  return { findingId: row.finding_id, ...JSON.parse(row.assessment_json), ts: row.ts };
}

export function recordReport(db, findingId, reportPath, { createdAt } = {}) {
  const ts = createdAt || new Date().toISOString();
  db.prepare('INSERT INTO reports (finding_id, path, created_at) VALUES (?, ?, ?)').run(findingId, reportPath, ts);
  // Ledger backing -- ver comentário em recordValidation.
  const ledgerEntry = appendFindingLedger(findingId, { type: 'bugbounty_report', path: reportPath, ts });
  return { findingId, correlationId: investigationIdFor(findingId), path: reportPath, createdAt: ts, ledgerHash: ledgerEntry.hash };
}

export function latestReport(db, findingId) {
  return db.prepare('SELECT * FROM reports WHERE finding_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(findingId) || null;
}

function submissionId(platform, externalReportId) {
  return `${platform || 'unknown'}:${externalReportId}`;
}

function rowToSubmission(row, findingIds = []) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    externalReportId: row.external_report_id,
    program: row.program,
    repository: row.repository,
    title: row.title,
    submittedAt: row.submitted_at,
    state: row.state,
    originalReportId: row.original_report_id,
    originalSubmittedAt: row.original_submitted_at,
    originalState: row.original_state,
    severityFinal: row.severity_final,
    bountyAmount: row.bounty_amount,
    comments: row.comments,
    updatedAt: row.updated_at,
    findingIds,
  };
}

/** One external report is one learning sample, even when several detector
 * findings supported it. */
export function recordSubmission(db, submission, findingIds = []) {
  if (!submission.externalReportId) throw new Error('submission precisa de externalReportId');
  const platform = submission.platform || 'unknown';
  // A identidade pertence à plataforma, não ao finding nem a um id
  // fornecido por importadores. Isto impede a mesma submissão externa de
  // virar duas amostras estatísticas com ids locais diferentes.
  const id = submissionId(platform, submission.externalReportId);
  const existing = getSubmission(db, id);
  const fields = [
    'program', 'repository', 'title', 'submittedAt', 'state',
    'originalReportId', 'originalSubmittedAt', 'originalState',
    'severityFinal', 'bountyAmount', 'comments',
  ];
  let effectiveSubmission = submission;
  let ts = submission.updatedAt || new Date().toISOString();
  if (existing) {
    const incomingTime = submission.updatedAt ? Date.parse(submission.updatedAt) : Number.NaN;
    const existingTime = existing.updatedAt ? Date.parse(existing.updatedAt) : Number.NaN;
    if (Number.isFinite(incomingTime) && Number.isFinite(existingTime) && incomingTime < existingTime) {
      // Hydration can see the portable submissions.jsonl first and an older
      // platformOutcome embedded in queue.jsonl later. The older copy may
      // add a missing finding link, but it must never roll back the current
      // report state, text or timestamp.
      effectiveSubmission = {
        ...submission,
        ...Object.fromEntries(fields.map((field) => [field, existing[field]])),
      };
      ts = existing.updatedAt;
    }
    const unchangedFields = fields.every((field) => {
      const incoming = effectiveSubmission[field];
      const effective = incoming === undefined || incoming === null || incoming === '' ? existing[field] : incoming;
      return effective === existing[field];
    });
    const effectiveFindingIds = [...new Set([...(existing.findingIds || []), ...findingIds])].sort();
    const existingFindingIds = [...(existing.findingIds || [])].sort();
    if (unchangedFields && JSON.stringify(effectiveFindingIds) === JSON.stringify(existingFindingIds)) {
      return existing;
    }
  }
  db.prepare(`
    INSERT INTO submissions (
      id, platform, external_report_id, program, title, submitted_at, state,
      repository,
      original_report_id, original_submitted_at, original_state,
      severity_final, bounty_amount, comments, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      program=COALESCE(excluded.program, submissions.program),
      repository=COALESCE(excluded.repository, submissions.repository),
      title=COALESCE(excluded.title, submissions.title),
      submitted_at=COALESCE(excluded.submitted_at, submissions.submitted_at),
      state=COALESCE(excluded.state, submissions.state),
      original_report_id=COALESCE(excluded.original_report_id, submissions.original_report_id),
      original_submitted_at=COALESCE(excluded.original_submitted_at, submissions.original_submitted_at),
      original_state=COALESCE(excluded.original_state, submissions.original_state),
      severity_final=COALESCE(excluded.severity_final, submissions.severity_final),
      bounty_amount=COALESCE(excluded.bounty_amount, submissions.bounty_amount),
      comments=COALESCE(excluded.comments, submissions.comments),
      updated_at=excluded.updated_at
  `).run(
    id, platform, String(submission.externalReportId), effectiveSubmission.program || null,
    effectiveSubmission.title || null, effectiveSubmission.submittedAt || null, effectiveSubmission.state || null,
    effectiveSubmission.repository || null,
    effectiveSubmission.originalReportId || null, effectiveSubmission.originalSubmittedAt || null,
    effectiveSubmission.originalState || null, effectiveSubmission.severityFinal || null,
    effectiveSubmission.bountyAmount || null, effectiveSubmission.comments || null, ts,
  );
  for (const findingId of findingIds) {
    db.prepare('INSERT OR IGNORE INTO submission_findings (submission_id, finding_id) VALUES (?, ?)').run(id, findingId);
  }
  const recorded = getSubmission(db, id);
  if (!IMPORTING_SUBMISSIONS.has(db)) persistSubmissionsForDb(db);
  return recorded;
}

export function getSubmission(db, id) {
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
  const findingIds = row
    ? db.prepare('SELECT finding_id FROM submission_findings WHERE submission_id = ? ORDER BY finding_id').all(id).map((x) => x.finding_id)
    : [];
  return rowToSubmission(row, findingIds);
}

export function latestSubmissionForFinding(db, findingId) {
  const row = db.prepare(`
    SELECT s.* FROM submissions s
    JOIN submission_findings sf ON sf.submission_id = s.id
    WHERE sf.finding_id = ? ORDER BY s.updated_at DESC LIMIT 1
  `).get(findingId);
  return row ? getSubmission(db, row.id) : null;
}

export function listSubmissions(db) {
  return db.prepare('SELECT id FROM submissions ORDER BY updated_at DESC').all().map((row) => getSubmission(db, row.id));
}

export function exportSubmissionsToJsonl(db, outputPath) {
  const submissions = listSubmissions(db).sort((a, b) => a.id.localeCompare(b.id));
  const lines = submissions.map((submission) => JSON.stringify(submission));
  writeFileSync(outputPath, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  return submissions.length;
}

export function importSubmissionsFromJsonl(db, inputPath) {
  if (!existsSync(inputPath)) return 0;
  const lines = readFileSync(inputPath, 'utf8').split(/\r?\n/).filter(Boolean);
  IMPORTING_SUBMISSIONS.add(db);
  try {
    for (let index = 0; index < lines.length; index++) {
      let submission;
      try { submission = JSON.parse(lines[index]); }
      catch (error) { throw new Error(`submissions.jsonl inválido na linha ${index + 1}: ${error.message}`); }
      const existingFindingIds = (submission.findingIds || []).filter((findingId) => !!getFinding(db, findingId));
      recordSubmission(db, submission, existingFindingIds);
    }
  } finally {
    IMPORTING_SUBMISSIONS.delete(db);
  }
  return lines.length;
}

function persistSubmissionsForDb(db) {
  const dbPath = DB_PATHS.get(db);
  if (!dbPath) return;
  exportSubmissionsToJsonl(db, path.join(path.dirname(dbPath), 'submissions.jsonl'));
}

export function recordPlatformOutcome(db, findingId, outcome) {
  const ts = outcome.updatedAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO platform_outcomes (
      finding_id, platform, external_report_id, submitted_at, state,
      severity_final, bounty_amount, original_report_id,
      original_submitted_at, original_state, comments, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(findingId, outcome.platform || null, outcome.externalReportId || null, outcome.submittedAt || null,
    outcome.state, outcome.severityFinal || null, outcome.bountyAmount || null,
    outcome.originalReportId || null, outcome.originalSubmittedAt || null,
    outcome.originalState || null, outcome.comments || null, ts);
  const finding = getFinding(db, findingId);
  if (outcome.externalReportId) {
    recordSubmission(db, {
      ...outcome,
      program: outcome.program || finding?.program || null,
      updatedAt: ts,
    }, [findingId]);
  }
  // Ledger backing -- ver comentário em recordValidation. Este é o caso
  // que motivou o achado: outcome real "duplicate" da HackerOne
  // (#3988959) tinha sumido entre ambientes porque nada aqui tocava o
  // ledger nem o export -- agora sobrevive nos dois.
  const ledgerEntry = appendFindingLedger(findingId, {
    type: 'bugbounty_platform_outcome',
    platform: outcome.platform || null,
    externalReportId: outcome.externalReportId || null,
    originalReportId: outcome.originalReportId || null,
    state: outcome.state, ts,
  });
  return { findingId, correlationId: investigationIdFor(findingId), ...outcome, ts, ledgerHash: ledgerEntry.hash };
}

export function latestPlatformOutcome(db, findingId) {
  return db.prepare('SELECT * FROM platform_outcomes WHERE finding_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1').get(findingId) || null;
}

const LEGACY_VERDICT_BY_STATE = {
  candidate: null,
  false_positive: 'falso_positivo',
  inconclusive: 'inconclusivo',
  // known_duplicate: comportamento de código É real (diferente de
  // false_positive de verdade), mas não é elegível/reportável — pro
  // painel v1 (só 3 valores possíveis), o que importa é "não é uma lead
  // a perseguir", que é o mesmo sinal prático de falso_positivo.
  known_duplicate: 'falso_positivo',
  // Qualquer estado além de candidate/false_positive/inconclusive/
  // known_duplicate já passou por pelo menos 1 confirmação real
  // (corroborated_static) — os painéis/relatórios v1 (que só entendem
  // status/verdict) continuam funcionando durante a transição, mas
  // `state` é o campo com a granularidade real agora (ver STATES em
  // state-machine.mjs).
};
function legacyVerdictFor(state) {
  if (state in LEGACY_VERDICT_BY_STATE) return LEGACY_VERDICT_BY_STATE[state];
  return 'confirmado';
}

// Converte a linha crua das 4 tabelas satélite (snake_case, formato de
// armazenamento) pro MESMO formato camelCase que as funções record*
// abaixo aceitam como entrada -- exportar e restaurar (migrateEntry)
// usam exatamente o mesmo shape, sem tradução duplicada em dois lugares.
function platformOutcomeToExport(row) {
  if (!row) return null;
  return {
    platform: row.platform,
    externalReportId: row.external_report_id,
    submittedAt: row.submitted_at,
    state: row.state,
    severityFinal: row.severity_final,
    bountyAmount: row.bounty_amount,
    originalReportId: row.original_report_id,
    originalSubmittedAt: row.original_submitted_at,
    originalState: row.original_state,
    comments: row.comments,
    updatedAt: row.updated_at,
  };
}

function deploymentEvidenceToExport(row) {
  if (!row) return null;
  return {
    repo: row.repo,
    commit: row.commit_sha,
    branchOrTag: row.branch_or_tag,
    packageOrContract: row.package_or_contract,
    deployedAddress: row.deployed_address,
    chainId: row.chain_id,
    blockNumber: row.block_number,
    bytecodeHash: row.bytecode_hash,
    confidence: row.confidence,
    notes: row.notes,
    ts: row.ts,
  };
}

function validationToExport(row) {
  return { type: row.type, command: row.command, result: row.result, rawOutput: row.raw_output, evidence: row.evidence || null, ts: row.ts };
}

function reportToExport(row) {
  if (!row) return null;
  return { path: row.path, createdAt: row.created_at };
}

function impactAssessmentToExport(assessment) {
  if (!assessment) return null;
  const { ledgerHash, findingId, ...portable } = assessment;
  return portable;
}

function codeAgeEvidenceToExport(evidence) {
  if (!evidence) return null;
  const { ledgerHash, findingId, correlationId, ...portable } = evidence;
  return portable;
}

/**
 * Regenera queue.jsonl (schema v1 compatível: status/verdict, mais o
 * campo novo `state`) a partir do banco v2 — nunca o contrário. Usado
 * pelo agente de nuvem no fim da rodada (o .db não é commitado, ver
 * .gitignore) e disponível localmente pra reconciliar depois de rodar o
 * CLI. Determinístico: mesma linha de entrada -> mesma saída, testável.
 *
 * Bug real corrigido em 02/09/2026: até então, só as colunas nativas da
 * tabela `findings` eram exportadas -- `platform_outcomes`,
 * `deployment_evidence`, `validations` e `reports` nunca eram lidas
 * aqui, então qualquer outcome/evidência/validação/relatório gravado
 * via record-platform-outcome/record-deployment-evidence/
 * record-validation/record-report sobrevivia só no banco LOCAL efêmero
 * de quem gravou -- perdido assim que outro ambiente reconstruía seu
 * próprio banco a partir de queue.jsonl (achado investigando o outcome
 * real "duplicate" da HackerOne #3988959 sumindo entre sessões; ver
 * docs/zerotoone-v2/IMPLEMENTATION_STATE.md pra narrativa completa).
 * Cada campo só aparece quando existe (`...(x ? {x} : {})`) pra não
 * poluir a maioria das linhas, que não têm nenhuma das 4 coisas ainda.
 */
export function exportFindingsToQueueLines(db) {
  const findings = listFindings(db);
  return findings.map((f) => {
    const base = { ...f.raw };
    delete base.status;
    delete base.verdict;
    // Nunca deveriam vir de f.raw (upsertFinding nunca as grava lá), mas
    // remove de qualquer jeito -- defesa contra uma linha antiga/externa
    // que já traga essas chaves poluídas, pra garantir que o que sai
    // abaixo é sempre a leitura fresca das tabelas satélite, nunca uma
    // cópia velha reexportada sem querer.
    delete base.platformOutcome;
    delete base.deploymentEvidence;
    delete base.validationsHistory;
    delete base.report;
    delete base.duplicateCheck;
    delete base.impactAssessment;
    delete base.codeAgeEvidence;
    delete base.submission;
    delete base.semanticFingerprint;
    const verdict = legacyVerdictFor(f.state);

    const platformOutcome = platformOutcomeToExport(latestPlatformOutcome(db, f.id));
    const deploymentEvidence = deploymentEvidenceToExport(latestDeploymentEvidence(db, f.id));
    const validationsHistory = listValidations(db, f.id).map(validationToExport);
    const report = reportToExport(latestReport(db, f.id));
    // Achado real (03/09/2026, mesma investigação que achou o
    // foundExisting nunca lido em state-machine.mjs): duplicateCheck
    // nunca esteve nesta lista -- em 605 findings reais, 0 linhas em
    // queue.jsonl carregavam a checagem de duplicata que, ela mesma, é
    // pré-condição obrigatória pra chegar em human_ready (ver gate
    // scope_verified->human_ready acima). Um ambiente que reconstrói o
    // banco a partir só de queue.jsonl perdia essa evidência por
    // completo, exatamente o mesmo bug de fundo que motivou adicionar
    // platformOutcome/deploymentEvidence/validationsHistory/report aqui.
    // semanticFingerprint tem o mesmo problema por um motivo diferente:
    // é coluna própria da tabela (rowToFinding já expõe f.semanticFingerprint
    // direto), não veio nunca de f.raw, e nunca foi listada abaixo --
    // então nunca aparecia nem como null.
    const duplicateCheck = latestDuplicateCheck(db, f.id);
    const impactAssessment = impactAssessmentToExport(latestImpactAssessment(db, f.id));
    const codeAgeEvidence = codeAgeEvidenceToExport(latestCodeAgeEvidence(db, f.id));
    const submission = latestSubmissionForFinding(db, f.id);

    return JSON.stringify({
      ...base,
      id: f.id,
      correlationId: f.correlationId,
      state: f.state,
      status: f.state === 'candidate' ? 'pending' : 'reviewed',
      ...(verdict ? { verdict } : {}),
      confidence: f.confidence,
      reasoning: f.reasoning,
      filesRead: f.filesRead,
      pocRun: f.pocRun,
      pocResult: f.pocResult,
      semanticFingerprint: f.semanticFingerprint,
      ...(platformOutcome ? { platformOutcome } : {}),
      ...(deploymentEvidence ? { deploymentEvidence } : {}),
      ...(validationsHistory.length ? { validationsHistory } : {}),
      ...(report ? { report } : {}),
      ...(duplicateCheck ? { duplicateCheck } : {}),
      ...(impactAssessment ? { impactAssessment } : {}),
      ...(codeAgeEvidence ? { codeAgeEvidence } : {}),
      ...(submission ? { submission } : {}),
    });
  });
}

export function exportFindingsToQueueJsonl(db, queuePath) {
  const lines = exportFindingsToQueueLines(db);
  writeFileSync(queuePath, lines.length ? lines.join('\n') + '\n' : '', 'utf8');
  return lines.length;
}

export function stateCounts(db) {
  const rows = db.prepare('SELECT state, COUNT(*) as n FROM findings GROUP BY state').all();
  const out = {};
  for (const r of rows) out[r.state] = r.n;
  return out;
}

export function closeDb(db) {
  db.close();
}
