import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEvidenceGrade, explainGrade, getEvidenceGrade } from '../evidence-grade.mjs';

test('E0 quando não há arquivo lido nem validação nem estado avançado', () => {
  assert.equal(computeEvidenceGrade({ state: 'candidate', filesReadCount: 0 }), 'E0');
});

test('E1 com exatamente 1 arquivo lido, estado ainda candidate', () => {
  assert.equal(computeEvidenceGrade({ state: 'candidate', filesReadCount: 1 }), 'E1');
});

test('E2 com 2+ arquivos lidos, mesmo sem o estado ter avançado ainda', () => {
  assert.equal(computeEvidenceGrade({ state: 'candidate', filesReadCount: 3 }), 'E2');
});

test('E2 quando o estado é corroborated_static, mesmo com só 1 arquivo lido', () => {
  assert.equal(computeEvidenceGrade({ state: 'corroborated_static', filesReadCount: 1 }), 'E2');
});

test('E3 quando existe validação real com result=pass, mesmo em estado anterior', () => {
  assert.equal(computeEvidenceGrade({ state: 'corroborated_static', filesReadCount: 5, hasPassingValidation: true }), 'E3');
});

test('prior-art supports não infla grau para E3 sem reprodução executável', () => {
  const grade = getEvidenceGrade({}, 'f1', {
    getFinding: () => ({ id: 'f1', state: 'corroborated_static', filesRead: ['a.go'] }),
    listValidations: () => [{ type: 'prior_art_search', result: 'pass', conclusion: 'supports' }],
    latestPlatformOutcome: () => null,
  });
  assert.equal(grade, 'E2');
});

test('E4 exige validação end-to-end isolada; sandbox de componente continua E3', () => {
  assert.equal(computeEvidenceGrade({ state: 'reproduced_local', hasPassingValidation: true }), 'E3');
  assert.equal(computeEvidenceGrade({ state: 'reproduced_local', hasPassingValidation: true, hasIsolatedEndToEndValidation: true }), 'E4');
});

test('E3 pra reproduced_local/scope_verified/human_ready/submitted, mesmo sem validation explícita passada aqui', () => {
  for (const state of ['reproduced_local', 'scope_verified', 'human_ready', 'submitted']) {
    assert.equal(computeEvidenceGrade({ state, filesReadCount: 0 }), 'E3', `esperava E3 pra ${state}`);
  }
});

test('E5 quando o outcome real de plataforma é triaged, paid ou resolved', () => {
  for (const outcome of ['triaged', 'paid', 'resolved']) {
    assert.equal(computeEvidenceGrade({ state: 'human_ready', filesReadCount: 5, hasPassingValidation: true, platformOutcomeState: outcome }), 'E5', `esperava E5 pra outcome ${outcome}`);
  }
});

test('outcome negativo real (duplicate/informative/rejected) NÃO rebaixa o grau já alcançado', () => {
  const grade = computeEvidenceGrade({ state: 'human_ready', filesReadCount: 5, hasPassingValidation: true, platformOutcomeState: 'duplicate' });
  assert.equal(grade, 'E3', 'duplicate é sobre elegibilidade, não sobre quão bem provado o comportamento está');
});

test('E3 quando o ESTADO ATUAL já é um terminal pós-submissão (duplicate/informative/rejected), mesmo sem validation registrada', () => {
  // Caso real: arc-remote-signer tem PoC real (go test PASS) mas nunca teve
  // um `record-validation` formal gravado no banco -- só narrado em prosa.
  // O finding avançou submitted -> duplicate (via sync-report-status), então
  // seu `state` HOJE é "duplicate", não mais "submitted". Antes do fix isso
  // caía pro bucket de contagem de arquivos (E2), escondendo que o gate de
  // human_ready já exigiu evidência E3 pra chegar até ali.
  for (const state of ['triaged', 'duplicate', 'informative', 'rejected', 'paid', 'resolved']) {
    assert.equal(
      computeEvidenceGrade({ state, filesReadCount: 2, hasPassingValidation: false }),
      'E3',
      `esperava pelo menos E3 pra estado terminal ${state} mesmo sem validation`
    );
  }
});

test('explainGrade devolve uma frase não-vazia pra todo grau real', () => {
  for (const g of ['E0', 'E1', 'E2', 'E3', 'E5']) {
    assert.ok(explainGrade(g).length > 5);
  }
  assert.match(explainGrade('E4'), /end-to-end/i);
});
