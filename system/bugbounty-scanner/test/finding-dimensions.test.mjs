import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFindingDimensions } from '../finding-dimensions.mjs';

test('sem nenhuma evidência satélite, tudo fica null/not_planned -- nunca inventa confiança', () => {
  const d = computeFindingDimensions({ state: 'candidate' });
  assert.deepEqual(d, { technicalValidity: null, securityImpact: null, novelty: null, submissionState: 'not_planned' });
});

test('impactAssessment com reportable=true vira securityImpact=verified; false vira none', () => {
  const finding = { state: 'candidate' };
  const yes = computeFindingDimensions(finding, { impactAssessment: { technicalValidity: 'confirmed', reportable: true } });
  const no = computeFindingDimensions(finding, { impactAssessment: { technicalValidity: 'confirmed', reportable: false } });
  assert.equal(yes.securityImpact, 'verified');
  assert.equal(yes.technicalValidity, 'confirmed');
  assert.equal(no.securityImpact, 'none');
});

test('duplicateCheck com foundExisting=true vira novelty=public_match, mesmo se noveltyStatus dissesse outra coisa', () => {
  const d = computeFindingDimensions({ state: 'candidate' }, { duplicateCheck: { foundExisting: true, noveltyStatus: 'private_unknown' } });
  assert.equal(d.novelty, 'public_match');
});

test('duplicateCheck com foundExisting=false usa noveltyStatus (private_unknown ou regression)', () => {
  const clean = computeFindingDimensions({ state: 'candidate' }, { duplicateCheck: { foundExisting: false, noveltyStatus: 'private_unknown' } });
  const regression = computeFindingDimensions({ state: 'candidate' }, { duplicateCheck: { foundExisting: false, noveltyStatus: 'regression' } });
  assert.equal(clean.novelty, 'private_unknown');
  assert.equal(regression.novelty, 'regression');
});

test('submissionState: not_planned antes de human_ready, ready em human_ready, submitted daí em diante (inclusive outcomes terminais)', () => {
  assert.equal(computeFindingDimensions({ state: 'corroborated_static' }).submissionState, 'not_planned');
  assert.equal(computeFindingDimensions({ state: 'human_ready' }).submissionState, 'ready');
  assert.equal(computeFindingDimensions({ state: 'submitted' }).submissionState, 'submitted');
  assert.equal(computeFindingDimensions({ state: 'duplicate' }).submissionState, 'submitted');
  assert.equal(computeFindingDimensions({ state: 'paid' }).submissionState, 'submitted');
});

test('achado real (03/09/2026): submission vinculada prevalece sobre state ainda em corroborated_static -- caso real vercel/next.js #3988959', () => {
  const d = computeFindingDimensions(
    { state: 'corroborated_static' },
    { submission: { id: 'HackerOne:3988959', state: 'duplicate' } },
  );
  assert.equal(d.submissionState, 'submitted', 'não deveria dizer not_planned pra algo que já foi enviado e já voltou duplicate');
});

test('caso real Kiwi.com: technicalValidity confirmed + securityImpact none coexistindo com submissionState submitted -- exatamente o par que o state único escondia', () => {
  const d = computeFindingDimensions(
    { state: 'duplicate' },
    {
      impactAssessment: { technicalValidity: 'confirmed', reportable: false },
      duplicateCheck: { foundExisting: true, foundExistingRef: '#3439366' },
    },
  );
  assert.equal(d.technicalValidity, 'confirmed');
  assert.equal(d.securityImpact, 'none');
  assert.equal(d.novelty, 'public_match');
  assert.equal(d.submissionState, 'submitted');
});
