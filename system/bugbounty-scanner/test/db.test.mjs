import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openDb, upsertFinding, getFinding, listFindings, recordTransition,
  recordValidation, listValidations, recordDeploymentEvidence, latestDeploymentEvidence,
  recordDuplicateCheck, latestDuplicateCheck,
  recordReport, latestReport, recordPlatformOutcome, latestPlatformOutcome, stateCounts,
  recordImpactAssessment, latestImpactAssessment, listSubmissions,
  recordSubmission,
  recordCodeAgeEvidence, latestCodeAgeEvidence,
  exportSubmissionsToJsonl, importSubmissionsFromJsonl,
  exportFindingsToQueueLines, closeDb, LEDGER_SCHEMA_VERSION,
  withoutLedgerWrites,
} from '../db.mjs';
import { verifyChain, readLedger } from '../../ledger/ledger.mjs';

function withTempEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-db-test-'));
  const prevLedgerDir = process.env.ZERO2ONE_LEDGER_DIR;
  process.env.ZERO2ONE_LEDGER_DIR = path.join(dir, 'ledger');
  // Achado real (03/09/2026): usuário recebeu ~17 notificações reais no
  // Telegram dele com dado de fixture ("Circle BBP"/"p::f::fn::type") --
  // recordTransition pra `duplicate` dispara sendTelegramMessage de
  // verdade se TELEGRAM_BOT_TOKEN/CHAT_ID estiverem configurados na
  // máquina, e nada aqui neutralizava isso (mesma classe de bug que já
  // atingiu ZERO2ONE_LEDGER_DIR, ver comentário em
  // list-deep-read-candidates.test.mjs). telegram.mjs também trava
  // sozinho quando `npm test` roda (defesa em profundidade), mas isto
  // cobre também `node --test <arquivo>` direto, sem passar por npm.
  const prevTelegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevTelegramChatId = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  const dbPath = path.join(dir, 'test.db');
  try {
    return fn(dbPath);
  } finally {
    process.env.ZERO2ONE_LEDGER_DIR = prevLedgerDir;
    if (prevTelegramToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = prevTelegramToken;
    if (prevTelegramChatId === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = prevTelegramChatId;
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
    assert.match(back.semanticFingerprint, /^sf:v1:[a-f0-9]{64}$/);
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

test('changeContext do monitor faz round-trip sem coluna paralela', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const changeContext = {
      repository: 'acme/api', previousSha: 'a'.repeat(40), introducedCommit: 'b'.repeat(40),
      parentCommit: 'a'.repeat(40), detectedAt: '2026-09-05T12:00:00Z', directSingleCommit: true,
    };
    upsertFinding(db, { ...SAMPLE, changeContext });
    const back = getFinding(db, SAMPLE.id);
    assert.deepEqual(back.changeContext, changeContext);
    assert.deepEqual(back.raw.changeContext, changeContext);
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

    recordDuplicateCheck(db, SAMPLE.id, { methods: ['github_issues'], query: 'foo bar', foundExisting: false });
    recordDuplicateCheck(db, SAMPLE.id, { methods: ['github_issues', 'hacktivity'], query: 'foo bar v2', foundExisting: true, foundExistingRef: 'https://github.com/x/y/issues/1' });
    const dup = latestDuplicateCheck(db, SAMPLE.id);
    assert.deepEqual(dup.methods, ['github_issues', 'hacktivity']);
    assert.equal(dup.foundExisting, true);
    assert.equal(dup.foundExistingRef, 'https://github.com/x/y/issues/1');

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

// --- 02/09/2026: bug real corrigido -- as 4 funções record* satélite
// (platformOutcome/deploymentEvidence/validation/report) nunca tocavam
// o ledger nem eram lidas de volta por exportFindingsToQueueLines,
// então esse dado sumia entre ambientes efêmeros (achado investigando
// o outcome real "duplicate" da HackerOne #3988959 desaparecendo). Ver
// docs/zerotoone-v2/IMPLEMENTATION_STATE.md pra narrativa completa.

test('recordPlatformOutcome/recordDeploymentEvidence/recordValidation/recordReport agora anexam evento real no ledger', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const before = verifyChain('research').entries;

    const r1 = recordPlatformOutcome(db, SAMPLE.id, { platform: 'HackerOne', state: 'duplicate', comments: 'dup de #123' });
    assert.ok(r1.ledgerHash, 'recordPlatformOutcome deveria devolver ledgerHash');
    assert.equal(verifyChain('research').entries, before + 1);

    const r2 = recordDeploymentEvidence(db, SAMPLE.id, { confidence: 'unverified' });
    assert.ok(r2.ledgerHash);
    assert.equal(verifyChain('research').entries, before + 2);

    const r3 = recordValidation(db, SAMPLE.id, { type: 'foundry_poc', result: 'pass' });
    assert.ok(r3.ledgerHash);
    assert.equal(verifyChain('research').entries, before + 3);

    const r4 = recordReport(db, SAMPLE.id, 'reports/x.md');
    assert.ok(r4.ledgerHash);
    assert.equal(verifyChain('research').entries, before + 4);

    closeDb(db);
  });
});

test('historicalConfidence estruturado faz round-trip no SQLite', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, { ...SAMPLE, historicalConfidence: { fpRate: 0.75, sampleSize: 8 } });
    assert.deepEqual(getFinding(db, SAMPLE.id).historicalConfidence, { fpRate: 0.75, sampleSize: 8 });
    closeDb(db);
  });
});

