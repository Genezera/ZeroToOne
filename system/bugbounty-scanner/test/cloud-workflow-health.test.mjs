import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessWorkflowRuns, checkCloudWorkflowHealth, parseGitHubRepository, workflowExpectations,
} from '../cloud-workflow-health.mjs';

const HOUR = 60 * 60 * 1000;
const expectation = { file: 'workflow.yml', label: 'workflow', maxSuccessAgeMs: HOUR };

test('Mission Control verifica o supervisor; o supervisor só exclui a própria execução', () => {
  assert.equal(workflowExpectations().length,7);
  assert.equal(workflowExpectations().some((item)=>item.label==='health_monitor'),true);
  assert.equal(workflowExpectations().some((item)=>item.label==='evidence_worker'),true);
  assert.equal(workflowExpectations({operationalOnly:true}).length,6);
  assert.equal(workflowExpectations().some((item)=>item.label==='operations_metrics'),true);
  assert.equal(workflowExpectations({operationalOnly:true}).some((item)=>item.label==='change_monitor'),true);
});

test('parseGitHubRepository aceita env e remotes HTTPS/SSH sem inventar host', () => {
  assert.equal(parseGitHubRepository('Genezera/ZeroToOne'), 'Genezera/ZeroToOne');
  assert.equal(parseGitHubRepository('https://github.com/Genezera/ZeroToOne.git'), 'Genezera/ZeroToOne');
  assert.equal(parseGitHubRepository('git@github.com:Genezera/ZeroToOne.git'), 'Genezera/ZeroToOne');
  assert.equal(parseGitHubRepository('https://example.test/Genezera/ZeroToOne'), null);
});

test('assessWorkflowRuns aceita sucesso fresco e mostra execução nova em andamento', () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const result = assessWorkflowRuns(expectation, [
    { id: 2, status: 'in_progress', created_at: '2026-09-05T11:59:00Z' },
    { id: 1, status: 'completed', conclusion: 'success', updated_at: '2026-09-05T11:45:00Z' },
  ], { now, workflowState: 'active' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'running');
  assert.equal(result.latestSuccess.id, 1);
});

test('assessWorkflowRuns falha fechado para último terminal falho ou sucesso velho', () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const failed = assessWorkflowRuns(expectation, [
    { id: 2, status: 'completed', conclusion: 'failure', updated_at: '2026-09-05T11:55:00Z' },
    { id: 1, status: 'completed', conclusion: 'success', updated_at: '2026-09-05T11:45:00Z' },
  ], { now, workflowState: 'active' });
  assert.equal(failed.ok, false);
  assert.match(failed.reasons.join(' '), /failure/);
  const stale = assessWorkflowRuns(expectation, [
    { id: 1, status: 'completed', conclusion: 'success', updated_at: '2026-09-05T10:00:00Z' },
  ], { now, workflowState: 'active' });
  assert.equal(stale.ok, false);
  assert.match(stale.reasons.join(' '), /excedeu/);
});

test('assessWorkflowRuns falha imediatamente quando o workflow foi desativado', () => {
  const result = assessWorkflowRuns(expectation, [
    { id: 1, status: 'completed', conclusion: 'success', updated_at: '2026-09-05T11:55:00Z' },
  ], { now: Date.parse('2026-09-05T12:00:00Z'), workflowState: 'disabled_manually' });
  assert.equal(result.ok, false);
  assert.equal(result.workflowState, 'disabled_manually');
  assert.match(result.reasons.join(' '), /não active/);
});

test('checkCloudWorkflowHealth consulta cada workflow e agrega indisponibilidade', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('bad.yml')) return { ok: false, status: 503, json: async () => ({}) };
    if (!url.includes('/runs?')) return { ok: true, json: async () => ({ state: 'active' }) };
    return {
      ok: true,
      json: async () => ({ workflow_runs: [
        { id: 1, status: 'completed', conclusion: 'success', updated_at: '2026-09-05T11:45:00Z' },
      ] }),
    };
  };
  const result = await checkCloudWorkflowHealth({
    repository: 'owner/repo', fetchImpl, now: Date.parse('2026-09-05T12:00:00Z'),
    expectations: [expectation, { ...expectation, file: 'bad.yml', label: 'bad' }],
  });
  assert.equal(seen.length, 4);
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].ok, true);
  assert.equal(result.checks[0].workflowState, 'active');
  assert.equal(result.checks[1].status, 'unreachable');
});

test('estado administrativo ausente nunca é inventado como active, mesmo com sucesso recente', async () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const workflow_runs = [{ id: 1, status: 'completed', conclusion: 'success', updated_at: '2026-09-05T11:45:00Z' }];
  for (const workflowState of [undefined, null, '', 'deleted', 'disabled_inactivity']) {
    assert.equal(assessWorkflowRuns(expectation, workflow_runs, { now, workflowState }).ok, false);
  }
  const result = await checkCloudWorkflowHealth({
    repository: 'owner/repo', now, expectations: [expectation],
    fetchImpl: async (url) => ({ ok: true, json: async () => url.includes('/runs?') ? { workflow_runs } : {} }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].workflowState, null);
  assert.match(result.checks[0].reasons.join(' '), /sem estado/);
});
