import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distinctSubmissionsFromFindings, enrichSubmissionsWithFindings,
  duplicateHistoryForFinding, computeStatsFromSubmissions,
  isDuplicateSaturatedProgram,
} from '../outcome-intelligence.mjs';

test('vários findings ligados ao mesmo report contam como uma submissão', () => {
  const outcome = { platform: 'HackerOne', externalReportId: '100', state: 'duplicate', originalReportId: '50' };
  const submissions = distinctSubmissionsFromFindings([
    { id: 'a', program: 'P', file: 'acme/api/a.ts', platformOutcome: outcome },
    { id: 'b', program: 'P', file: 'acme/api/b.ts', platformOutcome: outcome },
  ]);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].findingIds, ['a', 'b']);
});

test('view enriquecido ensina risco por report distinto, não por detector', () => {
  const raw = [{
    id: 'HackerOne:100', platform: 'HackerOne', externalReportId: '100',
    program: 'P', state: 'duplicate', findingIds: ['a', 'b'],
  }];
  const findings = [
    { id: 'a', program: 'P', file: 'acme/api/a.ts', type: 'ssrf', semanticFingerprint: 'sf:1' },
    { id: 'b', program: 'P', file: 'acme/api/b.ts', type: 'ssrf', semanticFingerprint: 'sf:2' },
  ];
  const enriched = enrichSubmissionsWithFindings(raw, findings);
  const history = duplicateHistoryForFinding({ program: 'P', file: 'acme/api/new.ts' }, enriched);
  assert.equal(history.priorDuplicateSubmissions, 1);
  assert.deepEqual(history.matchingSubmissionIds, ['HackerOne:100']);

  const stats = computeStatsFromSubmissions(enriched);
  assert.equal(stats.totalSubmissions, 1);
  assert.equal(stats.duplicateSubmissions, 1);
  assert.equal(stats.byRepository['acme/api'].submissions, 1);
  assert.equal(stats.bySemanticFingerprint['sf:1'].submissions, 1);
  // byWeakness: 1 submissão só (ambos findings são 'ssrf'), não 2 --
  // mesmo princípio de "por report, não por detector" do nome do teste.
  assert.equal(stats.byWeakness['ssrf'].submissions, 1);
  assert.equal(stats.byWeakness['ssrf'].duplicate, 1);
});

test('programa só satura depois de amostra mínima e taxa alta de duplicates', () => {
  const history = {
    'kiwi-com': { submissions: 6, duplicate: 6, duplicateRate: 1 },
    novo: { submissions: 1, duplicate: 1, duplicateRate: 1 },
    misto: { submissions: 5, duplicate: 3, duplicateRate: 0.6 },
  };
  assert.equal(isDuplicateSaturatedProgram('Kiwi.com', history), true);
  assert.equal(isDuplicateSaturatedProgram('Novo', history), false);
  assert.equal(isDuplicateSaturatedProgram('Misto', history), false);
  assert.equal(isDuplicateSaturatedProgram('Desconhecido', history), false);
});

