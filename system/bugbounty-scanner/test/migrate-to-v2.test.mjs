import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openDb, getFinding, exportFindingsToQueueLines, closeDb,
  recordPlatformOutcome, latestPlatformOutcome, recordDeploymentEvidence, latestDeploymentEvidence,
  recordValidation, listValidations, recordReport, latestReport, recordTransition,
  recordDuplicateCheck, latestDuplicateCheck, recordImpactAssessment, latestImpactAssessment,
  listSubmissions,
} from '../db.mjs';
import { migrateEntry } from '../migrate-to-v2.mjs';
import { buildScopeSnapshot } from '../scope-registry.mjs';
import { verifyChain, readLedger } from '../../ledger/ledger.mjs';
import { deriveStatesFromLedger } from '../state-machine.mjs';

function withTempEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-migrate-test-'));
  const prevLedgerDir = process.env.ZERO2ONE_LEDGER_DIR;
  process.env.ZERO2ONE_LEDGER_DIR = path.join(dir, 'ledger');
  // Notificação real do Telegram nunca pode disparar de dentro de teste --
  // ver comentário completo em test/db.test.mjs::withTempEnv (achado real
  // 03/09/2026, usuário recebeu ~17 notificações de fixture).
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

test('migrateAll (via migrateEntry + deriveStatesFromLedger): uma linha de fila desatualizada é corrigida pelo ledger, não aceita como está', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    // Estabelece o achado e transiciona de verdade pra inconclusive —
    // isso grava no ledger real (mesmo diretório temporário do teste).
    migrateEntry(db, {
      id: 'x::drift2', program: 'Vercel Open Source', platform: 'HackerOne', type: 'ai_deep_read_finding', language: 'js',
      file: 'vercel/vercel/x.ts', verdict: 'falso_positivo', status: 'reviewed', reasoning: 'sem alcançabilidade confirmada',
    }, { scopeSnapshots: {} });
    assert.equal(getFinding(db, 'x::drift2').state, 'false_positive');

    const ledgerStates = deriveStatesFromLedger(readLedger('research'));
    assert.equal(ledgerStates.get('x::drift2').state, 'false_positive');

    // Simula uma linha de fila DESATUALIZADA: outro ambiente, cujo banco
    // local nunca viu a transição real pra false_positive, exportou
    // ANTES dela acontecer — chega aqui numa rodada de migração
    // posterior ainda com state="corroborated_static".
    const staleLine = {
      id: 'x::drift2', program: 'Vercel Open Source', platform: 'HackerOne', type: 'ai_deep_read_finding', language: 'js',
      file: 'vercel/vercel/x.ts', state: 'corroborated_static', confidence: 'baixa', reasoning: 'versão antiga, pré-refutação',
    };
    const log = migrateEntry(db, staleLine, { scopeSnapshots: {}, ledgerStates });
    assert.equal(log.finalState, 'false_positive', 'o ledger deveria vencer sobre o state desatualizado da linha');
    assert.equal(getFinding(db, 'x::drift2').state, 'false_positive');
    assert.ok(log.steps.some((s) => s.reason && s.reason.startsWith('DRIFT CORRIGIDO')), 'deveria registrar explicitamente que corrigiu um drift');
    closeDb(db);
  });
});

