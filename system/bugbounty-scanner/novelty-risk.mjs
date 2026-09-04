// Política deliberadamente conservadora depois de 6/6 submissões reais
// voltarem como duplicate. Reports privados continuam invisíveis; portanto
// "não achei nada em busca pública" não é evidência suficiente para enviar.
// O gate só libera uma regressão recente demonstrada entre dois refs.
export const DUPLICATE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_RISK_FOR_SUBMISSION = 25;
export const MAX_VERIFIED_REGRESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Caminho alternativo a "regressão recente" (achado real, 04/09/2026):
// verifiedRegressionGate só aceita commit introdutor com <=7 dias -- não
// cobre código que nunca foi seguro (design original, não regressão). O
// mesmo limiar de 1 ano já usado como sinal em assessNoveltyRisk
// (codeAgeDays >= 365) vira aqui um segundo caminho de prova: exposição
// pública longa e ininterrupta, sem nenhum achado associado, é evidência
// forte de novidade pelo motivo oposto ao da regressão (tempo pra alguém
// achar já passou, ninguém achou -- não "ninguém teve tempo ainda").
export const MIN_LONGSTANDING_EXPOSURE_DAYS = 365;

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

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFullCommitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

/**
 * Prova mínima de novidade forte. Não tenta "provar ausência" de report
 * privado; prova algo verificável e temporalmente estreito: o parent do
 * commit não reproduz e o commit introdutor reproduz, usando o mesmo teste.
 */
export function verifiedRegressionGate(proof, {
  now = Date.now(),
  maxAgeMs = MAX_VERIFIED_REGRESSION_AGE_MS,
} = {}) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    return { ok: false, reason: 'falta noveltyProof estruturada de regressão verificada' };
  }
  if (proof.kind !== 'verified_regression') {
    return { ok: false, reason: 'noveltyProof.kind precisa ser verified_regression' };
  }
  if (!isFullCommitSha(proof.introducedCommit) || !isFullCommitSha(proof.parentCommit)) {
    return { ok: false, reason: 'noveltyProof precisa dos SHAs completos introducedCommit e parentCommit' };
  }
  if (proof.introducedCommit.toLowerCase() === proof.parentCommit.toLowerCase()) {
    return { ok: false, reason: 'introducedCommit e parentCommit precisam ser refs diferentes' };
  }
  const introducedAt = new Date(proof.introducedAt).getTime();
  if (!Number.isFinite(introducedAt)) {
    return { ok: false, reason: 'noveltyProof.introducedAt precisa ser timestamp válido' };
  }
  const age = now - introducedAt;
  if (age < -5 * 60 * 1000) return { ok: false, reason: 'commit introdutor está no futuro' };
  if (age > maxAgeMs) {
    return { ok: false, reason: `regressão tem ${Math.floor(age / 86400000)} dias; máximo ${Math.floor(maxAgeMs / 86400000)}` };
  }

  const baseline = proof.baseline;
  const candidate = proof.candidate;
  if (!baseline || baseline.ref?.toLowerCase() !== proof.parentCommit.toLowerCase()) {
    return { ok: false, reason: 'baseline.ref precisa ser exatamente o parentCommit' };
  }
  if (!candidate || candidate.ref?.toLowerCase() !== proof.introducedCommit.toLowerCase()) {
    return { ok: false, reason: 'candidate.ref precisa ser exatamente o introducedCommit' };
  }
  if (baseline.result !== 'not_vulnerable' || candidate.result !== 'vulnerable') {
    return { ok: false, reason: 'baseline precisa ser not_vulnerable e candidate precisa ser vulnerable' };
  }
  for (const [name, validation] of [['baseline', baseline], ['candidate', candidate]]) {
    if (!nonEmpty(validation.command) || !nonEmpty(validation.observedOutcome)) {
      return { ok: false, reason: `${name} precisa registrar command e observedOutcome reais` };
    }
  }
  if (baseline.command.trim() !== candidate.command.trim()) {
    return { ok: false, reason: 'baseline e candidate precisam usar o mesmo comando de validação' };
  }
  return { ok: true, reason: `regressão verificada no commit ${proof.introducedCommit.slice(0, 12)} contra o parent ${proof.parentCommit.slice(0, 12)}` };
}

/** Prova mínima de novidade forte, alternativa a verifiedRegressionGate,
 * para código que nunca foi seguro (não uma regressão recente -- ver
 * comentário de MIN_LONGSTANDING_EXPOSURE_DAYS acima). Consome a mesma
 * proof (check.noveltyProof) produzida por verifyLongstandingExposure
 * (regression-sandbox.mjs), distinguida de uma regressão por proof.kind --
 * não há coluna separada no banco, é o mesmo campo noveltyProof genérico.
 * Nunca confia numa data alegada pelo chamador sem verificação real via
 * git. */
