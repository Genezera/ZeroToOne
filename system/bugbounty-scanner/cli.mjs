import { openDb, upsertFinding, getFinding, listFindings, recordTransition, recordValidation, recordDeploymentEvidence, latestDeploymentEvidence, recordDuplicateCheck, recordReport, latestReport, latestDuplicateCheck, recordPlatformOutcome, latestPlatformOutcome, listValidations, stateCounts, exportFindingsToQueueJsonl, closeDb, recordImpactAssessment, latestImpactAssessment, listSubmissions, getSubmission, recordSubmission, latestSubmissionForFinding, recordCodeAgeEvidence, latestCodeAgeEvidence } from './db.mjs';
import { loadSnapshot, saveSnapshot, buildScopeSnapshot, scopeGate, assetRefForFinding } from './scope-registry.mjs';
import { getStructuredScope, getReport, getMyReports } from './h1-api.mjs';
import { getEvidenceGrade, explainGrade } from './evidence-grade.mjs';
import { loadProgramPolicyStrict, getBlockReason } from './program-policy.mjs';
import { loadSubmissionBudget, getSubmissionBudget } from './program-submission-budget.mjs';
import { isTerminal, submissionReadinessGate } from './state-machine.mjs';
import { generateReport } from './generate-report.mjs';
import { packageFinding } from './package-for-submission.mjs';
import { assessNoveltyRisk } from './novelty-risk.mjs';
import { computeStatsFromSubmissions, enrichSubmissionsWithFindings, duplicateHistoryForFinding } from './outcome-intelligence.mjs';
import { codeAgeSignal } from './code-age.mjs';
import { knownIssueSourceForVulnerableDependency } from './advisory-triage.mjs';
import { sendTelegramMessage } from './telegram.mjs';
import { computeFindingDimensions } from './finding-dimensions.mjs';
import { computeExpectedValue } from './ev-ranking.mjs';
import { loadRegressionConfig, verifyRegression, loadLongstandingExposureConfig, verifyLongstandingExposure } from './regression-sandbox.mjs';
import { loadRuntimeState, summarizeRuntimeHealth } from './runtime-state.mjs';
import { DEFAULT_RUNTIME_STATE_PATH } from './service-runner.mjs';
import { runToolchainDoctor } from './toolchain-doctor.mjs';
import { runReadinessAudit } from './readiness-audit.mjs';
import { runMissionControl } from './mission-control.mjs';
import { loadPriorArtConfig, searchPublicPriorArt } from './prior-art-search.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// CLI que dá ao agente de nuvem (só Bash/Read/Write/Edit/Glob/Grep, sem
// acesso MCP ao banco) uma forma estruturada de mudar estado — em vez de
// "reescreva a linha em queue.jsonl" (schema livre, sem checagem). Toda
// transição passa pela mesma validação de state-machine.mjs que o resto
// do sistema usa; o CLI não contorna a precondição, só empacota o
// contexto que ela pede.

// Absoluto (relativo a este arquivo), não a process.cwd() -- caminho
// relativo aqui já causou achado real de arquivo/DB perdido nesta
// sessão sempre que o CLI foi invocado de dentro de
// system/bugbounty-scanner/ em vez da raiz do repo.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'zerotoone.db');

function currentScopeGateForFinding(finding, now) {
  return scopeGate(loadSnapshot(finding.program), assetRefForFinding(finding), now);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) flags[arg.slice(2)] = true;
      else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function parseJsonFlag(flags, name, fallback = {}) {
  if (!flags[name]) return fallback;
  try {
    return JSON.parse(flags[name]);
  } catch (e) {
    throw new Error(`--${name} precisa ser JSON válido: ${e.message}`);
  }
}

export function cmdListPending(db) {
  return listFindings(db, { state: 'candidate' });
}

export function cmdStatus(db) {
  return stateCounts(db);
}

export function cmdUpsertFinding(db, patch) {
  if (!patch.id) throw new Error('patch precisa ter "id"');
  const existing = getFinding(db, patch.id);
  const merged = existing ? { ...existing.raw, ...existing, ...patch } : { state: 'candidate', ...patch };
  return upsertFinding(db, merged);
}

export function cmdUpdateFinding(db, id, patch) {
  const existing = getFinding(db, id);
  if (!existing) throw new Error(`finding "${id}" não existe`);
  return upsertFinding(db, { ...existing.raw, ...existing, ...patch, id });
}

const RESEARCH_ADVANCING_STATES = new Set([
  'corroborated_static', 'reproduced_local', 'scope_verified', 'human_ready', 'submitted',
]);

