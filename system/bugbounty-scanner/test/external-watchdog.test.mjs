import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessCloudHealth, dispatchChangeMonitor, runScheduled } from '../../../cloud/bugbounty-watchdog/src/worker.mjs';

function env() {
  const data = new Map();
  return {
    GITHUB_OWNER: 'Genezera', GITHUB_REPO: 'ZeroToOne', GITHUB_REF: 'master',
    GITHUB_ACTIONS_TOKEN: 'secret', TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHAT_ID: 'chat',
    ALERT_STATE: {
      get: async (key) => data.has(key) ? JSON.parse(data.get(key)) : null,
      put: async (key, value) => data.set(key, value),
    },
  };
}

test('external scheduler dispatches the exact change-monitor workflow', async () => {
  let request;
  await dispatchChangeMonitor(env(), async (url, init) => {
    request = { url, init }; return new Response(null, { status: 204 });
  });
  assert.match(request.url, /bugbounty-change-monitor\.yml\/dispatches$/);
  assert.equal(JSON.parse(request.init.body).ref, 'master');
});

test('external watchdog detects stale GitHub health and deduplicates Telegram alert', async () => {
  const e = env();
  let telegram = 0;
  const fetchFn = async (url) => {
    if (url.includes('/dispatches')) return new Response(null, { status: 204 });
    if (url.includes('api.telegram.org')) { telegram += 1; return Response.json({ ok: true }); }
    return Response.json({ workflow_runs: [{ status: 'completed', conclusion: 'success',
      updated_at: '2026-09-09T00:00:00Z', html_url: 'https://example/run' }] });
  };
  const first = await runScheduled(e, Date.parse('2026-09-09T02:00:00Z'), fetchFn);
  assert.equal(first.health.healthy, false);
  await runScheduled(e, Date.parse('2026-09-09T02:10:00Z'), fetchFn);
  assert.equal(telegram, 1);
});

test('health assessor accepts a current successful run', async () => {
  const health = await assessCloudHealth(env(), Date.parse('2026-09-09T02:00:00Z'), async () =>
    Response.json({ workflow_runs: [{ status: 'completed', conclusion: 'success',
      updated_at: '2026-09-09T01:50:00Z' }] }));
  assert.equal(health.healthy, true);
});

