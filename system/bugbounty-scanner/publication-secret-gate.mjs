import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BLOB_BYTES = 32 * 1024 * 1024;
const RULES = [
  ['private_key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['telegram_bot_token', /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/],
  ['service_token', /\b(?:xox[baprs]-[A-Za-z0-9-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,})\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['authorization_header', /\b(?:proxy-)?authorization["']?\s*[:=]\s*["']?\s*(?:Bearer|Basic|token)\s+[A-Za-z0-9+/_=.-]{12,}/i],
  ['cookie_header', /\b(?:set-cookie|cookie)["']?\s*[:=]\s*["']?\s*[A-Za-z0-9_.-]+=[^\s;"']{12,}/i],
  ['signed_url', /[?&](?:X-Amz-Signature|X-Amz-Security-Token|X-Goog-Signature|sig)=[A-Za-z0-9%+/_=-]{16,}/i],
  ['secret_assignment', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd)["']?\s*[:=]\s*["']([A-Za-z0-9+/_=.-]{16,})["']/i],
];

function knownSecretValues(env) {
  const values = new Set();
  for (const [name, value] of Object.entries(env)) {
    if (/(?:^|_)(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)(?:$|_)/i.test(name)
        && typeof value === 'string' && value.length >= 8) {
      values.add(value);
      values.add(encodeURIComponent(value));
    }
  }
  if (env.HACKERONE_USERNAME && env.HACKERONE_API_TOKEN) {
    values.add(Buffer.from(`${env.HACKERONE_USERNAME}:${env.HACKERONE_API_TOKEN}`).toString('base64'));
  }
  return [...values];
}

function findingFingerprint(detector, matchedValue) {
  return createHash('sha256').update(`${detector}\0${matchedValue}`).digest('hex');
}

function scanTextForSecretsDetailed(text, { env = process.env } = {}) {
  const known = knownSecretValues(env);
  const findings = [];
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    // Queue/ledger JSON encodes snippets and HTTP captures within one line.
    const decoded = line.replace(/\\"/g, '"').replace(/\\r\\n|\\n/g, '\n');
    for (const [detector, regex] of RULES) {
      const match = decoded.match(regex);
      if (match) findings.push({ line: index + 1, detector,
        fingerprint: findingFingerprint(detector, match[0]) });
    }
    for (const value of known) {
      if (line.includes(value) || decoded.includes(value)) {
        findings.push({ line: index + 1, detector: 'configured_credential',
          fingerprint: findingFingerprint('configured_credential', value) });
      }
    }
  }
  return findings;
}

/** Only detector names/line numbers leave this module, never matched values or
 * internal fingerprints. This is a heuristic guard, not a comprehensive
 * secret or PII classifier. */
export function scanTextForSecrets(text, options = {}) {
  return scanTextForSecretsDetailed(text, options)
    .map(({ line, detector }) => ({ line, detector }));
}

function git(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: repoRoot, encoding, stdio: 'pipe', maxBuffer: MAX_BLOB_BYTES + 1024 });
}

function addedLines(diff) {
  const result = [];
  let line = null;
  for (const raw of diff.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (line === null) continue;
    if (raw.startsWith('+')) { result.push({ line, text: raw.slice(1) }); line += 1; }
    else if (raw.startsWith(' ')) line += 1;
  }
  return result;
}

/** Inspects the exact staged blobs, not the working copy. Existing unchanged
 * history is outside this check. Uninspectable additions block automation. */
export function inspectStagedPublication(repoRoot, { env = process.env } = {}) {
  const findings = [];
  let paths = [];
  try {
    paths = git(repoRoot, ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMRT', '-z']).split('\0').filter(Boolean);
    for (const file of paths) {
      if (/(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519)$|\.(?:key|p12|pfx|pem)$/i.test(file)) {
        findings.push({ path: file, detector: 'sensitive_file' });
        continue;
      }
      if (/\.(?:zip|7z|rar|tar|tgz|gz|bz2|xz|zst|jar|war|pdf)$/i.test(file)) {
        findings.push({ path: file, detector: 'archive_requires_review' });
        continue;
      }
      const size = Number(git(repoRoot, ['cat-file', '-s', `:${file}`]).trim());
      if (!Number.isSafeInteger(size) || size > MAX_BLOB_BYTES) {
        findings.push({ path: file, detector: 'oversized_artifact' });
        continue;
      }
      const blob = git(repoRoot, ['cat-file', 'blob', `:${file}`], null);
      try {
        if (blob.includes(0)) throw new Error('binary');
        new TextDecoder('utf-8', { fatal: true }).decode(blob);
      } catch {
        findings.push({ path: file, detector: 'binary_requires_review' });
        continue;
      }
      const diff = git(repoRoot, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', '--', file]);
      if (/^Binary files .* differ$/m.test(diff)) {
        findings.push({ path: file, detector: 'binary_requires_review' });
        continue;
      }
      // A generated JSONL export can rewrite a line while carrying forward a
      // placeholder that already matched a heuristic in HEAD. Compare opaque
      // fingerprints and counts per path: unchanged carried-forward material
      // is not a new leak, while a different value or an extra occurrence is.
      const existing = new Map();
      try {
        const baseBlob = git(repoRoot, ['cat-file', 'blob', `HEAD:${file}`], null);
        if (!baseBlob.includes(0)) {
          const baseText = new TextDecoder('utf-8', { fatal: true }).decode(baseBlob);
          for (const hit of scanTextForSecretsDetailed(baseText, { env })) {
            existing.set(hit.fingerprint, (existing.get(hit.fingerprint) || 0) + 1);
          }
        }
      } catch { /* arquivo novo ou blob base não textual: nenhuma exceção */ }
      for (const added of addedLines(diff)) {
        for (const hit of scanTextForSecretsDetailed(added.text, { env })) {
          const carriedCount = existing.get(hit.fingerprint) || 0;
          if (carriedCount > 0) {
            existing.set(hit.fingerprint, carriedCount - 1);
            continue;
          }
          findings.push({ path: file, line: added.line, detector: hit.detector });
        }
      }
    }
  } catch {
    // Child-process errors may contain captured content. Do not return them.
    return { ok: false, checkedFiles: paths.length, findings, reason: 'não foi possível inspecionar todos os artefatos staged; publicação bloqueada' };
  }
  return { ok: findings.length === 0, checkedFiles: paths.length, findings,
    reason: findings.length ? 'publicação bloqueada: conteúdo sensível ou artefato que exige revisão local' : 'nenhum padrão sensível detectado nas adições textuais staged' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectStagedPublication(process.cwd());
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
