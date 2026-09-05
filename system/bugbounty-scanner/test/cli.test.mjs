import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb, upsertFinding, closeDb, recordDeploymentEvidence, recordDuplicateCheck, recordValidation, latestPlatformOutcome, getFinding, recordReport, recordImpactAssessment } from '../db.mjs';
import {
  cmdListPending, cmdStatus, cmdUpdateFinding, cmdTransition, cmdRecordValidation,
  cmdGenerateReport, cmdPipelineStatus, cmdRecordPlatformOutcome,
  cmdRecordDuplicateCheck, cmdSubmissionStats, cmdSubmissionPreflight, cmdGetFinding, cmdRankFinding,
  cmdAutoTriageKnownCve, cmdPackageForSubmission,
} from '../cli.mjs';

function withTempEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-cli-test-'));
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
const INTRODUCED = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PARENT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const REGRESSION_PROOF = {
  kind: 'verified_regression', introducedCommit: INTRODUCED, parentCommit: PARENT,
  introducedAt: '2026-09-02T12:00:00Z',
  baseline: { ref: PARENT, result: 'not_vulnerable', command: 'node poc.mjs', observedOutcome: 'controle recusado' },
  candidate: { ref: INTRODUCED, result: 'vulnerable', command: 'node poc.mjs', observedOutcome: 'exploit reproduzido' },
  execution: {
    validationScope: 'end_to_end', containerImageId: 'sha256:test-image',
    isolation: 'docker:no-network,read-only-root,cap-drop-all',
  },
};
const TEST_PROGRAM_POLICY = {
  'Circle BBP': { roeReviewed: true, reviewedAt: '2026-09-03', nextReviewAt: '2099-12-31' },
  P: { roeReviewed: true, reviewedAt: '2026-09-03', nextReviewAt: '2099-12-31' },
};

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
    const bad = cmdTransition(db, SAMPLE.id, 'corroborated_static', 'cloud-agent', {}, { programPolicy: TEST_PROGRAM_POLICY });
    assert.equal(bad.ok, false);
    const good = cmdTransition(db, SAMPLE.id, 'corroborated_static', 'cloud-agent', { filesRead: ['a.sol'] }, { programPolicy: TEST_PROGRAM_POLICY });
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
    const status = cmdPipelineStatus(db, { programPolicy: TEST_PROGRAM_POLICY });
    const ids = status.map((s) => s.id);
    assert.ok(ids.includes(SAMPLE.id));
    assert.ok(ids.includes('p2::f::fn::type'));
    assert.ok(!ids.includes('p3::f::fn::type'));
    const candidateRow = status.find((s) => s.id === SAMPLE.id);
    assert.match(candidateRow.blocker, /leitura profunda/);
    closeDb(db);
  });
});

test('cmdRecordValidation não permite fabricar o tipo/provenance reservado do executor de regressão', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    assert.throws(
      () => cmdRecordValidation(db, SAMPLE.id, {
        type: 'isolated_regression', result: 'pass', output: 'inventado',
      }),
      /evidência reservada/,
    );
    assert.throws(
      () => cmdRecordValidation(db, SAMPLE.id, {
        type: 'manual', result: 'pass', output: 'inventado', evidence: { provenance: 'regression-sandbox' },
      }),
      /evidência reservada/,
    );
    closeDb(db);
  });
});

test('policy bloqueia toda progressão de pesquisa no CLI, mas preserva encerramento cético', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const blockedPolicy = {
      'Circle BBP': { blocked: true, reason: 'fora da operação autorizada' },
    };
    const advance = cmdTransition(
      db, SAMPLE.id, 'corroborated_static', 'cloud-agent',
      { filesRead: ['a.sol'] }, { programPolicy: blockedPolicy },
    );
    assert.equal(advance.ok, false);
    assert.match(advance.reason, /bloqueado antes de avançar pesquisa/);
    assert.equal(getFinding(db, SAMPLE.id).state, 'candidate');

    const status = cmdPipelineStatus(db, { programPolicy: blockedPolicy });
    assert.match(status[0].blocker, /bloqueado por política/);

    const close = cmdTransition(db, SAMPLE.id, 'false_positive', 'cloud-agent', {}, { programPolicy: blockedPolicy });
    assert.equal(close.ok, true, close.reason);
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
      methods: ['github_issues', 'github_commits', 'github_advisories', 'hacktivity'],
      queries: ['function root cause', 'source sink'], foundExisting: false,
      signals: { codeAgeDays: 30, priorDuplicateSubmissions: 0 }, ts: '2026-09-03T17:00:00Z',
    });
    assert.equal(check.riskScore, 15, '20 base + 10 histórico - 15 código novo');
    assert.equal(check.signals.priorDuplicateSubmissions, 1, 'patch não pode apagar histórico real de duplicate');
    assert.deepEqual(check.results[0].matchingSubmissionIds, ['HackerOne:100']);

    const stats = cmdSubmissionStats(db);
    assert.equal(stats.totalSubmissions, 1);
    assert.equal(stats.duplicateSubmissions, 1);
    assert.equal(stats.byRepository['acme/api'].submissions, 1);
    closeDb(db);
  });
});

