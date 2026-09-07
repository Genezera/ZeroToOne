import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Scope Registry — verdade temporal e versionada sobre autorização de
// programa. Nunca é a fonte de curadoria de alvo (isso continua sendo
// targets-*.mjs, escrito à mão); é a fonte de "este ativo específico
// pode virar relatório agora, com esta elegibilidade, até esta data".
//
// TTL por tipo de fonte — quanto menos autoritativa a fonte, mais curto
// o prazo até precisar reconfirmar:
export const TTL_DAYS_BY_SOURCE = {
  official_page_fetch: 30,
  community_dataset_structured: 14,
  manual_human_confirmed: 90,
  hackerone_api_live: 3,
};

export function snapshotDir(baseDir = path.resolve(__dirname, '..', '..', 'research', 'bugbounty', 'scope-snapshots')) {
  return baseDir;
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

/**
 * Monta um snapshot de escopo. Função pura — não toca disco, não busca
 * rede. Quem chama já trouxe o dado bruto (fetch de página oficial ou
 * entrada do dataset comunitário).
 */
export function buildScopeSnapshot({
  program,
  platform,
  officialUrl,
  sourceType,
  sourceDetail,
  rawSourceContent,
  assets = [],
  categoriesEligible = [],
  categoriesExcluded = [],
  prohibitedTechniques = [],
  pocRequirements = null,
  rateLimits = null,
  disclosurePolicy = null,
  communitySourceNote = null,
  confidence,
  capturedAt,
  ttlDaysOverride,
}) {
  if (!TTL_DAYS_BY_SOURCE[sourceType]) {
    throw new Error(`sourceType inválido: "${sourceType}". Válidos: ${Object.keys(TTL_DAYS_BY_SOURCE).join(', ')}`);
  }
  const captured = capturedAt || new Date().toISOString();
  const ttlDays = ttlDaysOverride ?? TTL_DAYS_BY_SOURCE[sourceType];
  const expiresAt = new Date(new Date(captured).getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    program,
    platform,
    officialUrl,
    sourceType,
    sourceDetail,
    contentHash: sha256(rawSourceContent ?? { assets, categoriesEligible }),
    capturedAt: captured,
    expiresAt,
    ttlDays,
    confidence,
    assets,
    categoriesEligible,
    categoriesExcluded,
    prohibitedTechniques,
    pocRequirements,
    rateLimits,
    disclosurePolicy,
    communitySourceNote,
  };
}

export function isSnapshotExpired(snapshot, now = new Date().toISOString()) {
  const expiresAt = Date.parse(snapshot?.expiresAt);
  const nowMs = new Date(now).getTime();
  return !Number.isFinite(expiresAt) || !Number.isFinite(nowMs) || expiresAt <= nowMs;
}

function normalizeAssetKey(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\.git$/, '');
}

function scopeAssetKey(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || /\\/.test(raw)) return null;
  if (/\s/.test(raw)) return /:\/\//.test(raw) ? null : `opaque:${raw}`;
  const key = raw.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  // GitHub URLs and owner/repo are aliases only for a complete repository
  // identity. Paths, suffixes and lookalike hosts never imply authorization.
  if (/^github\.com\//i.test(key)) {
    const repo = key.slice('github.com/'.length).replace(/\.git$/i, '');
    if (/^[a-z0-9_-]+$/i.test(repo)) return `github-org:${repo.toLowerCase()}`;
    return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo) ? `github:${repo.toLowerCase()}` : null;
  }
  if (/^[a-z0-9_-]+\/[a-z0-9_.-]+$/i.test(key)) return `github:${key.replace(/\.git$/i, '').toLowerCase()}`;
  if (/^https?:\/\//i.test(raw) || /^(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d+)?(?:\/|$)/i.test(raw)) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (url.username || url.password) return null;
      return `${url.host.toLowerCase()}${url.pathname.replace(/\/$/, '')}${url.search}${url.hash}`;
    } catch { return null; }
  }
  return key;
}

