// Fecha a lacuna #1 da revisão de 03/09/2026: "um único state não
// representa tudo corretamente... uma duplicata pode ser tecnicamente
// válida e não ser nova; um Informative pode conter um defeito real, mas
// sem impacto acionável". Em vez de substituir `state` (isso quebraria
// toda a máquina de estados existente, um risco grande demais pra
// resolver um problema que é principalmente de VISUALIZAÇÃO), este módulo
// deriva as dimensões ortogonais como uma VIEW só-leitura por cima do que
// já existe -- state-machine.mjs continua sendo a única fonte de verdade
// sobre em que ponto do processo um achado está; isto só torna legível o
// que já estava disperso em `state` + `impactAssessment` + `duplicateCheck`
// + `platformOutcome`. Pura -- recebe tudo já carregado, não toca banco.

const SUBMITTED_OR_LATER = new Set(['submitted', 'triaged', 'duplicate', 'informative', 'rejected', 'paid', 'resolved']);

/**
 * technicalValidity: confirmed|refuted|inconclusive|null (null = ainda não
 *   avaliado -- nunca inventa "confirmed" default).
 * securityImpact: verified|none|null (null = sem impactAssessment ainda;
 *   "conditional" do desenho original fica pra quando algum caso real
 *   precisar dessa distinção -- não inventar categoria sem uso real).
 * novelty: public_match|private_unknown|regression|null (null = nenhuma
 *   duplicateCheck registrada ainda -- nunca "no_public_match" por
 *   omissão, esse é exatamente o erro que motivou a revisão inteira).
 * submissionState: not_planned|ready|submitted (submitted cobre também
 *   todo outcome terminal -- triaged/duplicate/informative/rejected/
 *   paid/resolved já SÃO um relatório submetido, só com resultado sabido).
 */
export function computeFindingDimensions(finding, { impactAssessment = null, duplicateCheck = null } = {}) {
  const technicalValidity = impactAssessment?.technicalValidity ?? null;

  let securityImpact = null;
  if (impactAssessment && typeof impactAssessment.reportable === 'boolean') {
    securityImpact = impactAssessment.reportable ? 'verified' : 'none';
  }

  let novelty = null;
  if (duplicateCheck) {
    novelty = duplicateCheck.foundExisting ? 'public_match' : (duplicateCheck.noveltyStatus || null);
  }

  let submissionState = 'not_planned';
  if (finding?.state === 'human_ready') submissionState = 'ready';
  else if (SUBMITTED_OR_LATER.has(finding?.state)) submissionState = 'submitted';

  return { technicalValidity, securityImpact, novelty, submissionState };
}
