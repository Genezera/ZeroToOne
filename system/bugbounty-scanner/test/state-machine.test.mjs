import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition, validTransitionsFrom, isTerminal, STATES } from '../state-machine.mjs';

function finding(state, overrides = {}) {
  return { id: 'x', state, reasoning: 'A função X faz Y sem checar Z, confirmado lendo o arquivo inteiro.', ...overrides };
}

test('todos os 14 estados do prompt mestre existem, mais known_duplicate (extensão desta sessão)', () => {
  assert.deepEqual([...STATES].sort(), [
    'candidate', 'corroborated_static', 'reproduced_local', 'scope_verified', 'human_ready',
    'submitted', 'triaged', 'duplicate', 'informative', 'rejected', 'paid', 'resolved',
    'false_positive', 'inconclusive', 'known_duplicate',
  ].sort());
});

test('known_duplicate exige knownIssueSource com título+tipo+url/quote — nunca "parece conhecido" sem citação', () => {
  const f = finding('corroborated_static');
  assert.equal(transition(f, 'known_duplicate', {}).ok, false);
  assert.equal(transition(f, 'known_duplicate', { knownIssueSource: { title: 'X' } }).ok, false, 'falta sourceType e url/quote');
  assert.equal(transition(f, 'known_duplicate', { knownIssueSource: { title: 'X', sourceType: 'public_audit' } }).ok, false, 'falta url ou quote');
  const good = transition(f, 'known_duplicate', {
    knownIssueSource: { title: 'ChainSecurity Circle Gateway audit, seção 8.1', sourceType: 'public_audit', url: 'https://circle.com/...' },
  });
  assert.equal(good.ok, true);
});

test('known_duplicate é alcançável de qualquer estado não-terminal, como false_positive/inconclusive', () => {
  const src = { knownIssueSource: { title: 'advisory X', sourceType: 'advisory', quote: 'trecho citado' } };
  for (const s of ['candidate', 'corroborated_static', 'reproduced_local', 'scope_verified', 'human_ready']) {
    assert.equal(transition(finding(s), 'known_duplicate', src).ok, true, `${s} -> known_duplicate deveria ser permitido`);
  }
});

test('known_duplicate é terminal — nenhuma transição sai dele', () => {
  assert.equal(isTerminal('known_duplicate'), true);
  assert.equal(transition(finding('known_duplicate'), 'candidate', {}).ok, false);
});

test('estado desconhecido é rejeitado', () => {
  const r = transition(finding('candidate'), 'nao_existe', {});
  assert.equal(r.ok, false);
});

test('transicionar pro mesmo estado é rejeitado', () => {
  const r = transition(finding('candidate'), 'candidate', {});
  assert.equal(r.ok, false);
});

test('candidate -> corroborated_static exige filesRead E reasoning não-trivial', () => {
  assert.equal(transition(finding('candidate'), 'corroborated_static', {}).ok, false);
  assert.equal(transition(finding('candidate'), 'corroborated_static', { filesRead: ['a.sol'] }).ok, true);
  assert.equal(transition(finding('candidate', { reasoning: '' }), 'corroborated_static', { filesRead: ['a.sol'] }).ok, false);
});

test('corroborated_static -> reproduced_local exige validação com result=pass, not_applicable não basta', () => {
  const f = finding('corroborated_static');
  assert.equal(transition(f, 'reproduced_local', {}).ok, false);
  assert.equal(transition(f, 'reproduced_local', { validations: [{ type: 'foundry_poc', result: 'fail' }] }).ok, false);
  const naResult = transition(f, 'reproduced_local', { validations: [{ type: 'foundry_poc', result: 'not_applicable' }] });
  assert.equal(naResult.ok, false);
  assert.match(naResult.reason, /Fase 2\/4/);
  assert.equal(transition(f, 'reproduced_local', { validations: [{ type: 'foundry_poc', result: 'pass', ts: '2026-08-30' }] }).ok, true);
});

test('reproduced_local -> scope_verified exige scopeGateResult.allowed=true E deploymentEvidence declarado', () => {
  const f = finding('reproduced_local');
  assert.equal(transition(f, 'scope_verified', {}).ok, false);
  assert.equal(transition(f, 'scope_verified', { scopeGateResult: { allowed: false, reason: 'expirado' } }).ok, false);
  const semDeploy = transition(f, 'scope_verified', { scopeGateResult: { allowed: true, reason: 'ok' } });
  assert.equal(semDeploy.ok, false);
  assert.match(semDeploy.reason, /DeploymentEvidence/);
  const naoVerificado = transition(f, 'scope_verified', {
    scopeGateResult: { allowed: true, reason: 'ok' },
    deploymentEvidence: { confidence: 'unverified', notes: 'branch master, sem confirmação de deploy' },
  });
  assert.equal(naoVerificado.ok, false, 'confidence="unverified" documenta o gap mas não deveria bastar pra scope_verified');
  assert.match(naoVerificado.reason, /vínculo real/);
  const comDeploy = transition(f, 'scope_verified', {
    scopeGateResult: { allowed: true, reason: 'ok' },
    deploymentEvidence: { confidence: 'low', notes: 'endereço confirmado via explorer' },
  });
  assert.equal(comDeploy.ok, true);
});