export function cmdTransition(db, id, toState, actor, context, {
  programPolicy = loadProgramPolicyStrict(),
} = {}) {
  const finding = getFinding(db, id);
  if (!finding) return { ok: false, reason: `finding "${id}" não existe no banco` };
  if (RESEARCH_ADVANCING_STATES.has(toState)) {
    const blockReason = getBlockReason(finding.program, programPolicy);
    if (blockReason) {
      return { ok: false, reason: `programa "${finding.program}" bloqueado antes de avançar pesquisa: ${blockReason}` };
    }
  }
  return recordTransition(db, id, toState, { actor, context });
}

export function cmdRecordValidation(db, id, { type, result, command, output, evidence = null }) {
  if (type === 'isolated_regression' || evidence?.provenance === 'regression-sandbox') {
    throw new Error('isolated_regression/regression-sandbox é evidência reservada; use verify-regression --config=... --finding-id=... para executá-la e registrá-la');
  }
  return recordValidation(db, id, { type, result, command, rawOutput: output, evidence });
}

export function cmdRecordDeploymentEvidence(db, id, patch) {
  if (!patch.confidence) throw new Error('deployment evidence precisa de "confidence" (unverified|low|medium|high)');
  return recordDeploymentEvidence(db, id, patch);
}

export function cmdRecordReport(db, id, reportPath) {
  return recordReport(db, id, reportPath);
}

export function cmdGenerateReport(db, id, opts = {}) {
  return generateReport(db, id, opts);
}

/** Junta relatório + screenshots de UM achado já em human_ready (ou
 * além) numa pasta em research/bugbounty/ready-to-submit/ — ver
 * package-for-submission.mjs pro porquê de não tentar automatizar o
 * preenchimento do formulário em si. */
export function cmdPackageForSubmission(db, id) {
  const finding = getFinding(db, id);
  const report = finding ? latestReport(db, id) : null;
  if (finding) {
    const readiness = submissionReadinessGate(finding, {
      report,
      duplicateCheck: latestDuplicateCheck(db, id),
      impactAssessment: latestImpactAssessment(db, id),
      deploymentEvidence: latestDeploymentEvidence(db, id),
      validations: listValidations(db, id),
      scopeGateResult: currentScopeGateForFinding(finding),
      programPolicy: loadProgramPolicyStrict(),
    });
    if (!readiness.ok) return { ok: false, reason: `pacote bloqueado pelo preflight: ${readiness.reason}` };
  }
  return packageFinding(finding, report);
}

/**
 * Varre todo achado não-terminal e diz exatamente o que falta pra
 * avançar -- a mesma pergunta ("viável prosseguir ou não?") que antes
 * exigia investigação manual finding por finding, agora como comando
 * repetível. Não muda nada, só lê estado já gravado.
 */
export function cmdPipelineStatus(db, { programPolicy = loadProgramPolicyStrict() } = {}) {
  const nonTerminal = listFindings(db, {}).filter((f) => !isTerminal(f.state));
  return nonTerminal.map((f) => {
    let blocker;
    const blockReason = getBlockReason(f.program, programPolicy);
    if (blockReason) {
      return {
        id: f.id,
        program: f.program,
        state: f.state,
        blocker: `bloqueado por política: ${blockReason}`,
      };
    }
    switch (f.state) {
      case 'candidate':
        blocker = 'aguardando leitura profunda (deep-read) -- ainda não investigado';
        break;
      case 'corroborated_static': {
        const validations = listValidations(db, f.id);
        if (validations.some((v) => v.result === 'pass')) blocker = 'PoC já passou -- pronto pra tentar reproduced_local';
        else if (validations.some((v) => v.result === 'not_applicable')) blocker = `sem validador local pra tipo/linguagem "${f.language}" -- bloqueio estrutural (não falta de esforço), ver README`;
        else blocker = 'PoC ainda não foi rodada pra este achado';
        break;
      }
      case 'reproduced_local':
        blocker = 'falta confirmar scope gate + deploymentEvidence pra virar scope_verified';
        break;
      case 'scope_verified': {
        const missing = [];
        const report = latestReport(db, f.id);
        const duplicateCheck = latestDuplicateCheck(db, f.id);
        const impactAssessment = latestImpactAssessment(db, f.id);
        if (!report) missing.push('relatório (rodar `generate-report`)');
        if (!duplicateCheck) missing.push('checagem de duplicata (rodar `record-duplicate-check`)');
        if (!impactAssessment) missing.push('avaliação de impacto (rodar `record-impact-assessment`)');
        if (missing.length > 0) blocker = `falta: ${missing.join('; ')}`;
        else {
          const readiness = submissionReadinessGate(f, {
            report, duplicateCheck, impactAssessment,
            deploymentEvidence: latestDeploymentEvidence(db, f.id),
            validations: listValidations(db, f.id),
            scopeGateResult: currentScopeGateForFinding(f),
            programPolicy,
          });
          blocker = readiness.ok ? 'evidência completa -- pronto pra virar human_ready' : `NÃO enviar: ${readiness.reason}`;
        }
        break;
      }
      case 'human_ready': {
        const readiness = submissionReadinessGate(f, {
          report: latestReport(db, f.id),
          impactAssessment: latestImpactAssessment(db, f.id),
          duplicateCheck: latestDuplicateCheck(db, f.id),
          deploymentEvidence: latestDeploymentEvidence(db, f.id),
          validations: listValidations(db, f.id),
          scopeGateResult: currentScopeGateForFinding(f),
          programPolicy,
        });
        blocker = readiness.ok
          ? 'aguardando decisão humana de enviar; impacto, E4, deploy e novidade revalidados'
          : `NÃO enviar até revalidar: ${readiness.reason}`;
        break;
      }
      case 'inconclusive':
        blocker = 'sem próximo passo automático -- só sai por nova investigação que resolva a incerteza (transition ... false_positive) ou decisão humana';
        break;
      default:
        blocker = '';
    }
    return { id: f.id, program: f.program, state: f.state, blocker };
  });
}

