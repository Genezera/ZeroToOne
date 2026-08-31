// Cliente fino pra Hacker API v1 do HackerOne (api.hackerone.com/v1/hackers/...).
// Credenciais NUNCA em arquivo — só via variável de ambiente (setx local,
// nunca commitado). Se não estiverem setadas, toda função aqui falha alto
// e claro, não silenciosamente.

const BASE_URL = 'https://api.hackerone.com/v1';

function getCredentials() {
  const username = process.env.HACKERONE_USERNAME;
  const token = process.env.HACKERONE_API_TOKEN;
  if (!username || !token) {
    throw new Error(
      'HACKERONE_USERNAME e/ou HACKERONE_API_TOKEN não estão setados nas variáveis de ambiente. ' +
      'Rode: setx HACKERONE_USERNAME "..." e setx HACKERONE_API_TOKEN "..." (uma janela nova de terminal depois disso).'
    );
  }
  return { username, token };
}

function authHeader() {
  const { username, token } = getCredentials();
  const encoded = Buffer.from(`${username}:${token}`).toString('base64');
  return `Basic ${encoded}`;
}

async function h1Get(pathAndQuery) {
  const url = pathAndQuery.startsWith('http') ? pathAndQuery : `${BASE_URL}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.errors ? JSON.stringify(body.errors) : `HTTP ${res.status}`;
    throw new Error(`HackerOne API ${res.status} em ${url}: ${msg}`);
  }
  return body;
}

/** Segue todos os links.next até esgotar as páginas. Devolve array achatado de `data`. */
async function h1GetAllPages(firstPathAndQuery) {
  let next = firstPathAndQuery;
  const all = [];
  let guard = 0;
  while (next && guard < 50) {
    const page = await h1Get(next);
    all.push(...(page.data || []));
    next = page.links?.next || null;
    guard++;
  }
  return all;
}

/** GET /hackers/me/reports — lista os reports do próprio usuário autenticado. */
export async function getMyReports() {
  const items = await h1GetAllPages('/hackers/me/reports');
  return items.map(toReportSummary);
}

/** GET /hackers/reports/{id} — um report específico, com mais detalhe. */
export async function getReport(id) {
  const body = await h1Get(`/hackers/reports/${id}`);
  return toReportSummary(body.data);
}

function toReportSummary(item) {
  if (!item) return null;
  return {
    id: item.id,
    title: item.attributes?.title,
    state: item.attributes?.state,
    substate: item.attributes?.substate,
    createdAt: item.attributes?.created_at,
    lastActivityAt: item.attributes?.last_activity_at,
    weaknessId: item.relationships?.weakness?.data?.id,
    programHandle: item.relationships?.program?.data?.id,
    bountyAwardedAt: item.attributes?.bounty_awarded_at,
    disclosedAt: item.attributes?.disclosed_at,
  };
}

/** GET /hackers/programs/{handle}/structured_scopes — escopo estruturado oficial, ao vivo. */
export async function getStructuredScope(programHandle) {
  const items = await h1GetAllPages(`/hackers/programs/${programHandle}/structured_scopes`);
  return items.map((x) => ({
    assetIdentifier: x.attributes.asset_identifier,
    assetType: x.attributes.asset_type,
    eligibleForBounty: x.attributes.eligible_for_bounty,
    eligibleForSubmission: x.attributes.eligible_for_submission,
    maxSeverity: x.attributes.max_severity,
    instruction: x.attributes.instruction || null,
  }));
}

/** GET /hackers/programs/{handle} — metadados do programa (pra achar policy/handle real). */
export async function getProgram(programHandle) {
  const body = await h1Get(`/hackers/programs/${programHandle}`);
  return body.data;
}
