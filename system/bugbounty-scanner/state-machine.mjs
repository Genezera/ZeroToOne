// Máquina de estados de um finding — substitui o "confirmado"/"falso_positivo"
// genérico por estados com precondição programática, conforme seção 6.3 da
// auditoria externa (docs/zerotoone-v2/). Cada transição é uma função pura:
// recebe o finding + o contexto de evidência disponível, devolve
// {ok, reason} — nunca decide sozinha, só valida se o pedido de transição
// tem lastro.
//
// ctx.programPolicy (ver program-policy.mjs) é injetado automaticamente por
// db.mjs::recordTransition em TODA chamada — não fica a cargo de quem
// chama lembrar de passar. Isso mantém esta função pura (só lê o objeto já
// carregado, nunca toca disco) e ainda assim faz o bloqueio valer pra
// QUALQUER caminho de chamada (CLI local, CLI do agente de nuvem).

import { getBlockReason } from './program-policy.mjs';
import { reportabilityGate } from './impact-assessment.mjs';
import { duplicateCheckGate } from './novelty-risk.mjs';
import { isIsolatedEndToEndValidation } from './evidence-grade.mjs';
import { findingIdentityQuality } from './finding-identity.mjs';
import { validationSupports } from './validation-semantics.mjs';

export const STATES = [
  'candidate',
  'corroborated_static',
  'reproduced_local',
  'scope_verified',
  'human_ready',
  'submitted',
  'triaged',
  'duplicate',
  'informative',
  'rejected',
  'paid',
  'resolved',
  'false_positive',
  'inconclusive',
  'known_duplicate',
];

const TERMINAL_STATES = new Set(['false_positive', 'duplicate', 'informative', 'rejected', 'paid', 'resolved', 'known_duplicate']);

function ok(reason) {
  return { ok: true, reason };
}
function fail(reason) {
  return { ok: false, reason };
}

