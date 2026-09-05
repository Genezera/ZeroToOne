import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition, validTransitionsFrom, isTerminal, STATES, deriveStatesFromLedger } from '../state-machine.mjs';

function finding(state, overrides = {}) {
  return { id: 'x', program: 'Test Program', state, reasoning: 'A função X faz Y sem checar Z, confirmado lendo o arquivo inteiro.', ...overrides };
}

const NOW = '2026-09-03T18:00:00Z';
const INTRODUCED = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PARENT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const REGRESSION_PROOF = {
  kind: 'verified_regression', introducedCommit: INTRODUCED, parentCommit: PARENT,
  introducedAt: '2026-09-02T12:00:00Z',
  baseline: { ref: PARENT, result: 'not_vulnerable', command: 'node poc.mjs', observedOutcome: 'controle recusado' },
  candidate: { ref: INTRODUCED, result: 'vulnerable', command: 'node poc.mjs', observedOutcome: 'exploit reproduzido' },
  execution: {
    validationScope: 'end_to_end', containerImageId: 'sha256:test-image',
    isolation: 'docker:no-network,read-only-root,cap-drop-all',
  },
};
const GOOD_IMPACT = {
  technicalValidity: 'confirmed', attackerControlledInput: true,
  attacker: 'usuário remoto autenticado', victim: 'outro usuário',
  securityBoundary: 'autorização entre contas', observableOutcome: 'leitura de dado de outra conta',
  confidentiality: 'low', integrity: 'none', availability: 'none',
  impactScope: 'other_user', reportable: true, rationale: 'IDOR reproduzido contra duas contas de teste',
};
const GOOD_DUPLICATE_CHECK = {
  methods: ['github_issues', 'github_commits', 'github_advisories', 'hacktivity'],
  queries: ['função endpoint IDOR', 'missing ownership check', 'commit regression IDOR'],
  foundExisting: false, noveltyStatus: 'regression', riskScore: 20,
  signals: { priorDuplicateSubmissions: 0 }, noveltyProof: REGRESSION_PROOF,
  ts: '2026-09-03T17:00:00Z',
};
const GOOD_E4_VALIDATION = {
  type: 'isolated_regression', result: 'pass',
  evidence: { provenance: 'regression-sandbox', noveltyProof: REGRESSION_PROOF },
};
const GOOD_DEPLOYMENT = {
  confidence: 'high', repo: 'acme/api', commit_sha: INTRODUCED,
  package_or_contract: '@acme/api@1.2.3',
};