test('migrateEntry: linha de fila resetada pra "candidate" explícito (re-ingestão de scanner) também é corrigida pelo ledger — reprodução exata do bug real pego nesta sessão (Vercel mcp.ts::line:345, driftCorrected saiu 0 numa migração real)', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    // Estabelece o achado como candidate e transiciona de verdade pra
    // corroborated_static — grava no ledger real (dir temporário do teste).
    migrateEntry(db, {
      id: 'x::reset-to-candidate', program: 'Vercel Open Source', platform: 'HackerOne', type: 'semgrep_detect_child_process', language: 'ts',
      file: 'vercel/vercel/x.ts', filesRead: ['vercel/vercel/x.ts'], reasoning: 'fonte/sink confirmado em código real',
    }, { scopeSnapshots: {} });
    const step = recordTransition(db, 'x::reset-to-candidate', 'corroborated_static', {
      actor: 'test', context: { filesRead: ['vercel/vercel/x.ts'] },
    });
    assert.ok(step.ok, step.reason);
    assert.equal(getFinding(db, 'x::reset-to-candidate').state, 'corroborated_static');

    const ledgerStates = deriveStatesFromLedger(readLedger('research'));
    assert.equal(ledgerStates.get('x::reset-to-candidate').state, 'corroborated_static');

    // Simula uma re-ingestão de scanner: uma rodada nova do Semgrep sobre
    // o mesmo repo recria a linha bruta deste id com `state:"candidate"`
    // EXPLÍCITO (não "sem campo state" — esse é o caso que a checagem
    // original de drift já cobria). O ledger nunca viu essa "regressão"
    // porque nada transicionou de verdade; só a linha exportada mudou.
    const rescannedLine = {
      id: 'x::reset-to-candidate', program: 'Vercel Open Source', platform: 'HackerOne', type: 'semgrep_detect_child_process', language: 'ts',
      file: 'vercel/vercel/x.ts', state: 'candidate', reasoning: 'Semgrep (...): descrição genérica de novo, sem o reasoning da investigação anterior',
    };
    const log = migrateEntry(db, rescannedLine, { scopeSnapshots: {}, ledgerStates });
    assert.equal(log.finalState, 'corroborated_static', 'o ledger deveria vencer mesmo quando a fila regrediu até o estado inicial "candidate"');
    assert.equal(getFinding(db, 'x::reset-to-candidate').state, 'corroborated_static');
    assert.ok(log.steps.some((s) => s.reason && s.reason.startsWith('DRIFT CORRIGIDO')), 'deveria registrar explicitamente que corrigiu um drift');
    closeDb(db);
  });
});