test('code age evidence persiste, entra na fila portátil e ganha correlationId', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const recorded = recordCodeAgeEvidence(db, SAMPLE.id, {
      repository: 'acme/repo', path: 'src/a.ts', method: 'github_file_last_commit',
      lastCommitSha: 'a'.repeat(40), lastCommitDate: '2026-09-01T00:00:00Z',
      codeAgeDays: 3, checkedAt: '2026-09-04T00:00:00Z', limitation: 'proxy de idade do arquivo',
    });
    assert.match(recorded.correlationId, /^inv:v1:/);
    assert.equal(latestCodeAgeEvidence(db, SAMPLE.id).codeAgeDays, 3);
    const exported = JSON.parse(exportFindingsToQueueLines(db)[0]);
    assert.equal(exported.codeAgeEvidence.codeAgeDays, 3);
    assert.equal(exported.correlationId, recorded.correlationId);
    closeDb(db);
  });
});

test('exportFindingsToQueueLines inclui platformOutcome/deploymentEvidence/validationsHistory/report reais quando existem', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    recordPlatformOutcome(db, SAMPLE.id, { platform: 'HackerOne', externalReportId: '3988959', state: 'duplicate', comments: 'dup de #3943945' });
    recordDeploymentEvidence(db, SAMPLE.id, { repo: 'circlefin/x', commit: 'abc123', confidence: 'unverified' });
    recordValidation(db, SAMPLE.id, { type: 'foundry_poc', result: 'pass', rawOutput: 'PASS' });
    recordReport(db, SAMPLE.id, 'research/bugbounty/reports/x.md');

    const [line] = exportFindingsToQueueLines(db).map((l) => JSON.parse(l));
    assert.equal(line.platformOutcome.state, 'duplicate');
    assert.equal(line.platformOutcome.externalReportId, '3988959');
    assert.equal(line.deploymentEvidence.commit, 'abc123');
    assert.equal(line.deploymentEvidence.confidence, 'unverified');
    assert.equal(line.validationsHistory.length, 1);
    assert.equal(line.validationsHistory[0].result, 'pass');
    assert.equal(line.report.path, 'research/bugbounty/reports/x.md');
    closeDb(db);
  });
});

