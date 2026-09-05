import { createHash } from 'node:crypto';

const EXECUTOR = 'zerotoone.prior-art-search/v1';
const EXECUTED_SOURCES = new Set(['github_issues', 'github_commits', 'github_advisories', 'hacktivity']);
const REVIEW_FIELDS = new Set(['disposition', 'reviewedAt', 'reviewedBy', 'reviewNote']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => [key, canonical(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function normalizedRepository(value) {
  return String(value || '').replace(/^https:\/\/github\.com\//i, '').replace(/\.git\/?$/i, '').replace(/\/$/, '').toLowerCase();
}

function executionResult(result) {
  return Object.fromEntries(Object.entries(result || {}).filter(([key]) => !REVIEW_FIELDS.has(key)));
}

/** Builds the immutable subset produced by the network executor. Human
 * review may only add disposition/reviewer fields to hits; it cannot remove
 * hits, rewrite URLs/titles, alter queries, or fabricate pagination. */
export function priorArtExecutionPayload({ repository, checkedAt, check }) {
  const byCanonicalValue = (a, b) => canonicalJson(a).localeCompare(canonicalJson(b));
  return {
    schemaVersion: 1,
    executor: EXECUTOR,
    repository: normalizedRepository(repository),
    checkedAt,
    methods: [...new Set((check?.methods || []).filter((method) => EXECUTED_SOURCES.has(method)))].sort(),
    queries: [...new Set((check?.queries || []).map((query) => String(query).trim()).filter(Boolean))].sort(),
    evidence: (check?.evidence || []).filter((item) => EXECUTED_SOURCES.has(item?.source)).map(canonical).sort(byCanonicalValue),
    results: (check?.results || []).filter((item) => EXECUTED_SOURCES.has(item?.source)).map(executionResult).map(canonical).sort(byCanonicalValue),
  };
}

export function priorArtExecutionDigest(input) {
  return `sha256:${createHash('sha256').update(canonicalJson(priorArtExecutionPayload(input))).digest('hex')}`;
}

export function createPriorArtSearchAttestation(searchResult, { validationTs = null } = {}) {
  const checkedAt = searchResult?.checkedAt || searchResult?.duplicateCheckDraft?.ts;
  const repository = normalizedRepository(searchResult?.repository);
  if (!repository || !checkedAt || !searchResult?.duplicateCheckDraft) {
    throw new Error('resultado de prior-art incompleto para atestação');
  }
  return {
    schemaVersion: 1,
    kind: 'executed_prior_art_search',
    executor: EXECUTOR,
    repository,
    checkedAt,
    validationTs,
    digest: priorArtExecutionDigest({ repository, checkedAt, check: searchResult.duplicateCheckDraft }),
  };
}

export function verifyPriorArtSearchAttestation(check, { repository = null } = {}) {
  const attestation = check?.searchAttestation;
  if (!attestation || attestation.schemaVersion !== 1 || attestation.kind !== 'executed_prior_art_search'
      || attestation.executor !== EXECUTOR) {
    return { ok: false, reason: 'duplicateCheck sem atestação do executor search-prior-art' };
  }
  const expectedRepository = normalizedRepository(repository || attestation.repository);
  if (!expectedRepository || normalizedRepository(attestation.repository) !== expectedRepository) {
    return { ok: false, reason: 'atestação de prior-art não corresponde ao mesmo repositório do finding' };
  }
  if (check.ts !== attestation.checkedAt) {
    return { ok: false, reason: 'timestamp do duplicateCheck não corresponde à busca atestada' };
  }
  const validationTs = Date.parse(attestation.validationTs);
  const checkedAt = Date.parse(attestation.checkedAt);
  if (!Number.isFinite(validationTs) || !Number.isFinite(checkedAt)
      || Math.abs(validationTs - checkedAt) > 5 * 60 * 1000) {
    return { ok: false, reason: 'atestação de prior-art não está ligada a uma validation contemporânea' };
  }
  const digest = priorArtExecutionDigest({ repository: expectedRepository, checkedAt: attestation.checkedAt, check });
  if (digest !== attestation.digest) {
    return { ok: false, reason: 'conteúdo da busca de prior-art diverge da execução atestada' };
  }
  return { ok: true, reason: `busca pública executada e vinculada por ${attestation.digest}` };
}