test('record-duplicate-check recusa noveltyProof de regressão sem atestado idêntico do executor isolado', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const finding = { ...SAMPLE, id: 'p::forged::fn::idor', program: 'P' };
    upsertFinding(db, finding);
    const check = cmdRecordDuplicateCheck(db, finding.id, {
      methods: ['github_issues', 'github_commits', 'github_advisories', 'hacktivity'],
      queries: ['q1 root cause', 'q2 source sink', 'q3 commit regression'],
      foundExisting: false,
      ts: '2026-09-03T17:00:00Z',
      noveltyProof: REGRESSION_PROOF,
    });
    assert.equal(check.noveltyStatus, 'private_unknown');
    assert.equal(check.noveltyProof, null);
    assert.equal(check.results.find((r) => r.source === 'isolated_regression_attestation').disposition, 'missing_or_mismatched');
    closeDb(db);
  });
});

test('cmdGetFinding devolve dimensions calculado, e null pra achado inexistente', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const result = cmdGetFinding(db, SAMPLE.id);
    assert.equal(result.id, SAMPLE.id);
    assert.deepEqual(result.dimensions, { technicalValidity: null, securityImpact: null, novelty: null, submissionState: 'not_planned' });
    assert.equal(cmdGetFinding(db, 'não-existe'), null);
    closeDb(db);
  });
});

test('cmdRankFinding junta impactAssessment+duplicateCheck reais com bounty/custo informados por quem chama', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const finding = { ...SAMPLE, id: 'p::f2::fn::type2', state: 'scope_verified' };
    upsertFinding(db, finding);
    recordImpactAssessment(db, finding.id, {
      technicalValidity: 'confirmed', reportable: false, attackerControlledInput: false,
      attacker: 'nenhum', victim: 'nenhum', securityBoundary: 'nenhuma', observableOutcome: 'nenhum',
      rationale: 'sem impacto real', confidentiality: 'none', integrity: 'none', availability: 'none', impactScope: 'self_request_only',
    });
    recordDuplicateCheck(db, finding.id, { methods: ['github_issues'], foundExisting: false, riskScore: 100 });
    const rank = cmdRankFinding(db, finding.id, { expectedBountyUsd: 500, researchCostUsd: 50 });
    assert.equal(rank.probabilityImpactAccepted, 0); // reportable=false
    assert.equal(rank.netExpectedValueUsd, -50);
    assert.throws(() => cmdRankFinding(db, 'não-existe'), /não existe no banco/);
    closeDb(db);
  });
});

test('cmdAutoTriageKnownCve fecha known_vulnerable_dependency com GHSA como known_duplicate, ignora o resto, roda de novo sem reprocessar', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { id: 'a', program: 'P', type: 'known_vulnerable_dependency', state: 'candidate', reasoning: 'OSV-Scanner: ... GHSA-aaaa-bbbb-cccc severidade 7.5' });
    upsertFinding(db, { id: 'b', program: 'P', type: 'known_vulnerable_dependency', state: 'candidate', reasoning: '' }); // achado real: 21/202 sem GHSA extraível
    upsertFinding(db, { id: 'c', program: 'P', type: 'ai_deep_read_finding', state: 'candidate', reasoning: 'nada a ver, GHSA-zzzz-yyyy-xxxx' }); // type errado, nunca mexe

    const first = cmdAutoTriageKnownCve(db);
    assert.equal(first.totalCandidates, 2); // só os 2 known_vulnerable_dependency, 'c' nem entra na conta
    assert.equal(first.triaged, 1);
    assert.equal(first.skipped, 1);
    assert.equal(getFinding(db, 'a').state, 'known_duplicate');
    assert.equal(getFinding(db, 'b').state, 'candidate'); // sem GHSA, fica como estava
    assert.equal(getFinding(db, 'c').state, 'candidate'); // type errado, nunca tocado

    // Rodar de novo: 'a' já não está mais em candidate, não é reprocessado.
    const second = cmdAutoTriageKnownCve(db);
    assert.equal(second.totalCandidates, 1); // só 'b' ainda está em candidate
    assert.equal(second.triaged, 0);
    closeDb(db);
  });
});

