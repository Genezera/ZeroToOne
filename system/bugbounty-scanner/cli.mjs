import { openDb, upsertFinding, getFinding, listFindings, recordTransition, recordValidation, recordDeploymentEvidence, recordReport, stateCounts, exportFindingsToQueueJsonl, closeDb } from './db.mjs';
import { loadSnapshot, scopeGate } from './scope-registry.mjs';
import path from 'node:path';

// CLI que dá ao agente de nuvem (só Bash/Read/Write/Edit/Glob/Grep, sem
// acesso MCP ao banco) uma forma estruturada de mudar estado — em vez de
// "reescreva a linha em queue.jsonl" (schema livre, sem checagem). Toda
// transição passa pela mesma validação de state-machine.mjs que o resto
// do sistema usa; o CLI não contorna a precondição, só empacota o
// contexto que ela pede.

const DB_PATH = path.join('research', 'bugbounty', 'zerotoone.db');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) flags[arg.slice(2)] = true;
      else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function parseJsonFlag(flags, name, fallback = {}) {
  if (!flags[name]) return fallback;
  try {
    return JSON.parse(flags[name]);
  } catch (e) {
    throw new Error(`--${name} precisa ser JSON válido: ${e.message}`);
  }
}

export function cmdListPending(db) {
  return listFindings(db, { state: 'candidate' });
}

export function cmdStatus(db) {
  return stateCounts(db);
}

export function cmdUpsertFinding(db, patch) {
  if (!patch.id) throw new Error('patch precisa ter "id"');
  const existing = getFinding(db, patch.id);
  const merged = existing ? { ...existing.raw, ...existing, ...patch } : { state: 'candidate', ...patch };
  return upsertFinding(db, merged);
}

export function cmdUpdateFinding(db, id, patch) {
  const existing = getFinding(db, id);
  if (!existing) throw new Error(`finding "${id}" não existe`);
  return upsertFinding(db, { ...existing.raw, ...existing, ...patch, id });
}

export function cmdTransition(db, id, toState, actor, context) {
  return recordTransition(db, id, toState, { actor, context });
}

export function cmdRecordValidation(db, id, { type, result, command, output }) {
  return recordValidation(db, id, { type, result, command, rawOutput: output });
}

export function cmdRecordDeploymentEvidence(db, id, patch) {
  if (!patch.confidence) throw new Error('deployment evidence precisa de "confidence" (unverified|low|medium|high)');
  return recordDeploymentEvidence(db, id, patch);
}

export function cmdRecordReport(db, id, reportPath) {
  return recordReport(db, id, reportPath);
}

export function cmdCheckScope(program, assetRef) {
  const snapshot = loadSnapshot(program);
  return scopeGate(snapshot, assetRef);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);

  if (command === 'check-scope') {
    const [program, assetRef] = positional;
    printJson(cmdCheckScope(program, assetRef));
    return;
  }

  const db = openDb(DB_PATH);
  try {
    switch (command) {
      case 'list-pending':
        printJson(cmdListPending(db));
        break;
      case 'status':
        printJson(cmdStatus(db));
        break;
      case 'get': {
        printJson(getFinding(db, positional[0]));
        break;
      }
      case 'upsert-finding':
        printJson(cmdUpsertFinding(db, parseJsonFlag(flags, 'patch')));
        break;
      case 'update-finding':
        printJson(cmdUpdateFinding(db, positional[0], parseJsonFlag(flags, 'patch')));
        break;
      case 'transition':
        printJson(cmdTransition(db, positional[0], positional[1], flags.actor || 'unknown', parseJsonFlag(flags, 'context')));
        break;
      case 'record-validation':
        printJson(cmdRecordValidation(db, positional[0], { type: flags.type, result: flags.result, command: flags.command, output: flags.output }));
        break;
      case 'record-deployment-evidence':
        printJson(cmdRecordDeploymentEvidence(db, positional[0], parseJsonFlag(flags, 'patch')));
        break;
      case 'record-report':
        printJson(cmdRecordReport(db, positional[0], positional[1]));
        break;
      case 'export-queue': {
        const queuePath = positional[0] || path.join('research', 'bugbounty', 'queue.jsonl');
        const n = exportFindingsToQueueJsonl(db, queuePath);
        printJson({ exported: n, path: queuePath });
        break;
      }
      default:
        console.error(`Comando desconhecido: "${command}". Comandos: list-pending, status, get <id>, upsert-finding --patch='{...}', update-finding <id> --patch='{...}', transition <id> <toState> --actor=X --context='{...}', record-validation <id> --type=X --result=pass|fail|not_applicable --output="...", record-deployment-evidence <id> --patch='{...}', record-report <id> <path>, export-queue [path], check-scope <program> <assetRef>`);
        process.exitCode = 1;
    }
  } finally {
    closeDb(db);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('cli.mjs');
if (isMain) {
  main().catch((err) => {
    console.error('Erro:', err.message);
    process.exitCode = 1;
  });
}
