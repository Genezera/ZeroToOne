import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOsvScannerJson, runOsvScannerOnRepo, toQueueFindings } from '../osv-scanner-runner.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-osv-test-'));
  try {
    return fn(dir);
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best-effort */ }
  }
}

function pkg(overrides = {}) {
  return {
    package: { name: 'minimist', version: '1.2.5', ecosystem: 'npm' },
    groups: [{ ids: ['GHSA-x'], max_severity: '9.8' }],
    vulnerabilities: [{ id: 'GHSA-x', summary: 'resumo real', details: 'detalhe\nmais linhas' }],
    ...overrides,
  };
}

test('parseOsvScannerJson filtra por severidade mínima (padrão 7.0) -- baixa severidade vira ruído descartado', () => {
  const json = {
    results: [
      {
        source: { path: 'package-lock.json' },
        packages: [
          pkg({ groups: [{ max_severity: '9.8' }] }),
          pkg({ package: { name: 'baixo-risco', version: '1.0.0', ecosystem: 'npm' }, groups: [{ max_severity: '3.1' }] }),
        ],
      },
    ],
  };
  const findings = parseOsvScannerJson(json);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].name, 'minimist');
});

test('parseOsvScannerJson trata max_severity ausente/vazio como 0 -- nunca promove achado sem severidade conhecida por omissão', () => {
  const json = { results: [{ source: { path: 'x' }, packages: [pkg({ groups: [{ max_severity: '' }] })] }] };
  assert.deepEqual(parseOsvScannerJson(json), []);
  const jsonSemGroups = { results: [{ source: { path: 'x' }, packages: [pkg({ groups: [] })] }] };
  assert.deepEqual(parseOsvScannerJson(jsonSemGroups), []);
});

test('parseOsvScannerJson respeita minSeverity customizado', () => {
  const json = { results: [{ source: { path: 'x' }, packages: [pkg({ groups: [{ max_severity: '5.0' }] })] }] };
  assert.equal(parseOsvScannerJson(json).length, 0);
  assert.equal(parseOsvScannerJson(json, { minSeverity: 4.0 }).length, 1);
});

test('parseOsvScannerJson conta todas as vulnerabilidades do mesmo pacote, não só a primeira', () => {
  const json = {
    results: [{
      source: { path: 'x' },
      packages: [pkg({ vulnerabilities: [{ id: 'A', summary: 's1' }, { id: 'B', summary: 's2' }, { id: 'C', summary: 's3' }] })],
    }],
  };
  const [finding] = parseOsvScannerJson(json);
  assert.equal(finding.vulnCount, 3);
  assert.deepEqual(finding.vulnIds, ['A', 'B', 'C']);
  assert.equal(finding.summary, 's1');
});

test('parseOsvScannerJson relativiza o caminho contra repoDir -- nunca vaza caminho absoluto da máquina local no id do achado', () => {
  const json = {
    results: [{
      source: { path: 'E:/dev-toolchains/osv-scanner-cache/go-wallet-sdk/coins/bitcoin/go.mod' },
      packages: [pkg()],
    }],
  };
  const semRepoDir = parseOsvScannerJson(json);
  assert.equal(semRepoDir[0].file, 'E:/dev-toolchains/osv-scanner-cache/go-wallet-sdk/coins/bitcoin/go.mod');

  const comRepoDir = parseOsvScannerJson(json, { repoDir: 'E:/dev-toolchains/osv-scanner-cache/go-wallet-sdk' });
  assert.equal(comRepoDir[0].file, 'coins/bitcoin/go.mod');
});

test('parseOsvScannerJson ignora manifesto dentro de examples//test//fixtures -- nunca alcançável por tráfego real', () => {
  const json = {
    results: [
      { source: { path: 'examples/gatsby/yarn.lock' }, packages: [pkg()] },
      { source: { path: 'packages/build-utils/test/fixtures/05/yarn.lock' }, packages: [pkg()] },
      { source: { path: 'pnpm-lock.yaml' }, packages: [pkg()] },
    ],
  };
  const findings = parseOsvScannerJson(json);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'pnpm-lock.yaml');
});

test('parseOsvScannerJson devolve [] pra JSON vazio/sem results, nunca lança', () => {
  assert.deepEqual(parseOsvScannerJson({}), []);
  assert.deepEqual(parseOsvScannerJson({ results: [] }), []);
});

test('toQueueFindings gera id na mesma convenção do resto do pipeline e mapeia ecosystem pro language certo', () => {
  const target = { program: 'Vercel Open Source', platform: 'HackerOne', owner: 'vercel', repo: 'flags' };
  const [f] = toQueueFindings(target, [
    { name: 'minimist', version: '1.2.5', ecosystem: 'npm', file: 'package-lock.json', severity: 9.8, vulnIds: ['GHSA-x'], vulnCount: 1, summary: 'resumo' },
  ]);
  assert.equal(f.id, 'Vercel Open Source::vercel/flags/package-lock.json::minimist@1.2.5::known_vulnerable_dependency');
  assert.equal(f.language, 'js');
  assert.equal(f.state, 'candidate');
  assert.match(f.reasoning, /GHSA-x/);
  assert.match(f.reasoning, /alcançabilidade/);
});

