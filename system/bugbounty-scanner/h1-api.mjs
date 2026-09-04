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

async function h1Get(pathAndQuery, { fetchImpl = fetch } = {}) {
  const url = pathAndQuery.startsWith('http') ? pathAndQuery : `${BASE_URL}${pathAndQuery}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.errors ? JSON.stringify(body.errors) : `HTTP ${res.status}`;
    throw new Error(`HackerOne API ${res.status} em ${url}: ${msg}`);
  }
  return body;
}

/** Uma página do feed público de Hacktivity. O endpoint não devolve
 * `links.next` de forma consistente (confirmado ao vivo em 04/09/2026),
 * portanto paginação/limite temporal ficam deliberadamente no chamador. */
export async function getHacktivityPage(pageNumber = 1, pageSize = 50, opts = {}) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('pageNumber precisa ser inteiro >= 1');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('pageSize precisa estar entre 1 e 50');
  const query = new URLSearchParams({
    'page[number]': String(pageNumber),
    'page[size]': String(pageSize),
  });
  const body = await h1Get(`/hackers/hacktivity?${query}`, opts);
  return (body.data || []).map((item) => ({
    id: String(item.id),
    title: item.attributes?.title || null,
    url: item.attributes?.url || `https://hackerone.com/reports/${item.id}`,
    submittedAt: item.attributes?.submitted_at || null,
    latestActivityAt: item.attributes?.latest_disclosable_activity_at || null,
    disclosedAt: item.attributes?.disclosed_at || null,
    disclosed: item.attributes?.disclosed === true,
    vulnerabilityInformation: item.attributes?.vulnerability_information || null,
    cveIds: item.attributes?.cve_ids || [],
    cwe: item.attributes?.cwe || null,
    severityRating: item.attributes?.severity_rating || null,
    programHandle: item.relationships?.program?.data?.attributes?.handle
      || item.relationships?.program?.data?.id || null,
  }));
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
  // Não passar `toReportSummary` diretamente ao map: o segundo argumento
  // de um callback de Array.map é o índice, mas o segundo argumento desta
  // função é a coleção `included`.
  return items.map((item) => toReportSummary(item));
}

/** GET /hackers/reports/{id} — um report específico, com mais detalhe. */
export async function getReport(id) {
  const body = await h1Get(`/hackers/reports/${id}`);
  return toReportSummary(body.data, body.included || []);
}

function includedResource(included, relationship) {
  const link = relationship?.data;
  if (!link || Array.isArray(link)) return null;
  // A Hacker API real atualmente embute o recurso completo em
  // relationships.data. Fixtures/JSON:API padrão também podem usar
  // `included`; aceitamos os dois sem presumir que included é array.
  if (link.attributes) return link;
  const resources = Array.isArray(included) ? included : [];
  return resources.find((entry) => entry.type === link.type && entry.id === link.id) || null;
}

function relatedResources(included, relationship) {
  const links = Array.isArray(relationship?.data) ? relationship.data : [];
  const embedded = links.filter((link) => link?.attributes);
  if (embedded.length === links.length) return embedded;
  const resources = Array.isArray(included) ? included : [];
  const wanted = new Set(links.map((link) => `${link.type}:${link.id}`));
  return resources.filter((entry) => wanted.has(`${entry.type}:${entry.id}`));
}

function originalReportIdFromActivities(activities) {
  for (const activity of activities) {
    const raw = JSON.stringify(activity.attributes || {});
    if (!/duplicate/i.test(raw)) continue;
    const structured = raw.match(/original_report_id[^0-9]*(\d+)/i);
    if (structured) return structured[1];
    const textual = raw.match(/duplicate[^#0-9]{0,80}#?(\d{4,})/i);
    if (textual) return textual[1];
  }
  return null;
}

export function toReportSummary(item, included = []) {
  if (!item) return null;
  const activities = relatedResources(included, item.relationships?.activities);
  const severity = includedResource(included, item.relationships?.severity);
  const scope = includedResource(included, item.relationships?.structured_scope);
  const program = includedResource(included, item.relationships?.program);
  return {
    id: item.id,
    title: item.attributes?.title,
    state: item.attributes?.state,
    substate: item.attributes?.substate,
    createdAt: item.attributes?.created_at,
    lastActivityAt: item.attributes?.last_activity_at,
    weaknessId: item.relationships?.weakness?.data?.id,
    programHandle: program?.attributes?.handle || item.relationships?.program?.data?.id,
    bountyAwardedAt: item.attributes?.bounty_awarded_at,
    disclosedAt: item.attributes?.disclosed_at,
    vulnerabilityInformation: item.attributes?.vulnerability_information || null,
    impact: item.attributes?.impact || null,
    severityRating: item.attributes?.severity_rating || severity?.attributes?.rating || null,
    severityScore: severity?.attributes?.score ?? null,
    structuredScopeId: item.relationships?.structured_scope?.data?.id || null,
    assetIdentifier: scope?.attributes?.asset_identifier || null,
    originalReportId: originalReportIdFromActivities(activities),
    activities: activities.map((activity) => ({ id: activity.id, type: activity.type, attributes: activity.attributes || {} })),
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

/** GET /hackers/programs/{handle} — metadados do programa, incluindo
 * `started_accepting_at` (data real de lançamento do programa — sinal de
 * maturidade/concorrência: programa mais novo tende a estar menos
 * escrutinado por outros pesquisadores). Confirmado ao vivo 31/08/2026.
 * ATENÇÃO: diferente de todo outro endpoint deste arquivo, este devolve o
 * recurso direto na raiz (`{id, type, attributes}`), SEM envelope
 * `{"data": {...}}` — confirmado com o corpo bruto da resposta depois de
 * `body.data` ter devolvido `undefined` silenciosamente numa primeira
 * versão. Não é um erro deste cliente, é a API real sendo inconsistente
 * entre endpoints. */
export async function getProgram(programHandle) {
  const body = await h1Get(`/hackers/programs/${programHandle}`);
  return toProgramSummary(body);
}

function toProgramSummary(item) {
  if (!item) return null;
  return {
    handle: item.attributes?.handle,
    name: item.attributes?.name,
    state: item.attributes?.state,
    submissionState: item.attributes?.submission_state,
    triageActive: item.attributes?.triage_active,
    offersBounties: item.attributes?.offers_bounties,
    startedAcceptingAt: item.attributes?.started_accepting_at || null,
  };
}