test('scope_verified -> human_ready exige rascunho de relatório existente', () => {
  const f = finding('scope_verified');
  assert.equal(transition(f, 'human_ready', {}).ok, false);
  const dup = { duplicateCheck: { methods: ['github_issues'], ts: '2026-08-31T00:00:00Z' } };
  assert.equal(transition(f, 'human_ready', { report: { path: 'reports/x.md' }, ...dup }).ok, true);
});

test('scope_verified -> human_ready exige duplicateCheck com methods incluindo "github_issues" e timestamp', () => {
  const f = finding('scope_verified');
  const report = { report: { path: 'reports/x.md' } };
  assert.equal(transition(f, 'human_ready', { ...report }).ok, false, 'sem duplicateCheck nenhum');
  assert.equal(
    transition(f, 'human_ready', { ...report, duplicateCheck: { methods: [] } }).ok,
    false,
    'methods vazio'
  );
  assert.equal(
    transition(f, 'human_ready', { ...report, duplicateCheck: { methods: ['web_search'], ts: '2026-08-31T00:00:00Z' } }).ok,
    false,
    'github_issues precisa estar entre os métodos, não só web_search'
  );
  assert.equal(
    transition(f, 'human_ready', { ...report, duplicateCheck: { methods: ['github_issues'] } }).ok,
    false,
    'falta timestamp'
  );
  const good = transition(f, 'human_ready', {
    ...report,
    duplicateCheck: { methods: ['github_issues', 'hacktivity'], ts: '2026-08-31T00:00:00Z', query: 'ColdStorageAddressBookModule' },
  });
  assert.equal(good.ok, true);
});

test('human_ready -> submitted exige humanApproval com actor humano (nunca agente/IA)', () => {
  const f = finding('human_ready');
  assert.equal(transition(f, 'submitted', {}).ok, false);
  assert.equal(transition(f, 'submitted', { humanApproval: { actor: 'agent' } }).ok, false);
  assert.equal(transition(f, 'submitted', { humanApproval: { actor: 'ai' } }).ok, false);
  assert.equal(transition(f, 'submitted', { humanApproval: { actor: 'renan', ts: '2026-08-30' } }).ok, true);
});

test('submitted -> triaged/duplicate/informative/rejected exigem platformOutcome real batendo com o estado pedido', () => {
  const f = finding('submitted');
  assert.equal(transition(f, 'triaged', {}).ok, false);
  assert.equal(transition(f, 'triaged', { platformOutcome: { state: 'duplicate' } }).ok, false);
  assert.equal(transition(f, 'triaged', { platformOutcome: { state: 'triaged' } }).ok, true);
  assert.equal(transition(f, 'duplicate', { platformOutcome: { state: 'duplicate' } }).ok, true);
});

test('refutação (false_positive/inconclusive) é permitida a partir de qualquer estado não-terminal', () => {
  for (const s of ['candidate', 'corroborated_static', 'reproduced_local', 'scope_verified', 'human_ready', 'submitted', 'triaged']) {
    assert.equal(transition(finding(s), 'false_positive', {}).ok, true, `${s} -> false_positive deveria ser permitido`);
    assert.equal(transition(finding(s), 'inconclusive', {}).ok, true, `${s} -> inconclusive deveria ser permitido`);
  }
});

test('refutação exige reasoning — nunca falso_positivo/inconclusivo vazio', () => {
  assert.equal(transition(finding('candidate', { reasoning: '' }), 'false_positive', {}).ok, false);
});

test('nenhuma transição sai de um estado terminal', () => {
  for (const s of ['false_positive', 'duplicate', 'informative', 'rejected', 'paid', 'resolved']) {
    assert.equal(isTerminal(s), true);
    assert.equal(transition(finding(s), 'candidate', {}).ok, false);
  }
});

test('validTransitionsFrom lista exatamente as transições programadas', () => {
  assert.deepEqual(validTransitionsFrom('candidate').sort(), ['corroborated_static', 'false_positive', 'inconclusive', 'known_duplicate'].sort());
  assert.deepEqual(validTransitionsFrom('paid'), []);
});
