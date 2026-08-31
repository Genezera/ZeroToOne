import { openDb, upsertFinding, getFinding, listFindings, recordTransition, recordValidation, recordDeploymentEvidence, recordDuplicateCheck, recordReport, latestReport, latestDuplicateCheck, recordPlatformOutcome, latestPlatformOutcome, listValidations, stateCounts, exportFindingsToQueueJsonl, closeDb } from './db.mjs';
import { loadSnapshot, saveSnapshot, buildScopeSnapshot, scopeGate } from './scope-registry.mjs';
import { getStructuredScope, getReport, getMyReports } from './h1-api.mjs';
import { getEvidenceGrade, explainGrade } from './evidence-grade.mjs';
import { loadProgramPolicy, getBlockReason } from './program-policy.mjs';
import { loadSubmissionBudget, getSubmissionBudget } from './program-submission-budget.mjs';
import { isTerminal } from './state-machine.mjs';
import { generateReport } from './generate-report.mjs';
import path from 'node:path';

// CLI que dá ao agente de nuvem (só Bash/Read/Write/Edit/Glob/Grep, sem
// acesso MCP ao banco) uma forma estruturada de mudar estado — em vez de
// "reescreva a linha em queue.jsonl" (schema livre, sem checagem). Toda
// transição passa pela mesma validação de state-machine.mjs que o resto
// do sistema usa; o CLI não contorna a precondição, só empacota o
// contexto que ela pede.

const DB_PATH = path.join('research', 'bugbounty', 'zerotoone.db');

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
        if (!latestReport(db, f.id)) missing.push('relatório (rodar `generate-report`)');
        if (!latestDuplicateCheck(db, f.id)) missing.push('checagem de duplicata (rodar `record-duplicate-check`)');
        blocker = missing.length > 0 ? `falta: ${missing.join('; ')}` : 'evidência completa -- pronto pra virar human_ready';
        break;
      }
      case 'human_ready': {
        const blockReason = getBlockReason(f.program, loadProgramPolicy());
        blocker = blockReason ? `bloqueado por política: ${blockReason}` : 'aguardando decisão humana de enviar';
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
  return recordDuplicateCheck(db, id, patch);
}

/** Pra quando um humano submete direto na plataforma (fora do fluxo de
 * transition->submitted deste CLI) -- registra o resultado real depois
 * do fato, mesmo padrão que `sync-report-status` já usa internamente,
 * só que chamável manualmente pra um finding que ainda não tinha
 * platformOutcome nenhum gravado. */
export function cmdRecordPlatformOutcome(db, id, patch) {
  if (!patch.state) throw new Error('platform outcome precisa de "state" (ex.: submitted, duplicate, triaged, paid, resolved, informative, rejected)');
  return recordPlatformOutcome(db, id, patch);
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
      case 'record-platform-outcome':
        printJson(cmdRecordPlatformOutcome(db, positional[0], parseJsonFlag(flags, 'patch')));
        break;
      case 'evidence-grade':
        printJson(cmdEvidenceGrade(db, positional[0]));
        break;
      case 'export-queue': {
        const queuePath = positional[0] || path.join('research', 'bugbounty', 'queue.jsonl');
        const n = exportFindingsToQueueJsonl(db, queuePath);
        printJson({ exported: n, path: queuePath });
        break;
      }
      case 'sync-report-status':
        printJson(await cmdSyncReportStatus(db));
        break;
      default:
        console.error(`Comando desconhecido: "${command}". Comandos: list-pending, status, get <id>, upsert-finding --patch='{...}', update-finding <id> --patch='{...}', transition <id> <toState> --actor=X --context='{...}', record-validation <id> --type=X --result=pass|fail|not_applicable --output="...", record-deployment-evidence <id> --patch='{...}', record-report <id> <path>, generate-report <id>, pipeline-status, record-duplicate-check <id> --patch='{"methods":["github_issues"],"query":"..."}', record-platform-outcome <id> --patch='{"platform":"HackerOne","externalReportId":"...","state":"duplicate","comments":"..."}', evidence-grade <id>, check-program "<nome do programa>", export-queue [path], check-scope <program> <assetRef>, refresh-scope-live <program> <programHandle>, report-status <externalReportId>, my-reports, sync-report-status`);
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
