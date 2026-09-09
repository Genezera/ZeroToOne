import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  closeDb, latestCodeAgeEvidence, latestImpactAssessment, listValidations,
  openDb, recordCodeAgeEvidence, recordImpactAssessment, recordValidation,
  upsertFinding, withoutLedgerWrites,
} from '../db.mjs';
import {
  bindRecipesToPlan, createEvidenceExecutor, emptyEvidenceState, inspectGitFileAge,
  formatAttentionMessage, notifyPendingAttention, pendingAttentionItems,
  reconcileWorkOrders, runEvidenceCycle,
} from '../evidence-worker.mjs';
import { repositoryRelativePathForFinding } from '../outcome-intelligence.mjs';

const NOW = new Date('2026-09-07T12:00:00Z');
const POLICY = { P: { roeReviewed: true, nextReviewAt: '2099-01-01' } };
const FINDING = {
  id: 'P::acme/api/src/auth.go::verify::signature_bypass', program: 'P',
  platform: 'HackerOne', repository: 'acme/api', asset: 'acme/api',
  file: 'src/auth.go', state: 'reproduced_local', type: 'signature_bypass',
};
const PLAN = { actionable: [
  { id: FINDING.id, program: 'P', repository: 'acme/api', state: 'reproduced_local',
    action: 'establish_novelty', reason: 'prove age', priority: 60 },
] };

function withDb(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-evidence-worker-'));
  const db = openDb(path.join(dir, 'test.db'));
  upsertFinding(db, FINDING);
  return Promise.resolve(fn(db)).finally(() => { closeDb(db); rmSync(dir, { recursive: true, force: true }); });
}

test('reconcileWorkOrders gera identidade determinística e torna ação antiga obsoleta', () => {
  const first = reconcileWorkOrders(emptyEvidenceState(), PLAN, NOW.toISOString());
  const second = reconcileWorkOrders(first, PLAN, NOW.toISOString());
  assert.deepEqual(second, first);
  const order = Object.values(first.workOrders)[0];
  assert.equal(order.status, 'pending');
  const gone = reconcileWorkOrders(first, { actionable: [] }, NOW.toISOString());
  assert.equal(gone.workOrders[order.taskId].status, 'obsolete');
});

test('alterar a receita vinculada cria novo work order e não deixa needs_human congelado', () => {
  const firstPlan = bindRecipesToPlan(PLAN, { findings: {} });
  const secondPlan = bindRecipesToPlan(PLAN, { findings: { [FINDING.id]: { impactAssessment: { kind: 'validated_negative_assessment' } } } });
  const first = reconcileWorkOrders(emptyEvidenceState(), firstPlan, NOW.toISOString());
  const oldId = Object.keys(first.workOrders)[0];
  first.workOrders[oldId].status = 'needs_human';
  const second = reconcileWorkOrders(first, secondPlan, NOW.toISOString());
  assert.equal(Object.keys(second.workOrders).length, 2);
  assert.equal(second.workOrders[oldId].status, 'obsolete');
  assert.equal(Object.values(second.workOrders).some((order) => order.status === 'pending'), true);
});

test('runEvidenceCycle aplica limite, persiste needs_human e não repete tarefa encerrada', async () => {
  const calls = [];
  const first = await runEvidenceCycle({
    state: emptyEvidenceState(), plan: PLAN, maxTasks: 1, now: () => new Date(NOW),
    executor: async (order) => { calls.push(order.taskId); return { status: 'needs_human', reason: 'falta impacto' }; },
  });
  assert.equal(first.summary.claimed, 1);
  assert.equal(first.summary.needsHuman, 1);
  const second = await runEvidenceCycle({
    state: first.state, plan: PLAN, maxTasks: 1, now: () => new Date(NOW),
    executor: async () => { throw new Error('não deve repetir'); },
  });
  assert.equal(second.summary.claimed, 0);
  assert.equal(second.changed, false);
  assert.equal(calls.length, 1);
});

