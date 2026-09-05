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
import { publicSearchEvidence, withPriorArtAttestation } from './fixtures/prior-art-evidence.mjs';

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
  asset: 'circlefin/evm-gateway-contracts',
  type: 'reentrancy_risk',
  language: 'solidity',
  file: 'src/Vault.sol',
  function: 'withdraw',
  reasoning: 'Raciocínio completo da investigação: withdraw() envia ETH via call antes de zerar o saldo, permitindo reentrância clássica.',
  filesRead: ['src/Vault.sol', 'src/interfaces/IVault.sol'],
  state: 'candidate',
};

const INTRODUCED = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PARENT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const STRICT_NOVELTY = withPriorArtAttestation({
  methods: ['github_issues', 'github_commits', 'github_advisories', 'hacktivity'],
  queries: ['withdraw reentrancy', 'external call before state update', 'commit regression withdraw'],
  evidence: publicSearchEvidence(['withdraw reentrancy', 'external call before state update', 'commit regression withdraw']),
  foundExisting: false, noveltyStatus: 'regression', riskScore: 20, riskLevel: 'low',
  signals: { priorDuplicateSubmissions: 0 },
  noveltyProof: {
    kind: 'verified_regression', introducedCommit: INTRODUCED, parentCommit: PARENT,
    introducedAt: '2026-09-02T12:00:00Z',
    baseline: { ref: PARENT, result: 'not_vulnerable', command: 'node poc.mjs', observedOutcome: 'controle recusado' },
    candidate: { ref: INTRODUCED, result: 'vulnerable', command: 'node poc.mjs', observedOutcome: 'exploit reproduzido' },
    execution: {
      validationScope: 'end_to_end', containerImageId: 'sha256:test-image',
      isolation: 'docker:no-network,read-only-root,cap-drop-all',
    },
  },
  ts: '2026-09-03T17:00:00Z',
}, 'circlefin/evm-gateway-contracts');

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

test('renderReportDraft rotula longa exposição como idade, não como prova de novidade', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'scope_verified' });
    recordDeploymentEvidence(db, SAMPLE.id, { repo: 'circlefin/vault', confidence: 'low' });
    recordDuplicateCheck(db, SAMPLE.id, {
      methods: ['github_issues', 'github_commits', 'github_advisories', 'web_search'],
      queries: ['a', 'b', 'c'], foundExisting: false,
      noveltyStatus: 'longstanding_exposure',
      noveltyProof: {
        kind: 'verified_longstanding_exposure', introducedCommit: INTRODUCED,
        introducedAt: '2018-02-13T12:00:00Z', ageDays: 3000, stillPresentOnDefaultBranch: true,
      },
    });
    const ctx = assembleReportContext(db, SAMPLE.id);
    const md = renderReportDraft(ctx);
    assert.match(md, /Evidência de idade do código/);
    assert.match(md, /3000 dias/);
    assert.match(md, /não prova novidade nem libera envio/);
    assert.match(md, /Gate atual: \*\*BLOCK\*\*/);
    assert.doesNotMatch(md, /\{\{parent ausente\}\}/);
    assert.doesNotMatch(md, /Prova de regressão: `/);
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

test('renderReportDraft inclui controles e disclosure exigidos pela policy do programa', () => {
  const md = renderReportDraft({
    finding: { ...SAMPLE, program: 'OKG' }, passingValidation: null,
    deploymentEvidence: null, duplicateCheck: null, impactAssessment: null,
    officialUrl: 'https://hackerone.com/okg',
    policyEntry: {
      aiDisclosureRequired: true, productionTestingProhibited: true,
      localForkRequired: true, priorAuditCheckRequired: true,
    },
  });
  assert.match(md, /Uso de IA declarado explicitamente/);
  assert.match(md, /nenhum teste foi executado em produção/);
  assert.match(md, /fork local/);
  assert.match(md, /Audits anteriores revisados/);
  assert.match(md, /Divulgação obrigatória de uso de IA/);
  assert.match(md, /revisou independentemente o código/);
});

test('renderReportDraft mostra proveniência do delta sem chamá-la de prova', () => {
  const md = renderReportDraft({
    finding: { ...SAMPLE, changeContext: {
      repository: 'acme/api', previousSha: 'a'.repeat(40), introducedCommit: 'b'.repeat(40),
      parentCommit: 'a'.repeat(40), detectedAt: '2026-09-05T12:00:00Z',
    } },
    passingValidation: null, deploymentEvidence: null, duplicateCheck: null,
    impactAssessment: null, officialUrl: null, policyEntry: null,
  });
  assert.match(md, /Proveniência da mudança monitorada/);
  assert.match(md, new RegExp('b'.repeat(40)));
  assert.match(md, /não prova sozinho/);
  assert.match(md, /noveltyProof E4/);
});

test('generateReport escreve o arquivo em disco e registra via recordReport', () => {
  withTempEnv((dbPath, reportsDir) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, state: 'scope_verified' });
    recordValidation(db, SAMPLE.id, {
      type: 'isolated_regression', result: 'pass', command: 'node poc.mjs', rawOutput: 'PASS',
      evidence: { provenance: 'regression-sandbox', noveltyProof: STRICT_NOVELTY.noveltyProof },
    });
    recordDeploymentEvidence(db, SAMPLE.id, {
      repo: 'circlefin/evm-gateway-contracts', commit: INTRODUCED,
      packageOrContract: 'Vault@mainnet', confidence: 'high',
    });
    recordDuplicateCheck(db, SAMPLE.id, STRICT_NOVELTY);
    recordImpactAssessment(db, SAMPLE.id, {
      technicalValidity: 'confirmed', attackerControlledInput: true,
      attacker: 'usuário remoto', victim: 'outros depositantes', securityBoundary: 'saldo por conta',
      observableOutcome: 'saque repetido no teste', rationale: 'PoC local com duas contas',
      confidentiality: 'none', integrity: 'high', availability: 'none', impactScope: 'other_user', reportable: true,
      severityRating: 'high', severityRationale: 'alteração financeira entre contas',
    });

    const result = generateReport(db, SAMPLE.id, { reportsDir, now: Date.parse('2026-09-03T18:00:00Z') });
    assert.equal(result.ok, true);
    assert.equal(existsSync(result.path), true);
    assert.deepEqual(result.warnings, []);

    const onDisk = readFileSync(result.path, 'utf8');
    assert.match(onDisk, /RASCUNHO GERADO AUTOMATICAMENTE/);
    assert.match(onDisk, /regression/);
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
