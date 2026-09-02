import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { transition as smTransition } from './state-machine.mjs';
import { appendEntry } from '../ledger/ledger.mjs';
import { sendTelegramMessage, shouldNotifyForTransition, formatTransitionMessage } from './telegram.mjs';
import { loadProgramPolicy } from './program-policy.mjs';

// Estado operacional local (SQLite/WAL) — substitui queue.jsonl como
// fonte de verdade para leitura/escrita concorrente (seção 6.5 da
// auditoria). O ledger hash-chain (system/ledger/ledger.mjs) CONTINUA
// sendo a trilha de auditoria tamper-evident — este módulo não duplica
// aquele mecanismo, só grava um evento no ledger a cada transição real e
// guarda o hash resultante junto da linha operacional, pra as duas
// fontes ficarem cruzáveis sem ficarem redundantes.

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
  found_existing INTEGER NOT NULL DEFAULT 0,
  found_existing_ref TEXT,
  notes TEXT,
  ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_findings_state ON findings(state);
CREATE INDEX IF NOT EXISTS idx_findings_program ON findings(program);
CREATE INDEX IF NOT EXISTS idx_transitions_finding ON state_transitions(finding_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_checks_finding ON duplicate_checks(finding_id);
`;

export function openDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function upsertFinding(db, finding) {
  const now = finding.updatedAt || new Date().toISOString();
  const existing = getFinding(db, finding.id);
  const createdAt = existing ? existing.createdAt : (finding.createdAt || now);
  db.prepare(`
    INSERT INTO findings (id, exact_fingerprint, semantic_fingerprint, program, platform, asset, type, language, file, fn, line, state, confidence, historical_confidence, reasoning, files_read_json, poc_run, poc_result, created_at, updated_at, raw_json)
    VALUES (@id, @exact_fingerprint, @semantic_fingerprint, @program, @platform, @asset, @type, @language, @file, @fn, @line, @state, @confidence, @historical_confidence, @reasoning, @files_read_json, @poc_run, @poc_result, @created_at, @updated_at, @raw_json)
    ON CONFLICT(id) DO UPDATE SET
      state=excluded.state, confidence=excluded.confidence, historical_confidence=excluded.historical_confidence,
      reasoning=excluded.reasoning, files_read_json=excluded.files_read_json, poc_run=excluded.poc_run,
      poc_result=excluded.poc_result, updated_at=excluded.updated_at, raw_json=excluded.raw_json
  `).run({
    id: finding.id,
    exact_fingerprint: finding.exactFingerprint || finding.id,
    semantic_fingerprint: finding.semanticFingerprint || null,
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
    historical_confidence: finding.historicalConfidence ?? null,
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
  return {
    id: row.id,
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
    historicalConfidence: row.historical_confidence,
    reasoning: row.reasoning,
    filesRead: JSON.parse(row.files_read_json || '[]'),
    pocRun: !!row.poc_run,
    pocResult: row.poc_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    raw: JSON.parse(row.raw_json),
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
export function recordTransition(db, findingId, toState, { actor, context = {} } = {}) {
  const finding = getFinding(db, findingId);
  if (!finding) return { ok: false, reason: `finding "${findingId}" não existe no banco` };
  // programPolicy é injetado aqui, não deixado a cargo de quem chama --
  // é o único jeito de o bloqueio valer pra QUALQUER chamador (CLI local,
  // CLI do agente de nuvem) sem depender de cada um lembrar de checar.
  // Fica fora do context_json persistido abaixo (é dado de sistema, não
  // evidência que o chamador forneceu) -- usa `context`, não `fullContext`.
  const fullContext = { ...context, programPolicy: loadProgramPolicy() };
  const result = smTransition(finding, toState, fullContext);
  if (!result.ok) return result;

  const ts = new Date().toISOString();
  const ledgerEntry = appendEntry('research', {
    type: 'bugbounty_state_transition',
    findingId,
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
  if (shouldNotifyForTransition(toState)) {
    sendTelegramMessage(formatTransitionMessage(finding, toState, result.reason)).catch(() => {});
  }

  return { ...result, ts, ledgerHash: ledgerEntry.hash };
}

export function recordValidation(db, findingId, { type, command, result, rawOutput }) {
  const ts = new Date().toISOString();
  db.prepare('INSERT INTO validations (finding_id, type, command, result, raw_output, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(findingId, type, command || null, result, rawOutput || null, ts);
  // Ledger backing (02/09/2026): recordTransition sempre anexou evento
  // real; as outras 4 funções record* nunca tocaram o ledger, então essa
  // evidência só sobrevivia no stdout do momento ou em prosa que uma
  // sessão lembrasse de copiar pra NOTES.md -- achado real investigando
  // o outcome do SSRF (image-optimizer.ts, HackerOne #3988959) sumindo
  // entre ambientes. Ver docs/zerotoone-v2/IMPLEMENTATION_STATE.md, seção
  // "Bug real encontrado (2026-09-02)", item (c).
  const ledgerEntry = appendEntry('research', { type: 'bugbounty_validation', findingId, validationType: type, result, ts });
  return { findingId, type, result, ts, ledgerHash: ledgerEntry.hash };
}

export function listValidations(db, findingId) {
  return db.prepare('SELECT * FROM validations WHERE finding_id = ? ORDER BY ts ASC').all(findingId);
}

export function recordDeploymentEvidence(db, findingId, evidence) {
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO deployment_evidence (finding_id, repo, commit_sha, branch_or_tag, package_or_contract, deployed_address, chain_id, block_number, bytecode_hash, confidence, notes, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(findingId, evidence.repo || null, evidence.commit || null, evidence.branchOrTag || null, evidence.packageOrContract || null,
    evidence.deployedAddress || null, evidence.chainId || null, evidence.blockNumber || null, evidence.bytecodeHash || null,
    evidence.confidence, evidence.notes || null, ts);
  // Ledger backing -- ver comentário em recordValidation.
  const ledgerEntry = appendEntry('research', { type: 'bugbounty_deployment_evidence', findingId, confidence: evidence.confidence, deployedAddress: evidence.deployedAddress || null, ts });
  return { findingId, ...evidence, ts, ledgerHash: ledgerEntry.hash };
}

export function latestDeploymentEvidence(db, findingId) {
  // ORDER BY ts DESC sozinho empata quando 2 chamadas caem no mesmo
  // milissegundo (achado real testando duplicate_checks) -- id DESC
  // desempata por ordem de inserção real, não por timestamp de string.
  return db.prepare('SELECT * FROM deployment_evidence WHERE finding_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(findingId) || null;
}

export function recordDuplicateCheck(db, findingId, { methods, query, foundExisting, foundExistingRef, notes }) {
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new Error('recordDuplicateCheck precisa de "methods" (array não-vazio, ex.: ["github_issues"])');
  }
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO duplicate_checks (finding_id, methods_json, query, found_existing, found_existing_ref, notes, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(findingId, JSON.stringify(methods), query || null, foundExisting ? 1 : 0, foundExistingRef || null, notes || null, ts);
  return { findingId, methods, query, foundExisting: !!foundExisting, foundExistingRef, ts };
}

export function latestDuplicateCheck(db, findingId) {
  const row = db.prepare('SELECT * FROM duplicate_checks WHERE finding_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(findingId);
  if (!row) return null;
  return {
    findingId: row.finding_id,
    methods: JSON.parse(row.methods_json),
    query: row.query,
    foundExisting: !!row.found_existing,
    foundExistingRef: row.found_existing_ref,
    notes: row.notes,
    ts: row.ts,
  };
}

export function recordReport(db, findingId, reportPath) {
  const ts = new Date().toISOString();
  db.prepare('INSERT INTO reports (finding_id, path, created_at) VALUES (?, ?, ?)').run(findingId, reportPath, ts);
  // Ledger backing -- ver comentário em recordValidation.
  const ledgerEntry = appendEntry('research', { type: 'bugbounty_report', findingId, path: reportPath, ts });
  return { findingId, path: reportPath, createdAt: ts, ledgerHash: ledgerEntry.hash };
}

export function latestReport(db, findingId) {
  return db.prepare('SELECT * FROM reports WHERE finding_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(findingId) || null;
}

export function recordPlatformOutcome(db, findingId, outcome) {
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO platform_outcomes (finding_id, platform, external_report_id, submitted_at, state, severity_final, bounty_amount, comments, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(findingId, outcome.platform || null, outcome.externalReportId || null, outcome.submittedAt || null,
    outcome.state, outcome.severityFinal || null, outcome.bountyAmount || null, outcome.comments || null, ts);
  // Ledger backing -- ver comentário em recordValidation. Este é o caso
  // que motivou o achado: outcome real "duplicate" da HackerOne
  // (#3988959) tinha sumido entre ambientes porque nada aqui tocava o
  // ledger nem o export -- agora sobrevive nos dois.
  const ledgerEntry = appendEntry('research', { type: 'bugbounty_platform_outcome', findingId, platform: outcome.platform || null, externalReportId: outcome.externalReportId || null, state: outcome.state, ts });
  return { findingId, ...outcome, ts, ledgerHash: ledgerEntry.hash };
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
  return { type: row.type, command: row.command, result: row.result, rawOutput: row.raw_output, ts: row.ts };
}

function reportToExport(row) {
  if (!row) return null;
  return { path: row.path, createdAt: row.created_at };
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
    const verdict = legacyVerdictFor(f.state);

    const platformOutcome = platformOutcomeToExport(latestPlatformOutcome(db, f.id));
    const deploymentEvidence = deploymentEvidenceToExport(latestDeploymentEvidence(db, f.id));
    const validationsHistory = listValidations(db, f.id).map(validationToExport);
    const report = reportToExport(latestReport(db, f.id));

    return JSON.stringify({
      ...base,
      id: f.id,
      state: f.state,
      status: f.state === 'candidate' ? 'pending' : 'reviewed',
      ...(verdict ? { verdict } : {}),
      confidence: f.confidence,
      reasoning: f.reasoning,
      filesRead: f.filesRead,
      pocRun: f.pocRun,
      pocResult: f.pocResult,
      ...(platformOutcome ? { platformOutcome } : {}),
      ...(deploymentEvidence ? { deploymentEvidence } : {}),
      ...(validationsHistory.length ? { validationsHistory } : {}),
      ...(report ? { report } : {}),
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
