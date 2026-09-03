import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openDb, upsertFinding, recordValidation, recordDeploymentEvidence,
  recordDuplicateCheck, recordImpactAssessment, latestReport, closeDb,
} from '../db.mjs';
import { assembleReportContext, renderReportDraft, generateReport, reportSlugFor } from '../generate-report.mjs';

function withTempEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-report-test-'));
  const prevLedgerDir = process.env.ZERO2ONE_LEDGER_DIR;
  process.env.ZERO2ONE_LEDGER_DIR = path.join(dir, 'ledger');
  // Notificação real do Telegram nunca pode disparar de dentro de teste --
  // ver comentário completo em test/db.test.mjs::withTempEnv (achado real
  // 03/09/2026, usuário recebeu ~17 notificações de fixture).
  const prevTelegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevTelegramChatId = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  const dbPath = path.join(dir, 'test.db');
  const reportsDir = path.join(dir, 'reports');
  try {
    return fn(dbPath, reportsDir);
  } finally {
    process.env.ZERO2ONE_LEDGER_DIR = prevLedgerDir;
    if (prevTelegramToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = prevTelegramToken;
    if (prevTelegramChatId === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = prevTelegramChatId;
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* limpeza best-effort */ }
  }
}

const SAMPLE = {
  id: 'Circle BBP::src/Vault.sol::withdraw::reentrancy_risk',
  program: 'Circle BBP',
  platform: 'HackerOne',
  asset: 'circlefin/vault',
  type: 'reentrancy_risk',
  language: 'solidity',
  file: 'src/Vault.sol',
  function: 'withdraw',
  reasoning: 'Raciocínio completo da investigação: withdraw() envia ETH via call antes de zerar o saldo, permitindo reentrância clássica.',
  filesRead: ['src/Vault.sol', 'src/interfaces/IVault.sol'],
  state: 'candidate',
};

test('assembleReportContext recusa achado em estado não-elegível (candidate)', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const ctx = assembleReportContext(db, SAMPLE.id);
    assert.equal(ctx.ok, false);
    assert.match(ctx.reason, /scope_verified/);
    closeDb(db);
  });
});

test('assembleReportContext recusa achado inexistente', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const ctx = assembleReportContext(db, 'nao-existe');
    assert.equal(ctx.ok, false);
    closeDb(db);
  });
});

test('assembleReportContext reúne PoC/deploy/duplicata quando achado está scope_verified', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'scope_verified' });
    recordValidation(db, SAMPLE.id, { type: 'foundry_poc', result: 'fail', rawOutput: 'FAIL primeira tentativa' });
    recordValidation(db, SAMPLE.id, { type: 'foundry_poc', result: 'pass', command: 'forge test --match-test test_reentrancy -vvv', rawOutput: 'PASS: test_reentrancy() (gas: 123456)' });
    recordDeploymentEvidence(db, SAMPLE.id, { repo: 'circlefin/vault', commit: 'abc123', confidence: 'high', notes: 'mainnet confirmado' });
    recordDuplicateCheck(db, SAMPLE.id, { methods: ['github_issues'], query: 'reentrancy withdraw', foundExisting: false });

    const ctx = assembleReportContext(db, SAMPLE.id);
    assert.equal(ctx.ok, true);
    assert.equal(ctx.passingValidation.result, 'pass');
    assert.equal(ctx.passingValidation.rawOutput, 'PASS: test_reentrancy() (gas: 123456)');
    assert.equal(ctx.deploymentEvidence.confidence, 'high');
    assert.deepEqual(ctx.duplicateCheck.methods, ['github_issues']);
    closeDb(db);
  });
});

