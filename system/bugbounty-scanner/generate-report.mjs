// Monta o rascunho de relatório (research/bugbounty/reports/*.md) a
// partir do que já está gravado no banco pra um achado -- fecha a lacuna
// real: `scope_verified->human_ready` já EXIGE ctx.report.path (ver
// state-machine.mjs), mas até agora esse arquivo só existia se alguém
// (eu, em conversa) escrevesse a prosa inteira à mão.
//
// O que este script automatiza de verdade: reunir fato já registrado
// (arquivos lidos, saída real de PoC, evidência de deploy, reasoning
// acumulado) na estrutura de TEMPLATE.md. O que ele NÃO tenta fazer:
// escrever Resumo/Impacto/Correção sugerida com qualidade editorial --
// isso continua exigindo julgamento (as duas rodadas de revisão de
// relatório desta missão mostraram que isso importa de verdade: ordem
// da evidência, o que afirmar vs. não afirmar, calibração de
// severidade). Essas seções saem como placeholder explícito, com o
// `reasoning` bruto completo anexado pra quem for revisar não precisar
// caçar contexto em outro lugar.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getFinding, listValidations, latestDeploymentEvidence, latestDuplicateCheck, latestImpactAssessment, recordReport } from './db.mjs';
import { duplicateCheckGate } from './novelty-risk.mjs';
import { reportabilityGate } from './impact-assessment.mjs';
import { loadSnapshot } from './scope-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_DIR = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'reports');

// Estados a partir dos quais um rascunho faz sentido: scope_verified é o
// primeiro ponto em que TODA evidência mecânica (PoC, escopo, deploy) já
// existe; human_ready/submitted permitem regenerar (ex.: reasoning
// atualizado) sem exigir refazer a transição.
const ELIGIBLE_STATES = new Set(['scope_verified', 'human_ready', 'submitted']);

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function reportSlugFor(finding) {
  return `${slugify(finding.program)}-${slugify(finding.file || finding.asset)}-${slugify(finding.type)}`;
}

/** Reúne tudo que já está gravado pro achado -- não decide nada, só lê. */
export function assembleReportContext(db, findingId) {
  const finding = getFinding(db, findingId);
  if (!finding) return { ok: false, reason: `achado "${findingId}" não existe no banco` };
  if (!ELIGIBLE_STATES.has(finding.state)) {
    return {
      ok: false,
      reason: `achado está em "${finding.state}" -- rascunho só é gerado a partir de ${[...ELIGIBLE_STATES].join('/')} (evidência mecânica completa: PoC + escopo + deploy). Ver "pipeline-status" pra saber exatamente o que falta.`,
    };
  }
  const validations = listValidations(db, findingId);
  const rawPassingValidation = [...validations].reverse().find((v) => v.result === 'pass') || null;
  // listValidations devolve linha crua do SQLite (raw_output, snake_case)
  // -- normaliza aqui pra renderReportDraft nunca precisar saber disso.
  const passingValidation = rawPassingValidation
    ? { type: rawPassingValidation.type, command: rawPassingValidation.command, ts: rawPassingValidation.ts, rawOutput: rawPassingValidation.raw_output, result: rawPassingValidation.result }
    : null;
  const deploymentEvidence = latestDeploymentEvidence(db, findingId);
  const duplicateCheck = latestDuplicateCheck(db, findingId);
  const impactAssessment = latestImpactAssessment(db, findingId);
  const snapshot = loadSnapshot(finding.program);
  return {
    ok: true,
    finding,
    passingValidation,
    deploymentEvidence,
    duplicateCheck,
    impactAssessment,
    officialUrl: snapshot ? snapshot.officialUrl : null,
  };
}

