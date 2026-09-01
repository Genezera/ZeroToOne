import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadCheckpoint, saveCheckpoint, findNewNotableTransitions, groupByProgram,
  formatIndividualMessage, formatGroupedDigest, runTelegramDigest,
} from '../telegram-digest.mjs';

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-digest-test-'));
  try {
    return await fn(dir);
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best-effort */ }
  }
}

function transition(overrides = {}) {
  return {
    type: 'bugbounty_state_transition',
    findingId: 'Circle BBP::src/Vault.sol::withdraw::reentrancy_risk',
    from: 'scope_verified',
    to: 'human_ready',
    actor: 'renan',
    rationale: 'rascunho pronto',
    ts: '2026-08-31T00:00:00.000Z',
    hash: 'h1',
    ...overrides,
  };
}

test('loadCheckpoint devolve lastHash:null quando o arquivo não existe, nunca lança', async () => {
  await withTempDir((dir) => {
    assert.deepEqual(loadCheckpoint(path.join(dir, 'nao-existe.json')), { lastHash: null });
  });
});

test('loadCheckpoint devolve lastHash:null pra JSON inválido', async () => {
  await withTempDir((dir) => {
    const p = path.join(dir, 'bad.json');
    writeFileSync(p, '{ nao é json', 'utf8');
    assert.deepEqual(loadCheckpoint(p), { lastHash: null });
  });
});

test('save/loadCheckpoint fazem round-trip', async () => {
  await withTempDir((dir) => {
    const p = path.join(dir, 'checkpoint.json');
    saveCheckpoint({ lastHash: 'abc123', lastCheckedAt: '2026-08-31T00:00:00.000Z' }, p);
    assert.deepEqual(loadCheckpoint(p), { lastHash: 'abc123', lastCheckedAt: '2026-08-31T00:00:00.000Z' });
  });
});

test('findNewNotableTransitions: sem checkpoint, processa tudo que for notável', () => {
  const entries = [
    transition({ hash: 'h1', to: 'candidate' }),
    transition({ hash: 'h2', to: 'false_positive' }),
    transition({ hash: 'h3', to: 'human_ready' }),
  ];
  const notable = findNewNotableTransitions(entries, null);
  assert.equal(notable.length, 1);
  assert.equal(notable[0].hash, 'h3');
});

test('findNewNotableTransitions: só processa o que vem DEPOIS do hash de checkpoint', () => {
  const entries = [
    transition({ hash: 'h1', to: 'human_ready' }),
    transition({ hash: 'h2', to: 'duplicate' }),
    transition({ hash: 'h3', to: 'reproduced_local' }),
  ];
  const notable = findNewNotableTransitions(entries, 'h1');
  assert.deepEqual(notable.map((n) => n.hash), ['h2', 'h3']);
});

test('findNewNotableTransitions: checkpoint órfão (ledger recriado) processa tudo em vez de travar', () => {
  const entries = [transition({ hash: 'h1', to: 'human_ready' })];
  const notable = findNewNotableTransitions(entries, 'hash-que-nao-existe-mais');
  assert.equal(notable.length, 1);
});

test('findNewNotableTransitions: ignora entradas que não são bugbounty_state_transition', () => {
  const entries = [{ type: 'outra_coisa', to: 'human_ready', hash: 'h1' }];
  assert.deepEqual(findNewNotableTransitions(entries, null), []);
});

test('groupByProgram agrupa corretamente por prefixo do findingId', () => {
  const grouped = groupByProgram([
    transition({ findingId: 'Circle BBP::a::b::c' }),
    transition({ findingId: 'Vercel Open Source::x::y::z' }),
    transition({ findingId: 'Circle BBP::d::e::f' }),
  ]);
  assert.equal(grouped['Circle BBP'].length, 2);
  assert.equal(grouped['Vercel Open Source'].length, 1);
});

test('formatIndividualMessage inclui programa, estado e ator, escapado', () => {
  const msg = formatIndividualMessage(transition({ actor: '<script>' }));
  assert.match(msg, /Circle BBP/);
  assert.match(msg, /human_ready/);
  assert.match(msg, /&lt;script&gt;/);
  assert.doesNotMatch(msg, /<script>/);
});

test('formatGroupedDigest resume por programa sem listar cada transição individualmente', () => {
  const msg = formatGroupedDigest([
    transition({ findingId: 'Circle BBP::a::b::c', to: 'human_ready' }),
    transition({ findingId: 'Circle BBP::d::e::f', to: 'duplicate' }),
    transition({ findingId: 'OKG::x::y::z', to: 'reproduced_local' }),
  ]);
  assert.match(msg, /resumo de atividade/);
  assert.match(msg, /Circle BBP/);
  assert.match(msg, /OKG/);
});

test('runTelegramDigest: nada notável novo -- não manda mensagem, mas avança o checkpoint', async () => {
  await withTempDir(async (dir) => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    const entries = [transition({ hash: 'h1', to: 'false_positive' })];
    let sendCalls = 0;
    const result = await runTelegramDigest({
      checkpointPath,
      readLedgerFn: () => entries,
      sendFn: async () => { sendCalls++; return { ok: true }; },
    });
    assert.equal(result.notable, 0);
    assert.equal(result.sent, 0);
    assert.equal(sendCalls, 0);
    assert.equal(loadCheckpoint(checkpointPath).lastHash, 'h1');
  });
});

test('runTelegramDigest: poucas transições notáveis -- uma mensagem por transição', async () => {
  await withTempDir(async (dir) => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    const entries = [
      transition({ hash: 'h1', to: 'human_ready', findingId: 'Circle BBP::a::b::c' }),
      transition({ hash: 'h2', to: 'reproduced_local', findingId: 'OKG::x::y::z' }),
    ];
    const sent = [];
    const result = await runTelegramDigest({
      checkpointPath,
      readLedgerFn: () => entries,
      sendFn: async (text) => { sent.push(text); return { ok: true }; },
    });
    assert.equal(result.notable, 2);
    assert.equal(result.sent, 2);
    assert.equal(sent.length, 2);
    assert.match(sent[1], /OKG/, 'a segunda mensagem deveria ser sobre o achado da OKG, não só Circle BBP');
  });
});

test('runTelegramDigest: muitas transições notáveis -- vira UM resumo agrupado, nunca spam', async () => {
  await withTempDir(async (dir) => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    const entries = Array.from({ length: 10 }, (_, i) => transition({ hash: `h${i}`, to: 'human_ready', findingId: `Programa${i}::a::b::c` }));
    const sent = [];
    const result = await runTelegramDigest({
      checkpointPath,
      readLedgerFn: () => entries,
      sendFn: async (text) => { sent.push(text); return { ok: true }; },
    });
    assert.equal(result.notable, 10);
    assert.equal(result.sent, 1, 'deveria mandar só 1 mensagem agrupada, não 10');
    assert.match(sent[0], /resumo de atividade/);
  });
});

test('runTelegramDigest: roda 2x seguidas -- a segunda vez não reenvia o que já foi notificado', async () => {
  await withTempDir(async (dir) => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    const entries = [transition({ hash: 'h1', to: 'human_ready' })];
    const sent = [];
    const sendFn = async (text) => { sent.push(text); return { ok: true }; };

    await runTelegramDigest({ checkpointPath, readLedgerFn: () => entries, sendFn });
    assert.equal(sent.length, 1);

    // Segunda rodada, ledger sem nada novo além do que já foi visto.
    await runTelegramDigest({ checkpointPath, readLedgerFn: () => entries, sendFn });
    assert.equal(sent.length, 1, 'não deveria reenviar a mesma transição já notificada');
  });
});
