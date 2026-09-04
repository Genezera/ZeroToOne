import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');

function stable(value) {
  return JSON.stringify(value);
}

function same(a, b) {
  return stable(a) === stable(b);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Three-way merge for JSON state. Conflicting concurrent edits are reported,
 * never silently selected by timestamp or worker priority. */
export function mergeJson(base, current, source, keyPath = '') {
  if (same(current, source)) return { value: current, conflicts: [] };
  if (same(base, current)) return { value: source, conflicts: [] };
  if (same(base, source)) return { value: current, conflicts: [] };
  if (isPlainObject(base) || isPlainObject(current) || isPlainObject(source)) {
    const output = {};
    const conflicts = [];
    const keys = new Set([
      ...Object.keys(base || {}), ...Object.keys(current || {}), ...Object.keys(source || {}),
    ]);
    for (const key of keys) {
      const child = mergeJson(base?.[key], current?.[key], source?.[key], keyPath ? `${keyPath}.${key}` : key);
      if (child.value !== undefined) output[key] = child.value;
      conflicts.push(...child.conflicts);
    }
    return { value: output, conflicts };
  }
  return { value: current, conflicts: [{ path: keyPath || '<root>', base, current, source }] };
}

function mapById(entries, label) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry?.id) throw new Error(`${label} contém entrada sem id`);
    if (map.has(entry.id)) throw new Error(`${label} contém id duplicado: ${entry.id}`);
    map.set(entry.id, entry);
  }
  return map;
}

export function mergeQueueEntries(baseEntries, currentEntries, sourceEntries) {
  const base = mapById(baseEntries, 'base');
  const current = mapById(currentEntries, 'current');
  const source = mapById(sourceEntries, 'source');
  const ids = new Set([...base.keys(), ...current.keys(), ...source.keys()]);
  const merged = [];
  const conflicts = [];
  let imported = 0;
  for (const id of ids) {
    const result = mergeJson(base.get(id), current.get(id), source.get(id), `finding:${id}`);
    if (result.value !== undefined) merged.push(result.value);
    if (!current.has(id) && source.has(id)) imported += 1;
    conflicts.push(...result.conflicts);
  }
  return { entries: merged, conflicts, imported };
}

function ledgerPayload(entry) {
  const { hash, prevHash, ...payload } = entry;
  return payload;
}

function ledgerFingerprint(entry) {
  return createHash('sha256').update(stable(ledgerPayload(entry))).digest('hex');
}

export function ledgerSuffix(baseEntries, sourceEntries) {
  if (sourceEntries.length < baseEntries.length) throw new Error('ledger source é menor que o ledger base');
  for (let i = 0; i < baseEntries.length; i += 1) {
    if (baseEntries[i]?.hash !== sourceEntries[i]?.hash) {
      throw new Error(`ledger source não deriva do base (divergência no índice ${i})`);
    }
  }
  return sourceEntries.slice(baseEntries.length);
}

export function appendLedgerEvents(currentEntries, sourceSuffix, {
  excludedTypes = new Set(['bugbounty_runtime_job']),
} = {}) {
  const output = [...currentEntries];
  const seen = new Set(currentEntries.map(ledgerFingerprint));
  let imported = 0;
  let skippedRuntime = 0;
  let skippedDuplicate = 0;
  for (const sourceEntry of sourceSuffix) {
    if (excludedTypes.has(sourceEntry.type)) {
      skippedRuntime += 1;
      continue;
    }
    const payload = ledgerPayload(sourceEntry);
    const fingerprint = ledgerFingerprint(sourceEntry);
    if (seen.has(fingerprint)) {
      skippedDuplicate += 1;
      continue;
    }
    const prevHash = output.length ? output.at(-1).hash : '0'.repeat(64);
    const record = { ...payload, prevHash };
    const hash = createHash('sha256').update(JSON.stringify(record)).digest('hex');
    output.push({ ...record, hash });
    seen.add(fingerprint);
    imported += 1;
  }
  return { entries: output, imported, skippedRuntime, skippedDuplicate };
}

