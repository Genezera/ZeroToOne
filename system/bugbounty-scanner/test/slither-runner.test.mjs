import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findingTypeForCheck, parseSlitherJson, runSlitherOnRepo, toQueueFindings } from '../slither-runner.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-slither-test-'));
  try {
    return fn(dir);
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best-effort */ }
  }
}

function detector(overrides = {}) {
  return {
    check: 'reentrancy-eth',
    impact: 'High',
    confidence: 'Medium',
    description: 'texto de descrição real do Slither',
    elements: [
      {
        name: 'withdraw',
        source_mapping: { filename_relative: 'src/Vault.sol', lines: [42, 43, 44] },
      },
    ],
    ...overrides,
  };
}

test('findingTypeForCheck mapeia detector conhecido pro vocabulário já usado pelas heurísticas próprias', () => {
  assert.equal(findingTypeForCheck('reentrancy-eth'), 'reentrancy_risk');
  assert.equal(findingTypeForCheck('tx-origin'), 'tx_origin_auth_risk');
  assert.equal(findingTypeForCheck('controlled-delegatecall'), 'delegatecall_risk');
});

test('findingTypeForCheck prefixa detector sem equivalente com slither_ -- proveniência rastreável', () => {
  assert.equal(findingTypeForCheck('incorrect-return'), 'slither_incorrect_return');
  assert.equal(findingTypeForCheck('unindexed-event-address'), 'slither_unindexed_event_address');
});

test('parseSlitherJson filtra por impacto mínimo (padrão Medium) -- Informational vira ruído descartado', () => {
  const json = {
    results: {
      detectors: [
        detector({ check: 'reentrancy-eth', impact: 'High' }),
        detector({ check: 'unused-return', impact: 'Medium' }),
        detector({ check: 'naming-convention', impact: 'Informational' }),
        detector({ check: 'too-many-digits', impact: 'Informational' }),
      ],
    },
  };
  const findings = parseSlitherJson(json);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.impact === 'High' || f.impact === 'Medium'));
});

test('parseSlitherJson respeita minImpact customizado (ex.: incluir Low)', () => {
  const json = { results: { detectors: [detector({ check: 'x', impact: 'Low' })] } };
  assert.equal(parseSlitherJson(json).length, 0);
  assert.equal(parseSlitherJson(json, { minImpact: 'Low' }).length, 1);
});

test('parseSlitherJson extrai arquivo/linha/função do primeiro elemento', () => {
  const json = { results: { detectors: [detector()] } };
  const [finding] = parseSlitherJson(json);
  assert.equal(finding.file, 'src/Vault.sol');
  assert.equal(finding.line, 42);
  assert.equal(finding.function, 'withdraw');
  assert.equal(finding.type, 'reentrancy_risk');
});

test('parseSlitherJson nunca lança em detector sem elements/source_mapping (registra null, não quebra)', () => {
  const json = { results: { detectors: [{ check: 'x', impact: 'High', confidence: 'Medium', description: 'd' }] } };
  const [finding] = parseSlitherJson(json);
  assert.equal(finding.file, null);
  assert.equal(finding.line, null);
});

test('parseSlitherJson devolve [] pra JSON sem results.detectors, nunca lança', () => {
  assert.deepEqual(parseSlitherJson({}), []);
  assert.deepEqual(parseSlitherJson({ results: {} }), []);
});

test('toQueueFindings gera id na mesma convenção do resto do pipeline (program::owner/repo/file::function::type)', () => {
  const target = { program: 'Circle BBP', platform: 'HackerOne', owner: 'circlefin', repo: 'evm-cctp-contracts' };
  const [f] = toQueueFindings(target, [
    { check: 'reentrancy-eth', type: 'reentrancy_risk', impact: 'High', confidence: 'Medium', description: 'x', file: 'src/Vault.sol', line: 42, function: 'withdraw' },
  ]);
  assert.equal(f.id, 'Circle BBP::circlefin/evm-cctp-contracts/src/Vault.sol::withdraw::reentrancy_risk');
  assert.equal(f.state, 'candidate');
  assert.match(f.reasoning, /reentrancy-eth/);
});

test('toQueueFindings cai pra line:N quando Slither não dá nome de função', () => {
  const target = { program: 'Circle BBP', platform: 'HackerOne', owner: 'circlefin', repo: 'x' };
  const [f] = toQueueFindings(target, [
    { check: 'c', type: 'slither_c', impact: 'Medium', confidence: 'Medium', description: 'x', file: 'src/A.sol', line: 7, function: null },
  ]);
  assert.equal(f.function, 'line:7');
  assert.match(f.id, /line:7/);
});

test('toQueueFindings é determinístico -- mesmo achado gera o mesmo id em rodadas diferentes (evita duplicar via upsert)', () => {
  const target = { program: 'Circle BBP', platform: 'HackerOne', owner: 'circlefin', repo: 'x' };
  const raw = [{ check: 'c', type: 'slither_c', impact: 'Medium', confidence: 'Medium', description: 'x', file: 'src/A.sol', line: 7, function: 'f' }];
  assert.equal(toQueueFindings(target, raw)[0].id, toQueueFindings(target, raw)[0].id);
});

// Integração real -- roda o Slither de verdade (instalado neste ambiente,
// py -m slither) contra um projeto Foundry sintético mínimo, sem
// dependência externa nenhuma (sem submódulo, sem npm) pra ficar rápido
// o bastante pra suíte principal (~2s). Prova que a invocação real
// funciona de ponta a ponta, não só que o parser está correto.
test('runSlitherOnRepo roda o Slither de verdade contra um contrato tx.origin sintético', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'foundry.toml'), '[profile.default]\nsrc = "src"\nout = "out"\nlibs = []\n', 'utf8');
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(
      path.join(dir, 'src', 'Vulnerable.sol'),
      [
        '// SPDX-License-Identifier: MIT',
        'pragma solidity ^0.8.19;',
        '',
        'contract Vulnerable {',
        '    address public owner;',
        '',
        '    function setOwnerByOrigin() external {',
        '        require(tx.origin == owner, "not owner");',
        '        owner = msg.sender;',
        '    }',
        '}',
        '',
      ].join('\n'),
      'utf8'
    );

    const result = runSlitherOnRepo(dir, { minImpact: 'Medium' });
    assert.equal(result.ok, true, `esperava sucesso, motivo se falhou: ${result.reason}`);
    assert.ok(result.findings.some((f) => f.check === 'tx-origin'), 'deveria detectar o padrão tx.origin real');
    const txOriginFinding = result.findings.find((f) => f.check === 'tx-origin');
    assert.equal(txOriginFinding.type, 'tx_origin_auth_risk');
    assert.equal(txOriginFinding.file, 'src/Vulnerable.sol');
  });
});