export function renderReportDraft(ctx) {
  const { finding, passingValidation, deploymentEvidence, duplicateCheck, impactAssessment, officialUrl } = ctx;
  const now = new Date().toISOString();

  const pocSection = passingValidation
    ? `## Prova de conceito executável\n\`\`\`\ncomando: ${passingValidation.command || '{{comando não registrado}}'}\n\`\`\`\nSaída real (${passingValidation.type}, ${passingValidation.ts}):\n\`\`\`\n${passingValidation.rawOutput || '{{raw_output não registrado -- ver validations no banco}}'}\n\`\`\`\n`
    : `## Prova de conceito executável\n{{Nenhuma validação com result="pass" está registrada para este achado -- não invente uma. Se este achado não tem validador local (ver README do scanner), diga isso explicitamente em vez de pular a seção.}}\n`;

  const deployLines = deploymentEvidence
    ? [
        `- Repositório: \`${deploymentEvidence.repo || '{{não registrado}}'}\``,
        `- Commit/branch: \`${deploymentEvidence.commit_sha || deploymentEvidence.branch_or_tag || '{{não registrado}}'}\``,
        deploymentEvidence.deployed_address ? `- Endereço de deploy: \`${deploymentEvidence.deployed_address}\`${deploymentEvidence.chain_id ? ` (chain ${deploymentEvidence.chain_id})` : ''}` : null,
        `- Confiança da evidência de deploy: **${deploymentEvidence.confidence}**${deploymentEvidence.notes ? ` — ${deploymentEvidence.notes}` : ''}`,
      ].filter(Boolean).join('\n')
    : '{{deploymentEvidence não registrado -- não deveria ser possível chegar aqui sem isso, ver state-machine.mjs}}';

  const duplicateGate = duplicateCheck ? duplicateCheckGate(duplicateCheck) : null;
  const dupLine = duplicateCheck
    ? [
        `- Data: ${duplicateCheck.ts}`,
        `- Fontes: ${duplicateCheck.methods.join(', ')}`,
        `- Consultas: ${(duplicateCheck.queries || [duplicateCheck.query]).filter(Boolean).map((q) => `\`${q}\``).join('; ') || '{{não registradas}}'}`,
        `- Correspondência pública encontrada: **${duplicateCheck.foundExisting ? 'sim' : 'não'}**${duplicateCheck.foundExistingRef ? ` — ${duplicateCheck.foundExistingRef}` : ''}`,
        `- Classificação de novidade: **${duplicateCheck.noveltyStatus || 'não calculada'}**; risco estimado: **${duplicateCheck.riskScore ?? 'não calculado'}/100**`,
        `- Gate atual: **${duplicateGate.ok ? 'PASS' : 'BLOCK'}** — ${duplicateGate.reason}`,
        '',
        '> Limitação: uma busca pública limpa não comprova que o achado é único. Reports privados continuam invisíveis; o estado correto é `private_unknown`, nunca “sem duplicata”.',
      ].join('\n')
    : '⚠️ **Nenhuma checagem de duplicata registrada ainda** -- obrigatória antes de scope_verified->human_ready (ver state-machine.mjs). Rode `record-duplicate-check` antes de avançar este achado.';

  const impactGate = impactAssessment ? reportabilityGate(impactAssessment) : null;
  const impactSection = impactAssessment
    ? [
        `- Validade técnica: **${impactAssessment.technicalValidity}**`,
        `- Entrada controlada pelo atacante: **${impactAssessment.attackerControlledInput ? 'sim' : 'não'}**`,
        `- Atacante: ${impactAssessment.attacker}`,
        `- Vítima: ${impactAssessment.victim}`,
        `- Fronteira de segurança: ${impactAssessment.securityBoundary}`,
        `- Resultado observado: ${impactAssessment.observableOutcome}`,
        `- C/I/A: **${impactAssessment.confidentiality}/${impactAssessment.integrity}/${impactAssessment.availability}**`,
        `- Escopo do impacto: **${impactAssessment.impactScope}**`,
        `- Gate atual: **${impactGate.ok ? 'PASS' : 'BLOCK'}** — ${impactGate.reason}`,
        '',
        `Racional registrado: ${impactAssessment.rationale}`,
        '',
        '{{Reescrever estes fatos em narrativa curta, sem ampliar além do resultado observado.}}',
      ].join('\n')
    : '{{Nenhuma avaliação estruturada de impacto registrada. Rode `record-impact-assessment`; defeito funcional sem vítima/fronteira de segurança não deve ser promovido como vulnerabilidade.}}';

  return `# ⚠️ RASCUNHO GERADO AUTOMATICAMENTE — REVISÃO EDITORIAL + HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este arquivo foi montado por \`generate-report.mjs\` a partir do que já está gravado no banco para \`${finding.id}\` -- não foi escrito por um revisor. As seções "Resumo", "Impacto" e "Correção sugerida" abaixo estão marcadas como placeholder de propósito: a qualidade dessas seções depende de julgamento editorial (ordem da evidência, o que afirmar exatamente, calibração de severidade) que este script não tenta automatizar. **Não copiar/colar sem uma passada humana ou de IA revisando o texto.**

