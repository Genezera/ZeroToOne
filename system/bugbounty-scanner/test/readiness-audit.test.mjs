import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditQueueText, runReadinessAudit, workflowContract } from '../readiness-audit.mjs';
import { openDb, closeDb } from '../db.mjs';

test('auditQueueText detecta JSON inválido, id ausente e duplicata', () => {
  const result = auditQueueText('{"id":"a"}\n{"id":"a"}\n{}\n{não-json\n');
  assert.deepEqual(result.duplicateIds, ['a']);
  assert.equal(result.invalidLines.length, 2);
});

test('workflowContract rejeita qualquer action com referência móvel', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zto-workflow-contract-'));
  const workflowPath = path.join(root, 'workflow.yml');
  writeFileSync(workflowPath, [
    'on:', '  schedule:', '  workflow_dispatch:', 'permissions:', '  contents: write',
    'concurrency:', '  group: zerotoone-bugbounty-writer', '  cancel-in-progress: false',
    'steps:', `  - uses: actions/checkout@${'a'.repeat(40)}`, '  - uses: vendor/tool@main',
  ].join('\n'), 'utf8');
  const result = workflowContract(workflowPath);
  assert.equal(result.ok, false);
  assert.match(result.detail, /vendor\/tool@main/);
});

test('readiness audit consolida invariantes e mantém reports privados como limitação honesta', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zto-readiness-'));
  mkdirSync(path.join(root, 'research', 'bugbounty'), { recursive: true });
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(path.join(root, 'research', 'bugbounty', 'queue.jsonl'), '', 'utf8');
  writeFileSync(path.join(root, 'research', 'bugbounty', 'program-policy.json'), '{}', 'utf8');
  const db = openDb(path.join(root, 'research', 'bugbounty', 'zerotoone.db'));
  closeDb(db);
  const workflow = 'on:\n  schedule:\n  workflow_dispatch:\npermissions:\n  contents: write\nconcurrency:\n  group: zerotoone-bugbounty-writer\n  cancel-in-progress: false\nsteps:\n  - uses: actions/checkout@' + 'a'.repeat(40) + '\n';
  writeFileSync(path.join(root, '.github', 'workflows', 'bugbounty-scan.yml'), workflow, 'utf8');
  writeFileSync(path.join(root, '.github', 'workflows', 'bugbounty-report-sync.yml'), workflow, 'utf8');
  writeFileSync(path.join(root, '.github', 'workflows', 'bugbounty-change-monitor.yml'), workflow, 'utf8');
  const result = runReadinessAudit({
    repoRoot: root,
    doctor: () => ({ ok: true, tools: { node: {} }, failedTools: [], missingIntegrations: [] }),
    verifyLedger: () => ({ valid: true, entries: 0 }),
    git: () => '',
    targetPrograms: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.fullyOperational, true);
  assert.equal(result.summary.criticalFailures, 0);
  assert.equal(result.summary.warnings, 0);
  assert.equal(result.summary.limitations, 1);
});

test('readiness audit bloqueia uma liberação de pesquisa com revisão de RoE expirada', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zto-readiness-expired-'));
  mkdirSync(path.join(root, 'research', 'bugbounty'), { recursive: true });
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(path.join(root, 'research', 'bugbounty', 'queue.jsonl'), '', 'utf8');
  writeFileSync(path.join(root, 'research', 'bugbounty', 'program-policy.json'), JSON.stringify({
    Acme: {
      roeReviewed: true, reviewedAt: '2026-01-01', nextReviewAt: '2026-02-01',
      policyUrl: 'https://example.test/program', reviewMethod: 'fixture_test',
    },
  }), 'utf8');
  const db = openDb(path.join(root, 'research', 'bugbounty', 'zerotoone.db'));
  closeDb(db);
  const workflow = 'on:\n  schedule:\n  workflow_dispatch:\npermissions:\n  contents: write\nconcurrency:\n  group: zerotoone-bugbounty-writer\n  cancel-in-progress: false\nsteps:\n  - uses: actions/checkout@' + 'a'.repeat(40) + '\n';
  writeFileSync(path.join(root, '.github', 'workflows', 'bugbounty-scan.yml'), workflow, 'utf8');
  writeFileSync(path.join(root, '.github', 'workflows', 'bugbounty-report-sync.yml'), workflow, 'utf8');
  writeFileSync(path.join(root, '.github', 'workflows', 'bugbounty-change-monitor.yml'), workflow, 'utf8');
  const result = runReadinessAudit({
    repoRoot: root,
    doctor: () => ({ ok: true, tools: { node: {} }, failedTools: [], missingIntegrations: [] }),
    verifyLedger: () => ({ valid: true, entries: 0 }),
    git: () => '',
    targetPrograms: ['Acme'],
    now: Date.parse('2026-02-02T00:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.match(result.checks.find((item) => item.name === 'program_policy_review_freshness').detail, /expirou/);
});
