export const DUPLICATE_CHECK_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const MAX_RISK_FOR_SUBMISSION = 59;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Transparent heuristic. It does not claim access to private reports; it
 * estimates competition risk and always labels a clean public search as
 * private_unknown rather than "unique". */
export function assessNoveltyRisk(signals = {}) {
  const reasons = [];
  let score = 20; // private reports are unknowable, so risk never starts at zero

  if (signals.foundPublicMatch) {
    return { riskScore: 100, riskLevel: 'high', noveltyStatus: 'public_match', reasons: ['correspondência pública encontrada'] };
  }
  if (signals.regressionAfterVerifiedFix) {
    score -= 35;
    reasons.push('regressão posterior a uma correção verificada');
  }
  if (Number.isFinite(signals.codeAgeDays)) {
    if (signals.codeAgeDays >= 1825) { score += 30; reasons.push('código vulnerável existe há pelo menos 5 anos'); }
    else if (signals.codeAgeDays >= 730) { score += 22; reasons.push('código vulnerável existe há pelo menos 2 anos'); }
    else if (signals.codeAgeDays >= 365) { score += 14; reasons.push('código vulnerável existe há pelo menos 1 ano'); }
    else if (signals.codeAgeDays <= 90) { score -= 15; reasons.push('mudança introduzida nos últimos 90 dias'); }
  }
  if (Number.isFinite(signals.programAgeDays)) {
    if (signals.programAgeDays >= 1095) { score += 15; reasons.push('programa maduro (3+ anos)'); }
    else if (signals.programAgeDays <= 180) { score -= 12; reasons.push('programa novo (até 180 dias)'); }
  }
  if (Number.isFinite(signals.repoStars)) {
    if (signals.repoStars >= 10000) { score += 20; reasons.push('repositório muito popular (10k+ estrelas)'); }
    else if (signals.repoStars >= 1000) { score += 10; reasons.push('repositório popular (1k+ estrelas)'); }
  }
  if (Number.isFinite(signals.priorDuplicateSubmissions) && signals.priorDuplicateSubmissions > 0) {
    const penalty = Math.min(30, signals.priorDuplicateSubmissions * 10);
    score += penalty;
    reasons.push(`${signals.priorDuplicateSubmissions} submissão(ões) anterior(es) voltou(aram) duplicate neste alvo/programa`);
  }
  if (Number.isFinite(signals.portfolioSubmissionCount)
      && signals.portfolioSubmissionCount >= 3
      && Number.isFinite(signals.portfolioDuplicateRate)) {
    if (signals.portfolioDuplicateRate >= 0.8) {
      score += 20;
      reasons.push(`histórico global com ${(signals.portfolioDuplicateRate * 100).toFixed(0)}% de duplicates em ${signals.portfolioSubmissionCount} submissões`);
    } else if (signals.portfolioDuplicateRate >= 0.5) {
      score += 10;
      reasons.push(`histórico global com alta taxa de duplicates (${(signals.portfolioDuplicateRate * 100).toFixed(0)}%)`);
    }
  }
  if (signals.obviousness === 'high') { score += 20; reasons.push('root cause curto/óbvio para revisão estática'); }
  else if (signals.obviousness === 'medium') { score += 10; reasons.push('root cause de complexidade moderada'); }
  if (signals.assetRecentlyAddedToScope) { score -= 15; reasons.push('ativo adicionado recentemente ao escopo'); }

  score = clamp(Math.round(score), 0, 100);
  return {
    riskScore: score,
    riskLevel: score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low',
    noveltyStatus: signals.regressionAfterVerifiedFix ? 'regression' : 'private_unknown',
    reasons,
  };
}

export function duplicateCheckGate(check = {}, { now = Date.now(), maxAgeMs = DUPLICATE_CHECK_MAX_AGE_MS } = {}) {
  if (!Array.isArray(check.methods) || check.methods.length === 0) {
    return { ok: false, reason: 'duplicateCheck sem métodos rastreáveis' };
  }
  const methods = new Set(check.methods);
  if (!methods.has('github_issues')) return { ok: false, reason: 'duplicateCheck precisa incluir github_issues (issues e PRs)' };
  if (!methods.has('github_advisories')) return { ok: false, reason: 'duplicateCheck precisa incluir github_advisories' };
  if (!methods.has('hacktivity') && !methods.has('web_search')) {
    return { ok: false, reason: 'duplicateCheck precisa incluir hacktivity ou web_search além das fontes do repositório' };
  }
  const queries = Array.isArray(check.queries) ? check.queries : (check.query ? [check.query] : []);
  if (queries.filter((q) => typeof q === 'string' && q.trim()).length < 2) {
    return { ok: false, reason: 'duplicateCheck precisa registrar pelo menos 2 consultas/framing diferentes' };
  }
  if (check.foundExisting !== false) {
    return { ok: false, reason: check.foundExisting ? 'duplicateCheck encontrou correspondência existente' : 'foundExisting precisa ser false explícito' };
  }
  const ts = new Date(check.ts).getTime();
  if (!Number.isFinite(ts)) return { ok: false, reason: 'duplicateCheck precisa de timestamp válido' };
  const age = now - ts;
  if (age < -5 * 60 * 1000) return { ok: false, reason: 'duplicateCheck tem timestamp no futuro' };
  if (age > maxAgeMs) return { ok: false, reason: `duplicateCheck expirou (${Math.floor(age / 3600000)}h; máximo ${Math.floor(maxAgeMs / 3600000)}h)` };
  if (!['private_unknown', 'regression'].includes(check.noveltyStatus)) {
    return { ok: false, reason: 'noveltyStatus precisa ser private_unknown ou regression; busca pública limpa nunca prova unicidade' };
  }
  if (!Number.isFinite(check.riskScore)) return { ok: false, reason: 'duplicateCheck precisa de riskScore numérico' };
  if (check.riskScore > MAX_RISK_FOR_SUBMISSION) {
    return { ok: false, reason: `risco de duplicata alto (${check.riskScore}/100)` };
  }
  return { ok: true, reason: `fontes públicas sem correspondência; privado permanece desconhecido; risco=${check.riskScore}/100` };
}
