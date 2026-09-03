import { openDb, upsertFinding, getFinding, listFindings, recordTransition, recordValidation, recordDeploymentEvidence, recordDuplicateCheck, recordReport, latestReport, latestDuplicateCheck, recordPlatformOutcome, latestPlatformOutcome, listValidations, stateCounts, exportFindingsToQueueJsonl, closeDb, recordImpactAssessment, latestImpactAssessment, listSubmissions, recordSubmission } from './db.mjs';
import { loadSnapshot, saveSnapshot, buildScopeSnapshot, scopeGate } from './scope-registry.mjs';
import { getStructuredScope, getReport, getMyReports } from './h1-api.mjs';
import { getEvidenceGrade, explainGrade } from './evidence-grade.mjs';
import { loadProgramPolicy, getBlockReason } from './program-policy.mjs';
import { loadSubmissionBudget, getSubmissionBudget } from './program-submission-budget.mjs';
import { isTerminal, submissionReadinessGate } from './state-machine.mjs';
import { generateReport } from './generate-report.mjs';
import { packageFinding } from './package-for-submission.mjs';
import { assessNoveltyRisk, duplicateCheckGate } from './novelty-risk.mjs';
import { reportabilityGate } from './impact-assessment.mjs';
import { computeStatsFromSubmissions, enrichSubmissionsWithFindings, duplicateHistoryForFinding } from './outcome-intelligence.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function cmdTransition(db, id, toState, actor, context) {
  return recordTransition(db, id, toState, { actor, context });
}

export function cmdRecordValidation(db, id, { type, result, command, output }) {
  return recordValidation(db, id, { type, result, command, rawOutput: output });
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
  return packageFinding(finding, report);
}

/**
 * Varre todo achado não-terminal e diz exatamente o que falta pra
 * avançar -- a mesma pergunta ("viável prosseguir ou não?") que antes
 * exigia investigação manual finding por finding, agora como comando
 * repetível. Não muda nada, só lê estado já gravado.
 */
export function cmdPipelineStatus(db) {
  const nonTerminal = listFindings(db, {}).filter((f) => !isTerminal(f.state));
  return nonTerminal.map((f) => {
    let blocker;
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
            programPolicy: loadProgramPolicy(),
          });
          blocker = readiness.ok ? 'evidência completa -- pronto pra virar human_ready' : `NÃO enviar: ${readiness.reason}`;
        }
        break;
      }
      case 'human_ready': {
        const blockReason = getBlockReason(f.program, loadProgramPolicy());
        if (blockReason) blocker = `bloqueado por política: ${blockReason}`;
        else {
          const impact = reportabilityGate(latestImpactAssessment(db, f.id));
          const duplicate = duplicateCheckGate(latestDuplicateCheck(db, f.id));
          blocker = impact.ok && duplicate.ok
            ? 'aguardando decisão humana de enviar; impacto e novidade revalidados'
            : `NÃO enviar até revalidar: ${!impact.ok ? impact.reason : duplicate.reason}`;
        }
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
  const signals = {
    priorDuplicateSubmissions: learned.priorDuplicateSubmissions,
    portfolioSubmissionCount: portfolio.totalSubmissions,
    portfolioDuplicateRate: portfolio.duplicateRate,
    ...(patch.signals || {}),
    foundPublicMatch: patch.foundExisting === true,
  };
  // O score gravado é sempre derivado dos sinais auditáveis. Aceitar um
  // número pronto aqui permitiria reduzir manualmente o risco para contornar
  // o gate sem mudar nenhuma evidência.
  const risk = assessNoveltyRisk(signals);
  return recordDuplicateCheck(db, id, {
    ...patch,
    ...risk,
    results: [
      ...(patch.results || []),
      ...(learned.matchingSubmissionIds.length ? [{ source: 'local_submission_history', matchingSubmissionIds: learned.matchingSubmissionIds }] : []),
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

export function cmdSubmissionStats(db) {
  const submissions = enrichSubmissionsWithFindings(listSubmissions(db), listFindings(db));
  return computeStatsFromSubmissions(submissions);
}

export function cmdSubmissionPreflight(db, id, { now = Date.now() } = {}) {
  const finding = getFinding(db, id);
  if (!finding) throw new Error(`finding "${id}" não existe no banco`);
  const report = latestReport(db, id);
  const impactAssessment = latestImpactAssessment(db, id);
  const duplicateCheck = latestDuplicateCheck(db, id);
  const submissions = enrichSubmissionsWithFindings(listSubmissions(db), listFindings(db));
  const history = duplicateHistoryForFinding(finding, submissions);
  const readiness = submissionReadinessGate(finding, {
    report, impactAssessment, duplicateCheck,
    programPolicy: loadProgramPolicy(), now,
  });
  return {
    findingId: id,
    state: finding.state,
    semanticFingerprint: finding.semanticFingerprint,
    ready: readiness.ok,
    reason: readiness.reason,
    evidence: { report, impactAssessment, duplicateCheck },
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
  const policy = loadProgramPolicy();
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
  for (const summary of summaries) {
    const live = await getReport(summary.id);
    const findingIds = findingIdsByReport.get(String(live.id)) || [];
    const localProgram = findingIds.length ? getFinding(db, findingIds[0])?.program : null;
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
    imported.push(submission);
  }
  return { imported: imported.length, submissions: imported };
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
        printJson(getFinding(db, positional[0]));
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
        printJson(cmdRecordValidation(db, positional[0], { type: flags.type, result: flags.result, command: flags.command, output: flags.output }));
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
      case 'submission-stats':
        printJson(cmdSubmissionStats(db));
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
        console.error(`Comando desconhecido: "${command}". Comandos: list-pending, status, get <id>, upsert-finding, update-finding, transition, record-validation, record-deployment-evidence, record-impact-assessment, record-report, generate-report, pipeline-status, record-duplicate-check, assess-novelty, record-platform-outcome, submission-stats, submission-preflight, evidence-grade, check-program, export-queue, check-scope, refresh-scope-live, report-status, my-reports, sync-my-reports, sync-report-status, package-for-submission`);
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