test('renderReportDraft produz markdown com aviso de rascunho e seções do TEMPLATE', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'scope_verified' });
    recordValidation(db, SAMPLE.id, { type: 'foundry_poc', result: 'pass', command: 'forge test -vvv', rawOutput: 'PASS' });
    recordDeploymentEvidence(db, SAMPLE.id, { repo: 'circlefin/vault', commit: 'abc123', confidence: 'unverified' });
    recordDuplicateCheck(db, SAMPLE.id, { methods: ['github_issues'], query: 'x', foundExisting: false });

    const ctx = assembleReportContext(db, SAMPLE.id);
    const md = renderReportDraft(ctx);

    assert.match(md, /RASCUNHO GERADO AUTOMATICAMENTE/);
    assert.match(md, /REVISÃO EDITORIAL \+ HUMANA OBRIGATÓRIA/);
    assert.match(md, /## Programa \/ Plataforma/);
    assert.match(md, /## Cadeia de chamada confirmada/);
    assert.match(md, /src\/Vault\.sol/);
    assert.match(md, /src\/interfaces\/IVault\.sol/);
    assert.match(md, /PASS/);
    assert.match(md, /forge test -vvv/);
    assert.match(md, /Raciocínio bruto da investigação/);
    assert.match(md, /reentrância clássica/);
    closeDb(db);
  });
});

test('renderReportDraft marca explicitamente quando não há PoC "pass" -- nunca inventa uma', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'scope_verified' });
    recordDeploymentEvidence(db, SAMPLE.id, { repo: 'circlefin/vault', confidence: 'unverified' });
    const ctx = assembleReportContext(db, SAMPLE.id);
    const md = renderReportDraft(ctx);
    assert.match(md, /Nenhuma validação com result="pass" está registrada/);
    closeDb(db);
  });
});

test('generateReport escreve o arquivo em disco e registra via recordReport', () => {
  withTempEnv((dbPath, reportsDir) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'scope_verified' });
    recordValidation(db, SAMPLE.id, { type: 'foundry_poc', result: 'pass', rawOutput: 'PASS' });
    recordDeploymentEvidence(db, SAMPLE.id, { repo: 'circlefin/vault', confidence: 'high' });
    recordDuplicateCheck(db, SAMPLE.id, {
      methods: ['github_issues', 'github_advisories', 'hacktivity'],
      queries: ['withdraw reentrancy', 'external call before state update'],
      foundExisting: false, noveltyStatus: 'private_unknown', riskScore: 30, riskLevel: 'low',
    });
    recordImpactAssessment(db, SAMPLE.id, {
      technicalValidity: 'confirmed', attackerControlledInput: true,
      attacker: 'usuário remoto', victim: 'outros depositantes', securityBoundary: 'saldo por conta',
      observableOutcome: 'saque repetido no teste', rationale: 'PoC local com duas contas',
      confidentiality: 'none', integrity: 'high', availability: 'none', impactScope: 'other_user', reportable: true,
    });

    const result = generateReport(db, SAMPLE.id, { reportsDir });
    assert.equal(result.ok, true);
    assert.equal(existsSync(result.path), true);
    assert.deepEqual(result.warnings, []);

    const onDisk = readFileSync(result.path, 'utf8');
    assert.match(onDisk, /RASCUNHO GERADO AUTOMATICAMENTE/);
    assert.match(onDisk, /private_unknown/);
    assert.match(onDisk, /busca pública limpa não comprova/);
    assert.match(onDisk, /saque repetido no teste/);

    const recorded = latestReport(db, SAMPLE.id);
    assert.equal(recorded.path, result.path);
    closeDb(db);
  });
});

test('generateReport avisa quando falta PoC ou checagem de duplicata, mas ainda gera o rascunho', () => {
  withTempEnv((dbPath, reportsDir) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'scope_verified' });
    recordDeploymentEvidence(db, SAMPLE.id, { repo: 'circlefin/vault', confidence: 'unverified' });

    const result = generateReport(db, SAMPLE.id, { reportsDir });
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((w) => w.includes('PoC')));
    assert.ok(result.warnings.some((w) => w.includes('duplicata')));
    closeDb(db);
  });
});

test('generateReport recusa e não escreve nada quando o achado ainda não chegou em scope_verified', () => {
  withTempEnv((dbPath, reportsDir) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'corroborated_static' });
    const result = generateReport(db, SAMPLE.id, { reportsDir });
    assert.equal(result.ok, false);
    assert.equal(existsSync(reportsDir), false);
    closeDb(db);
  });
});

test('reportSlugFor produz um nome de arquivo estável e sem caracteres especiais', () => {
  const slug = reportSlugFor(SAMPLE);
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.match(slug, /circle-bbp/);
  assert.match(slug, /reentrancy-risk/);
});
