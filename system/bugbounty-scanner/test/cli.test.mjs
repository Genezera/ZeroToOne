import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb, upsertFinding, closeDb, recordDeploymentEvidence, recordDuplicateCheck, latestPlatformOutcome, getFinding, recordReport, recordImpactAssessment } from '../db.mjs';
import {
  cmdListPending, cmdStatus, cmdUpdateFinding, cmdTransition, cmdRecordValidation,
  cmdGenerateReport, cmdPipelineStatus, cmdRecordPlatformOutcome,
  cmdRecordDuplicateCheck, cmdSubmissionStats, cmdSubmissionPreflight,
} from '../cli.mjs';

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

test('duplicate outcome anterior alimenta automaticamente risco e estatística por submissão', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const oldFinding = { ...SAMPLE, id: 'p::acme/api/old.ts::f::ssrf', program: 'P', file: 'acme/api/old.ts' };
    const newFinding = { ...SAMPLE, id: 'p::acme/api/new.ts::f::ssrf', program: 'P', file: 'acme/api/new.ts' };
    upsertFinding(db, oldFinding);
    upsertFinding(db, newFinding);
    cmdRecordPlatformOutcome(db, oldFinding.id, {
      platform: 'HackerOne', externalReportId: '100', state: 'duplicate', originalReportId: '50',
    });

    const check = cmdRecordDuplicateCheck(db, newFinding.id, {
      methods: ['github_issues', 'github_advisories', 'hacktivity'],
      queries: ['function root cause', 'source sink'], foundExisting: false,
      signals: { codeAgeDays: 30 }, ts: '2026-09-03T17:00:00Z',
    });
    assert.equal(check.riskScore, 15, '20 base + 10 histórico - 15 código novo');
    assert.deepEqual(check.results[0].matchingSubmissionIds, ['HackerOne:100']);

    const stats = cmdSubmissionStats(db);
    assert.equal(stats.totalSubmissions, 1);
    assert.equal(stats.duplicateSubmissions, 1);
    assert.equal(stats.byRepository['acme/api'].submissions, 1);
    closeDb(db);
  });
});

test('submission-preflight é fail-closed e explica a limitação de reports privados', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const finding = { ...SAMPLE, id: 'p::acme/api/auth.ts::f::idor', program: 'P', file: 'acme/api/auth.ts', state: 'scope_verified' };
    upsertFinding(db, finding);
    const blocked = cmdSubmissionPreflight(db, finding.id, { now: new Date('2026-09-03T18:00:00Z').getTime() });
    assert.equal(blocked.ready, false);
    assert.match(blocked.limitation, /não provam unicidade/);

    recordReport(db, finding.id, 'reports/idor.md');
    recordImpactAssessment(db, finding.id, {
      technicalValidity: 'confirmed', attackerControlledInput: true,
      attacker: 'usuário remoto', victim: 'outro usuário', securityBoundary: 'isolamento entre contas',
      observableOutcome: 'leitura de dado da vítima', rationale: 'duas contas próprias',
      confidentiality: 'low', integrity: 'none', availability: 'none', impactScope: 'other_user', reportable: true,
    });
    cmdRecordDuplicateCheck(db, finding.id, {
      methods: ['github_issues', 'github_advisories', 'hacktivity'],
      queries: ['auth function IDOR', 'missing ownership check'], foundExisting: false,
      ts: '2026-09-03T17:00:00Z', signals: { codeAgeDays: 30 },
    });
    const ready = cmdSubmissionPreflight(db, finding.id, { now: new Date('2026-09-03T18:00:00Z').getTime() });
    assert.equal(ready.ready, true, ready.reason);
    closeDb(db);
  });
});

// --- 02/09/2026: cmdRecordPlatformOutcome também tenta a transição de
// state correspondente (mesmo padrão de sync-report-status) -- bug real
// achado usando esta função pra registrar de verdade o outcome
// "duplicate" (HackerOne #3988959) e notando que o finding continuava
// "corroborated_static" pra sempre, contradição interna que nada mais
// detectaria sozinho.

test('cmdRecordPlatformOutcome com outcome terminal (duplicate) TRANSICIONA o finding quando ele está em "submitted"', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'submitted' });
    const result = cmdRecordPlatformOutcome(db, SAMPLE.id, { platform: 'HackerOne', externalReportId: '123', state: 'duplicate' });
    assert.equal(result.outcome.state, 'duplicate');
    assert.equal(result.transition.ok, true);
    assert.equal(getFinding(db, SAMPLE.id).state, 'duplicate');
    closeDb(db);
  });
});

test('cmdRecordPlatformOutcome com outcome terminal, mas finding NÃO está em "submitted": outcome grava mesmo assim, transição falha honestamente (não escondida, não forçada)', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    // Reprodução exata do caso real: achado enviado com base em revisão
    // humana direta, nunca passou pelo fluxo interno completo do pipeline.
    upsertFinding(db, { ...SAMPLE, state: 'corroborated_static' });
    const result = cmdRecordPlatformOutcome(db, SAMPLE.id, { platform: 'HackerOne', externalReportId: '3988959', state: 'duplicate' });
    assert.equal(result.outcome.state, 'duplicate', 'outcome real deveria ser gravado independente da transição conseguir ou não');
    assert.equal(latestPlatformOutcome(db, SAMPLE.id).state, 'duplicate');
    assert.equal(result.transition.ok, false, 'transição deveria falhar honestamente, não ser forçada nem escondida');
    assert.equal(getFinding(db, SAMPLE.id).state, 'corroborated_static', '`state` não deveria mudar quando a transição falha');
    closeDb(db);
  });
});

test('cmdRecordPlatformOutcome com outcome NÃO-terminal (ex.: "submitted") não tenta transição nenhuma', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'human_ready' });
    const result = cmdRecordPlatformOutcome(db, SAMPLE.id, { platform: 'HackerOne', state: 'submitted' });
    assert.equal(result.transition, null);
    assert.equal(getFinding(db, SAMPLE.id).state, 'human_ready');
    closeDb(db);
  });
});

test('cmdRecordPlatformOutcome exige "state" no patch', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    assert.throws(() => cmdRecordPlatformOutcome(db, SAMPLE.id, { platform: 'HackerOne' }), /precisa de "state"/);
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
