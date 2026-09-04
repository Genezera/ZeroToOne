import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Runtime telemetry is deliberately local and untracked. Research evidence
 * belongs in the hash-chained ledger; five-minute service heartbeats do not.
 * Keeping the two separate prevents the coordinator from dirtying the shared
 * Git worktree immediately after a successful push.
 */
export function appendRuntimeEvent(filePath, event, { now = () => new Date() } = {}) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const ts = now().toISOString();
  appendFileSync(filePath, `${JSON.stringify({ ...event, ts })}\n`, 'utf8');
  return { ...event, ts };
}
