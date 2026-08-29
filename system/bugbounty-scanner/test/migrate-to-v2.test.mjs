import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, getFinding, exportFindingsToQueueLines, closeDb } from '../db.mjs';
import { migrateEntry } from '../migrate-to-v2.mjs';
import { buildScopeSnapshot } from '../scope-registry.mjs';
import { verifyChain } from '../../ledger/ledger.mjs';

function withTempEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-migrate-test-'));
  const prevLedgerDir = process.env.ZERO2ONE_LEDGER_DIR;
  process.env.ZERO2ONE_LEDGER_DIR = path.join(dir, 'ledger');
  const dbPath = path.join(dir, 'test.db');
  try {
    return fn(dbPath);
  } finally {
    process.env.ZERO2ONE_LEDGER_DIR = prevLedgerDir;
    // Best-effort: nunca deixar uma falha de limpeza (lock passageiro do
    // Windows) mascarar uma falha de asserção real do bloco try acima —
    // exceção no finally substitui silenciosamente a exceção original.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* limpeza best-effort, ver comentário acima */ }
  }
}

const CIRCLE_SNAPSHOT = buildScopeSnapshot({
  program: 'Circle BBP',
  platform: 'HackerOne',
  officialUrl: 'https://hackerone.com/circle-bbp',
  sourceType: 'community_dataset_structured',
  sourceDetail: 'fixture',
  rawSourceContent: 'fixture',
  confidence: 'medium',
  assets: [{ assetIdentifier: 'https://github.com/circlefin/evm-gateway-contracts', eligibleForBounty: true, eligibleForSubmission: true }],
});

test('migrateEntry: falso_positivo v1 vira false_positive v2 via transição real', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const log = migrateEntry(db, {
      id: 'x::fp', program: 'Vercel Open Source', platform: 'HackerOne', type: 'ssrf_risk', language: 'js',
      file: 'vercel/flags/x.ts', verdict: 'falso_positivo', status: 'reviewed', reasoning: 'destino é constante, não SSRF',
    }, { scopeSnapshots: {} });
    assert.equal(log.finalState, 'false_positive');
    assert.equal(getFinding(db, 'x::fp').state, 'false_positive');
    closeDb(db);
  });
});

test('migrateEntry: confirmado SEM filesRead nem PoC para em corroborated_static (usa [file] como filesRead mínimo)', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const log = migrateEntry(db, {
      id: 'x::confirmed-no-poc', program: 'Circle BBP', platform: 'HackerOne', type: 'reentrancy_risk', language: 'solidity',
      file: 'circlefin/evm-gateway-contracts/x.sol', verdict: 'confirmado', status: 'reviewed',
      reasoning: 'padrão de reentrância confirmado lendo o arquivo inteiro',
    }, { scopeSnapshots: { 'Circle BBP': CIRCLE_SNAPSHOT } });
    assert.equal(log.finalState, 'corroborated_static');
    const steps = log.steps.map((s) => s.to);
    assert.ok(steps.includes('corroborated_static'));
    assert.ok(!steps.includes('scope_verified') || log.steps.find((s) => s.to === 'scope_verified').ok === false);
    closeDb(db);
  });
});

test('migrateEntry: confirmado COM pocResult=pass avança até reproduced_local mas para em scope_verified (deployment evidence unverified)', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const log = migrateEntry(db, {
      id: 'x::confirmed-with-poc', program: 'Circle BBP', platform: 'HackerOne', type: 'reentrancy_risk', language: 'solidity',
      file: 'circlefin/evm-gateway-contracts/x.sol', verdict: 'confirmado', status: 'reviewed',
      reasoning: 'confirmado e reproduzido via fork Foundry', pocRun: true, pocResult: 'pass',
      filesRead: ['circlefin/evm-gateway-contracts/x.sol'],
    }, { scopeSnapshots: { 'Circle BBP': CIRCLE_SNAPSHOT } });
    assert.equal(log.finalState, 'reproduced_local');
    const scopeStep = log.steps.find((s) => s.to === 'scope_verified');
    assert.equal(scopeStep.ok, false, 'não deveria alcançar scope_verified sem deployment evidence real (só unverified)');
    closeDb(db);
  });
});