function repositoryKey(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}`.toLowerCase() : normalized.toLowerCase();
}

// Caminho ADITIVO de prontidão para programas de baixa competição
// (program-policy.competitionLevel === 'low' + noveltyStatus
// 'low_competition_reviewed'). Mantém as proteções que importam
// (escopo/impacto/identidade/colisão local/busca pública atestada +
// reprodução real) mas dispensa os interlocks específicos de regressão
// (deployment confidence=high, commit_sha===introducedCommit, E4 do
// noveltyProof, casamento com o change monitor). Deixa o achado
// human_ready com rótulo explícito de "sem regressão, revisão humana
// obrigatória" -- a aprovação humana antes de `submitted` NÃO muda.
function lowCompetitionReadinessGate(finding, ctx, impact, identity) {
  const deployment = ctx.deploymentEvidence;
  if (!deployment || !['low', 'medium', 'high'].includes(deployment.confidence)) {
    return fail('envio de baixa competição exige DeploymentEvidence com confidence >= "low" (código presente/alcançável no HEAD público consumido)');
  }
  if (!deployment.repo || !deployment.commit_sha) {
    return fail('DeploymentEvidence precisa registrar repo e commit_sha');
  }
  if (!deployment.package_or_contract && !deployment.deployed_address) {
    return fail('DeploymentEvidence precisa identificar package_or_contract ou deployed_address afetado');
  }
  const duplicate = duplicateCheckGate(ctx.duplicateCheck, {
    now: ctx.now ? new Date(ctx.now).getTime() : Date.now(),
    repository: repositoryKey(deployment.repo),
    lowCompetition: true,
  });
  if (!duplicate.ok) return fail(duplicate.reason);
  const identitySignals = ctx.duplicateCheck?.signals || {};
  if (identitySignals.localRootCauseFingerprint !== identity.rootCauseFingerprint) {
    return fail('checagem de duplicata precisa ser refeita depois da identidade de causa raiz atual');
  }
  if (!Array.isArray(identitySignals.localRootCauseCollisionIds)) {
    return fail('checagem de duplicata não contém busca estruturada por colisões locais');
  }
  if (identitySignals.localRootCauseCollisionIds.length > 0) {
    return fail(`causa raiz colide com finding(s) local(is): ${identitySignals.localRootCauseCollisionIds.join(', ')}`);
  }
  const reproduced = (ctx.validations || []).some(validationSupports);
  if (!reproduced) {
    return fail('envio de baixa competição exige ao menos uma validação com conclusion="supports" (reprodução real, não só leitura)');
  }
  return ok(`${impact.reason}; ${duplicate.reason} [BAIXA COMPETIÇÃO: sem prova de regressão nem E4 -- revisão humana criteriosa obrigatória antes de enviar]`);
}

export function submissionReadinessGate(finding, ctx = {}) {
  const blockReason = getBlockReason(finding.program, ctx.programPolicy || {});
  if (blockReason) return fail(`programa "${finding.program}" está bloqueado para envio: ${blockReason}`);
  if (!ctx.report || !ctx.report.path) return fail('nenhum rascunho de relatório foi gerado ainda');
  const identity = findingIdentityQuality(finding);
  if (!identity.ok) return fail(identity.reason);

  if (!ctx.scopeGateResult) return fail('preflight final exige nova consulta ao scope snapshot vigente');
  if (!ctx.scopeGateResult.allowed) return fail(`scope gate final recusou: ${ctx.scopeGateResult.reason}`);
  if (ctx.scopeGateResult.bountyEligible !== true) {
    return fail('ativo não tem eligibleForBounty=true explícito no scope snapshot vigente');
  }

  const impact = reportabilityGate(ctx.impactAssessment);
  if (!impact.ok) return fail(impact.reason);

  // Caminho aditivo: programa explicitamente de baixa competição.
  if ((ctx.programPolicy || {})[finding.program]?.competitionLevel === 'low'
      && ctx.duplicateCheck?.noveltyStatus === 'low_competition_reviewed') {
    return lowCompetitionReadinessGate(finding, ctx, impact, identity);
  }

  const deployment = ctx.deploymentEvidence;
  if (!deployment || deployment.confidence !== 'high') {
    return fail('envio exige DeploymentEvidence com confidence="high"');
  }
  if (!deployment.repo || !deployment.commit_sha) {
    return fail('DeploymentEvidence high precisa registrar repo e commit_sha imutável');
  }
  if (!deployment.package_or_contract && !deployment.deployed_address) {
    return fail('DeploymentEvidence high precisa identificar package_or_contract ou deployed_address afetado');
  }

  const duplicate = duplicateCheckGate(ctx.duplicateCheck, {
    now: ctx.now ? new Date(ctx.now).getTime() : Date.now(),
    repository: repositoryKey(deployment.repo),
  });
  if (!duplicate.ok) return fail(duplicate.reason);
  const identitySignals = ctx.duplicateCheck?.signals || {};
  if (identitySignals.localRootCauseFingerprint !== identity.rootCauseFingerprint) {
    return fail('checagem de duplicata precisa ser refeita depois da identidade de causa raiz atual');
  }
  if (!Array.isArray(identitySignals.localRootCauseCollisionIds)) {
    return fail('checagem de duplicata não contém busca estruturada por colisões locais');
  }
  if (identitySignals.localRootCauseCollisionIds.length > 0) {
    return fail(`causa raiz colide com finding(s) local(is): ${identitySignals.localRootCauseCollisionIds.join(', ')}`);
  }
  const changeContext = finding.changeContext || finding.raw?.changeContext || null;
  if (changeContext?.introducedCommit
    && String(changeContext.introducedCommit).toLowerCase() !== ctx.duplicateCheck.noveltyProof.introducedCommit.toLowerCase()) {
    return fail('noveltyProof precisa comprovar o mesmo commit que originou o finding no change monitor');
  }
  if (changeContext?.repository && repositoryKey(deployment.repo) !== repositoryKey(changeContext.repository)) {
    return fail('DeploymentEvidence.repo precisa ser o mesmo repositório observado pelo change monitor');
  }
  if (deployment.commit_sha.toLowerCase() !== ctx.duplicateCheck.noveltyProof.introducedCommit.toLowerCase()) {
    return fail('DeploymentEvidence.commit_sha precisa ser o mesmo commit introdutor comprovado no noveltyProof');
  }
  const e4 = (ctx.validations || []).some((validation) => isIsolatedEndToEndValidation(validation, {
    expectedNoveltyProof: ctx.duplicateCheck.noveltyProof,
  }));
  if (!e4) {
    return fail('envio exige validação E4 end-to-end do mesmo noveltyProof, registrada pelo regression-sandbox');
  }
  return ok(`${impact.reason}; ${duplicate.reason}`);
}

// Refutação (false_positive/inconclusive) pode acontecer a partir de
// qualquer estado não-terminal — ceticismo pode vencer a qualquer altura
// da investigação, isso é comportamento correto, não exceção.
const REFUTABLE_FROM = STATES.filter((s) => !TERMINAL_STATES.has(s) && s !== 'inconclusive');

/**
 * context esperado (todos os campos opcionais — a ausência é o sinal
 * mais comum de "ainda não pronto"):
 * - filesRead: string[]
 * - validations: [{ type, result: 'pass'|'fail'|'not_applicable', ts }]
 * - scopeGateResult: { allowed, reason, bountyEligible } (de scope-registry.mjs)
 * - deploymentEvidence: { confidence: 'unverified'|'low'|'medium'|'high', notes }
 * - report: { path } | null
 * - humanApproval: { actor, ts, rationale, reportReviewed,
 *     technicalValidationConfirmed, programRulesReconfirmed,
 *     aiUseDisclosed?, noProductionTestingConfirmed?, localForkConfirmed?,
 *     priorAuditChecked? } | null
 * - platformOutcome: { state, severity, bounty } | null
 * - duplicateCheck: checagem estruturada e recente de fontes públicas
 * - impactAssessment: fatos estruturados sobre atacante/vítima/C-I-A
 */
const PRECONDITIONS = {
  'candidate->corroborated_static': (f, ctx = {}) => {
    if (!ctx.filesRead || ctx.filesRead.length === 0) {
      return fail('precisa de pelo menos 1 arquivo lido confirmando o padrão perigoso no código (filesRead vazio)');
    }
    if (!f.reasoning || f.reasoning.trim().length < 20) {
      return fail('precisa de reasoning não-trivial documentando o que foi confirmado no código');
    }
    return ok('source/sink ou condição perigosa confirmada em código real, com arquivo(s) citado(s)');
  },
  'corroborated_static->reproduced_local': (f, ctx = {}) => {
    const pass = (ctx.validations || []).find(validationSupports);
    if (pass) return ok(`reprodução determinística local com sucesso (${pass.type}, ${pass.ts || 'sem timestamp'})`);
    const notApplicable = (ctx.validations || []).find((v) => v.result === 'not_applicable');
    if (notApplicable) {
      return fail('nenhum validador local existe ainda para este tipo de achado (PoC not_applicable) — fica em corroborated_static até Fase 2/4 do plano adicionar um validador de verdade, não simular um');
    }
    return fail('precisa de pelo menos uma validação com conclusion="supports" — sem isso não é reproduzido, é só lido');
  },
  'reproduced_local->scope_verified': (f, ctx = {}) => {
    if (!ctx.scopeGateResult) return fail('nenhum scope snapshot foi consultado para este ativo');
    if (!ctx.scopeGateResult.allowed) return fail(`scope gate recusou: ${ctx.scopeGateResult.reason}`);
    if (ctx.scopeGateResult.bountyEligible !== true) {
      return fail('scope_verified exige eligibleForBounty=true explícito; escopo informativo ou elegibilidade desconhecida não basta');
    }
    if (!ctx.deploymentEvidence) {
      return fail('falta DeploymentEvidence (mesmo que confidence="unverified") — precisa declarar explicitamente o que se sabe/não se sabe sobre repo→release→deploy, não pular a etapa em silêncio');
    }
    if (ctx.deploymentEvidence.confidence !== 'high') {
      return fail(`DeploymentEvidence existe mas confidence="${ctx.deploymentEvidence.confidence || 'ausente'}" — modo profissional exige vínculo real commit↔release↔deploy com confidence="high" antes de scope_verified`);
    }
    return ok(`escopo válido (${ctx.scopeGateResult.reason}) + vínculo de deploy confirmado (confidence=${ctx.deploymentEvidence.confidence})`);
  },
  // Exige checagem de duplicata via fonte pesquisável (issues/PRs do
  // repo no mínimo — Hacktivity quando credencial disponível) ANTES de
  // marcar human_ready. Adicionado em 31/08/2026 depois de dois achados
  // seguidos (arc-remote-signer, ColdStorageAddressBookModule) chegarem
  // até human_ready/enviados sem essa checagem e se revelarem duplicata
  // pública já conhecida — a rodada original tinha até sinalizado a
  // lacuna ("não consigo checar issues/PRs agora") e ninguém revisitou
  // antes de recomendar envio. Isso não pode mais depender de alguém
  // lembrar de perguntar "verifique tudo" no fim.
  'scope_verified->human_ready': (f, ctx = {}) => {
    const readiness = submissionReadinessGate(f, ctx);
    if (!readiness.ok) return readiness;
    return ok(`rascunho pronto em ${ctx.report.path}; ${readiness.reason}; aguardando revisão humana`);
  },
  'human_ready->submitted': (f, ctx = {}) => {
    if (!ctx.humanApproval || !ctx.humanApproval.actor) {
      return fail('só um humano pode aprovar esta transição — nenhum humanApproval registrado');
    }
    if (ctx.humanApproval.actor === 'agent' || ctx.humanApproval.actor === 'ai') {
      return fail('humanApproval.actor não pode ser um agente/IA — a submissão é sempre ação humana');
    }
    if (ctx.humanApproval.reportReviewed !== true) {
      return fail('aprovação humana precisa confirmar reportReviewed=true');
    }
    if (ctx.humanApproval.technicalValidationConfirmed !== true) {
      return fail('aprovação humana precisa confirmar technicalValidationConfirmed=true após rever PoC e impacto');
    }
    if (ctx.humanApproval.programRulesReconfirmed !== true) {
      return fail('aprovação humana precisa confirmar programRulesReconfirmed=true no momento do envio');
    }
    const policy = ctx.programPolicy?.[f.program] || {};
    const conditionalRequirements = [
      ['aiDisclosureRequired', 'aiUseDisclosed', 'o programa exige divulgar uso de IA'],
      ['productionTestingProhibited', 'noProductionTestingConfirmed', 'o programa proíbe teste em produção'],
      ['localForkRequired', 'localForkConfirmed', 'o programa exige PoC em fork local'],
      ['priorAuditCheckRequired', 'priorAuditChecked', 'o programa exige descartar achados já presentes em audits anteriores'],
    ];
    for (const [policyFlag, approvalFlag, message] of conditionalRequirements) {
      if (policy[policyFlag] === true && ctx.humanApproval[approvalFlag] !== true) {
        return fail(`${message}; humanApproval.${approvalFlag}=true é obrigatório`);
      }
    }
    // Revalida impacto e novidade no instante do envio. Isso protege
    // findings human_ready antigos/importados que chegaram ao estado antes
    // destes gates existirem e impede uma checagem expirada.
    const readiness = submissionReadinessGate(f, ctx);
    if (!readiness.ok) return readiness;
    return ok(`relatório e validação técnica aprovados por ${ctx.humanApproval.actor} em ${ctx.humanApproval.ts || 'sem timestamp'}; ${readiness.reason}`);
  },
  'submitted->triaged': (f, ctx = {}) => outcomeGate(ctx, 'triaged'),
  'submitted->duplicate': (f, ctx = {}) => outcomeGate(ctx, 'duplicate'),
  'submitted->informative': (f, ctx = {}) => outcomeGate(ctx, 'informative'),
  'submitted->rejected': (f, ctx = {}) => outcomeGate(ctx, 'rejected'),
  'triaged->paid': (f, ctx = {}) => outcomeGate(ctx, 'paid'),
  'triaged->resolved': (f, ctx = {}) => outcomeGate(ctx, 'resolved'),
};

function outcomeGate(ctx, expectedState) {
  if (!ctx.platformOutcome) return fail('nenhum resultado real da plataforma foi importado ainda — isso nunca é uma decisão interna');
  if (ctx.platformOutcome.state !== expectedState) {
    return fail(`platformOutcome.state="${ctx.platformOutcome.state}" não bate com a transição pedida ("${expectedState}")`);
  }
  return ok(`confirmado por resultado real da plataforma (${ctx.platformOutcome.state})`);
}

for (const from of REFUTABLE_FROM) {
  PRECONDITIONS[`${from}->false_positive`] = (f, ctx = {}) => {
    if (!f.reasoning || f.reasoning.trim().length < 10) return fail('precisa de reasoning explicando por que foi refutado');
    return ok('refutado com justificativa — ceticismo pode vencer a qualquer altura da investigação');
  };
  PRECONDITIONS[`${from}->inconclusive`] = (f, ctx = {}) => {
    if (!f.reasoning || f.reasoning.trim().length < 10) return fail('precisa de reasoning explicando a incerteza');
    return ok('marcado inconclusivo com justificativa — nunca "confirmado" por otimismo');
  };
  // Diferente de false_positive: o comportamento de código é REAL e bate
  // com o que foi lido — só não é novo. Exige citar ONDE já foi
  // divulgado (auditoria pública, advisory, issue, changelog) — nunca
  // "parece conhecido" sem fonte, seção 6.16 da auditoria externa.
  PRECONDITIONS[`${from}->known_duplicate`] = (f, ctx = {}) => {
    const src = ctx.knownIssueSource;
    if (!src || !src.title || !src.sourceType) {
      return fail('precisa de knownIssueSource citando título e tipo da fonte (public_audit|advisory|issue|changelog) — nunca "parece já conhecido" sem citação verificável');
    }
    if (!src.url && !src.quote) {
      return fail('knownIssueSource precisa de url ou quote — a fonte tem que ser rastreável, não só afirmada');
    }
    return ok(`comportamento real, mas já divulgado publicamente em "${src.title}" (${src.sourceType}) — não é novo, não é elegível para recompensa`);
  };
}

// `inconclusive` fica de fora de REFUTABLE_FROM de propósito (não é um
// estado do qual normalmente se sai por otimismo), mas isso deixava sem
// saída o caso real de "nova investigação resolve a incerteza pra
// negativo" (ex.: OKG cosmossdk.io/math -- achado inicial hipotetizou o
// mecanismo errado do CVE; nova leitura do diff real da correção mostrou
// que o código vulnerável nem existe no caminho alcançável -- sem essa
// aresta, essa conclusão não tinha como virar transição, só comentário
// solto). Não abre `inconclusive->corroborated_static`/outros de volta
// pra "vivo" -- só a saída pro lado cético, mesma assinatura das demais.
PRECONDITIONS['inconclusive->false_positive'] = (f, ctx = {}) => {
  if (!f.reasoning || f.reasoning.trim().length < 10) return fail('precisa de reasoning explicando por que foi refutado');
  return ok('refutado com justificativa — ceticismo pode vencer a qualquer altura da investigação, mesmo depois de "inconclusive"');
};

export function validTransitionsFrom(state) {
  return Object.keys(PRECONDITIONS)
    .filter((k) => k.startsWith(`${state}->`))
    .map((k) => k.split('->')[1]);
}

/**
 * Tenta transicionar. Não muta `finding` — devolve o resultado para quem
 * chama decidir persistir (db.mjs) ou não.
 */
export function transition(finding, toState, context = {}) {
  if (!STATES.includes(toState)) {
    return fail(`estado de destino desconhecido: "${toState}"`);
  }
  const from = finding.state;
  if (from === toState) {
    return fail(`já está em "${toState}"`);
  }
  const key = `${from}->${toState}`;
  const check = PRECONDITIONS[key];
  if (!check) {
    return fail(`transição "${from}" → "${toState}" não é permitida pela máquina de estados`);
  }
  const result = check(finding, context);
  if (!result.ok) return result;
  return { ok: true, reason: result.reason, from, to: toState };
}

export function isTerminal(state) {
  return TERMINAL_STATES.has(state);
}

/**
 * Deriva o estado real de cada finding a partir do ledger (fonte de
 * verdade append-only), não da última linha exportada pra queue.jsonl.
 *
 * Por quê: ambientes efêmeros do agente de nuvem rodam em paralelo sobre
 * o mesmo push (visto de verdade nesta missão — dois runs concorrentes
 * no mesmo push, cada um com seu próprio banco local). O run mais antigo
 * pode exportar DEPOIS do mais novo, sobrescrevendo queue.jsonl com um
 * `state` mais velho mesmo com o ledger já tendo registrado a transição
 * real. O ledger nunca sofre esse problema (é só apensado), então ele é
 * a fonte confiável pra detectar e corrigir esse tipo de drift — DESDE
 * que a história de um mesmo finding seja mesmo uma linha reta.
 *
 * Ela nem sempre é: duas investigações concorrentes e independentes (uma
 * interativa, uma do agente de nuvem) já divergiram de verdade a partir
 * do MESMO `corroborated_static` nesta missão — uma foi direto pra
 * `known_duplicate` (divulgação pública encontrada), a outra seguiu sem
 * saber e construiu uma PoC real até `human_ready`. As duas transições
 * são reais e ficam no ledger; "pegar só a de timestamp mais recente"
 * teria revertido silenciosamente uma decisão correta e deliberada
 * (não-enviar, já é duplicata pública conhecida) de volta pra
 * "pronto pra enviar" — exatamente o oposto do que se quer de uma
 * reconciliação. Por isso: detecta bifurcação (mesmo `from` levando a
 * mais de um `to` distinto) e, quando ela existe, só resolve sozinho se
 * exatamente um dos ramos chegou a um estado terminal (terminal =
 * decisão final deliberada, sempre mais decisiva que uma ramificação
 * ainda em andamento — mesmo precedente já usado numa reconciliação
 * manual real desta missão). Bifurcação com zero ou mais de um terminal
 * entre os ramos é ambígua demais pra resolver sozinho — o finding fica
 * de fora do Map, e quem chama trata isso como "não reconciliar",
 * preferindo não adivinhar a adivinhar errado.
 *
 * Pura — recebe as entradas já lidas do ledger (io fica pra quem chama),
 * devolve um Map<findingId, {state, ts, forked}> com o estado resolvido
 * de cada finding. Findings sem nenhuma transição no ledger, ou com
 * bifurcação ambígua não resolvida, não aparecem no Map.
 */
export function deriveStatesFromLedger(ledgerEntries) {
  const byFinding = new Map();
  for (const entry of ledgerEntries) {
    if (entry.type !== 'bugbounty_state_transition' || !entry.findingId || !entry.to) continue;
    if (!byFinding.has(entry.findingId)) byFinding.set(entry.findingId, []);
    byFinding.get(entry.findingId).push(entry);
  }

  const result = new Map();
  for (const [findingId, transitions] of byFinding) {
    transitions.sort((a, b) => new Date(a.ts) - new Date(b.ts));

    const outgoingByFrom = new Map();
    for (const t of transitions) {
      if (!outgoingByFrom.has(t.from)) outgoingByFrom.set(t.from, new Set());
      outgoingByFrom.get(t.from).add(t.to);
    }
    const hasFork = [...outgoingByFrom.values()].some((toSet) => toSet.size > 1);

    if (!hasFork) {
      const last = transitions[transitions.length - 1];
      result.set(findingId, { state: last.to, ts: last.ts, forked: false });
      continue;
    }

    const distinctToStates = [...new Set(transitions.map((t) => t.to))];
    const terminalBranches = distinctToStates.filter((s) => isTerminal(s));
    if (terminalBranches.length === 1) {
      const winning = transitions.filter((t) => t.to === terminalBranches[0]).pop();
      result.set(findingId, { state: winning.to, ts: winning.ts, forked: true });
    }
    // Senão (0 ou >1 terminal entre os ramos): não seta nada de propósito.
  }
  return result;
}