test('migrateEntry: sem entrada correspondente no ledgerStates, o `state` da linha é aceito normalmente (comportamento antigo preservado)', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    const log = migrateEntry(db, {
      id: 'x::no-drift', program: 'Circle BBP', platform: 'HackerOne', type: 'reentrancy_risk', language: 'solidity',
      file: 'circlefin/evm-gateway-contracts/x.sol', state: 'human_ready', confidence: 'alta', reasoning: 'pronto pra revisão',
    }, { scopeSnapshots: {}, ledgerStates: new Map() });
    assert.equal(log.finalState, 'human_ready');
    assert.ok(!log.steps.some((s) => s.reason && s.reason.startsWith('DRIFT CORRIGIDO')));
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

// --- 02/09/2026: reprodução direta do bug real (outcome "duplicate" da
// HackerOne #3988959 sumindo entre ambientes) e prova de que o
// round-trip completo agora sobrevive: gravar -> exportar -> banco
// NOVO (ambiente efêmero simulado) -> migrar -> outcome presente de
// volta. Ver docs/zerotoone-v2/IMPLEMENTATION_STATE.md.

test('round-trip completo: platformOutcome gravado num ambiente sobrevive export -> banco novo -> migrateEntry (reprodução exata do bug do SSRF #3988959)', () => {
  withTempEnv((dbPath1) => {
    // "Ambiente 1": onde o outcome real é gravado pela primeira vez.
    const db1 = openDb(dbPath1);
    migrateEntry(db1, {
      id: 'x::ssrf-repro', program: 'Vercel Open Source', platform: 'HackerOne', type: 'ssrf_redirect_allowlist_bypass_risk', language: 'typescript',
      file: 'vercel/next.js/packages/next/src/server/image-optimizer.ts', verdict: 'confirmado', status: 'reviewed',
      reasoning: 'SSRF via redirect bypass',
    }, { scopeSnapshots: {} });
    recordPlatformOutcome(db1, 'x::ssrf-repro', { platform: 'HackerOne', externalReportId: '3988959', state: 'duplicate', comments: 'Duplicate de #3943945' });
    const exportedLines = exportFindingsToQueueLines(db1);
    closeDb(db1);

    const exported = JSON.parse(exportedLines.find((l) => JSON.parse(l).id === 'x::ssrf-repro'));
    assert.equal(exported.platformOutcome.state, 'duplicate', 'a linha exportada precisa carregar o outcome -- essa é a correção');

    // "Ambiente 2": banco novo/vazio, como o agente de nuvem reconstrói
    // a cada rodada -- só tem o que queue.jsonl (aqui, `exported`) traz.
    withTempEnv((dbPath2) => {
      const db2 = openDb(dbPath2);
      migrateEntry(db2, exported, { scopeSnapshots: {} });
      const outcome = latestPlatformOutcome(db2, 'x::ssrf-repro');
      assert.ok(outcome, 'outcome deveria ter sido restaurado no ambiente novo');
      assert.equal(outcome.state, 'duplicate');
      assert.equal(outcome.external_report_id, '3988959');
      closeDb(db2);
    });
  });
});

test('round-trip completo: deploymentEvidence, validationsHistory (múltiplas) e report também sobrevivem export -> banco novo -> migrateEntry', () => {
  withTempEnv((dbPath1) => {
    const db1 = openDb(dbPath1);
    migrateEntry(db1, {
      id: 'x::full-satellite', program: 'Circle BBP', platform: 'HackerOne', type: 'reentrancy_risk', language: 'solidity',
      file: 'circlefin/evm-gateway-contracts/x.sol', verdict: 'confirmado', status: 'reviewed', reasoning: 'teste',
    }, { scopeSnapshots: {} });
    recordDeploymentEvidence(db1, 'x::full-satellite', { repo: 'circlefin/evm-gateway-contracts', commit: 'deadbeef', deployedAddress: '0xabc', confidence: 'high' });
    recordValidation(db1, 'x::full-satellite', { type: 'foundry_poc', result: 'fail', rawOutput: 'FAIL: revert' });
    recordValidation(db1, 'x::full-satellite', { type: 'foundry_poc', result: 'pass', rawOutput: 'PASS' });
    recordReport(db1, 'x::full-satellite', 'research/bugbounty/reports/x.md');
    const exported = JSON.parse(exportFindingsToQueueLines(db1).find((l) => JSON.parse(l).id === 'x::full-satellite'));
    closeDb(db1);

    assert.equal(exported.validationsHistory.length, 2, 'as DUAS validações deveriam estar na linha exportada, não só a mais recente');

    withTempEnv((dbPath2) => {
      const db2 = openDb(dbPath2);
      migrateEntry(db2, exported, { scopeSnapshots: {} });
      assert.equal(latestDeploymentEvidence(db2, 'x::full-satellite').deployed_address, '0xabc');
      assert.equal(listValidations(db2, 'x::full-satellite').length, 2);
      assert.equal(latestReport(db2, 'x::full-satellite').path, 'research/bugbounty/reports/x.md');
      closeDb(db2);
    });
  });
});

test('round-trip completo: fingerprint, duplicateCheck, impacto e submissão sobrevivem em outro ambiente', () => {
  withTempEnv((dbPath1) => {
    const db1 = openDb(dbPath1);
    migrateEntry(db1, {
      id: 'x::professional-roundtrip', program: 'P', platform: 'HackerOne', type: 'idor', language: 'typescript',
      file: 'acme/api/src/account.ts', state: 'scope_verified', reasoning: 'acesso entre duas contas próprias',
      source: 'req.params.accountId', sink: 'db.account.findById', missingControl: 'owner check',
    }, { scopeSnapshots: {} });
    recordDuplicateCheck(db1, 'x::professional-roundtrip', {
      methods: ['github_issues', 'github_advisories', 'hacktivity'],
      queries: ['account findById IDOR', 'missing owner check'], results: [],
      foundExisting: false, noveltyStatus: 'private_unknown', riskScore: 25, riskLevel: 'low',
      signals: { priorDuplicateSubmissions: 0, codeAgeDays: 2 },
      noveltyProof: { kind: 'verified_regression', introducedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      ts: '2026-09-03T17:00:00Z',
    });
    recordImpactAssessment(db1, 'x::professional-roundtrip', {
      technicalValidity: 'confirmed', attackerControlledInput: true,
      attacker: 'usuário remoto', victim: 'outro usuário', securityBoundary: 'isolamento entre contas',
      observableOutcome: 'leitura de conta alheia', rationale: 'duas contas próprias',
      confidentiality: 'low', integrity: 'none', availability: 'none', impactScope: 'other_user', reportable: true,
      ts: '2026-09-03T17:05:00Z',
    });
    recordPlatformOutcome(db1, 'x::professional-roundtrip', {
      platform: 'HackerOne', externalReportId: '900', state: 'duplicate', originalReportId: '100',
      updatedAt: '2026-09-03T18:00:00Z',
    });
    const exported = JSON.parse(exportFindingsToQueueLines(db1).find((line) => JSON.parse(line).id === 'x::professional-roundtrip'));
    closeDb(db1);

    assert.match(exported.semanticFingerprint, /^sf:v1:/);
    withTempEnv((dbPath2) => {
      const db2 = openDb(dbPath2);
      migrateEntry(db2, exported, { scopeSnapshots: {} });
      assert.equal(getFinding(db2, exported.id).semanticFingerprint, exported.semanticFingerprint);
      assert.equal(latestDuplicateCheck(db2, exported.id).riskScore, 25);
      assert.equal(latestDuplicateCheck(db2, exported.id).signals.codeAgeDays, 2);
      assert.equal(latestDuplicateCheck(db2, exported.id).noveltyProof.kind, 'verified_regression');
      assert.equal(latestImpactAssessment(db2, exported.id).impactScope, 'other_user');
      assert.equal(listSubmissions(db2).length, 1);
      assert.equal(listSubmissions(db2)[0].originalReportId, '100');
      closeDb(db2);
    });
  });
});

test('migrateEntry restaurando satélite é idempotente: rodar a mesma linha exportada duas vezes não duplica linha nem ledger', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    migrateEntry(db, {
      id: 'x::satellite-idempotent', program: 'Vercel Open Source', platform: 'HackerOne', type: 'ssrf_risk', language: 'js',
      file: 'vercel/flags/x.ts', verdict: 'confirmado', status: 'reviewed', reasoning: 'teste',
    }, { scopeSnapshots: {} });
    recordPlatformOutcome(db, 'x::satellite-idempotent', { platform: 'HackerOne', state: 'triaged' });
    const exported = JSON.parse(exportFindingsToQueueLines(db).find((l) => JSON.parse(l).id === 'x::satellite-idempotent'));
    const entriesBeforeReplay = verifyChain('research').entries;

    // Reprocessa a MESMA linha (já com platformOutcome) contra o MESMO
    // banco que já tem exatamente esse outcome -- cenário real de rodar
    // migrate-to-v2 de novo sem nada ter mudado.
    migrateEntry(db, exported, { scopeSnapshots: {} });
    assert.equal(verifyChain('research').entries, entriesBeforeReplay, 'reprocessar outcome idêntico não deveria gerar novo evento no ledger nem duplicar a linha');

    closeDb(db);
  });
});

