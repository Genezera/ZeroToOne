import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHacktivityPage, toReportSummary } from '../h1-api.mjs';

test('toReportSummary preserva evidência útil do report e relação de duplicate', () => {
  const item = {
    id: '3994302',
    attributes: {
      title: 'Argument mismatch', state: 'duplicate', created_at: '2026-09-03T18:00:00Z',
      vulnerability_information: 'passos do report', impact: 'operação falha',
    },
    relationships: {
      program: { data: { type: 'program', id: 'kiwi_com' } },
      severity: { data: { type: 'severity', id: 'sev-1' } },
      structured_scope: { data: { type: 'structured-scope', id: 'scope-1' } },
      activities: { data: [{ type: 'activity', id: 'act-1' }] },
    },
  };
  const included = [
    { type: 'severity', id: 'sev-1', attributes: { rating: 'low', score: 3.1 } },
    { type: 'structured-scope', id: 'scope-1', attributes: { asset_identifier: 'github.com/kiwicom/js-iam-middleware' } },
    { type: 'activity', id: 'act-1', attributes: { message: 'Closed as duplicate of report #3439366' } },
  ];
  const result = toReportSummary(item, included);
  assert.equal(result.id, '3994302');
  assert.equal(result.programHandle, 'kiwi_com');
  assert.equal(result.originalReportId, '3439366');
  assert.equal(result.severityRating, 'low');
  assert.equal(result.severityScore, 3.1);
  assert.equal(result.assetIdentifier, 'github.com/kiwicom/js-iam-middleware');
  assert.equal(result.activities.length, 1);
  assert.equal(result.vulnerabilityInformation, 'passos do report');
});

test('toReportSummary não inventa originalReportId sem atividade explícita', () => {
  const result = toReportSummary({
    id: '1', attributes: { state: 'duplicate' }, relationships: {},
  }, []);
  assert.equal(result.originalReportId, null);
});

test('toReportSummary aceita o formato real com attributes embutidos em relationships.data', () => {
  const result = toReportSummary({
    id: '3994302', attributes: { state: 'duplicate' }, relationships: {
      program: { data: { type: 'program', id: 'kiwi_com', attributes: { handle: 'kiwi_com' } } },
      severity: { data: { type: 'severity', id: 's', attributes: { rating: 'low', score: 2.5 } } },
      structured_scope: { data: { type: 'structured-scope', id: 'x', attributes: { asset_identifier: 'github.com/kiwicom/js-iam-middleware' } } },
      activities: { data: [{ type: 'activity', id: 'a', attributes: { message: 'Duplicate of #3439366' } }] },
    },
  });
  assert.equal(result.originalReportId, '3439366');
  assert.equal(result.severityRating, 'low');
  assert.equal(result.assetIdentifier, 'github.com/kiwicom/js-iam-middleware');
});

test('getHacktivityPage normaliza o feed sem depender de links.next', async () => {
  const previousUser = process.env.HACKERONE_USERNAME;
  const previousToken = process.env.HACKERONE_API_TOKEN;
  process.env.HACKERONE_USERNAME = 'researcher';
  process.env.HACKERONE_API_TOKEN = 'secret';
  try {
    let requested = null;
    const items = await getHacktivityPage(2, 25, { fetchImpl: async (url) => {
      requested = String(url);
      return { ok: true, json: async () => ({ data: [{
        id: 42,
        attributes: { title: 'Bug', submitted_at: '2026-09-01T00:00:00Z', latest_disclosable_activity_at: '2026-09-04T00:00:00Z', disclosed: true },
        relationships: { program: { data: { id: 'acme', attributes: { handle: 'acme' } } } },
      }] }) };
    } });
    assert.match(requested, /page%5Bnumber%5D=2/);
    assert.equal(items[0].id, '42');
    assert.equal(items[0].programHandle, 'acme');
  } finally {
    if (previousUser === undefined) delete process.env.HACKERONE_USERNAME; else process.env.HACKERONE_USERNAME = previousUser;
    if (previousToken === undefined) delete process.env.HACKERONE_API_TOKEN; else process.env.HACKERONE_API_TOKEN = previousToken;
  }
});

test('getHacktivityPage recusa tamanho que a API não suporta', async () => {
  await assert.rejects(() => getHacktivityPage(1, 51), /entre 1 e 50/);
});
