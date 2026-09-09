const GITHUB_API = 'https://api.github.com';
const HEALTH_WORKFLOW = 'bugbounty-health.yml';
const MONITOR_WORKFLOW = 'bugbounty-change-monitor.yml';
const STATE_KEY = 'health-notification-state-v1';

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function githubHeaders(env) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${required(env, 'GITHUB_ACTIONS_TOKEN')}`,
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'ZeroToOne-External-Watchdog/1.0',
  };
}

async function github(env, route, init = {}, fetchFn = fetch) {
  const response = await fetchFn(`${GITHUB_API}${route}`, {
    ...init, headers: { ...githubHeaders(env), ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`GitHub ${route} returned HTTP ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

export async function dispatchChangeMonitor(env, fetchFn = fetch) {
  const owner = required(env, 'GITHUB_OWNER');
  const repo = required(env, 'GITHUB_REPO');
  await github(env, `/repos/${owner}/${repo}/actions/workflows/${MONITOR_WORKFLOW}/dispatches`, {
    method: 'POST', body: JSON.stringify({ ref: env.GITHUB_REF || 'master' }),
  }, fetchFn);
  return { dispatched: true };
}

export async function assessCloudHealth(env, scheduledTime = Date.now(), fetchFn = fetch) {
  const owner = required(env, 'GITHUB_OWNER');
  const repo = required(env, 'GITHUB_REPO');
  const body = await github(env,
    `/repos/${owner}/${repo}/actions/workflows/${HEALTH_WORKFLOW}/runs?per_page=5`, {}, fetchFn);
  const completed = (body?.workflow_runs || []).find((run) => run.status === 'completed');
  if (!completed) return { healthy: false, reason: 'no completed cloud-health run exists', ageMinutes: null };
  const ageMinutes = Math.max(0, Math.floor((scheduledTime - Date.parse(completed.updated_at)) / 60_000));
  if (completed.conclusion !== 'success') {
    return { healthy: false, reason: `latest cloud-health conclusion is ${completed.conclusion}`, ageMinutes, url: completed.html_url };
  }
  const maxAge = Number(env.HEALTH_MAX_AGE_MINUTES || 75);
  return ageMinutes <= maxAge
    ? { healthy: true, reason: 'cloud health is current', ageMinutes, url: completed.html_url }
    : { healthy: false, reason: `cloud health is ${ageMinutes} minutes old`, ageMinutes, url: completed.html_url };
}

async function sendTelegram(env, text, fetchFn = fetch) {
  const token = required(env, 'TELEGRAM_BOT_TOKEN');
  const chatId = required(env, 'TELEGRAM_CHAT_ID');
  const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
}

export async function runScheduled(env, scheduledTime = Date.now(), fetchFn = fetch) {
  if (!env.ALERT_STATE) throw new Error('ALERT_STATE KV binding is required for deduplicated alerts');
  const results = { dispatch: null, health: null, notification: null };
  try { results.dispatch = await dispatchChangeMonitor(env, fetchFn); }
  catch (error) { results.dispatch = { dispatched: false, reason: error.message }; }
  try { results.health = await assessCloudHealth(env, scheduledTime, fetchFn); }
  catch (error) { results.health = { healthy: false, reason: error.message, ageMinutes: null }; }
  const previous = await env.ALERT_STATE.get(STATE_KEY, { type: 'json' }) || { healthy: null };
  if (previous.healthy !== results.health.healthy) {
    const message = results.health.healthy
      ? `✅ ZeroToOne external watchdog: cloud health recovered (${results.health.ageMinutes} min old).`
      : `🚨 ZeroToOne external watchdog: attention required — ${results.health.reason}.`;
    try {
      await sendTelegram(env, message, fetchFn);
      results.notification = { sent: true };
      await env.ALERT_STATE.put(STATE_KEY, JSON.stringify({
        healthy: results.health.healthy, changedAt: new Date(scheduledTime).toISOString(),
      }));
    } catch (error) {
      results.notification = { sent: false, reason: error.message };
    }
  } else {
    results.notification = { sent: false, reason: 'state unchanged' };
  }
  return results;
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  },
  async fetch(request, env) {
    const expected = required(env, 'STATUS_TOKEN');
    if (request.headers.get('authorization') !== `Bearer ${expected}`) return new Response('unauthorized', { status: 401 });
    const health = await assessCloudHealth(env);
    return Response.json(health, { status: health.healthy ? 200 : 503 });
  },
};