function matchesScopeAsset(identifier, requested) {
  const scoped = scopeAssetKey(identifier);
  if (!scoped || !requested) return false;
  if (scoped === requested) return true;
  // Only explicit DNS wildcards are supported. The apex is not included;
  // repository/path globs require an explicit, separately reviewed asset.
  if (!/^\*\.(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(scoped)) return false;
  if (!/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(requested)) return false;
  return requested.toLowerCase().endsWith(scoped.slice(1).toLowerCase());
}

function repositoryFromFindingId(finding = {}) {
  const location = normalizeAssetKey(String(finding.id || '').split('::')[1]);
  if (!location) return null;

  // Scanner IDs use Program::owner/repo/path/to/file::symbol::kind.  Older
  // records sometimes retained only path/to/file in `asset` and `file`.
  // Recover owner/repo only when the recorded relative path is an exact
  // suffix and the remaining prefix is exactly two segments.  This avoids
  // guessing that an arbitrary path such as packages/next/src/image.ts is a
  // repository named packages/next.
  for (const value of [finding.file, finding.asset]) {
    const suffix = normalizeAssetKey(value).replace(/^github\.com\//, '');
    if (!suffix || location === suffix || !location.endsWith(`/${suffix}`)) continue;
    const prefix = location.slice(0, -(suffix.length + 1));
    if (prefix.split('/').filter(Boolean).length === 2) return prefix;
  }
  return null;
}

/** Resolve the stable asset identifier carried by a finding. Repository is
 * preferred when explicitly recorded; otherwise a path such as
 * owner/repo/src/file.ts is reduced to owner/repo. Non-repository assets
 * (contracts/domains) retain their explicit `asset` value. */
export function assetRefForFinding(finding = {}) {
  const explicitRepo = finding.repository || finding.repo || finding.raw?.repository || finding.raw?.repo;
  if (explicitRepo) return normalizeAssetKey(explicitRepo).replace(/^github\.com\//, '');
  const repositoryFromId = repositoryFromFindingId(finding);
  if (repositoryFromId) return repositoryFromId;
  if (finding.asset) return normalizeAssetKey(finding.asset).replace(/^github\.com\//, '');
  const file = normalizeAssetKey(finding.file).replace(/^github\.com\//, '');
  const parts = file.split('/').filter(Boolean);
  if (parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  return finding.file || null;
}

/**
 * Confere se um ativo (ex.: "circlefin/evm-gateway-contracts" ou a URL
 * completa do repo) está listado no snapshot, e devolve a entrada com as
 * flags de elegibilidade — ou null se não achar (nunca assume elegível
 * por padrão).
 */
export function assetInScope(snapshot, assetRef) {
  if (!Array.isArray(snapshot?.assets)) return null;
  const requested = scopeAssetKey(assetRef);
  const matches = snapshot.assets.filter((asset) => matchesScopeAsset(asset?.assetIdentifier, requested));
  // An explicit exclusion must not be shadowed by an earlier wildcard.
  return matches.find((asset) => asset.eligibleForSubmission === false)
    || matches.find((asset) => asset.eligibleForBounty === false)
    || matches.find((asset) => scopeAssetKey(asset.assetIdentifier) === requested)
    || matches[0] || null;
}

/**
 * Decide se um achado pode avançar considerando só o escopo — não decide
 * o estado final (isso é do state-machine.mjs), só responde a pergunta
 * "o snapshot autoriza isto, agora?".
 */
export function scopeGate(snapshot, assetRef, now = new Date().toISOString()) {
  if (!snapshot) {
    return { allowed: false, reason: 'nenhum scope snapshot existe para este programa' };
  }
  if (isSnapshotExpired(snapshot, now)) {
    return { allowed: false, reason: `scope snapshot expirado em ${snapshot.expiresAt} (capturado ${snapshot.capturedAt}, fonte ${snapshot.sourceType})` };
  }
  const asset = assetInScope(snapshot, assetRef);
  if (!asset) {
    return { allowed: false, reason: `ativo "${assetRef}" não encontrado no snapshot de escopo do programa` };
  }
  const evidence = {
    snapshotCapturedAt: snapshot.capturedAt,
    snapshotExpiresAt: snapshot.expiresAt,
    snapshotSourceType: snapshot.sourceType,
    snapshotContentHash: snapshot.contentHash,
    officialUrl: snapshot.officialUrl,
  };
  if ([asset.eligibleForSubmission, asset.eligibleForBounty].some((value) => value != null && typeof value !== 'boolean')) {
    return { allowed: false, reason: 'flags de elegibilidade inválidas no scope snapshot', asset, ...evidence };
  }
  if (asset.eligibleForSubmission === false) {
    return { allowed: false, reason: `ativo "${assetRef}" explicitamente NÃO elegível para submissão neste snapshot`, asset, ...evidence };
  }
  if (asset.eligibleForBounty === false) {
    return { allowed: true, reason: 'ativo em escopo mas marcado não-elegível para recompensa (pode ainda ser elegível para submissão informativa)', asset, bountyEligible: false, ...evidence };
  }
  if (asset.eligibleForBounty === null || asset.eligibleForBounty === undefined) {
    return { allowed: true, reason: 'ativo em escopo, mas esta fonte não informa elegibilidade de recompensa — confirmar manualmente antes de human_ready', asset, bountyEligible: null, ...evidence };
  }
  return { allowed: true, reason: 'ativo em escopo e elegível', asset, bountyEligible: true, ...evidence };
}

function slugFor(program) {
  return program.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function saveSnapshot(snapshot, baseDir = snapshotDir()) {
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const file = path.join(baseDir, `${slugFor(snapshot.program)}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return file;
}

export function loadSnapshot(program, baseDir = snapshotDir()) {
  const file = path.join(baseDir, `${slugFor(program)}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadAllSnapshots(baseDir = snapshotDir()) {
  if (!existsSync(baseDir)) return [];
  return readdirSync(baseDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(baseDir, f), 'utf8')));
}
