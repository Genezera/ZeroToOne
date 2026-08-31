// Máquina de estados de um finding — substitui o "confirmado"/"falso_positivo"
// genérico por estados com precondição programática, conforme seção 6.3 da
// auditoria externa (docs/zerotoone-v2/). Cada transição é uma função pura:
// recebe o finding + o contexto de evidência disponível, devolve
// {ok, reason} — nunca decide sozinha, só valida se o pedido de transição
// tem lastro.

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
 * - humanApproval: { actor, ts, rationale } | null
 * - platformOutcome: { state, severity, bounty } | null
 * - duplicateCheck: { methods: string[], ts, query } | null — ver nota
 *   abaixo em scope_verified->human_ready
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
    const pass = (ctx.validations || []).find((v) => v.result === 'pass');
    if (pass) return ok(`reprodução determinística local com sucesso (${pass.type}, ${pass.ts || 'sem timestamp'})`);
    const notApplicable = (ctx.validations || []).find((v) => v.result === 'not_applicable');
    if (notApplicable) {
      return fail('nenhum validador local existe ainda para este tipo de achado (PoC not_applicable) — fica em corroborated_static até Fase 2/4 do plano adicionar um validador de verdade, não simular um');
    }
    return fail('precisa de pelo menos uma validação com result="pass" (ex.: forge test) — sem isso não é reproduzido, é só lido');
  },
  'reproduced_local->scope_verified': (f, ctx = {}) => {
    if (!ctx.scopeGateResult) return fail('nenhum scope snapshot foi consultado para este ativo');
    if (!ctx.scopeGateResult.allowed) return fail(`scope gate recusou: ${ctx.scopeGateResult.reason}`);
    if (!ctx.deploymentEvidence) {
      return fail('falta DeploymentEvidence (mesmo que confidence="unverified") — precisa declarar explicitamente o que se sabe/não se sabe sobre repo→release→deploy, não pular a etapa em silêncio');
    }
    if (ctx.deploymentEvidence.confidence === 'unverified') {
      return fail('DeploymentEvidence existe mas confidence="unverified" — declarar o gap não é o mesmo que fechá-lo; precisa de vínculo real (commit↔release↔deploy) com confidence >= "low" antes de scope_verified');
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
    if (!ctx.report || !ctx.report.path) return fail('nenhum rascunho de relatório foi gerado ainda');
    const dup = ctx.duplicateCheck;
    if (!dup || !Array.isArray(dup.methods) || dup.methods.length === 0) {
      return fail('falta duplicateCheck com pelo menos um método usado (ex.: methods=["github_issues"]) — não pode chegar em human_ready sem uma checagem de duplicata rastreável, nunca "provavelmente é inédito"');
    }
    if (!dup.methods.includes('github_issues')) {
      return fail('duplicateCheck.methods precisa incluir "github_issues" no mínimo (issues+PRs do repositório afetado) — outras fontes (hacktivity, web_search) são complementares, não substitutas');
    }
    if (!dup.ts) return fail('duplicateCheck precisa de timestamp (ts) — sem isso não dá pra saber se a checagem está desatualizada');
    return ok(`rascunho de relatório pronto em ${ctx.report.path} + checagem de duplicata feita (${dup.methods.join(', ')}, ${dup.ts}), aguardando revisão humana`);
  },
  'human_ready->submitted': (f, ctx = {}) => {
    if (!ctx.humanApproval || !ctx.humanApproval.actor) {
      return fail('só um humano pode aprovar esta transição — nenhum humanApproval registrado');
    }
    if (ctx.humanApproval.actor === 'agent' || ctx.humanApproval.actor === 'ai') {
      return fail('humanApproval.actor não pode ser um agente/IA — a submissão é sempre ação humana');
    }
    return ok(`aprovado por ${ctx.humanApproval.actor} em ${ctx.humanApproval.ts || 'sem timestamp'}`);
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