export function verifiedLongstandingExposureGate(proof, {
  now = Date.now(),
  minDays = MIN_LONGSTANDING_EXPOSURE_DAYS,
} = {}) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    return { ok: false, reason: 'falta longstandingExposureProof estruturada' };
  }
  if (proof.kind !== 'verified_longstanding_exposure') {
    return { ok: false, reason: 'longstandingExposureProof.kind precisa ser verified_longstanding_exposure' };
  }
  if (!isFullCommitSha(proof.introducedCommit)) {
    return { ok: false, reason: 'longstandingExposureProof precisa do SHA completo introducedCommit' };
  }
  if (!proof.stillPresentOnDefaultBranch) {
    return { ok: false, reason: 'longstandingExposureProof precisa confirmar que o commit é ancestral da branch padrão atual (ainda em produção, não revertido)' };
  }
  const introducedAt = new Date(proof.introducedAt).getTime();
  if (!Number.isFinite(introducedAt)) {
    return { ok: false, reason: 'longstandingExposureProof.introducedAt precisa ser timestamp válido' };
  }
  if (introducedAt > now + 5 * 60 * 1000) {
    return { ok: false, reason: 'commit introdutor está no futuro' };
  }
  if (!nonEmpty(proof.repositoryUrl) || !nonEmpty(proof.verifiedAt)) {
    return { ok: false, reason: 'longstandingExposureProof precisa de repositoryUrl e verifiedAt' };
  }
  const realAgeDays = Math.floor((now - introducedAt) / 86400000);
  if (!Number.isFinite(proof.ageDays) || Math.abs(proof.ageDays - realAgeDays) > 2) {
    return { ok: false, reason: 'longstandingExposureProof.ageDays não bate com introducedAt' };
  }
  if (realAgeDays < minDays) {
    return { ok: false, reason: `código vulnerável tem só ${realAgeDays} dia(s) de exposição pública verificada; mínimo ${minDays} pra contar como longa data` };
  }
  return { ok: true, reason: `exposição pública de longa data verificada -- commit ${proof.introducedCommit.slice(0, 12)} tem ${realAgeDays} dias, ainda ancestral da branch padrão` };
}

export function duplicateCheckGate(check = {}, { now = Date.now(), maxAgeMs = DUPLICATE_CHECK_MAX_AGE_MS } = {}) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) check = {};
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
  if (new Set(queries.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim().toLowerCase())).size < 3) {
    return { ok: false, reason: 'duplicateCheck precisa registrar pelo menos 3 consultas/framing distintos' };
  }
  if (check.foundExisting !== false) {
    return { ok: false, reason: check.foundExisting ? 'duplicateCheck encontrou correspondência existente' : 'foundExisting precisa ser false explícito' };
  }
  const pendingCandidates = (check.results || []).filter((result) => result?.candidate === true && result.disposition !== 'ruled_out');
  if (pendingCandidates.length > 0) {
    return { ok: false, reason: `duplicateCheck ainda tem ${pendingCandidates.length} correspondência(s) pública(s) sem revisão` };
  }
  const ts = new Date(check.ts).getTime();
  if (!Number.isFinite(ts)) return { ok: false, reason: 'duplicateCheck precisa de timestamp válido' };
  const age = now - ts;
  if (age < -5 * 60 * 1000) return { ok: false, reason: 'duplicateCheck tem timestamp no futuro' };
  if (age > maxAgeMs) return { ok: false, reason: `duplicateCheck expirou (${Math.floor(age / 3600000)}h; máximo ${Math.floor(maxAgeMs / 3600000)}h)` };
  if (check.noveltyStatus !== 'regression' && check.noveltyStatus !== 'longstanding_exposure') {
    return { ok: false, reason: 'modo anti-duplicate exige noveltyStatus=regression ou longstanding_exposure; private_unknown sozinho não é suficiente para envio' };
  }
  if (!Number.isFinite(check.riskScore)) return { ok: false, reason: 'duplicateCheck precisa de riskScore numérico' };
  if (check.riskScore > MAX_RISK_FOR_SUBMISSION) {
    return { ok: false, reason: `risco de duplicata alto (${check.riskScore}/100)` };
  }
  if (check.signals?.priorDuplicateSubmissions !== 0) {
    return { ok: false, reason: 'modo anti-duplicate exige zero submissões duplicate anteriores no mesmo programa/repositório' };
  }
  if (check.noveltyStatus === 'regression') {
    const regression = verifiedRegressionGate(check.noveltyProof, { now });
    if (!regression.ok) return regression;
    return { ok: true, reason: `${regression.reason}; fontes públicas sem correspondência nas últimas 24h; privado permanece desconhecido; risco=${check.riskScore}/100` };
  }
  // noveltyStatus === 'longstanding_exposure' -- caminho alternativo, ver
  // comentário de MIN_LONGSTANDING_EXPOSURE_DAYS acima. Mesmo campo
  // noveltyProof, distinguido por proof.kind.
  const longstanding = verifiedLongstandingExposureGate(check.noveltyProof, { now });
  if (!longstanding.ok) return longstanding;
  return { ok: true, reason: `${longstanding.reason}; fontes públicas sem correspondência nas últimas 24h; privado permanece desconhecido; risco=${check.riskScore}/100` };
}
