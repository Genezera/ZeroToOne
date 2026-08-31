import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb, upsertFinding, closeDb, recordDeploymentEvidence, recordDuplicateCheck } from '../db.mjs';
import { cmdListPending, cmdStatus, cmdUpdateFinding, cmdTransition, cmdRecordValidation, cmdGenerateReport, cmdPipelineStatus } from '../cli.mjs';

function withTempEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-cli-test-'));
  const prevLedgerDir = process.env.ZERO2ONE_LEDGER_DIR;
  process.env.ZERO2ONE_LEDGER_DIR = path.join(dir, 'ledger');
  const dbPath = path.join(dir, 'test.db');
  const reportsDir = path.join(dir, 'reports');
  try {
    return fn(dbPath, reportsDir);
  } finally {
    process.env.ZERO2ONE_LEDGER_DIR = prevLedgerDir;
    // Best-effort: no Windows, um subprocesso recém-encerrado (spawnado
    // pelos testes de CLI real abaixo) pode manter o diretório temp
    // brevemente travado (antivírus/indexação) mesmo depois do processo
    // ter saído — não é um bug de correção do código sob teste, então a
    // limpeza nunca deve derrubar o teste.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* limpeza best-effort, ver comentário acima */ }
  }
}

const SAMPLE = { id: 'p::f::fn::type', program: 'Circle BBP', type: 'reentrancy_risk', state: 'candidate', reasoning: 'achado inicial do scanner, ainda não investigado a fundo' };

test('cmdListPending / cmdStatus refletem o banco', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    assert.equal(cmdListPending(db).length, 1);
    assert.deepEqual(cmdStatus(db), { candidate: 1 });
    closeDb(db);
  });
});

test('cmdUpdateFinding faz merge sem apagar campos não tocados', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    cmdUpdateFinding(db, SAMPLE.id, { reasoning: 'atualizado com leitura completa', filesRead: ['a.sol', 'b.sol'] });
    const updated = cmdListPending(db)[0];
    assert.equal(updated.reasoning, 'atualizado com leitura completa');
    assert.deepEqual(updated.filesRead, ['a.sol', 'b.sol']);
    assert.equal(updated.program, 'Circle BBP');
    closeDb(db);
  });
});

test('cmdTransition usa a mesma state-machine — recusa sem contexto válido', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const bad = cmdTransition(db, SAMPLE.id, 'corroborated_static', 'cloud-agent', {});
    assert.equal(bad.ok, false);
    const good = cmdTransition(db, SAMPLE.id, 'corroborated_static', 'cloud-agent', { filesRead: ['a.sol'] });
    assert.equal(good.ok, true);
    closeDb(db);
  });
});

test('cmdRecordValidation grava validação ligada ao finding', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const v = cmdRecordValidation(db, SAMPLE.id, { type: 'foundry_poc', result: 'pass', output: 'PASS: test_x()' });
    assert.equal(v.result, 'pass');
    closeDb(db);
  });
});

test('cmdGenerateReport gera rascunho pra achado scope_verified via CLI wrapper', () => {
  withTempEnv((dbPath, reportsDir) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'scope_verified', file: 'src/Vault.sol', filesRead: ['src/Vault.sol'] });
    recordDeploymentEvidence(db, SAMPLE.id, { repo: 'x/y', confidence: 'unverified' });
    recordDuplicateCheck(db, SAMPLE.id, { methods: ['github_issues'], query: 'q', foundExisting: false });
    const result = cmdGenerateReport(db, SAMPLE.id, { reportsDir });
    assert.equal(result.ok, true);
    assert.ok(result.path.startsWith(reportsDir), 'rascunho de teste nunca deve ir pra pasta real de relatórios');
    closeDb(db);
  });
});

test('cmdPipelineStatus lista bloqueio de cada achado não-terminal', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE); // candidate
    upsertFinding(db, { ...SAMPLE, id: 'p2::f::fn::type', state: 'corroborated_static' });
    upsertFinding(db, { ...SAMPLE, id: 'p3::f::fn::type', state: 'false_positive' }); // terminal, deve sumir da lista
    const status = cmdPipelineStatus(db);
    const ids = status.map((s) => s.id);
    assert.ok(ids.includes(SAMPLE.id));
    assert.ok(ids.includes('p2::f::fn::type'));
    assert.ok(!ids.includes('p3::f::fn::type'));
    const candidateRow = status.find((s) => s.id === SAMPLE.id);
    assert.match(candidateRow.blocker, /leitura profunda/);
    closeDb(db);
  });
});

test('CLI real via subprocess: check-scope não toca o banco e devolve JSON válido do argv real', () => {
  const cliPath = path.join(process.cwd(), 'system', 'bugbounty-scanner', 'cli.mjs');
  const out = execFileSync('node', [cliPath, 'check-scope', 'StackingDAO', 'nao-existe'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.allowed, false);
  assert.match(parsed.reason, /não encontrado/);
});

test('CLI real via subprocess: comando desconhecido sai com erro, não com JSON quebrado', () => {
  assert.throws(() => execFileSync('node', [path.join(process.cwd(), 'system', 'bugbounty-scanner', 'cli.mjs'), 'chute-invalido'], { encoding: 'utf8' }));
});
