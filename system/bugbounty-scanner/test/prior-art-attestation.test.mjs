import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPriorArtSearchAttestation,
  priorArtExecutionDigest,
  verifyPriorArtSearchAttestation,
} from '../prior-art-attestation.mjs';
import { publicSearchEvidence } from './fixtures/prior-art-evidence.mjs';

const TS = '2026-09-05T12:00:00Z';
const baseCheck = {
  methods: ['github_issues', 'github_commits', 'github_advisories', 'hacktivity'],
  queries: ['root cause one', 'source sink two', 'missing control three'],
  evidence: publicSearchEvidence(['root cause one', 'source sink two', 'missing control three']),
  results: [{
    source: 'github_issues', query: 'root cause one', candidate: true,
    disposition: 'unreviewed', number: 7, title: 'possible match', url: 'https://github.com/acme/api/issues/7',
  }],
  ts: TS,
};

function attested(check = baseCheck) {
  const searchAttestation = createPriorArtSearchAttestation({
    repository: 'acme/api', checkedAt: TS, duplicateCheckDraft: check,
  }, { validationTs: TS });
  return { ...check, searchAttestation };
}

test('digest é determinístico e revisão humana permitida não quebra o vínculo', () => {
  const original = attested();
  const reviewed = structuredClone(original);
  reviewed.results[0].disposition = 'ruled_out';
  reviewed.results[0].reviewedBy = 'human:renan';
  reviewed.results[0].reviewNote = 'root cause diferente';
  assert.equal(priorArtExecutionDigest({ repository: 'acme/api', checkedAt: TS, check: original }), original.searchAttestation.digest);
  assert.equal(verifyPriorArtSearchAttestation(reviewed, { repository: 'acme/api' }).ok, true);
});

test('remoção ou alteração de hit, paginação, query e repositório invalidam a atestação', () => {
  const variants = [];
  const removed = attested(); removed.results = []; variants.push(removed);
  const changedUrl = attested(); changedUrl.results[0].url = 'https://github.com/acme/api/issues/8'; variants.push(changedUrl);
  const changedQuery = attested(); changedQuery.queries[0] = 'outra causa'; variants.push(changedQuery);
  const changedEvidence = attested(); changedEvidence.evidence[0].pagesScanned = 2; variants.push(changedEvidence);
  for (const candidate of variants) {
    assert.equal(verifyPriorArtSearchAttestation(candidate, { repository: 'acme/api' }).ok, false);
  }
  assert.equal(verifyPriorArtSearchAttestation(attested(), { repository: 'other/api' }).ok, false);
});

test('validation precisa ser contemporânea e o timestamp do check não pode ser renovado manualmente', () => {
  const staleValidation = attested();
  staleValidation.searchAttestation.validationTs = '2026-09-05T13:00:00Z';
  assert.equal(verifyPriorArtSearchAttestation(staleValidation, { repository: 'acme/api' }).ok, false);
  const renewed = attested(); renewed.ts = '2026-09-05T14:00:00Z';
  assert.equal(verifyPriorArtSearchAttestation(renewed, { repository: 'acme/api' }).ok, false);
});
