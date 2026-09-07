import { assetRefForFinding } from './scope-registry.mjs';

export function repositoryFromFinding(finding = {}) {
  const value = String(assetRefForFinding(finding) || '').replace(/\\/g, '/').replace(/^https?:\/\/github\.com\//, '');
  const parts = value.split('/').filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}`.toLowerCase() : value.toLowerCase();
}

export function programKey(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Programs with a repeated, overwhelmingly duplicate outcome are poor
 * candidates for historical/routine scanning. They remain monitored for new
 * commits so a fresh regression can still enter the strict novelty path. */
export function isDuplicateSaturatedProgram(program, historyByProgram = {}, {
  minSubmissions = 2, minDuplicateRate = 0.8,
} = {}) {
  const stats = historyByProgram[programKey(program)];
  return !!stats
    && Number(stats.submissions) >= minSubmissions
    && Number(stats.duplicateRate) >= minDuplicateRate;
}

/** Junta entidades de submissão com os findings locais que deram origem ao
 * report. A tabela de submissões continua normalizada; este view é que leva
 * repositório, fraqueza e fingerprint para o motor de aprendizado. */
export function enrichSubmissionsWithFindings(submissions = [], findings = []) {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  return submissions.map((submission) => {
    const linked = (submission.findingIds || []).map((id) => byId.get(id)).filter(Boolean);
    const platformRepository = submission.repository
      ? repositoryFromFinding({ repository: submission.repository })
      : null;
    const repositories = [...new Set([platformRepository, ...linked.map(repositoryFromFinding)].filter(Boolean))];
    const semanticFingerprints = [...new Set(linked.map((finding) => finding.semanticFingerprint).filter(Boolean))];
    const weaknesses = [...new Set(linked.map((finding) => finding.type).filter(Boolean))];
    return {
      ...submission,
      repository: repositories[0] || null,
      repositories,
      semanticFingerprints,
      weaknesses,
    };
  });
}

/** O risco aprendido usa uma amostra por report externo. Para um finding
 * novo, conta duplicates anteriores no mesmo repositório ou programa, nunca
 * o número de detectores/findings que apoiaram cada report. */
export function duplicateHistoryForFinding(finding, submissions = []) {
  const repository = repositoryFromFinding(finding);
  const matching = submissions.filter((submission) => {
    if (submission.state !== 'duplicate') return false;
    const sameRepository = repository && (submission.repositories || [submission.repository]).includes(repository);
    const sameProgram = finding.program && programKey(submission.program) === programKey(finding.program);
    return sameRepository || sameProgram;
  });
  return {
    priorDuplicateSubmissions: matching.length,
    matchingSubmissionIds: matching.map((submission) => submission.id),
    repository: repository || null,
  };
}

function tally(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    const row = result[key] || { submissions: 0, duplicate: 0, triaged: 0, informative: 0, rejected: 0, paid: 0, resolved: 0 };
    row.submissions++;
    if (item.state in row) row[item.state]++;
    result[key] = row;
  }
  for (const row of Object.values(result)) row.duplicateRate = row.submissions ? row.duplicate / row.submissions : null;
  return result;
}

function multiTally(items, keysFn) {
  const expanded = [];
  for (const item of items) {
    const keys = [...new Set((keysFn(item) || []).filter(Boolean))];
    if (keys.length === 0) expanded.push({ item, key: 'unknown' });
    else for (const key of keys) expanded.push({ item, key });
  }
  const result = {};
  for (const { item, key } of expanded) {
    const row = result[key] || { submissions: 0, duplicate: 0, triaged: 0, informative: 0, rejected: 0, paid: 0, resolved: 0 };
    row.submissions++;
    if (item.state in row) row[item.state]++;
    result[key] = row;
  }
  for (const row of Object.values(result)) row.duplicateRate = row.submissions ? row.duplicate / row.submissions : null;
  return result;
}

/** Count platform submissions, never findings. Several detector findings can
 * legitimately support one report and must produce one outcome sample. */
export function distinctSubmissionsFromFindings(findings = []) {
  const byId = new Map();
  for (const finding of findings) {
    const outcome = finding.platformOutcome;
    if (!outcome?.externalReportId) continue;
    const key = `${outcome.platform || finding.platform || 'unknown'}:${outcome.externalReportId}`;
    const existing = byId.get(key) || {
      id: key,
      platform: outcome.platform || finding.platform || null,
      externalReportId: outcome.externalReportId,
      originalReportId: outcome.originalReportId || null,
      program: finding.program || null,
      state: outcome.state,
      repository: repositoryFromFinding(finding),
      findingIds: [],
    };
    existing.findingIds.push(finding.id);
    if (outcome.originalReportId) existing.originalReportId = outcome.originalReportId;
    byId.set(key, existing);
  }
  return [...byId.values()];
}

export function computeSubmissionOutcomeStats(findings = []) {
  const submissions = distinctSubmissionsFromFindings(findings);
  return computeStatsFromSubmissions(submissions);
}

export function computeStatsFromSubmissions(submissions = []) {
  const duplicateSubmissions = submissions.filter((s) => s.state === 'duplicate').length;
  return {
    totalSubmissions: submissions.length,
    duplicateSubmissions,
    duplicateRate: submissions.length ? duplicateSubmissions / submissions.length : null,
    byProgram: tally(submissions, (s) => programKey(s.program)),
    byRepository: tally(submissions, (s) => s.repository),
    bySemanticFingerprint: multiTally(submissions, (s) => s.semanticFingerprints),
    // "por weakness" e "por detector" pedidos na revisão de 03/09/2026 são
    // o MESMO campo neste esquema: `finding.type` já carrega os dois
    // juntos (ex.: "semgrep_detect_child_process" nomeia a origem --
    // Semgrep -- e a fraqueza -- child_process -- na mesma string; não
    // existe um campo "detector" separado hoje pra desduplicar disso).
    byWeakness: multiTally(submissions, (s) => s.weaknesses),
    submissions,
  };
}
