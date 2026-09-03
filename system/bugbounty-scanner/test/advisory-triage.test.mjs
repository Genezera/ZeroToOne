import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGhsaId, knownIssueSourceForVulnerableDependency } from '../advisory-triage.mjs';

test('extractGhsaId acha o id real no formato do osv-scanner-runner.mjs', () => {
  const reasoning = 'OSV-Scanner: github.com/go-jose/go-jose/v4@v4.1.0 (Go) tem vulnerabilidade PUBLICADA (GO-2026-4945, GHSA-78h2-9frx-2jm8, severidade 7.5): Go JOSE Panics in JWE decryption.';
  assert.equal(extractGhsaId(reasoning), 'GHSA-78H2-9FRX-2JM8');
});

test('extractGhsaId devolve null quando não há GHSA no texto -- nunca inventa', () => {
  assert.equal(extractGhsaId(''), null);
  assert.equal(extractGhsaId(null), null);
  assert.equal(extractGhsaId('texto qualquer sem id nenhum'), null);
  assert.equal(extractGhsaId('só menciona GO-2026-4945 sem GHSA'), null);
});

test('knownIssueSourceForVulnerableDependency monta fonte rastreável (url real do GitHub Advisory)', () => {
  const finding = {
    type: 'known_vulnerable_dependency',
    reasoning: 'OSV-Scanner: ... (GO-2026-4945, GHSA-78h2-9frx-2jm8, severidade 7.5): ...',
  };
  const src = knownIssueSourceForVulnerableDependency(finding);
  assert.equal(src.sourceType, 'advisory');
  assert.equal(src.url, 'https://github.com/advisories/GHSA-78H2-9FRX-2JM8');
  assert.match(src.title, /GHSA-78H2-9FRX-2JM8/);
});

test('knownIssueSourceForVulnerableDependency devolve null pra type diferente ou reasoning sem GHSA -- achado real (03/09/2026): 21/202 tinham reasoning vazio', () => {
  assert.equal(knownIssueSourceForVulnerableDependency({ type: 'ai_deep_read_finding', reasoning: 'GHSA-aaaa-bbbb-cccc' }), null);
  assert.equal(knownIssueSourceForVulnerableDependency({ type: 'known_vulnerable_dependency', reasoning: '' }), null);
  assert.equal(knownIssueSourceForVulnerableDependency({ type: 'known_vulnerable_dependency', reasoning: null }), null);
});