test('duplicateCheck e impactAssessment sobrevivem no export; submissão conta uma vez por externalReportId', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    recordDuplicateCheck(db, SAMPLE.id, {
      methods: ['github_issues', 'github_commits', 'github_advisories', 'web_search'],
      queries: ['file function', 'source sink'], results: [], foundExisting: false,
      noveltyStatus: 'private_unknown', riskScore: 25, riskLevel: 'low',
      signals: { priorDuplicateSubmissions: 0 },
      noveltyProof: { kind: 'verified_regression', introducedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    recordImpactAssessment(db, SAMPLE.id, {
      technicalValidity: 'confirmed', attackerControlledInput: true,
      attacker: 'usuário remoto', victim: 'outro usuário', securityBoundary: 'contas distintas',
      observableOutcome: 'dado de outra conta retornado', confidentiality: 'low', integrity: 'none', availability: 'none',
      impactScope: 'other_user', reportable: true, rationale: 'duas contas de teste reproduziram o acesso',
      severityRating: 'medium', severityRationale: 'acesso entre contas',
    });
    recordPlatformOutcome(db, SAMPLE.id, {
      platform: 'HackerOne', externalReportId: '3994302', state: 'duplicate', originalReportId: '3439366',
    });
    // Atualizar o mesmo report não cria uma segunda submissão.
    recordPlatformOutcome(db, SAMPLE.id, {
      platform: 'HackerOne', externalReportId: '3994302', state: 'duplicate', originalReportId: '3439366',
    });

    const [line] = exportFindingsToQueueLines(db).map(JSON.parse);
    assert.equal(line.duplicateCheck.noveltyStatus, 'private_unknown');
    assert.equal(line.duplicateCheck.riskScore, 25);
    assert.equal(line.duplicateCheck.signals.priorDuplicateSubmissions, 0);
    assert.equal(line.duplicateCheck.noveltyProof.kind, 'verified_regression');
    assert.equal(line.impactAssessment.impactScope, 'other_user');
    assert.equal(line.submission.externalReportId, '3994302');
    assert.equal(line.submission.originalReportId, '3439366');
    assert.equal(listSubmissions(db).length, 1);
    assert.deepEqual(listSubmissions(db)[0].findingIds, [SAMPLE.id]);
    closeDb(db);
  });
});

test('exportFindingsToQueueLines NÃO inclui as 4 chaves satélite quando um finding não tem nenhuma (compatibilidade retroativa)', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    const [line] = exportFindingsToQueueLines(db).map((l) => JSON.parse(l));
    assert.equal(line.platformOutcome, undefined);
    assert.equal(line.deploymentEvidence, undefined);
    assert.equal(line.validationsHistory, undefined);
    assert.equal(line.report, undefined);
    assert.equal(line.duplicateCheck, undefined);
    assert.equal(line.impactAssessment, undefined);
    assert.equal(line.submission, undefined);
    closeDb(db);
  });
});

test('submissions.jsonl torna todo o histórico de reports portátil, inclusive entre bancos distintos', () => {
  withTempEnv((dbPath) => {
    const db1 = openDb(dbPath);
    upsertFinding(db1, SAMPLE);
    recordPlatformOutcome(db1, SAMPLE.id, {
      platform: 'HackerOne', externalReportId: '777', state: 'duplicate', originalReportId: '111',
    });
    const portablePath = path.join(path.dirname(dbPath), 'submissions.jsonl');
    assert.equal(existsSync(portablePath), true);
    assert.equal(exportSubmissionsToJsonl(db1, portablePath), 1);
    closeDb(db1);

    const db2Path = path.join(path.dirname(dbPath), 'second', 'test.db');
    const db2 = openDb(db2Path);
    upsertFinding(db2, SAMPLE);
    assert.equal(importSubmissionsFromJsonl(db2, portablePath), 1);
    assert.equal(listSubmissions(db2).length, 1);
    assert.equal(listSubmissions(db2)[0].externalReportId, '777');
    assert.deepEqual(listSubmissions(db2)[0].findingIds, [SAMPLE.id]);
    closeDb(db2);
  });
});

