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

import { execSync } from 'node:child_process';

/** Chamar ANTES de escanear -- nunca bloqueia a rodada se falhar (rede
 * fora, conflito impossível de resolver sozinho): só loga e segue com
 * o que já existe localmente, mesmo comportamento de degradação
 * graciosa já usado pro Telegram no resto do projeto. */
export function pullLatest(repoRoot, log = () => {}) {
  try {
    execSync('git pull --no-rebase --no-edit', { cwd: repoRoot, stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    log(`AVISO: git pull antes da rodada falhou (${err.message.split('\n')[0]}) -- seguindo com o estado local atual`);
    return { ok: false, reason: err.message };
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
    execSync('git add -A', { cwd: repoRoot });
    const status = execSync('git status --porcelain', { cwd: repoRoot }).toString().trim();
    if (!status) return { ok: true, committed: false };
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: repoRoot });
  } catch (err) {
    return { ok: false, committed: false, reason: `commit falhou: ${err.message.split('\n')[0]}` };
  }

  try {
    execSync('git push', { cwd: repoRoot, stdio: 'pipe' });
    return { ok: true, committed: true, recovered: false };
  } catch (pushErr) {
    log(`AVISO: git push falhou (provável divergência com origin) -- tentando pull + push uma vez: ${pushErr.message.split('\n')[0]}`);
    try {
      execSync('git pull --no-rebase --no-edit', { cwd: repoRoot, stdio: 'pipe' });
    } catch (pullErr) {
      log(`AVISO: pull de recuperação falhou (provável conflito de verdade) -- abortando merge parcial e desistindo desta rodada: ${pullErr.message.split('\n')[0]}`);
      try { execSync('git merge --abort', { cwd: repoRoot, stdio: 'pipe' }); } catch { /* nada pra abortar, ok */ }
      return { ok: false, committed: true, reason: `pull de recuperação falhou: ${pullErr.message.split('\n')[0]}` };
    }
    try {
      execSync('git push', { cwd: repoRoot, stdio: 'pipe' });
      log('Push recuperado depois de sincronizar com origin.');
      return { ok: true, committed: true, recovered: true };
    } catch (retryErr) {
      return { ok: false, committed: true, reason: `push continuou falhando após pull: ${retryErr.message.split('\n')[0]}` };
    }
  }
}
