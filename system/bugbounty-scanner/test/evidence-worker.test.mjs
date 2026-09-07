import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  closeDb, latestCodeAgeEvidence, listValidations, openDb, recordCodeAgeEvidence,
  recordValidation, upsertFinding, withoutLedgerWrites,
} from '../db.mjs';
import {
  createEvidenceExecutor, emptyEvidenceState, inspectGitFileAge,
  reconcileWorkOrders, runEvidenceCycle,
} from '../evidence-worker.mjs';

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

test('inspectGitFileAge usa somente metadado git e seleciona o commit mais antigo', () => {
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
    assert.ok(result.codeAgeDays > 300);
    assert.equal(calls.some((args) => args.includes('--follow')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
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
      latestTouchAt: '2026-01-01T00:00:00Z', codeAgeDays: 371,
      historyEntries: 2, method: 'git_log_follow_oldest_path_commit',
    }),
  });
  const result = await executor({ findingId: FINDING.id, action: 'establish_novelty' });
  assert.equal(result.status, 'completed');
  assert.equal(result.queueMutated, true);
  assert.match(result.reason, /fora da janela/);
  assert.equal(latestCodeAgeEvidence(db, FINDING.id).codeAgeDays, 371);
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