test('delta exato recente gera um único alerta de atenção ao parar em needs_human', async () => {
  const recentPlan = { actionable: [{ ...PLAN.actionable[0], recentExactChange: true,
    introducedAt: '2026-09-07T11:00:00Z', introducedCommit: 'a'.repeat(40) }] };
  const first = await runEvidenceCycle({
    state: emptyEvidenceState(), plan: recentPlan, now: () => new Date(NOW),
    executor: async () => ({ status: 'needs_human', reason: 'impacto exige duas contas' }),
  });
  assert.equal(first.attention.length, 1);
  assert.equal(first.attention[0].recentExactChange, true);
  assert.equal(pendingAttentionItems(first.state).length, 1);
  first.state.workOrders[first.attention[0].taskId].attentionNotifiedAt = NOW.toISOString();
  assert.equal(pendingAttentionItems(first.state).length, 0);
  const second = await runEvidenceCycle({
    state: first.state, plan: recentPlan, now: () => new Date(NOW),
    executor: async () => { throw new Error('não deve repetir'); },
  });
  assert.deepEqual(second.attention, []);
});

test('pendência sem delta recente não interrompe o Telegram; revisão final sempre interrompe', async () => {
  const stale = await runEvidenceCycle({
    state: emptyEvidenceState(), plan: PLAN, now: () => new Date(NOW),
    executor: async () => ({ status: 'needs_human', reason: 'pendência histórica' }),
  });
  assert.deepEqual(stale.attention, []);
  const reviewPlan = { actionable: [{ ...PLAN.actionable[0], action: 'human_review', priority: 100 }] };
  const review = await runEvidenceCycle({
    state: emptyEvidenceState(), plan: reviewPlan, now: () => new Date(NOW),
    executor: async () => ({ status: 'needs_human', reason: 'decisão de envio' }),
  });
  assert.equal(review.attention.length, 1);
  assert.match(formatAttentionMessage(review.attention), /PRONTO PARA REVISÃO FINAL/);
  assert.match(formatAttentionMessage([{ ...review.attention[0], program: '<P&>' }]), /&lt;P&amp;&gt;/);
});

test('entrega de atenção confirma sucesso uma vez e tenta novamente depois de falha', async () => {
  const plan = { actionable: [{ ...PLAN.actionable[0], recentExactChange: true }] };
  const cycle = await runEvidenceCycle({
    state: emptyEvidenceState(), plan, now: () => new Date(NOW),
    executor: async () => ({ status: 'needs_human', reason: 'prova manual necessária' }),
  });
  const failed = await notifyPendingAttention(cycle.state, {
    notify: async () => ({ ok: false, reason: 'Telegram indisponível' }), now: () => new Date(NOW),
  });
  assert.equal(failed.notification.ok, false);
  assert.equal(failed.changed, false);
  assert.equal(pendingAttentionItems(cycle.state).length, 1);
  let sends = 0;
  const delivered = await notifyPendingAttention(cycle.state, {
    notify: async () => { sends += 1; return { ok: true }; }, now: () => new Date(NOW),
  });
  assert.equal(delivered.changed, true);
  assert.equal(pendingAttentionItems(cycle.state).length, 0);
  const repeated = await notifyPendingAttention(cycle.state, {
    notify: async () => { sends += 1; return { ok: true }; }, now: () => new Date(NOW),
  });
  assert.equal(repeated.notification.attempted, false);
  assert.equal(sends, 1);
});

test('runEvidenceCycle registra falha com backoff em vez de perder a tarefa', async () => {
  const result = await runEvidenceCycle({
    state: emptyEvidenceState(), plan: PLAN, now: () => new Date(NOW),
    executor: async () => { throw new Error('rede indisponível'); },
  });
  const order = Object.values(result.state.workOrders)[0];
  assert.equal(order.status, 'retry');
  assert.match(order.result.reason, /rede indisponível/);
  assert.ok(Date.parse(order.nextEligibleAt) > NOW.getTime());
});

