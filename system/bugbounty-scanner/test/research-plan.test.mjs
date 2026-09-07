import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchPlan } from '../research-plan.mjs';

const NOW = Date.parse('2026-09-07T03:00:00Z');
const finding = { id: 'P::acme/api/src/a.go::run::risk', program: 'P', state: 'candidate', asset:'acme/api', file:'src/a.go' };
const policy = { P: { roeReviewed: true, nextReviewAt:'2026-10-01' } };
const options = { now: NOW, programPolicy: policy, scopeFor: () => ({ allowed:true, bountyEligible:true }) };
const impact = {
  technicalValidity:'confirmed', attackerControlledInput:true, reportable:true, severityRating:'medium',
  severityRationale:'fixture demonstrada entre duas contas próprias', attacker:'conta A', victim:'conta B',
  securityBoundary:'isolamento de contas', observableOutcome:'acesso a dado da vítima', rationale:'controle e teste reais da fixture',
  impactScope:'other_user', confidentiality:'low', integrity:'none', availability:'none',
};

test('política bloqueada precede qualquer leitura de evidência ou consulta de escopo', () => {
  const input = structuredClone(finding);
  const result = buildResearchPlan([input], { ...options, programPolicy:{ P:{blocked:true} },
    scopeFor: () => { throw new Error('não deve ser chamado'); },
    contextFor: () => { throw new Error('não deve ser chamado'); },
  });
  assert.equal(result.actionable.length, 0);
  assert.equal(result.held[0].code, 'program_blocked');
  assert.deepEqual(input, finding);
});

test('submissão real impede reinvestigar finding legado que ainda aparece como estático', () => {
  const result = buildResearchPlan([{ ...finding, state:'corroborated_static' }], { ...options,
    submissions:[{id:'HackerOne:100',state:'duplicate',findingIds:[finding.id]}],
  });
  assert.equal(result.held[0].code, 'previous_submission');
  assert.deepEqual(result.held[0].submissionIds, ['HackerOne:100']);
});

test('mantém a restrição explícita da campanha para programa com duplicate anterior', () => {
  const result = buildResearchPlan([finding], { ...options,
    submissions:[{id:'HackerOne:100',program:'P',state:'duplicate',findingIds:[]}],
  });
  assert.equal(result.held[0].code, 'campaign_duplicate_history');
});

test('Low, ausência de controle do atacante e efeito só na própria requisição não ganham outra PoC', () => {
  for (const patch of [{severityRating:'low'}, {attackerControlledInput:false}, {impactScope:'self_request_only'}, {reportable:false}]) {
    const result = buildResearchPlan([finding], { ...options, contextFor: () => ({impactAssessment:{...impact,...patch}}) });
    assert.equal(result.held[0].code, 'below_campaign_impact');
  }
});

test('escopo desconhecido exige confirmação; bounty explicitamente negado fica retido', () => {
  const missing = buildResearchPlan([finding], {...options,scopeFor:()=>null});
  assert.equal(missing.actionable[0].action, 'verify_scope');
  const denied = buildResearchPlan([finding], {...options,scopeFor:()=>({allowed:true,bountyEligible:false})});
  assert.equal(denied.held[0].code, 'bounty_ineligible');
  const excluded = buildResearchPlan([finding], {...options,scopeFor:()=>({allowed:false,asset:{eligibleForSubmission:false}})});
  assert.equal(excluded.held[0].code, 'scope_excluded');
});

test('ativo ausente de snapshot oficial ao vivo fica retido em vez de gerar verify_scope infinito', () => {
  const officialMissing = buildResearchPlan([finding], {
    ...options,
    scopeFor:()=>({allowed:false,snapshotSourceType:'hackerone_api_live',reason:'ativo exato não encontrado'}),
  });
  assert.equal(officialMissing.actionable.length, 0);
  assert.equal(officialMissing.held[0].code, 'scope_not_confirmed');

  const communityMissing = buildResearchPlan([finding], {
    ...options,
    scopeFor:()=>({allowed:false,snapshotSourceType:'community_dataset_structured'}),
  });
  assert.equal(communityMissing.actionable[0].action, 'verify_scope');
});

test('um candidato novo e uma PoC pass não fabricam impacto ou novidade', () => {
  const result = buildResearchPlan([{...finding,state:'reproduced_local',createdAt:new Date(NOW).toISOString()}], {
    ...options, contextFor:()=>({validations:[{result:'pass'}]}),
  });
  assert.equal(result.actionable[0].action, 'measure_code_age');
  const assessed = buildResearchPlan([finding], {...options,contextFor:()=>({impactAssessment:impact,
    codeAgeEvidence:{codeAgeDays:1,method:'git_log_follow_latest_path_commit'}})});
  assert.equal(assessed.actionable[0].action, 'establish_novelty');
});

test('delta antigo fica retido; dados incompletos não viram automaticamente novidade recente', () => {
  const old = buildResearchPlan([{...finding,changeContext:{introducedAt:'2026-09-01T00:00:00Z'}}],options);
  assert.equal(old.held[0].code, 'outside_campaign_window');
  const measured = buildResearchPlan([finding], {...options,contextFor:()=>({impactAssessment:impact,
    codeAgeEvidence:{codeAgeDays:3,method:'git_log_follow_latest_path_commit'}})});
  assert.equal(measured.held[0].code, 'outside_campaign_window');
  const legacySignal = buildResearchPlan([finding], {...options,contextFor:()=>({impactAssessment:impact,duplicateCheck:{signals:{codeAgeDays:318}}})});
  assert.equal(legacySignal.actionable[0].action, 'measure_code_age');
  const unsafeOldest = buildResearchPlan([finding], {...options,contextFor:()=>({impactAssessment:impact,
    codeAgeEvidence:{codeAgeDays:318,method:'git_log_follow_oldest_path_commit'}})});
  assert.equal(unsafeOldest.actionable[0].action, 'measure_code_age');
  const malformed = buildResearchPlan([{...finding,changeContext:{introducedAt:'invalid'}}],options);
  assert.equal(malformed.actionable[0].action, 'measure_code_age');
});

test('toque recente do caminho permite avaliar impacto, mas não prova regressão', () => {
  const result = buildResearchPlan([finding], { ...options, contextFor: () => ({
    codeAgeEvidence: { codeAgeDays: 1, method: 'github_file_last_commit' },
  }) });
  assert.equal(result.actionable[0].action, 'assess_impact');

  const exactRecent = buildResearchPlan([{ ...finding, changeContext: { introducedAt: '2026-09-07T02:00:00Z' } }], options);
  assert.equal(exactRecent.actionable[0].action, 'assess_impact');
});

test('terminal e inconclusive continuam históricos; correspondência pública bloqueia novo trabalho', () => {
  const result = buildResearchPlan([
    finding, {...finding,id:'done',state:'false_positive'}, {...finding,id:'uncertain',state:'inconclusive'},
  ], {...options,contextFor:()=>({duplicateCheck:{foundExisting:true}})});
  assert.equal(result.summary.historical,2);
  assert.equal(result.summary.held,1);
  assert.equal(result.held[0].code,'known_public_match');
});