export function cmdRecordDuplicateCheck(db, id, patch) {
  const finding = getFinding(db, id);
  if (!finding) throw new Error(`finding "${id}" não existe no banco`);
  const submissions = enrichSubmissionsWithFindings(listSubmissions(db), listFindings(db));
  const learned = duplicateHistoryForFinding(finding, submissions);
  const portfolio = computeStatsFromSubmissions(submissions);
  const recordedCodeAge = latestCodeAgeEvidence(db, id);
  const requestedProof = patch.noveltyProof?.kind === 'verified_regression'
    ? patch.noveltyProof
    : null;
  const regressionAttestation = requestedProof
    ? [...listValidations(db, id)].reverse().find((validation) => (
        validation.type === 'isolated_regression'
        && validation.result === 'pass'
        && validation.evidence?.provenance === 'regression-sandbox'
        && isDeepStrictEqual(validation.evidence?.noveltyProof, requestedProof)
      )) || null
    : null;
  const attestedNoveltyProof = regressionAttestation ? requestedProof : null;
  const signals = {
    ...(patch.signals || {}),
    // Estes quatro valores vêm de fontes locais auditáveis e são aplicados
    // DEPOIS do patch: quem chama não consegue zerar o próprio histórico
    // de duplicates nem forçar o rótulo de regressão só por JSON.
    priorDuplicateSubmissions: learned.priorDuplicateSubmissions,
    portfolioSubmissionCount: portfolio.totalSubmissions,
    portfolioDuplicateRate: portfolio.duplicateRate,
    foundPublicMatch: patch.foundExisting === true,
    regressionAfterVerifiedFix: Boolean(regressionAttestation),
    ...(recordedCodeAge ? {
      codeAgeDays: recordedCodeAge.codeAgeDays,
      codeAgeCommitSha: recordedCodeAge.lastCommitSha,
      codeAgeCheckedAt: recordedCodeAge.checkedAt,
      codeAgeMethod: recordedCodeAge.method,
    } : {}),
  };
  // O score gravado é sempre derivado dos sinais auditáveis. Aceitar um
  // número pronto aqui permitiria reduzir manualmente o risco para contornar
  // o gate sem mudar nenhuma evidência.
  const risk = assessNoveltyRisk(signals);
  return recordDuplicateCheck(db, id, {
    ...patch,
    noveltyProof: attestedNoveltyProof,
    ...risk,
    signals,
    results: [
      ...(patch.results || []),
      ...(learned.matchingSubmissionIds.length ? [{ source: 'local_submission_history', matchingSubmissionIds: learned.matchingSubmissionIds }] : []),
      ...(requestedProof ? [{
        source: 'isolated_regression_attestation',
        disposition: regressionAttestation ? 'verified' : 'missing_or_mismatched',
        validationTs: regressionAttestation?.ts || null,
      }] : []),
      { source: 'local_portfolio', submissions: portfolio.totalSubmissions, duplicateRate: portfolio.duplicateRate },
    ],
  });
}

export function cmdRecordImpactAssessment(db, id, patch) {
  return recordImpactAssessment(db, id, patch);
}

export function cmdAssessNovelty(patch) {
  return assessNoveltyRisk(patch);
}

