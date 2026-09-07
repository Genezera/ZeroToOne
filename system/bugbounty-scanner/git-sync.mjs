// Sincronização git resiliente pros dois processos agendados (scanner
// diário, descoberta semanal) que rodam sozinhos, sem ninguém olhando.
//
// Motivo de existir: achado real em logs/bugbounty-scanner.log
// (2026-08-30T12:21:37Z) -- o scanner tentou `git push` direto, sem
// puxar antes, e foi rejeitado porque a sessão de nuvem tinha
// empurrado commits no meio tempo (`! [rejected] master -> master
// (fetch first)`). O código só logava um aviso e desistia -- sem
// tentar de novo, sem sequer ter puxado o trabalho da nuvem antes de
// rodar. Isso significa que a tarefa agendada local podia (a) escanear
// em cima de um estado desatualizado e (b) perder o próprio commit se
// a corrida acontecesse, silenciosamente, todo santo dia que a nuvem
// empurrasse algo por perto do horário fixo da tarefa.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { inspectStagedPublication } from './publication-secret-gate.mjs';
import { repairChainFile } from '../ledger/ledger.mjs';

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }).trim();
}

export function inspectGitState(repoRoot) {
  const dirty = git(repoRoot, ['status', '--porcelain']);
  let ahead = null;
  let behind = null;
  try {
    const [behindText, aheadText] = git(repoRoot, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).split(/\s+/);
    behind = Number(behindText);
    ahead = Number(aheadText);
  } catch {
    // A mensagem principal de pull/push vai explicar upstream ausente.
  }
  return { clean: dirty.length === 0, dirty, ahead, behind };
}

/** Chamar ANTES de qualquer job que produza estado compartilhado.
 * Falha fechada: pesquisar em snapshot velho gera trabalho duplicado e
 * torna o ledger append-only impossível de reconciliar corretamente. */
export function pullLatest(repoRoot, log = () => {}) {
  const before = inspectGitState(repoRoot);
  if (!before.clean) {
    const reason = `worktree contém mudanças antes da rodada: ${before.dirty.split('\n').slice(0, 5).join(', ')}`;
    log(`ERRO: ${reason} -- rodada bloqueada para não capturar alterações alheias nem pesquisar estado obsoleto.`);
    return { ok: false, reason, state: before };
  }
  try {
    git(repoRoot, ['pull', '--ff-only']);
    return { ok: true, state: inspectGitState(repoRoot) };
  } catch (err) {
    const reason = `git pull --ff-only falhou: ${err.message.split('\n')[0]}`;
    log(`ERRO: ${reason} -- rodada bloqueada (fail-closed).`);
    return { ok: false, reason, state: inspectGitState(repoRoot) };
  }
}

/** git add -A + commit (se houver algo pra commitar) + push, com UMA
 * tentativa de recuperação (pull + push de novo) se o push inicial for
 * rejeitado por divergência. Se a recuperação também falhar (conflito
 * de verdade, não só divergência limpa), aborta qualquer merge parcial
 * e desiste desta rodada sem deixar o repositório num estado quebrado
 * pra próxima execução. */
export function commitAndPush(repoRoot, message, log = () => {}) {
  try {
    git(repoRoot, ['add', '-A']);
    const status = git(repoRoot, ['status', '--porcelain']);
    if (!status) return { ok: true, committed: false };
    const publication = inspectStagedPublication(repoRoot);
    if (!publication.ok) {
      log(`ERRO: ${publication.reason}; ${publication.findings.length} ocorrência(s). Nenhum valor sensível é incluído neste diagnóstico.`);
      return { ok: false, committed: false, blockedBy: 'publication-secret-gate',
        reason: publication.reason, publication };
    }
    git(repoRoot, ['commit', '-m', message]);
  } catch (err) {
    return { ok: false, committed: false, reason: `commit falhou: ${err.message.split('\n')[0]}` };
  }

  try {
    git(repoRoot, ['push']);
    return { ok: true, committed: true, recovered: false };
  } catch (pushErr) {
    log(`AVISO: git push falhou (provável divergência por corrida com outro produtor) -- tentando rebase + push uma vez: ${pushErr.message.split('\n')[0]}`);
    try {
      git(repoRoot, ['pull', '--rebase']);
    } catch (pullErr) {
      log(`ERRO: rebase de recuperação conflitou -- abortando e preservando o commit local para reconciliação: ${pullErr.message.split('\n')[0]}`);
      try { git(repoRoot, ['rebase', '--abort']); } catch { /* nada pra abortar */ }
      return { ok: false, committed: true, requiresRecovery: true, reason: `rebase de recuperação falhou: ${pullErr.message.split('\n')[0]}`, state: inspectGitState(repoRoot) };
    }
    const ledgerRepair = repairChainFile(path.join(repoRoot, 'ledger', 'ledger.research.jsonl'));
    if (ledgerRepair.repaired) {
      log(`AVISO: dois sufixos concorrentes do ledger foram reencadeados a partir do índice ${ledgerRepair.repairedFrom}; payloads preservados.`);
      try {
        git(repoRoot, ['add', '--', 'ledger/ledger.research.jsonl']);
        const publication = inspectStagedPublication(repoRoot);
        if (!publication.ok) {
          return { ok: false, committed: true, requiresRecovery: true,
            blockedBy: 'publication-secret-gate', reason: publication.reason, publication };
        }
        git(repoRoot, ['commit', '--amend', '--no-edit']);
      } catch (repairErr) {
        return { ok: false, committed: true, requiresRecovery: true,
          reason: `reparo do ledger após rebase falhou: ${repairErr.message.split('\n')[0]}`, state: inspectGitState(repoRoot) };
      }
    }
    try {
      git(repoRoot, ['push']);
      log('Push recuperado depois de rebasear sobre origin.');
      return { ok: true, committed: true, recovered: true };
    } catch (retryErr) {
      return { ok: false, committed: true, requiresRecovery: true, reason: `push continuou falhando após rebase: ${retryErr.message.split('\n')[0]}`, state: inspectGitState(repoRoot) };
    }
  }
}
