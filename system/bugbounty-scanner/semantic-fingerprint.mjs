import { createHash } from 'node:crypto';

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/https?:\/\/github\.com\//, '')
    .replace(/[^a-z0-9_./:@>-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function repositoryFrom(finding) {
  // `asset` em entradas antigas costuma ser só um caminho interno
  // (packages/next/...), enquanto `file` preserva owner/repo.
  const candidate = normalize(finding.repository || finding.repo || finding.file || finding.asset);
  const parts = candidate.split('/').filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : candidate;
}

const TYPE_ALIASES = new Map([
  ['os command injection', 'command_injection'],
  ['command injection', 'command_injection'],
  ['semgrep_detect_child_process', 'command_injection'],
  ['ssrf redirect allowlist bypass risk', 'ssrf'],
  ['ssrf_risk', 'ssrf'],
  ['server side request forgery', 'ssrf'],
]);

function canonicalType(value) {
  const normalized = normalize(value).replace(/-/g, ' ');
  return TYPE_ALIASES.get(normalized) || normalized.replace(/ /g, '_');
}

/**
 * A fingerprint deliberately excludes program name, line number and prose.
 * Those fields change without changing the vulnerable instance. Structured
 * source/sink/guard/fix fields are optional today, but become part of the
 * identity as soon as an analyzer supplies them.
 */
export function semanticFingerprintPayload(finding = {}) {
  return {
    version: 1,
    repository: repositoryFrom(finding),
    file: normalize(finding.file || finding.asset),
    function: normalize(finding.function || finding.fn),
    weakness: canonicalType(finding.weakness || finding.cwe || finding.type),
    source: normalize(finding.source || finding.attackerInput || finding.raw?.source),
    transformation: normalize(finding.transformation || finding.rootCause || finding.raw?.rootCause),
    sink: normalize(finding.sink || finding.raw?.sink),
    missingControl: normalize(finding.missingControl || finding.guard || finding.raw?.missingControl),
    expectedFix: normalize(finding.expectedFix || finding.fixSignature || finding.raw?.expectedFix),
  };
}

export function deriveSemanticFingerprint(finding = {}) {
  const payload = semanticFingerprintPayload(finding);
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `sf:v1:${digest}`;
}