/** `get` deixa de devolver só o registro cru do banco -- acrescenta
 * `dimensions` (finding-dimensions.mjs) computado a partir das mesmas
 * evidências satélite que os gates já consultam, pra "confirmado mas não
 * reportável" e "não é novo mas é válido" ficarem visíveis sem precisar
 * juntar `state`+impactAssessment+duplicateCheck manualmente toda vez. */
export function cmdGetFinding(db, id) {
  const finding = getFinding(db, id);
  if (!finding) return null;
  const report = latestReport(db, id);
  const impactAssessment = latestImpactAssessment(db, id);
  const duplicateCheck = latestDuplicateCheck(db, id);
  const submission = latestSubmissionForFinding(db, id);
  const submissionReadiness = submissionReadinessGate(finding, {
    report, impactAssessment, duplicateCheck,
    deploymentEvidence: latestDeploymentEvidence(db, id),
    validations: listValidations(db, id),
    scopeGateResult: currentScopeGateForFinding(finding),
    programPolicy: loadProgramPolicyStrict(),
  });
  return {
    ...finding,
    dimensions: computeFindingDimensions(finding, {
      impactAssessment, duplicateCheck, submission, submissionReadiness,
    }),
  };
}

/** `ownerRepo` no formato "owner/repo". Chamada de rede real, de propósito
 * separada de assess-novelty (que é síncrono/offline) -- mesmo padrão de
 * refresh-scope-live ser separado de check-scope. Devolve o sinal pronto
 * pra colar direto num --patch de assess-novelty/record-duplicate-check. */
export async function cmdCodeAge(ownerRepo, filePath, ref, {
  db = null, findingId = null, signal = codeAgeSignal, now = () => new Date(),
} = {}) {
  const [owner, repo] = String(ownerRepo || '').split('/');
  if (!owner || !repo) throw new Error('formato esperado: owner/repo (ex.: kiwicom/js-iam-middleware)');
  if (!filePath) throw new Error('precisa do caminho do arquivo dentro do repositório (ex.: src/authorizationDirective.ts)');
  const result = await signal(owner, repo, filePath, ref ? { ref } : {});
  if (!findingId) return result;
  if (!db) throw new Error('db é obrigatório quando --finding-id é usado');
  return recordCodeAgeEvidence(db, findingId, {
    ...result, repository: `${owner}/${repo}`, path: filePath, ref: ref || null,
    method: 'github_file_last_commit', checkedAt: now().toISOString(),
  });
}

/** Junta os sinais REAIS já registrados pro achado (impactAssessment,
 * duplicateCheck) com o que só quem chama sabe (bounty esperado do
 * programa, custo de pesquisa já gasto/estimado) -- ver ev-ranking.mjs.
 * `opts.expectedBountyUsd`/`opts.researchCostUsd` seguem null quando não
 * informados (computeExpectedValue já trata como 0, nunca inventa). */
export function cmdRankFinding(db, id, opts = {}) {
  const finding = getFinding(db, id);
  if (!finding) throw new Error(`finding "${id}" não existe no banco`);
  const impactAssessment = latestImpactAssessment(db, id);
  const duplicateCheck = latestDuplicateCheck(db, id);
  const ev = computeExpectedValue({
    technicalValidity: impactAssessment?.technicalValidity ?? null,
    riskScore: duplicateCheck?.riskScore ?? null,
    impactAssessment,
    expectedBountyUsd: opts.expectedBountyUsd,
    researchCostUsd: opts.researchCostUsd,
  });
  return { findingId: id, state: finding.state, ...ev };
}

/** Roda de verdade contra o banco: todo `candidate` known_vulnerable_dependency
 * com GHSA extraível vira known_duplicate, citando o advisory real como
 * fonte. Nunca lança por causa de UM achado ruim -- mesmo padrão de
 * promoteTargets/slither-runner: cada um vira uma entrada em `triaged` OU
 * `skipped`, nenhum desaparece em silêncio. Seguro rodar de novo (achado
 * que já não está mais em `candidate` é ignorado, não re-processado). */