test('migrateEntry: inconclusivo v1 vira inconclusive v2', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const log = migrateEntry(db, {
      id: 'x::inc', program: 'Block Open Source', platform: 'Bugcrowd', type: 'ai_deep_read_finding', language: 'kotlin',
      file: 'afterpay/sdk-android/x.kt', verdict: 'inconclusivo', status: 'reviewed', reasoning: 'não consigo confirmar nem refutar sem acesso externo',
    }, { scopeSnapshots: {} });
    assert.equal(log.finalState, 'inconclusive');
    closeDb(db);
  });
});

test('migrateEntry é idempotente: reprocessar uma entrada já exportada de v2 (tem "state") não replaya transição nem duplica o ledger', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    migrateEntry(db, {
      id: 'x::round-trip', program: 'Circle BBP', platform: 'HackerOne', type: 'reentrancy_risk', language: 'solidity',
      file: 'circlefin/evm-gateway-contracts/x.sol', verdict: 'falso_positivo', status: 'reviewed', reasoning: 'refutado na primeira rodada',
    }, { scopeSnapshots: {} });
    assert.equal(getFinding(db, 'x::round-trip').state, 'false_positive');
    const entriesAfterRound1 = verifyChain('research').entries;

    const exported = JSON.parse(exportFindingsToQueueLines(db)[0]);
    assert.equal(exported.state, 'false_positive');

    const log2 = migrateEntry(db, exported, { scopeSnapshots: {} });
    assert.equal(log2.finalState, 'false_positive');
    assert.equal(getFinding(db, 'x::round-trip').state, 'false_positive');
    assert.equal(verifyChain('research').entries, entriesAfterRound1, 'reprocessar não deveria adicionar nova entrada ao ledger');
    closeDb(db);
  });
});

test('migrateEntry é idempotente MESMO quando a linha de entrada ainda está no formato v1 (sem "state") mas o banco JÁ tem o id migrado — reprodução exata do bug real pego nesta sessão', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const legacyLine = {
      id: 'x::same-env-rerun', program: 'Circle BBP', platform: 'HackerOne', type: 'reentrancy_risk', language: 'solidity',
      file: 'circlefin/evm-gateway-contracts/x.sol', verdict: 'falso_positivo', status: 'reviewed', reasoning: 'refutado na primeira rodada',
    };
    migrateEntry(db, legacyLine, { scopeSnapshots: {} });
    const entriesAfterRound1 = verifyChain('research').entries;

    // Roda migrate-to-v2 de NOVO com a MESMA linha v1 (queue.jsonl real
    // nunca teve export-queue aplicado em cima) contra o MESMO banco
    // local persistente — cenário real: rodar o script manualmente duas
    // vezes, ou a máquina Windows local reexecutar sem passar por
    // export-queue entre uma vez e outra.
    const log2 = migrateEntry(db, legacyLine, { scopeSnapshots: {} });
    assert.equal(log2.finalState, 'false_positive');
    assert.equal(verifyChain('research').entries, entriesAfterRound1, 'reprocessar a MESMA linha v1 contra banco já migrado não deveria duplicar o ledger');
    closeDb(db);
  });
});

test('migrateEntry: item pending v1 fica candidate v2', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const log = migrateEntry(db, {
      id: 'x::pending', program: 'Vercel Open Source', platform: 'HackerOne', type: 'ssrf_risk', language: 'js',
      file: 'vercel/flags/y.ts', status: 'pending',
    }, { scopeSnapshots: {} });
    assert.equal(log.finalState, 'candidate');
    closeDb(db);
  });
});
