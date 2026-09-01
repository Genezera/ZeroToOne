import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseSemgrepJson, runSemgrepOnRepo, toQueueFindings } from '../semgrep-runner.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-semgrep-test-'));
  try {
    return fn(dir);
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best-effort */ }
  }
}

function result(overrides = {}) {
  return {
    check_id: 'go.lang.security.audit.crypto.use_of_weak_crypto.use-of-rc4',
    path: 'src/foo.go',
    start: { line: 42, col: 1 },
    extra: { severity: 'WARNING', message: 'texto real da regra   com espaço duplicado\ne quebra de linha' },
    ...overrides,
  };
}

test('parseSemgrepJson filtra por severidade mínima (padrão WARNING) -- INFO vira ruído descartado', () => {
  const json = { results: [result({ extra: { severity: 'ERROR', message: 'x' } }), result({ extra: { severity: 'INFO', message: 'x' } })] };
  const findings = parseSemgrepJson(json);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'ERROR');
});

test('parseSemgrepJson respeita minSeverity customizado (INFO incluído)', () => {
  const json = { results: [result({ extra: { severity: 'INFO', message: 'x' } })] };
  assert.equal(parseSemgrepJson(json).length, 0);
  assert.equal(parseSemgrepJson(json, { minSeverity: 'INFO' }).length, 1);
});

test('parseSemgrepJson normaliza mensagem (colapsa espaço/quebra de linha)', () => {
  const [f] = parseSemgrepJson({ results: [result()] });
  assert.equal(f.message, 'texto real da regra com espaço duplicado e quebra de linha');
});

test('parseSemgrepJson troca separador Windows (\\\\) por / no caminho, com ou sem repoDir', () => {
  const json = { results: [result({ path: 'coins\\bitcoin\\src20inscribe.go' })] };
  const semRepoDir = parseSemgrepJson(json);
  assert.equal(semRepoDir[0].file, 'coins/bitcoin/src20inscribe.go');
});

test('parseSemgrepJson relativiza caminho absoluto contra repoDir', () => {
  const json = { results: [result({ path: 'E:\\dev-toolchains\\semgrep-cache\\go-wallet-sdk\\coins\\bitcoin\\src20inscribe.go' })] };
  const [f] = parseSemgrepJson(json, { repoDir: 'E:\\dev-toolchains\\semgrep-cache\\go-wallet-sdk' });
  assert.equal(f.file, 'coins/bitcoin/src20inscribe.go');
});

test('parseSemgrepJson ignora achado dentro de examples//test//fixtures -- nunca alcançável por tráfego real', () => {
  const json = {
    results: [
      result({ path: 'examples/gatsby/build.js' }),
      result({ path: 'packages/cli/__tests__/mcp.ts' }),
      result({ path: 'packages/cli/src/commands/mcp/mcp.ts' }),
    ],
  };
  const findings = parseSemgrepJson(json, { minSeverity: 'INFO' });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'packages/cli/src/commands/mcp/mcp.ts');
});

test('parseSemgrepJson devolve [] pra JSON vazio/sem results, nunca lança', () => {
  assert.deepEqual(parseSemgrepJson({}), []);
  assert.deepEqual(parseSemgrepJson({ results: [] }), []);
});

test('toQueueFindings gera id na mesma convenção do resto do pipeline, mapeando check_id conhecido', () => {
  const target = { program: 'OKG', platform: 'HackerOne', owner: 'okx', repo: 'go-wallet-sdk' };
  const [f] = toQueueFindings(target, [{ checkId: 'go.lang.security.audit.crypto.use_of_weak_crypto.use-of-rc4', file: 'coins/bitcoin/x.go', line: 99, severity: 'WARNING', message: 'RC4 é fraco', cwe: ['CWE-327'] }]);
  assert.equal(f.id, 'OKG::okx/go-wallet-sdk/coins/bitcoin/x.go::line:99::weak_crypto_risk');
  assert.equal(f.state, 'candidate');
  assert.match(f.reasoning, /RC4/);
  assert.match(f.reasoning, /CWE-327/);
});

test('toQueueFindings prefixa detector desconhecido com semgrep_ -- proveniência rastreável', () => {
  const target = { program: 'X', platform: 'HackerOne', owner: 'a', repo: 'b' };
  const [f] = toQueueFindings(target, [{ checkId: 'python.lang.security.some-obscure-check', file: 'x.py', line: 1, severity: 'ERROR', message: 'm' }]);
  assert.match(f.type, /^semgrep_/);
});

// Integração real -- roda o Semgrep de verdade (venv em E:, nunca
// Python global) contra um arquivo Go sintético com RC4 real, pra
// provar que a invocação real funciona.
test('runSemgrepOnRepo roda o Semgrep de verdade contra um arquivo Go com RC4 real', () => {
  withTempDir((dir) => {
    writeFileSync(
      path.join(dir, 'weak.go'),
      [
        'package main',
        '',
        'import "crypto/rc4"',
        '',
        'func useWeakCipher(key []byte) {',
        '\tcipher, _ := rc4.NewCipher(key)',
        '\t_ = cipher',
        '}',
        '',
      ].join('\n'),
      'utf8'
    );

    const res = runSemgrepOnRepo(dir, { ruleset: 'p/golang', minSeverity: 'WARNING' });
    assert.equal(res.ok, true, `esperava sucesso, motivo se falhou: ${res.reason}`);
    assert.ok(res.findings.some((f) => f.checkId.includes('rc4')), 'deveria detectar o uso real de RC4');
  });
});