test('submission-preflight é fail-closed e explica a limitação de reports privados', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const finding = { ...SAMPLE, id: 'p::acme/api/auth.ts::f::idor', program: 'P', file: 'acme/api/auth.ts', state: 'scope_verified' };
    upsertFinding(db, finding);
    const blocked = cmdSubmissionPreflight(db, finding.id, { now: new Date('2026-09-03T18:00:00Z').getTime(), programPolicy: TEST_PROGRAM_POLICY });
    assert.equal(blocked.ready, false);
    assert.match(blocked.limitation, /não provam unicidade/);

    recordReport(db, finding.id, 'reports/idor.md');
    recordImpactAssessment(db, finding.id, {
      technicalValidity: 'confirmed', attackerControlledInput: true,
      attacker: 'usuário remoto', victim: 'outro usuário', securityBoundary: 'isolamento entre contas',
      observableOutcome: 'leitura de dado da vítima', rationale: 'duas contas próprias',
      confidentiality: 'low', integrity: 'none', availability: 'none', impactScope: 'other_user', reportable: true,
      severityRating: 'medium', severityRationale: 'violação de autorização entre duas contas',
    });
    recordValidation(db, finding.id, {
      type: 'isolated_regression', result: 'pass', command: 'node poc.mjs', rawOutput: 'exploit reproduzido',
      evidence: { provenance: 'regression-sandbox', noveltyProof: REGRESSION_PROOF },
    });
    recordDeploymentEvidence(db, finding.id, {
      repo: 'acme/api', commit: INTRODUCED,
      packageOrContract: '@acme/api@1.2.3', confidence: 'high',
      notes: 'release pública ligada ao commit introdutor',
    });
    cmdRecordDuplicateCheck(db, finding.id, {
      methods: ['github_issues', 'github_commits', 'github_advisories', 'hacktivity'],
      queries: ['auth function IDOR', 'missing ownership check', 'commit regression IDOR'], foundExisting: false,
      ts: '2026-09-03T17:00:00Z', signals: { codeAgeDays: 30 }, noveltyProof: REGRESSION_PROOF,
    });
    const ready = cmdSubmissionPreflight(db, finding.id, {
      now: new Date('2026-09-03T18:00:00Z').getTime(), programPolicy: TEST_PROGRAM_POLICY,
      scopeResolver: () => ({ allowed: true, reason: 'fixture elegível', bountyEligible: true }),
    });
    assert.equal(ready.ready, true, ready.reason);
    // Lacuna #1 da revisão de 03/09/2026: dimensões ortogonais visíveis
    // sem juntar state+impactAssessment+duplicateCheck manualmente.
    assert.deepEqual(ready.dimensions, {
      technicalValidity: 'confirmed', securityImpact: 'verified', novelty: 'regression', submissionState: 'not_planned',
    });
    closeDb(db);
  });
});

test('submission-preflight com relatório legado, mas sem impacto/duplicateCheck, bloqueia sem lançar', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const finding = { ...SAMPLE, id: 'p::legacy::f::x', program: 'P', state: 'scope_verified' };
    upsertFinding(db, finding);
    recordReport(db, finding.id, 'reports/legacy.md');
    const result = cmdSubmissionPreflight(db, finding.id, {
      programPolicy: TEST_PROGRAM_POLICY,
      scopeResolver: () => ({ allowed: true, reason: 'fixture elegível', bountyEligible: true }),
    });
    assert.equal(result.ready, false);
    assert.match(result.reason, /impactAssessment incompleto/);
    closeDb(db);
  });
});

test('package-for-submission não empacota human_ready legado que reprova o preflight estrito', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const finding = { ...SAMPLE, id: 'p::legacy-ready::f::x', program: 'P', state: 'human_ready' };
    upsertFinding(db, finding);
    recordReport(db, finding.id, 'reports/legacy-ready.md');
    const result = cmdPackageForSubmission(db, finding.id);
    assert.equal(result.ok, false);
    assert.match(result.reason, /preflight/);
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
