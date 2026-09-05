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
  return new Date(snapshot.expiresAt).getTime() <= new Date(now).getTime();
}

function normalizeAssetKey(value) {
  return (value || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/\/$/, '');
}

/** Resolve the stable asset identifier carried by a finding. Repository is
 * preferred when explicitly recorded; otherwise a path such as
 * owner/repo/src/file.ts is reduced to owner/repo. Non-repository assets
 * (contracts/domains) retain their explicit `asset` value. */
export function assetRefForFinding(finding = {}) {
  const explicitRepo = finding.repository || finding.repo;
  if (explicitRepo) return normalizeAssetKey(explicitRepo).replace(/^github\.com\//, '');
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
  if (!snapshot || !assetRef) return null;
  const needle = normalizeAssetKey(assetRef);
  for (const asset of snapshot.assets) {
    const hay = normalizeAssetKey(asset.assetIdentifier);
    if (!hay) continue;
    if (hay === needle || hay.endsWith('/' + needle) || needle.endsWith(hay) || hay.includes(needle) || needle.includes(hay)) {
      return asset;
    }
  }
  return null;
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