test('toQueueFindings readiciona o prefixo "v" pra ecosystem Go -- bate com o id que dep-scanner.mjs já usa pro mesmo pacote', () => {
  const target = { program: 'OKG', platform: 'HackerOne', owner: 'okx', repo: 'go-wallet-sdk' };
  const [f] = toQueueFindings(target, [
    { name: 'cosmossdk.io/math', version: '1.1.2', ecosystem: 'Go', file: 'coins/cosmos/go.mod', severity: 8.7, vulnIds: ['GHSA-x'], vulnCount: 1, summary: null },
  ]);
  assert.equal(f.id, 'OKG::okx/go-wallet-sdk/coins/cosmos/go.mod::cosmossdk.io/math@v1.1.2::known_vulnerable_dependency');
});

test('toQueueFindings não duplica o "v" se o OSV-Scanner já devolver com prefixo', () => {
  const target = { program: 'OKG', platform: 'HackerOne', owner: 'okx', repo: 'go-wallet-sdk' };
  const [f] = toQueueFindings(target, [
    { name: 'x', version: 'v1.0.0', ecosystem: 'Go', file: 'go.mod', severity: 8.0, vulnIds: ['A'], vulnCount: 1, summary: null },
  ]);
  assert.match(f.id, /x@v1\.0\.0::/);
  assert.doesNotMatch(f.id, /vv1/);
});

test('toQueueFindings não mexe na versão pra npm/Maven (só Go tem essa convenção de prefixo)', () => {
  const target = { program: 'X', platform: 'HackerOne', owner: 'a', repo: 'b' };
  const [f] = toQueueFindings(target, [
    { name: 'minimist', version: '1.2.5', ecosystem: 'npm', file: 'f', severity: 9.0, vulnIds: ['A'], vulnCount: 1, summary: null },
  ]);
  assert.match(f.id, /minimist@1\.2\.5::/);
});

test('toQueueFindings mapeia Go e Maven pro language certo', () => {
  const target = { program: 'OKG', platform: 'HackerOne', owner: 'okx', repo: 'go-wallet-sdk' };
  const [goFinding] = toQueueFindings(target, [{ name: 'x', version: '1.0.0', ecosystem: 'Go', file: 'go.mod', severity: 8.0, vulnIds: ['A'], vulnCount: 1, summary: null }]);
  assert.equal(goFinding.language, 'go');
  const [mavenFinding] = toQueueFindings({ ...target, owner: 'x', repo: 'y' }, [{ name: 'x', version: '1.0.0', ecosystem: 'Maven', file: 'build.gradle', severity: 8.0, vulnIds: ['A'], vulnCount: 1, summary: null }]);
  assert.equal(mavenFinding.language, 'jvm');
});

test('toQueueFindings menciona quantas vulnerabilidades extras quando há mais de uma', () => {
  const target = { program: 'X', platform: 'HackerOne', owner: 'a', repo: 'b' };
  const [f] = toQueueFindings(target, [{ name: 'x', version: '1.0.0', ecosystem: 'npm', file: 'f', severity: 9.0, vulnIds: ['A', 'B', 'C'], vulnCount: 3, summary: 's' }]);
  assert.match(f.reasoning, /\+ 2 outra/);
});

// Integração real -- roda o OSV-Scanner de verdade (binário instalado em
// E:/dev-toolchains/go/bin/, nunca em C:) contra um package-lock.json
// sintético mínimo com uma dependência conhecida vulnerável (minimist
// 1.2.5, CVE-2021-44906) pra provar que a invocação real funciona.
test('runOsvScannerOnRepo roda o OSV-Scanner de verdade contra um package-lock.json sintético', () => {
  withTempDir((dir) => {
    writeFileSync(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({
        name: 'fixture',
        lockfileVersion: 3,
        packages: {
          '': { name: 'fixture' },
          'node_modules/minimist': { version: '1.2.5' },
        },
      }),
      'utf8'
    );

    const result = runOsvScannerOnRepo(dir, { minSeverity: 7.0 });
    assert.equal(result.ok, true, `esperava sucesso, motivo se falhou: ${result.reason}`);
    assert.ok(result.findings.some((f) => f.name === 'minimist'), 'deveria detectar a vulnerabilidade real do minimist 1.2.5');
    const finding = result.findings.find((f) => f.name === 'minimist');
    assert.equal(finding.ecosystem, 'npm');
    assert.equal(finding.file, 'package-lock.json', 'caminho deveria vir relativo ao repoDir, nunca absoluto');
    assert.ok(finding.vulnIds.includes('GHSA-xvch-5gv4-984h'));
  });
});