export function cmdAutoTriageKnownCve(db, { actor = 'auto-triage-known-cve' } = {}) {
  const candidates = listFindings(db, { state: 'candidate' }).filter((f) => f.type === 'known_vulnerable_dependency');
  const triaged = [];
  const skipped = [];
  for (const finding of candidates) {
    const knownIssueSource = knownIssueSourceForVulnerableDependency(finding);
    if (!knownIssueSource) {
      skipped.push({ id: finding.id, reason: 'sem GHSA extraível no reasoning' });
      continue;
    }
    // notify:false -- ver comentário em db.mjs::recordTransition (achado
    // real: 181 notificações reais em sequência estouraram o rate limit
    // do Telegram numa rodada anterior desta mesma operação).
    const result = recordTransition(db, finding.id, 'known_duplicate', { actor, context: { knownIssueSource }, notify: false });
    if (result.ok) triaged.push({ id: finding.id, url: knownIssueSource.url });
    else skipped.push({ id: finding.id, reason: result.reason });
  }
  if (triaged.length > 0) {
    sendTelegramMessage(`📋 <b>ZeroToOne</b> — auto-triagem\n${triaged.length} achado(s) fechado(s) como <b>known_duplicate</b> (CVE de dependência já publicado, sem checar alcançabilidade)\n${skipped.length} sem GHSA extraível, ficaram como estavam`).catch(() => {});
  }
  return { totalCandidates: candidates.length, triaged: triaged.length, skipped: skipped.length, triagedIds: triaged, skippedIds: skipped };
}

export function cmdSubmissionStats(db) {
  const submissions = enrichSubmissionsWithFindings(listSubmissions(db), listFindings(db));
  return computeStatsFromSubmissions(submissions);
}

export function cmdSubmissionPreflight(db, id, {
  now = Date.now(), programPolicy = loadProgramPolicyStrict(), scopeResolver = currentScopeGateForFinding,
} = {}) {
  const finding = getFinding(db, id);
  if (!finding) throw new Error(`finding "${id}" não existe no banco`);
  const report = latestReport(db, id);
  const impactAssessment = latestImpactAssessment(db, id);
  const duplicateCheck = latestDuplicateCheck(db, id);
  const submission = latestSubmissionForFinding(db, id);
  const submissions = enrichSubmissionsWithFindings(listSubmissions(db), listFindings(db));
  const history = duplicateHistoryForFinding(finding, submissions);
  const readiness = submissionReadinessGate(finding, {
    report, impactAssessment, duplicateCheck,
    deploymentEvidence: latestDeploymentEvidence(db, id),
    validations: listValidations(db, id),
    scopeGateResult: scopeResolver(finding, new Date(now).toISOString()),
    programPolicy, now,
  });
  return {
    findingId: id,
    state: finding.state,
    semanticFingerprint: finding.semanticFingerprint,
    dimensions: computeFindingDimensions(finding, {
      impactAssessment, duplicateCheck, submission, submissionReadiness: readiness,
    }),
    ready: readiness.ok,
    reason: readiness.reason,
    evidence: {
      report, impactAssessment, duplicateCheck,
      deploymentEvidence: latestDeploymentEvidence(db, id),
      validations: listValidations(db, id),
      scopeGateResult: scopeResolver(finding, new Date(now).toISOString()),
    },
    localHistory: history,
    limitation: 'Buscas públicas sem correspondência não provam unicidade: reports privados permanecem invisíveis até a plataforma revelar uma relação de duplicate.',
  };
}

/** Pra quando um humano submete direto na plataforma (fora do fluxo de
 * transition->submitted deste CLI) -- registra o resultado real depois
 * do fato, mesmo padrão que `sync-report-status` já usa internamente,
 * só que chamável manualmente pra um finding que ainda não tinha
 * platformOutcome nenhum gravado.
 *
 * Bug real corrigido em 02/09/2026: até então só gravava o outcome
 * (recordPlatformOutcome), nunca tentava a transição de `state`
 * correspondente -- inconsistente com o próprio comentário acima
 * ("mesmo padrão que sync-report-status já usa internamente"), que
 * SEMPRE tenta `recordTransition` pros 4 outcomes terminais. Achado
 * usando esta função de verdade pela primeira vez pra registrar o
 * outcome real do achado SSRF (image-optimizer.ts, HackerOne #3988959):
 * o outcome gravava certo, mas o finding continuava "corroborated_static"
 * pra sempre, uma contradição interna nenhum outro comando detectaria
 * sozinho. A transição pode legitimamente FALHAR aqui (ex.: este
 * finding específico nunca passou por reproduced_local/scope_verified/
 * human_ready/submitted dentro do pipeline -- foi enviado com base em
 * revisão humana direta, fora do fluxo formal) -- isso é reportado
 * honestamente em `transition.ok`, nunca escondido nem forçado com
 * precondição fabricada. */
export function cmdRecordPlatformOutcome(db, id, patch) {
  if (!patch.state) throw new Error('platform outcome precisa de "state" (ex.: submitted, duplicate, triaged, paid, resolved, informative, rejected)');
  const outcome = recordPlatformOutcome(db, id, patch);
  let transition = null;
  if (['duplicate', 'informative', 'rejected', 'triaged'].includes(patch.state)) {
    transition = recordTransition(db, id, patch.state, {
      actor: 'record-platform-outcome (CLI manual)',
      context: { platformOutcome: { state: patch.state } },
    });
  }
  return { outcome, transition };
}

