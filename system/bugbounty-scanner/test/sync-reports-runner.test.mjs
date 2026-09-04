import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSyncReports } from '../sync-reports-runner.mjs';

test('sync de reports puxa antes, fecha banco e publica estado compartilhado', async () => {
  const calls = [];
  const db = { fake: true };
  const result = await runSyncReports({
    repoRoot: 'repo', dbPath: 'db', logger: () => {},
    pull: () => { calls.push('pull'); return { ok: true }; },
    open: () => { calls.push('open'); return db; },
    sync: async (received) => { assert.equal(received, db); calls.push('sync'); return { checked: 6, changed: 1 }; },
    close: () => calls.push('close'),
    publish: (_root, message) => { calls.push('publish'); assert.match(message, /1 report/); return { ok: true, committed: true }; },
  });
  assert.deepEqual(calls, ['pull', 'open', 'sync', 'close', 'publish']);
  assert.equal(result.published.ok, true);
});

test('sync de reports não consulta API quando preflight Git falha', async () => {
  let opened = false;
  await assert.rejects(() => runSyncReports({
    repoRoot: 'repo', logger: () => {},
    pull: () => ({ ok: false, reason: 'divergente' }),
    open: () => { opened = true; },
  }), /preflight.*divergente/);
  assert.equal(opened, false);
});

test('sync de reports propaga falha de publicação depois de fechar banco', async () => {
  let closed = false;
  await assert.rejects(() => runSyncReports({
    repoRoot: 'repo', logger: () => {},
    pull: () => ({ ok: true }), open: () => ({}), close: () => { closed = true; },
    sync: async () => ({ checked: 6, changed: 1 }),
    publish: () => ({ ok: false, reason: 'push rejeitado' }),
  }), /publicação falhou.*push rejeitado/);
  assert.equal(closed, true);
});
