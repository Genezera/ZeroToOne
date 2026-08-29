import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openDb, upsertFinding, getFinding, listFindings, recordTransition,
  recordValidation, listValidations, recordDeploymentEvidence, latestDeploymentEvidence,
  recordReport, latestReport, recordPlatformOutcome, latestPlatformOutcome, stateCounts,
  exportFindingsToQueueLines, closeDb,
} from '../db.mjs';
import { verifyChain } from '../../ledger/ledger.mjs';

function withTempEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-db-test-'));
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

const SAMPLE = {
  id: 'Program::file.sol::fn::reentrancy_risk',
  program: 'Circle BBP',
  platform: 'HackerOne',
  type: 'reentrancy_risk',
  language: 'solidity',
  file: 'file.sol',
  state: 'candidate',
  reasoning: 'achado inicial do scanner, ainda não investigado',
};

test('upsertFinding grava e getFinding lê de volta com os mesmos campos', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const back = getFinding(db, SAMPLE.id);
    assert.equal(back.program, 'Circle BBP');
    assert.equal(back.state, 'candidate');
    assert.equal(back.type, 'reentrancy_risk');
    closeDb(db);
  });
});

test('upsertFinding é idempotente (mesmo id não duplica linha)', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    upsertFinding(db, { ...SAMPLE, reasoning: 'atualizado' });
    const all = listFindings(db, { program: 'Circle BBP' });
    assert.equal(all.length, 1);
    assert.equal(all[0].reasoning, 'atualizado');
    closeDb(db);
  });
});

test('recordTransition recusa transição inválida sem mudar o estado nem gravar no ledger', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const result = recordTransition(db, SAMPLE.id, 'human_ready', { actor: 'agent' });
    assert.equal(result.ok, false);
    assert.equal(getFinding(db, SAMPLE.id).state, 'candidate');
    closeDb(db);
  });
});

test('recordTransition válida muda o estado, grava histórico e anexa evento no ledger', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, reasoning: 'lido o arquivo inteiro, padrão confirmado no código real' });
    const result = recordTransition(db, SAMPLE.id, 'corroborated_static', {
      actor: 'agent',
      context: { filesRead: ['file.sol'] },
    });
    assert.equal(result.ok, true);
    assert.ok(result.ledgerHash);
    assert.equal(getFinding(db, SAMPLE.id).state, 'corroborated_static');

    const chain = verifyChain('research');
    assert.equal(chain.valid, true);
    assert.equal(chain.entries, 1);
    closeDb(db);
  });
});

test('recordTransition encadeia múltiplas transições no mesmo finding, ledger acumula', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, reasoning: 'confirmado no código' });
    recordTransition(db, SAMPLE.id, 'corroborated_static', { actor: 'agent', context: { filesRead: ['a'] } });
    recordTransition(db, SAMPLE.id, 'reproduced_local', {
      actor: 'agent',
      context: { validations: [{ type: 'foundry_poc', result: 'pass', ts: '2026-08-30' }] },
    });
    assert.equal(getFinding(db, SAMPLE.id).state, 'reproduced_local');
    assert.equal(verifyChain('research').entries, 2);
    closeDb(db);
  });
});

test('validations, deploymentEvidence, reports e platformOutcome gravam e "latest" devolve o mais recente', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    recordValidation(db, SAMPLE.id, { type: 'foundry_poc', result: 'fail', rawOutput: 'FAIL: revert' });
    recordValidation(db, SAMPLE.id, { type: 'foundry_poc', result: 'pass', rawOutput: 'PASS' });
    const vals = listValidations(db, SAMPLE.id);
    assert.equal(vals.length, 2);
    assert.equal(vals[vals.length - 1].result, 'pass');

    recordDeploymentEvidence(db, SAMPLE.id, { repo: 'circlefin/x', commit: 'abc123', confidence: 'unverified' });
    assert.equal(latestDeploymentEvidence(db, SAMPLE.id).confidence, 'unverified');

    recordReport(db, SAMPLE.id, 'reports/x.md');
    assert.equal(latestReport(db, SAMPLE.id).path, 'reports/x.md');

    recordPlatformOutcome(db, SAMPLE.id, { platform: 'HackerOne', state: 'triaged', severityFinal: 'high' });
    assert.equal(latestPlatformOutcome(db, SAMPLE.id).state, 'triaged');
    closeDb(db);
  });
});

test('exportFindingsToQueueLines: candidate vira status=pending sem verdict; false_positive/inconclusive mapeiam pro verdict v1 certo', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, id: 'a', state: 'candidate' });
    upsertFinding(db, { ...SAMPLE, id: 'b', state: 'false_positive', reasoning: 'refutado' });
    upsertFinding(db, { ...SAMPLE, id: 'c', state: 'inconclusive', reasoning: 'incerto' });
    const lines = exportFindingsToQueueLines(db).map((l) => JSON.parse(l));
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    assert.equal(byId.a.status, 'pending');
    assert.equal(byId.a.verdict, undefined);
    assert.equal(byId.b.status, 'reviewed');
    assert.equal(byId.b.verdict, 'falso_positivo');
    assert.equal(byId.c.verdict, 'inconclusivo');
    // campo novo sempre presente, pra quem já entende v2 não perder granularidade
    assert.equal(byId.a.state, 'candidate');
    assert.equal(byId.c.state, 'inconclusive');
    closeDb(db);
  });
});

test('exportFindingsToQueueLines: known_duplicate mapeia pro verdict "falso_positivo" legado (não é lead a perseguir, mesmo o código sendo real)', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, id: 'a', state: 'known_duplicate', reasoning: 'já divulgado em auditoria pública' });
    const [line] = exportFindingsToQueueLines(db).map((l) => JSON.parse(l));
    assert.equal(line.verdict, 'falso_positivo');
    assert.equal(line.state, 'known_duplicate');
    closeDb(db);
  });
});

test('exportFindingsToQueueLines: estados pós-candidate que não são terminal-negativo mapeiam pro verdict "confirmado" legado', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, id: 'a', state: 'corroborated_static', reasoning: 'confirmado em código' });
    upsertFinding(db, { ...SAMPLE, id: 'b', state: 'scope_verified', reasoning: 'confirmado e em escopo' });
    const lines = exportFindingsToQueueLines(db).map((l) => JSON.parse(l));
    for (const l of lines) assert.equal(l.verdict, 'confirmado');
    closeDb(db);
  });
});

test('stateCounts agrega corretamente por estado', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, id: 'a', state: 'candidate' });
    upsertFinding(db, { ...SAMPLE, id: 'b', state: 'candidate' });
    upsertFinding(db, { ...SAMPLE, id: 'c', state: 'false_positive' });
    const counts = stateCounts(db);
    assert.equal(counts.candidate, 2);
    assert.equal(counts.false_positive, 1);
    closeDb(db);
  });
});
