import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTargets, summarizeQueue, renderStatusMarkdown } from '../status-dashboard.mjs';

test('summarizeTargets normaliza alvos Clarity (contracts) e alvos de repo (owner/repo)', () => {
  const targetLists = {
    clarity: [{ program: 'StackingDAO', platform: 'Immunefi', contracts: ['a', 'b', 'c'] }],
    js: [{ program: 'Vercel Open Source', platform: 'HackerOne', owner: 'vercel', repo: 'flags' }],
  };
  const rows = summarizeTargets(targetLists);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].target, '3 contrato(s)');
  assert.equal(rows[1].target, 'vercel/flags');
});

test('summarizeQueue separa pendentes de revisados e pega os 5 mais recentes', () => {
  const entries = [
    { status: 'pending', foundAt: '2026-08-28T00:00:00Z' },
    { status: 'reviewed', verdict: 'confirmado', foundAt: '2026-08-27T00:00:00Z' },
    { status: 'reviewed', verdict: 'falso_positivo', foundAt: '2026-08-26T00:00:00Z' },
  ];
  const summary = summarizeQueue(entries);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.reviewedCount, 2);
  assert.equal(summary.recentReviewed[0].foundAt, '2026-08-27T00:00:00Z');
});

test('renderStatusMarkdown produz markdown não-vazio com as seções esperadas', () => {
  const md = renderStatusMarkdown({
    targetRows: [{ language: 'go', program: 'Block Open Source', platform: 'Bugcrowd', target: 'cashapp/hermit' }],
    queueSummary: { pendingCount: 2, reviewedCount: 3, recentReviewed: [] },
    lastScanAt: '2026-08-28T12:00:00Z',
  });
  assert.ok(md.includes('# Centro de operações'));
  assert.ok(md.includes('## Alvos ativos'));
  assert.ok(md.includes('cashapp/hermit'));
  assert.ok(md.includes('**2**'));
});