/** Grau de evidência (E0-E5, ver evidence-grade.mjs) -- deriva do que já
 * está gravado (filesRead, validations, platformOutcome), não pede
 * nenhum dado novo do chamador. */
export function cmdEvidenceGrade(db, id) {
  const grade = getEvidenceGrade(db, id, { getFinding, listValidations, latestPlatformOutcome });
  if (grade === null) throw new Error(`finding "${id}" não existe`);
  return { id, grade, meaning: explainGrade(grade) };
}

/** Checagem rápida ANTES de investir tempo de investigação — não precisa
 * de finding nem de banco. Usa a mesma policy que o gate de human_ready
 * consulta automaticamente, então "seguro pra pesquisar" aqui e "consegue
 * chegar a human_ready" depois são sempre a mesma resposta. Também
 * mostra orçamento de envio restante quando existe um rastreado (ver
 * program-submission-budget.mjs) -- aviso, não bloqueio automático. */
export function cmdCheckProgram(programName) {
  const policy = loadProgramPolicyStrict();
  const reason = getBlockReason(programName, policy);
  const budget = getSubmissionBudget(programName, loadSubmissionBudget());
  const result = reason ? { program: programName, blocked: true, reason } : { program: programName, blocked: false };
  if (budget) result.submissionBudget = budget;
  return result;
}

export function cmdCheckScope(program, assetRef) {
  const snapshot = loadSnapshot(program);
  return scopeGate(snapshot, assetRef);
}

/**
 * Busca o escopo estruturado oficial direto na Hacker API (fonte mais
 * autoritativa que existe — não é scraping, é o dado que o próprio
 * programa cadastrou no HackerOne) e substitui o snapshot local. TTL
 * curto (3 dias, ver scope-registry.mjs) porque agora é barato re-buscar.
 */
export async function cmdRefreshScopeLive(program, programHandle) {
  const assetsRaw = await getStructuredScope(programHandle);
  const assets = assetsRaw.map((a) => ({
    assetIdentifier: a.assetIdentifier,
    eligibleForBounty: a.eligibleForBounty,
    eligibleForSubmission: a.eligibleForSubmission,
    maxSeverity: a.maxSeverity,
    instruction: a.instruction,
  }));
  const snapshot = buildScopeSnapshot({
    program,
    platform: 'HackerOne',
    officialUrl: `https://hackerone.com/${programHandle}`,
    sourceType: 'hackerone_api_live',
    sourceDetail: `GET /v1/hackers/programs/${programHandle}/structured_scopes`,
    rawSourceContent: assetsRaw,
    assets,
    confidence: 'alta',
  });
  const file = saveSnapshot(snapshot);
  return { savedTo: file, assetCount: assets.length };
}

/** Status ao vivo de um report específico, direto da Hacker API. */
export async function cmdReportStatus(reportId) {
  return getReport(reportId);
}

/** Lista todos os reports do usuário autenticado, direto da Hacker API. */
export async function cmdMyReports() {
  return getMyReports();
}

/** Importa cada report do próprio hacker como uma entidade de submissão
 * distinta. O GET detalhado permite aproveitar activities/severity e a
 * referência do original quando a plataforma a disponibiliza. Reports sem
 * finding local continuam úteis para estatística de portfólio. */
export async function cmdSyncMyReports(db) {
  const summaries = await getMyReports();
  const findings = listFindings(db);
  const findingIdsByReport = new Map();
  for (const finding of findings) {
    const outcome = latestPlatformOutcome(db, finding.id);
    if (!outcome?.external_report_id) continue;
    const key = String(outcome.external_report_id);
    const ids = findingIdsByReport.get(key) || [];
    ids.push(finding.id);
    findingIdsByReport.set(key, ids);
  }
  const imported = [];
  let changed = 0;
  for (const summary of summaries) {
    const live = await getReport(summary.id);
    const findingIds = findingIdsByReport.get(String(live.id)) || [];
    const localProgram = findingIds.length ? getFinding(db, findingIds[0])?.program : null;
    const before = getSubmission(db, `HackerOne:${live.id}`);
    const submission = recordSubmission(db, {
      platform: 'HackerOne',
      externalReportId: live.id,
      program: localProgram || live.programHandle || null,
      repository: live.assetIdentifier || null,
      title: live.title || null,
      submittedAt: live.createdAt || null,
      state: live.state || null,
      originalReportId: live.originalReportId || null,
      severityFinal: live.severityRating || null,
      comments: live.originalReportId ? `Duplicate relacionado ao report #${live.originalReportId}` : null,
    }, findingIds);
    if (!before || before.updatedAt !== submission.updatedAt) changed += 1;
    imported.push(submission);
  }
  return { checked: imported.length, changed, unchanged: imported.length - changed, submissions: imported };
}

