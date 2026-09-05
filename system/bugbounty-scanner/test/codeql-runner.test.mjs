import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCodeqlExecutable, parseCodeqlSarif, runCodeqlOnRepo, toQueueFindings } from '../codeql-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('parseCodeqlSarif filtra severidade e caminhos não produtivos', () => {
  const sarif = { runs: [{
    tool: { driver: { rules: [
      { id: 'js/high', properties: { 'security-severity': '8.8', precision: 'high', tags: ['external/cwe/cwe-078'] } },
      { id: 'js/low', properties: { 'security-severity': '4.0' } },
    ] } },
    results: [
      { ruleId: 'js/high', message: { text: 'command injection' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/app.js' }, region: { startLine: 7 } } }] },
      { ruleId: 'js/high', message: { text: 'fixture' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'test/x.js' }, region: { startLine: 1 } } }] },
      { ruleId: 'js/low', message: { text: 'low' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/low.js' } } }] },
    ],
  }] };
  const findings = parseCodeqlSarif(sarif);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].cwe, 'CWE-078');
  assert.equal(findings[0].line, 7);
});

test('toQueueFindings usa identidade determinística e mantém provenance', () => {
  const target = { owner: 'acme', repo: 'api', program: 'P', platform: 'HackerOne' };
  const [finding] = toQueueFindings(target, [{ ruleId: 'js/command-line-injection', file: 'src/a.js', line: 3, message: 'x', securitySeverity: 9.8, precision: 'high', cwe: 'CWE-078' }]);
  assert.match(finding.id, /codeql_command_line_injection$/);
  assert.match(finding.reasoning, /CodeQL/);
});

test('integração CodeQL buildless encontra fluxo HTTP para command injection', { timeout: 180_000 }, () => {
  const fixture = path.join(__dirname, 'fixtures', 'codeql-js');
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'zto-codeql-test-'));
  try {
    const result = runCodeqlOnRepo(fixture, { codeql: findCodeqlExecutable(), cacheDir });
    assert.equal(result.ok, true, result.reason);
    assert.ok(result.rawResultCount > 0);
    assert.ok(result.findings.some((finding) => /command.*injection/i.test(`${finding.ruleId} ${finding.message}`)));
  } finally {
    try { rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch { /* CodeQL/antivírus pode soltar o handle alguns ms depois */ }
  }
});