function parseJsonl(text) {
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function renderJsonl(entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function show(repoRoot, ref, relativePath) {
  return git(repoRoot, ['show', `${ref}:${relativePath}`]);
}

function readJsonAtRef(repoRoot, ref, relativePath) {
  return JSON.parse(show(repoRoot, ref, relativePath));
}

function readJsonlAtRef(repoRoot, ref, relativePath) {
  return parseJsonl(show(repoRoot, ref, relativePath));
}

export function reconcileSharedState({ repoRoot = DEFAULT_REPO_ROOT, sourceRef, baseRef = null } = {}) {
  if (!sourceRef) throw new Error('sourceRef é obrigatório');
  const dirty = git(repoRoot, ['status', '--porcelain']);
  if (dirty) throw new Error(`worktree precisa estar limpo antes da reconciliação: ${dirty.split('\n')[0]}`);
  const resolvedBase = baseRef || git(repoRoot, ['merge-base', 'HEAD', sourceRef]);

  const queuePath = 'research/bugbounty/queue.jsonl';
  const seenPath = 'research/bugbounty/scanner-seen.json';
  const repoShasPath = 'research/bugbounty/scanner-seen-repo-shas.json';
  const verdictsPath = 'research/bugbounty/scanner-seen-verdicts.json';
  const ledgerPath = 'ledger/ledger.research.jsonl';

  const baseQueue = readJsonlAtRef(repoRoot, resolvedBase, queuePath);
  const currentQueue = parseJsonl(readFileSync(path.join(repoRoot, queuePath), 'utf8'));
  const sourceQueue = readJsonlAtRef(repoRoot, sourceRef, queuePath);
  const queue = mergeQueueEntries(baseQueue, currentQueue, sourceQueue);

  const jsonMerges = [];
  for (const relativePath of [repoShasPath, verdictsPath]) {
    const result = mergeJson(
      readJsonAtRef(repoRoot, resolvedBase, relativePath),
      JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')),
      readJsonAtRef(repoRoot, sourceRef, relativePath),
      relativePath,
    );
    jsonMerges.push({ relativePath, ...result });
  }

  const currentSeen = JSON.parse(readFileSync(path.join(repoRoot, seenPath), 'utf8'));
  const sourceSeen = readJsonAtRef(repoRoot, sourceRef, seenPath);
  const mergedSeen = [...new Set([...currentSeen, ...sourceSeen])].sort();

  const baseLedger = readJsonlAtRef(repoRoot, resolvedBase, ledgerPath);
  const currentLedger = parseJsonl(readFileSync(path.join(repoRoot, ledgerPath), 'utf8'));
  const sourceLedger = readJsonlAtRef(repoRoot, sourceRef, ledgerPath);
  const suffix = ledgerSuffix(baseLedger, sourceLedger);
  const ledger = appendLedgerEvents(currentLedger, suffix);

  const conflicts = [...queue.conflicts, ...jsonMerges.flatMap((item) => item.conflicts)];
  if (conflicts.length) {
    const sample = conflicts.slice(0, 10).map((conflict) => conflict.path).join(', ');
    throw new Error(`${conflicts.length} conflito(s) semântico(s); nenhum arquivo foi escrito: ${sample}`);
  }

  writeFileSync(path.join(repoRoot, queuePath), renderJsonl(queue.entries), 'utf8');
  writeFileSync(path.join(repoRoot, seenPath), `${JSON.stringify(mergedSeen, null, 2)}\n`, 'utf8');
  for (const item of jsonMerges) {
    writeFileSync(path.join(repoRoot, item.relativePath), `${JSON.stringify(item.value, null, 2)}\n`, 'utf8');
  }
  writeFileSync(path.join(repoRoot, ledgerPath), renderJsonl(ledger.entries), 'utf8');

  return {
    sourceRef,
    baseRef: resolvedBase,
    queueImported: queue.imported,
    seenAdded: mergedSeen.length - currentSeen.length,
    ledgerImported: ledger.imported,
    runtimeEventsExcluded: ledger.skippedRuntime,
    duplicateLedgerEventsSkipped: ledger.skippedDuplicate,
  };
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const sourceArg = process.argv.find((arg) => arg.startsWith('--source-ref='));
  const baseArg = process.argv.find((arg) => arg.startsWith('--base-ref='));
  try {
    const result = reconcileSharedState({
      sourceRef: sourceArg?.slice('--source-ref='.length),
      baseRef: baseArg?.slice('--base-ref='.length) || null,
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, reason: error.message }, null, 2));
    process.exitCode = 1;
  }
}