test('inspectGitFileAge usa somente metadado git e mede o último toque do caminho', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zto-evidence-age-test-'));
  const calls = [];
  try {
    const result = inspectGitFileAge({ repository: 'acme/api', file: 'src/auth.go' }, {
      workspaceRoot: root, now: () => new Date(NOW),
      run: (_git, args) => {
        calls.push(args);
        return args.includes('log')
          ? `${'b'.repeat(40)}\t2026-09-06T00:00:00Z\n${'a'.repeat(40)}\t2025-09-01T00:00:00Z`
          : '';
      },
    });
    assert.equal(result.introducedCommit, 'a'.repeat(40));
    assert.equal(result.latestTouchCommit, 'b'.repeat(40));
    assert.equal(result.codeAgeDays, 1);
    assert.ok(result.pathHistoryAgeDays > 300);
    assert.equal(result.method, 'git_log_follow_latest_path_commit');
    assert.equal(calls.some((args) => args.includes('--follow')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('caminho legado qualificado vira relativo ao checkout sem alterar caminho moderno', () => {
  assert.equal(repositoryRelativePathForFinding({ repository:'okx/go-wallet-sdk', file:'okx/go-wallet-sdk/coins/aptos/key.go' }), 'coins/aptos/key.go');
  assert.equal(repositoryRelativePathForFinding({ repository:'okx/go-wallet-sdk', file:'coins/aptos/key.go' }), 'coins/aptos/key.go');
});

test('executor revalida política e atualiza escopo oficial antes de concluir', async () => withDb(async (db) => {
  let refreshCalls = 0;
  const snapshot = () => ({
    officialUrl: 'https://hackerone.com/p', capturedAt: NOW.toISOString(), expiresAt: '2099-01-01T00:00:00Z',
    sourceType: 'hackerone_api_live', contentHash: 'hash',
    assets: [{ assetIdentifier: 'acme/api', eligibleForSubmission: true, eligibleForBounty: true }],
  });
  const executor = createEvidenceExecutor({
    db, recipes: { programHandles: { P: 'p' }, findings: {} }, policy: POLICY,
    now: () => new Date(NOW), readSnapshot: snapshot,
    refreshScope: async (program, handle) => { assert.equal(program, 'P'); assert.equal(handle, 'p'); refreshCalls += 1; },
  });
  const result = await executor({ findingId: FINDING.id, action: 'verify_scope' });
  await executor({ findingId: FINDING.id, action: 'verify_scope' });
  assert.equal(refreshCalls, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.evidence.bountyEligible, true);
  assert.notEqual(result.queueMutated, true);
}));

test('executor mede idade e grava evidência; código antigo não pede nova PoC', async () => withDb(async (db) => {
  const executor = createEvidenceExecutor({
    db, recipes: { findings: {} }, policy: POLICY, now: () => new Date(NOW),
    recordAge: (...args) => withoutLedgerWrites(() => recordCodeAgeEvidence(...args)),
    inspectAge: () => ({
      repository: 'acme/api', file: 'src/auth.go', introducedCommit: 'a'.repeat(40),
      introducedAt: '2025-09-01T00:00:00Z', latestTouchCommit: 'b'.repeat(40),
      latestTouchAt: '2026-01-01T00:00:00Z', codeAgeDays: 249, pathHistoryAgeDays: 371,
      historyEntries: 2, method: 'git_log_follow_latest_path_commit',
    }),
  });
  const result = await executor({ findingId: FINDING.id, action: 'establish_novelty' });
  assert.equal(result.status, 'completed');
  assert.equal(result.queueMutated, true);
  assert.match(result.reason, /fora da janela/);
  assert.equal(latestCodeAgeEvidence(db, FINDING.id).codeAgeDays, 249);
  assert.equal(latestCodeAgeEvidence(db, FINDING.id).lastCommitSha, 'b'.repeat(40));
}));

test('executor não reutiliza evidência legada baseada no commit mais antigo', async () => withDb(async (db) => {
  withoutLedgerWrites(() => recordCodeAgeEvidence(db, FINDING.id, {
    repository: 'acme/api', path: 'src/auth.go', codeAgeDays: 371,
    lastCommitSha: 'a'.repeat(40), lastCommitDate: '2025-09-01T00:00:00Z',
    method: 'git_log_follow_oldest_path_commit', checkedAt: '2026-09-06T00:00:00Z',
  }));
  let inspections = 0;
  const executor = createEvidenceExecutor({
    db, recipes: { findings: {} }, policy: POLICY, now: () => new Date(NOW),
    recordAge: (...args) => withoutLedgerWrites(() => recordCodeAgeEvidence(...args)),
    inspectAge: () => {
      inspections += 1;
      return { repository: 'acme/api', file: 'src/auth.go', introducedCommit: 'a'.repeat(40),
        introducedAt: '2025-09-01T00:00:00Z', latestTouchCommit: 'b'.repeat(40),
        latestTouchAt: '2026-09-06T00:00:00Z', codeAgeDays: 1, pathHistoryAgeDays: 371,
        historyEntries: 2, method: 'git_log_follow_latest_path_commit' };
    },
  });
  const result = await executor({ findingId: FINDING.id, action: 'measure_code_age' });
  assert.equal(inspections, 1);
  assert.equal(result.status, 'completed');
  assert.equal(latestCodeAgeEvidence(db, FINDING.id).codeAgeDays, 1);
  assert.equal(latestCodeAgeEvidence(db, FINDING.id).method, 'git_log_follow_latest_path_commit');
}));

test('receita registrada executa regressão isolada e grava validação reservada', async () => withDb(async (db) => {
  const executor = createEvidenceExecutor({
    db, policy: POLICY, now: () => new Date(NOW),
    recordValidationFn: (...args) => withoutLedgerWrites(() => recordValidation(...args)),
    recipes: { findings: { [FINDING.id]: { regression: { kind: 'verified_regression' } } } },
    verifyRegressionFn: () => ({
      repositoryUrl: 'https://github.com/acme/api.git', runtime: 'go127',
      noveltyProof: {
        kind: 'verified_regression', introducedCommit: 'b'.repeat(40), parentCommit: 'a'.repeat(40),
        baseline: { command: 'go test ./...', observedOutcome: 'ZTO_RESULT=NOT_VULNERABLE' },
        candidate: { command: 'go test ./...', observedOutcome: 'ZTO_RESULT=VULNERABLE' },
        execution: { validationScope: 'end_to_end' },
      },
    }),
  });
  const result = await executor({ findingId: FINDING.id, action: 'establish_novelty' });
  assert.equal(result.status, 'completed');
  assert.equal(result.queueMutated, true);
  const validations = listValidations(db, FINDING.id);
  assert.equal(validations[0].type, 'isolated_regression');
  assert.equal(validations[0].evidence.provenance, 'regression-sandbox');
}));

test('receita negativa exige conclusão refutes específica e registra impacto não-reportável', async () => withDb(async (db) => {
  withoutLedgerWrites(() => recordValidation(db, FINDING.id, {
    type: 'timing_benchmark', result: 'fail', rawOutput: 'nenhum sinal distinguível',
  }));
  const assessment = {
    technicalValidity: 'confirmed', attackerControlledInput: true,
    attacker: 'remetente que já conhece o primeiro segredo', victim: 'instância de teste',
    securityBoundary: 'segunda assinatura HMAC', observableOutcome: 'nenhum timing distinguível',
    rationale: 'benchmark da função real não confirmou oracle explorável',
    confidentiality: 'none', integrity: 'none', availability: 'none',
    impactScope: 'self_request_only', reportable: false,
  };
  const executor = createEvidenceExecutor({
    db, policy: POLICY, now: () => new Date(NOW),
    recordImpact: (...args) => withoutLedgerWrites(() => recordImpactAssessment(...args)),
    recipes: { findings: { [FINDING.id]: {
      impactAssessment: { kind: 'validated_negative_assessment',
        requiresValidation: { type: 'timing_benchmark', conclusion: 'refutes' }, assessment },
    } } },
  });
  const result = await executor({ findingId: FINDING.id, action: 'assess_impact' });
  assert.equal(result.status, 'completed');
  assert.equal(result.queueMutated, true);
  assert.equal(latestImpactAssessment(db, FINDING.id).reportable, false);
  assert.equal(latestImpactAssessment(db, FINDING.id).evidenceBasis.validationType, 'timing_benchmark');
}));

test('receita negativa sem a validação exigida falha fechado', async () => withDb(async (db) => {
  const executor = createEvidenceExecutor({
    db, policy: POLICY, now: () => new Date(NOW),
    recipes: { findings: { [FINDING.id]: {
      impactAssessment: { kind: 'validated_negative_assessment',
        requiresValidation: { type: 'timing_benchmark', conclusion: 'refutes' },
        assessment: { reportable: false } },
    } } },
  });
  const result = await executor({ findingId: FINDING.id, action: 'assess_impact' });
  assert.equal(result.status, 'needs_human');
  assert.match(result.reason, /não encontrada/);
  assert.equal(latestImpactAssessment(db, FINDING.id), null);
}));