test('migrateEntry restaura platformOutcome ATUALIZADO (não idêntico) e isso SIM gera novo evento no ledger', () => {
  withTempEnv((dbPath) => {
    const db = openDb(dbPath);
    migrateEntry(db, {
      id: 'x::satellite-updated', program: 'Vercel Open Source', platform: 'HackerOne', type: 'ssrf_risk', language: 'js',
      file: 'vercel/flags/x.ts', verdict: 'confirmado', status: 'reviewed', reasoning: 'teste',
    }, { scopeSnapshots: {} });
    recordPlatformOutcome(db, 'x::satellite-updated', { platform: 'HackerOne', state: 'triaged' });
    const entriesAfterFirst = verifyChain('research').entries;

    // Linha da fila chega com um outcome MAIS NOVO (triaged -> duplicate,
    // como aconteceria de verdade quando a plataforma decide).
    const staleExport = JSON.parse(exportFindingsToQueueLines(db).find((l) => JSON.parse(l).id === 'x::satellite-updated'));
    const updatedLine = { ...staleExport, platformOutcome: { ...staleExport.platformOutcome, state: 'duplicate' } };
    migrateEntry(db, updatedLine, { scopeSnapshots: {} });

    assert.equal(latestPlatformOutcome(db, 'x::satellite-updated').state, 'duplicate');
    assert.equal(verifyChain('research').entries, entriesAfterFirst + 1, 'um outcome genuinamente diferente deveria gerar um novo evento');
    closeDb(db);
  });
});