test('recordSubmission é idempotente quando sync remoto não trouxe mudança material', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const first = recordSubmission(db, {
      platform: 'HackerOne', externalReportId: '42', program: 'P', state: 'duplicate',
      updatedAt: '2026-09-01T00:00:00Z',
    });
    const second = recordSubmission(db, {
      platform: 'HackerOne', externalReportId: '42', program: 'P', state: 'duplicate',
    });
    assert.equal(second.updatedAt, first.updatedAt, 'poll sem mudança não deve reescrever timestamp nem arquivo portátil');
    const changed = recordSubmission(db, {
      platform: 'HackerOne', externalReportId: '42', program: 'P', state: 'resolved',
      updatedAt: '2026-09-02T00:00:00Z',
    });
    assert.equal(changed.state, 'resolved');
    assert.equal(changed.updatedAt, '2026-09-02T00:00:00Z');
    closeDb(db);
  });
});

// Lacuna #8 da revisão de 03/09/2026: cada evento bugbounty_* gravado no
// ledger carrega schemaVersion -- verifica contra o arquivo real gravado
// em disco (readLedger), não só o objeto devolvido em memória.
test('todo evento bugbounty_* gravado no ledger carrega schemaVersion', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    recordDuplicateCheck(db, SAMPLE.id, { methods: ['github_issues'], foundExisting: false, riskScore: 10 });
    recordImpactAssessment(db, SAMPLE.id, {
      technicalValidity: 'confirmed', reportable: true, attackerControlledInput: true,
      attacker: 'atacante', victim: 'vítima', securityBoundary: 'fronteira', observableOutcome: 'resultado', rationale: 'motivo real',
      confidentiality: 'low', integrity: 'none', availability: 'none', impactScope: 'other_user',
      severityRating: 'medium', severityRationale: 'acesso entre contas',
    });
    recordReport(db, SAMPLE.id, 'reports/x.md');
    recordPlatformOutcome(db, SAMPLE.id, { platform: 'HackerOne', externalReportId: '999', state: 'duplicate' });
    closeDb(db);

    const entries = readLedger('research').filter((e) => e.findingId === SAMPLE.id);
    const bugbountyEvents = entries.filter((e) => e.type?.startsWith('bugbounty_'));
    assert.ok(bugbountyEvents.length >= 4, `esperava pelo menos 4 eventos, achou ${bugbountyEvents.length}`);
    for (const e of bugbountyEvents) {
      assert.equal(e.schemaVersion, LEDGER_SCHEMA_VERSION, `evento "${e.type}" sem schemaVersion`);
      assert.match(e.correlationId, /^inv:v1:[a-f0-9]{64}$/, `evento "${e.type}" sem correlationId`);
    }
  });
});

test('recordSubmission nunca deixa outcome portátil antigo sobrescrever estado/timestamp novo ao religar finding', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    upsertFinding(db, SAMPLE);
    recordSubmission(db, {
      platform: 'HackerOne', externalReportId: '42', program: 'P', state: 'resolved',
      comments: 'estado mais novo', updatedAt: '2026-09-02T00:00:00Z',
    });
    const merged = recordSubmission(db, {
      platform: 'HackerOne', externalReportId: '42', program: 'P', state: 'duplicate',
      comments: 'cópia velha da fila', updatedAt: '2026-09-01T00:00:00Z',
    }, [SAMPLE.id]);
    assert.equal(merged.state, 'resolved');
    assert.equal(merged.comments, 'estado mais novo');
    assert.equal(merged.updatedAt, '2026-09-02T00:00:00Z');
    assert.deepEqual(merged.findingIds, [SAMPLE.id], 'vínculo novo ainda deve ser incorporado');
    closeDb(db);
  });
});

test('withoutLedgerWrites hidrata tabelas sem reapensar fatos no ledger', () => withTempEnv((dbPath) => {
  const db = openDb(dbPath);
  upsertFinding(db, SAMPLE);
  withoutLedgerWrites(() => {
    recordValidation(db, SAMPLE.id, { type: 'hydrate', result: 'pass', rawOutput: 'restored' });
    recordDeploymentEvidence(db, SAMPLE.id, { confidence: 'low', notes: 'restored' });
  });
  assert.equal(listValidations(db, SAMPLE.id).length, 1);
  assert.equal(latestDeploymentEvidence(db, SAMPLE.id).confidence, 'low');
  assert.equal(verifyChain('research').entries, 0);
  closeDb(db);
}));