/**
 * Pra todo finding em estado "submitted" que já tem um platformOutcome
 * registrado (portanto um externalReportId conhecido), busca o status
 * ao vivo na Hacker API e, se mudou pra um estado terminal reconhecido
 * (duplicate/informative/rejected/triaged), registra o outcome real e
 * tenta a transição — nunca inventa um outcome, só espelha o que a
 * própria plataforma diz.
 */
export async function cmdSyncReportStatus(db) {
  const submitted = listFindings(db, { state: 'submitted' });
  const results = [];
  for (const finding of submitted) {
    const prior = latestPlatformOutcome(db, finding.id);
    if (!prior || !prior.external_report_id) {
      results.push({ id: finding.id, skipped: 'sem externalReportId registrado ainda' });
      continue;
    }
    const live = await getReport(prior.external_report_id);
    if (!live || live.state === prior.state) {
      results.push({ id: finding.id, externalReportId: prior.external_report_id, unchanged: live?.state || null });
      continue;
    }
    const outcome = recordPlatformOutcome(db, finding.id, {
      platform: 'HackerOne',
      externalReportId: prior.external_report_id,
      submittedAt: prior.submitted_at,
      state: live.state,
      comments: `Sincronizado automaticamente via Hacker API (era "${prior.state}", agora "${live.state}").`,
    });
    let transition = null;
    if (['duplicate', 'informative', 'rejected', 'triaged'].includes(live.state)) {
      transition = recordTransition(db, finding.id, live.state, { actor: 'HackerOne API (sync automático)', context: { platformOutcome: { state: live.state } } });
    }
    results.push({ id: finding.id, externalReportId: prior.external_report_id, changedTo: live.state, outcome, transition });
  }
  return results;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);

  if (command === 'check-program') {
    printJson(cmdCheckProgram(positional[0]));
    return;
  }
  if (command === 'check-scope') {
    const [program, assetRef] = positional;
    printJson(cmdCheckScope(program, assetRef));
    return;
  }
  if (command === 'refresh-scope-live') {
    const [program, programHandle] = positional;
    printJson(await cmdRefreshScopeLive(program, programHandle));
    return;
  }
  if (command === 'report-status') {
    printJson(await cmdReportStatus(positional[0]));
    return;
  }
  if (command === 'my-reports') {
    printJson(await cmdMyReports());
    return;
  }
  if (command === 'verify-regression') {
    const result = verifyRegression(loadRegressionConfig(flags.config));
    if (flags['finding-id']) {
      const db = openDb(DB_PATH);
      try {
        result.validation = recordValidation(db, flags['finding-id'], {
          type: 'isolated_regression', result: 'pass',
          command: result.noveltyProof.candidate.command,
          rawOutput: result.noveltyProof.candidate.observedOutcome,
          evidence: { provenance: 'regression-sandbox', repositoryUrl: result.repositoryUrl, runtime: result.runtime, noveltyProof: result.noveltyProof },
        });
      } finally {
        closeDb(db);
      }
    }
    printJson(result);
    return;
  }
  if (command === 'verify-longstanding-exposure') {
    const result = verifyLongstandingExposure(loadLongstandingExposureConfig(flags.config));
    if (flags['finding-id'] && result.ok) {
      const db = openDb(DB_PATH);
      try {
        result.validation = recordValidation(db, flags['finding-id'], {
          type: 'verified_longstanding_exposure', result: 'pass',
          command: `git show -s --format=%cI ${result.longstandingExposureProof.introducedCommit}`,
          rawOutput: `introducedAt=${result.longstandingExposureProof.introducedAt}, ageDays=${result.longstandingExposureProof.ageDays}, stillPresentOnDefaultBranch=${result.longstandingExposureProof.stillPresentOnDefaultBranch}`,
          evidence: { provenance: 'regression-sandbox', repositoryUrl: result.repositoryUrl, longstandingExposureProof: result.longstandingExposureProof },
        });
      } finally {
        closeDb(db);
      }
    }
    printJson(result);
    return;
  }
  if (command === 'runtime-status') {
    const statePath = flags.state ? path.resolve(String(flags.state)) : DEFAULT_RUNTIME_STATE_PATH;
    const state = loadRuntimeState(statePath);
    printJson({ statePath, health: summarizeRuntimeHealth(state), state });
    return;
  }
  if (command === 'doctor') {
    const result = runToolchainDoctor();
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'audit-system') {
    const result = runReadinessAudit();
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'mission-control') {
    const result = await runMissionControl();
    printJson(result);
    if (!result.operational) process.exitCode = 1;
    return;
  }
  if (command === 'search-prior-art') {
    printJson(await searchPublicPriorArt(loadPriorArtConfig(flags.config)));
    return;
  }

  const db = openDb(DB_PATH);
  try {
    switch (command) {
      case 'list-pending':
        printJson(cmdListPending(db));
        break;
      case 'status':
        printJson(cmdStatus(db));
        break;
      case 'get': {
        printJson(cmdGetFinding(db, positional[0]));
        break;
      }
      case 'upsert-finding':
        printJson(cmdUpsertFinding(db, parseJsonFlag(flags, 'patch')));
        break;
      case 'update-finding':
        printJson(cmdUpdateFinding(db, positional[0], parseJsonFlag(flags, 'patch')));
        break;
      case 'transition':
        printJson(cmdTransition(db, positional[0], positional[1], flags.actor || 'unknown', parseJsonFlag(flags, 'context')));
        break;
      case 'record-validation':
        printJson(cmdRecordValidation(db, positional[0], { type: flags.type, result: flags.result, command: flags.command, output: flags.output, evidence: flags.evidence ? JSON.parse(flags.evidence) : null }));
        break;
      case 'record-deployment-evidence':
        printJson(cmdRecordDeploymentEvidence(db, positional[0], parseJsonFlag(flags, 'patch')));
        break;
      case 'record-report':
        printJson(cmdRecordReport(db, positional[0], positional[1]));
        break;
      case 'generate-report':
        printJson(cmdGenerateReport(db, positional[0]));
        break;
      case 'pipeline-status':
        printJson(cmdPipelineStatus(db));
        break;
      case 'record-duplicate-check':
        printJson(cmdRecordDuplicateCheck(db, positional[0], parseJsonFlag(flags, 'patch')));
        break;
      case 'record-impact-assessment':
        printJson(cmdRecordImpactAssessment(db, positional[0], parseJsonFlag(flags, 'patch')));
        break;
      case 'assess-novelty':
        printJson(cmdAssessNovelty(parseJsonFlag(flags, 'patch')));
        break;
      case 'code-age':
        printJson(await cmdCodeAge(positional[0], positional[1], positional[2], { db, findingId: flags['finding-id'] || null }));
        break;
      case 'submission-stats':
        printJson(cmdSubmissionStats(db));
        break;
      case 'auto-triage-known-cve':
        printJson(cmdAutoTriageKnownCve(db));
        break;
      case 'rank-finding':
        printJson(cmdRankFinding(db, positional[0], parseJsonFlag(flags, 'opts')));
        break;
      case 'submission-preflight':
        printJson(cmdSubmissionPreflight(db, positional[0]));
        break;
      case 'record-platform-outcome':
        printJson(cmdRecordPlatformOutcome(db, positional[0], parseJsonFlag(flags, 'patch')));
        break;
      case 'evidence-grade':
        printJson(cmdEvidenceGrade(db, positional[0]));
        break;
      case 'export-queue': {
        const queuePath = positional[0] || path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'queue.jsonl');
        const n = exportFindingsToQueueJsonl(db, queuePath);
        printJson({ exported: n, path: queuePath });
        break;
      }
      case 'sync-report-status':
        printJson(await cmdSyncReportStatus(db));
        break;
      case 'sync-my-reports':
        printJson(await cmdSyncMyReports(db));
        break;
      case 'package-for-submission':
        printJson(cmdPackageForSubmission(db, positional[0]));
        break;
      default:
        console.error(`Comando desconhecido: "${command}". Comandos: list-pending, status, get <id>, upsert-finding, update-finding, transition, record-validation, record-deployment-evidence, record-impact-assessment, record-report, generate-report, pipeline-status, record-duplicate-check, assess-novelty, search-prior-art --config=<arquivo.json>, verify-regression --config=<arquivo.json>, verify-longstanding-exposure --config=<arquivo.json>, runtime-status, doctor, audit-system, mission-control, code-age <owner/repo> <path> [ref] [--finding-id=<id>], auto-triage-known-cve, record-platform-outcome, submission-stats, submission-preflight, rank-finding <id> --opts='{...}', evidence-grade, check-program, export-queue, check-scope, refresh-scope-live, report-status, my-reports, sync-my-reports, sync-report-status, package-for-submission`);
        process.exitCode = 1;
    }
  } finally {
    closeDb(db);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('cli.mjs');
if (isMain) {
  main().catch((err) => {
    console.error('Erro:', err.message);
    process.exitCode = 1;
  });
}