- [ ] Escopo reconfirmado na página do programa (pode ter mudado desde a varredura)
- [ ] Categoria bate com o que o programa declara elegível (\`research/bugbounty/{{program-slug}}/NOTES.md\`)
- [ ] Evidência/PoC conferida linha por linha (não é paráfrase/alucinação)
- [ ] Checagem de duplicata está atualizada
- [ ] Resumo/Impacto/Correção sugerida escritos de verdade, não deixados como placeholder

---

## Título
{{RASCUNHO -- revisar}} ${finding.type} em \`${finding.file || finding.asset}\` (${finding.program})

## Programa / Plataforma
\`${finding.program}\` via \`${finding.platform}\`${officialUrl ? ` — ${officialUrl}` : ''}

## Categoria / Severidade declarada
\`${finding.type}\` -- {{confirmar contra a lista de categorias elegíveis em research/bugbounty/${slugify(finding.program)}/NOTES.md}}

## Ativo afetado
${deployLines}
- Arquivo: \`${finding.file || '{{não registrado}}'}\`${finding.line ? ` (linha ${finding.line})` : ''}
- Função/símbolo: \`${finding.function || '{{não registrado}}'}\`

## Resumo
{{RASCUNHO -- escrever 2-4 frases reais aqui. O raciocínio bruto da investigação está na seção final deste documento -- use como matéria-prima, não copie literalmente.}}

## Cadeia de chamada confirmada
${(finding.filesRead || []).length > 0 ? finding.filesRead.map((f) => `- \`${f}\``).join('\n') : '{{nenhum filesRead registrado -- não deveria ser possível chegar aqui}}'}

Ver raciocínio completo na seção final deste documento.

## Pré-requisitos
{{RASCUNHO -- o mínimo necessário pra reproduzir. Nunca dado ou conta real.}}

## Passo a passo de reprodução
${passingValidation && passingValidation.command ? `1. \`${passingValidation.command}\`\n2. {{completar demais passos}}` : '{{RASCUNHO -- completar}}'}

## Resultado atual vs. esperado
- **Atual:** {{RASCUNHO}}
- **Esperado:** {{RASCUNHO}}

## Evidência
{{Trecho de código real citado com caminho:linha -- puxar da leitura original, não está gravado estruturadamente no banco}}

${pocSection}
## Impacto
${impactSection}

## Correção sugerida
{{RASCUNHO -- mudança concreta e mínima}}

## Checagem de duplicata
${dupLine}

---

## Raciocínio bruto da investigação (gerado automaticamente, matéria-prima para as seções acima)
${finding.reasoning || '{{reasoning vazio -- não deveria ser possível chegar aqui}}'}

---
*Rascunho gerado automaticamente em ${now} a partir do achado \`${finding.id}\` (estado no momento da geração: \`${finding.state}\`). Ver histórico completo em \`ledger/ledger.research.jsonl\`.*
`;
}

export function generateReport(db, findingId, { reportsDir = DEFAULT_REPORTS_DIR } = {}) {
  const ctx = assembleReportContext(db, findingId);
  if (!ctx.ok) return ctx;
  const markdown = renderReportDraft(ctx);
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `${reportSlugFor(ctx.finding)}.md`);
  writeFileSync(reportPath, markdown, 'utf8');
  recordReport(db, findingId, reportPath);
  const warnings = [];
  if (!ctx.passingValidation) warnings.push('sem validação PoC com result="pass" registrada');
  if (!ctx.duplicateCheck) warnings.push('sem checagem de duplicata registrada ainda (obrigatória antes de human_ready)');
  else if (!duplicateCheckGate(ctx.duplicateCheck).ok) warnings.push(`checagem de duplicata não passa o gate: ${duplicateCheckGate(ctx.duplicateCheck).reason}`);
  if (!ctx.impactAssessment) warnings.push('sem avaliação estruturada de impacto registrada');
  else if (!reportabilityGate(ctx.impactAssessment).ok) warnings.push(`impacto não passa o gate: ${reportabilityGate(ctx.impactAssessment).reason}`);
  return { ok: true, path: reportPath, warnings };
}