function readyContext(overrides = {}) {
  return {
    now: NOW,
    programPolicy: { 'Test Program': { roeReviewed: true, reviewedAt: '2026-09-04', nextReviewAt: '2099-12-31' } },
    report: { path: 'reports/x.md' },
    impactAssessment: GOOD_IMPACT,
    duplicateCheck: GOOD_DUPLICATE_CHECK,
    deploymentEvidence: GOOD_DEPLOYMENT,
    validations: [GOOD_E4_VALIDATION],
    ...overrides,
  };
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

test('reproduced_local -> scope_verified exige scopeGateResult.allowed=true E deploymentEvidence high', () => {
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
  assert.equal(comDeploy.ok, false);
  assert.match(comDeploy.reason, /confidence="high"/);
  const highDeploy = transition(f, 'scope_verified', {
    scopeGateResult: { allowed: true, reason: 'ok' },
    deploymentEvidence: GOOD_DEPLOYMENT,
  });
  assert.equal(highDeploy.ok, true);
});

test('scope_verified -> human_ready exige rascunho de relatório existente', () => {
  const f = finding('scope_verified');
  assert.equal(transition(f, 'human_ready', {}).ok, false);
  assert.equal(transition(f, 'human_ready', readyContext()).ok, true);
});

test('scope_verified -> human_ready bloqueia programa em ctx.programPolicy com aiResearchBanned, mesmo com relatório+duplicateCheck completos', () => {
  const f = finding('scope_verified', { program: 'Block Open Source' });
  const policy = { 'Block Open Source': { aiResearchBanned: true, reason: 'regras do programa proíbem pesquisa assistida por IA' } };
  const r = transition(f, 'human_ready', readyContext({ programPolicy: policy }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /bloqueado/);
  assert.match(r.reason, /proíbem pesquisa assistida por IA/);
});

test('scope_verified -> human_ready bloqueia programa sem decisão explícita na policy', () => {
  const f = finding('scope_verified', { program: 'Circle BBP' });
  const policy = { 'Block Open Source': { aiResearchBanned: true, reason: 'x' } };
  const r = transition(f, 'human_ready', readyContext({ programPolicy: policy }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /sem decisão explícita/);
});

test('scope_verified -> human_ready exige duplicateCheck com methods incluindo "github_issues" e timestamp', () => {
  const f = finding('scope_verified');
  const report = readyContext({ duplicateCheck: undefined });
  assert.equal(transition(f, 'human_ready', { ...report }).ok, false, 'sem duplicateCheck nenhum');
  assert.equal(
    transition(f, 'human_ready', { ...report, duplicateCheck: { methods: [] } }).ok,
    false,
    'methods vazio'
  );
  assert.equal(
    transition(f, 'human_ready', { ...report, duplicateCheck: { ...GOOD_DUPLICATE_CHECK, methods: ['web_search'] } }).ok,
    false,
    'github_issues precisa estar entre os métodos, não só web_search'
  );
  assert.equal(
    transition(f, 'human_ready', { ...report, duplicateCheck: { ...GOOD_DUPLICATE_CHECK, ts: undefined } }).ok,
    false,
    'falta timestamp'
  );
  const good = transition(f, 'human_ready', readyContext());
  assert.equal(good.ok, true);
});

test('scope_verified -> human_ready bloqueia match público, risco alto e checagem expirada', () => {
  const f = finding('scope_verified');
  assert.equal(transition(f, 'human_ready', readyContext({ duplicateCheck: { ...GOOD_DUPLICATE_CHECK, foundExisting: true } })).ok, false);
  assert.equal(transition(f, 'human_ready', readyContext({ duplicateCheck: { ...GOOD_DUPLICATE_CHECK, riskScore: 80 } })).ok, false);
  assert.equal(transition(f, 'human_ready', readyContext({ duplicateCheck: { ...GOOD_DUPLICATE_CHECK, ts: '2026-08-01T00:00:00Z' } })).ok, false);
});

test('scope_verified -> human_ready bloqueia private_unknown e regressão sem baseline seguro comprovado', () => {
  const f = finding('scope_verified');
  const privateUnknown = { ...GOOD_DUPLICATE_CHECK, noveltyStatus: 'private_unknown' };
  assert.equal(transition(f, 'human_ready', readyContext({ duplicateCheck: privateUnknown })).ok, false);
  assert.equal(transition(f, 'human_ready', readyContext({ duplicateCheck: { ...GOOD_DUPLICATE_CHECK, noveltyProof: null } })).ok, false);
});

test('scope_verified -> human_ready exige impacto reportável além da própria requisição', () => {
  const f = finding('scope_verified');
  assert.equal(transition(f, 'human_ready', readyContext({ impactAssessment: undefined })).ok, false);
  assert.equal(transition(f, 'human_ready', readyContext({ impactAssessment: { ...GOOD_IMPACT, reportable: false } })).ok, false);
  assert.equal(transition(f, 'human_ready', readyContext({ impactAssessment: { ...GOOD_IMPACT, impactScope: 'self_request_only' } })).ok, false);
  assert.equal(transition(f, 'human_ready', readyContext({ impactAssessment: { ...GOOD_IMPACT, attackerControlledInput: false } })).ok, false);
});

test('scope_verified -> human_ready exige E4 end-to-end e deployment do mesmo commit', () => {
  const f = finding('scope_verified');
  const noE4 = transition(f, 'human_ready', readyContext({ validations: [] }));
  assert.equal(noE4.ok, false);
  assert.match(noE4.reason, /E4 end-to-end/);

  const componentOnly = transition(f, 'human_ready', readyContext({
    validations: [{
      ...GOOD_E4_VALIDATION,
      evidence: { provenance: 'regression-sandbox', noveltyProof: {
        ...REGRESSION_PROOF, execution: { ...REGRESSION_PROOF.execution, validationScope: 'component' },
      } },
    }],
  }));
  assert.equal(componentOnly.ok, false);

  const mismatchedDeploy = transition(f, 'human_ready', readyContext({
    deploymentEvidence: { ...GOOD_DEPLOYMENT, commit_sha: 'c'.repeat(40) },
  }));
  assert.equal(mismatchedDeploy.ok, false);
  assert.match(mismatchedDeploy.reason, /mesmo commit introdutor/);
});

test('human_ready -> submitted exige humanApproval com actor humano (nunca agente/IA)', () => {
  const f = finding('human_ready');
  assert.equal(transition(f, 'submitted', {}).ok, false);
  assert.equal(transition(f, 'submitted', { humanApproval: { actor: 'agent' } }).ok, false);
  assert.equal(transition(f, 'submitted', { humanApproval: { actor: 'ai' } }).ok, false);
  assert.equal(transition(f, 'submitted', readyContext({ humanApproval: { actor: 'renan', ts: NOW } })).ok, false);
  assert.equal(transition(f, 'submitted', readyContext({ humanApproval: {
    actor: 'renan', ts: NOW, reportReviewed: true,
    technicalValidationConfirmed: true, programRulesReconfirmed: true,
  } })).ok, true);
});

test('human_ready -> submitted aplica requisitos específicos registrados pelo programa', () => {
  const f = finding('human_ready', { program: 'Conditional Program' });
  const base = {
    actor: 'renan', ts: NOW, reportReviewed: true,
    technicalValidationConfirmed: true, programRulesReconfirmed: true,
  };
  const programPolicy = { 'Conditional Program': {
    roeReviewed: true, reviewedAt: '2026-09-04', nextReviewAt: '2099-12-31', aiDisclosureRequired: true, localForkRequired: true,
    priorAuditCheckRequired: true, productionTestingProhibited: true,
  } };
  const missing = transition(f, 'submitted', readyContext({ programPolicy, humanApproval: base }));
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /aiUseDisclosed/);
  const complete = transition(f, 'submitted', readyContext({ programPolicy, humanApproval: {
    ...base, aiUseDisclosed: true, localForkConfirmed: true,
    priorAuditChecked: true, noProductionTestingConfirmed: true,
  } }));
  assert.equal(complete.ok, true);
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

test('inconclusive->false_positive é permitido (investigação posterior resolve a incerteza pro lado cético)', () => {
  assert.equal(transition(finding('inconclusive'), 'false_positive', {}).ok, true);
});

test('inconclusive não reabre pra estados "vivos" — só a saída pro lado cético existe', () => {
  assert.equal(transition(finding('inconclusive'), 'corroborated_static', {}).ok, false);
  assert.equal(transition(finding('inconclusive'), 'human_ready', {}).ok, false);
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

test('deriveStatesFromLedger pega a transição mais recente por finding, ignorando outros tipos de entrada', () => {
  const entries = [
    { type: 'bugbounty_state_transition', findingId: 'A', from: 'candidate', to: 'corroborated_static', ts: '2026-01-01T00:00:00.000Z' },
    { type: 'bugbounty_verdict', findingId: 'A', ts: '2026-01-01T00:05:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'B', from: 'candidate', to: 'false_positive', ts: '2026-01-01T00:02:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'A', from: 'corroborated_static', to: 'reproduced_local', ts: '2026-01-01T00:10:00.000Z' },
  ];
  const result = deriveStatesFromLedger(entries);
  assert.equal(result.get('A').state, 'reproduced_local');
  assert.equal(result.get('B').state, 'false_positive');
  assert.equal(result.has('C'), false);
});

test('deriveStatesFromLedger não depende de ordem de chegada — usa timestamp, não posição no array', () => {
  const entries = [
    { type: 'bugbounty_state_transition', findingId: 'A', from: 'scope_verified', to: 'human_ready', ts: '2026-01-01T00:10:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'A', from: 'corroborated_static', to: 'reproduced_local', ts: '2026-01-01T00:01:00.000Z' },
  ];
  assert.equal(deriveStatesFromLedger(entries).get('A').state, 'human_ready');
});

test('deriveStatesFromLedger: bifurcação real (duas investigações concorrentes do mesmo `from`) prefere o ramo terminal, mesmo que não seja o mais recente — reprodução exata do caso real Withdrawals.sol', () => {
  // Duas investigações independentes divergem do mesmo corroborated_static:
  // ramo A vai direto pra known_duplicate (decisão final, divulgação
  // pública); ramo B, sem saber do A, segue construindo uma PoC real e
  // chega até human_ready DEPOIS do known_duplicate no tempo. A resposta
  // certa é known_duplicate — divulgação pública já encontrada é mais
  // decisiva que uma ramificação que só não sabia disso ainda.
  const entries = [
    { type: 'bugbounty_state_transition', findingId: 'W', from: 'candidate', to: 'corroborated_static', ts: '2026-01-01T00:00:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'W', from: 'corroborated_static', to: 'known_duplicate', ts: '2026-01-01T00:10:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'W', from: 'corroborated_static', to: 'reproduced_local', ts: '2026-01-01T00:15:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'W', from: 'reproduced_local', to: 'scope_verified', ts: '2026-01-01T00:20:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'W', from: 'scope_verified', to: 'human_ready', ts: '2026-01-01T00:25:00.000Z' },
  ];
  const result = deriveStatesFromLedger(entries);
  assert.equal(result.get('W').state, 'known_duplicate', 'terminal deveria vencer sobre um ramo não-terminal mais recente no tempo');
  assert.equal(result.get('W').forked, true);
});

test('deriveStatesFromLedger: bifurcação SEM nenhum ramo terminal fica de fora do resultado — não adivinha', () => {
  const entries = [
    { type: 'bugbounty_state_transition', findingId: 'X', from: 'candidate', to: 'corroborated_static', ts: '2026-01-01T00:00:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'X', from: 'corroborated_static', to: 'reproduced_local', ts: '2026-01-01T00:10:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'X', from: 'corroborated_static', to: 'scope_verified', ts: '2026-01-01T00:11:00.000Z' },
  ]; // nem reproduced_local nem scope_verified são terminais — ambíguo de propósito.
  assert.equal(deriveStatesFromLedger(entries).has('X'), false);
});

test('deriveStatesFromLedger: bifurcação com DOIS ramos terminais distintos é ambígua demais — fica de fora do resultado', () => {
  const entries = [
    { type: 'bugbounty_state_transition', findingId: 'Y', from: 'candidate', to: 'corroborated_static', ts: '2026-01-01T00:00:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'Y', from: 'corroborated_static', to: 'false_positive', ts: '2026-01-01T00:10:00.000Z' },
    { type: 'bugbounty_state_transition', findingId: 'Y', from: 'corroborated_static', to: 'known_duplicate', ts: '2026-01-01T00:11:00.000Z' },
  ];
  assert.equal(deriveStatesFromLedger(entries).has('Y'), false, 'dois terminais divergentes não deveriam ser resolvidos automaticamente');
});
