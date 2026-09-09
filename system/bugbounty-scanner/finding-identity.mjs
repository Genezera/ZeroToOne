import { createHash } from 'node:crypto';
import { assetRefForFinding } from './scope-registry.mjs';

function value(finding, ...names) {
  for (const name of names) {
    const direct = finding?.[name];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const nested = finding?.raw?.[name];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return '';
}

function normalize(input) {
  return String(input || '').trim().toLowerCase().replaceAll('\\', '/')
    .replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
    .replace(/[^a-z0-9_./:@>-]+/g, ' ').replace(/\s+/g, ' ');
}

function canonicalFile(finding, repository) {
  const file = normalize(value(finding, 'file', 'asset'));
  const prefix = `${repository}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

/** Reportable findings need a structured mechanical identity.  Prose is not
 * accepted as a substitute because two agents can describe the same root
 * cause very differently and bypass semantic deduplication. */
export function findingIdentityQuality(finding = {}) {
  const repository = normalize(value(finding, 'repository', 'repo') || assetRefForFinding(finding));
  const fields = {
    repository,
    file: canonicalFile(finding, repository),
    weakness: normalize(value(finding, 'weakness', 'cwe') || (finding.type !== 'ai_deep_read_finding' ? finding.type : '')),
    rootCause: normalize(value(finding, 'rootCause', 'transformation')),
    attackerInput: normalize(value(finding, 'attackerInput', 'source', 'trigger')),
    securitySink: normalize(value(finding, 'securitySink', 'sink')),
    missingControl: normalize(value(finding, 'missingControl', 'securityInvariant', 'guard')),
    expectedFix: normalize(value(finding, 'expectedFix', 'fixSignature')),
  };
  const missing = Object.entries(fields).filter(([, fieldValue]) => !fieldValue).map(([name]) => name);
  if (missing.length) {
    return { ok: false, reason: `identidade mecânica incompleta: faltam ${missing.join(', ')}`, missing, fields, rootCauseFingerprint: null };
  }
  const rootPayload = {
    version: 1,
    repository: fields.repository,
    file: fields.file,
    weakness: fields.weakness,
    rootCause: fields.rootCause,
    missingControl: fields.missingControl,
    expectedFix: fields.expectedFix,
  };
  const digest = createHash('sha256').update(JSON.stringify(rootPayload)).digest('hex');
  return { ok: true, reason: 'identidade mecânica estruturada', missing: [], fields, rootCauseFingerprint: `rcf:v1:${digest}` };
}

export function localRootCauseCollisions(finding, findings = []) {
  const identity = findingIdentityQuality(finding);
  if (!identity.ok) return { ...identity, collisionIds: [] };
  const collisionIds = findings
    .filter((candidate) => candidate.id !== finding.id)
    .filter((candidate) => findingIdentityQuality(candidate).rootCauseFingerprint === identity.rootCauseFingerprint)
    .map((candidate) => candidate.id).sort();
  return { ...identity, collisionIds };
}
