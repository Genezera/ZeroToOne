import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pullLatest, commitAndPush } from '../git-sync.mjs';

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: 'pipe' }).toString();
}

function initRepoWithRemote() {
  const root = mkdtempSync(path.join(tmpdir(), 'zto-git-sync-test-'));
  const originDir = path.join(root, 'origin.git');
  const cloneADir = path.join(root, 'clone-a');
  const cloneBDir = path.join(root, 'clone-b');

  sh(`git init --bare "${originDir}"`, root);
  sh(`git clone "${originDir}" "${cloneADir}"`, root);
  sh('git config user.email "a@test.local"', cloneADir);
  sh('git config user.name "Clone A"', cloneADir);
  writeFileSync(path.join(cloneADir, 'seed.txt'), 'seed\n', 'utf8');
  sh('git add -A', cloneADir);
  sh('git commit -m "seed"', cloneADir);
  sh('git push', cloneADir);

  sh(`git clone "${originDir}" "${cloneBDir}"`, root);
  sh('git config user.email "b@test.local"', cloneBDir);
  sh('git config user.name "Clone B"', cloneBDir);

  return { root, originDir, cloneADir, cloneBDir };
}

function cleanup(root) {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch { /* limpeza best-effort */ }
}

test('commitAndPush: sem nada pra commitar, devolve ok sem tentar push', () => {
  const { root, cloneADir } = initRepoWithRemote();
  try {
    const logs = [];
    const result = commitAndPush(cloneADir, 'não deveria aparecer', (m) => logs.push(m));
    assert.equal(result.ok, true);
    assert.equal(result.committed, false);
    assert.deepEqual(logs, []);
  } finally {
    cleanup(root);
  }
});

test('commitAndPush: commit real, push real, sem divergência', () => {
  const { root, cloneADir, originDir } = initRepoWithRemote();
  try {
    writeFileSync(path.join(cloneADir, 'novo.txt'), 'conteudo\n', 'utf8');
    const result = commitAndPush(cloneADir, 'commit de teste', () => {});
    assert.equal(result.ok, true);
    assert.equal(result.committed, true);
    assert.equal(result.recovered, false);
    const log = sh('git log --oneline', originDir);
    assert.match(log, /commit de teste/);
  } finally {
    cleanup(root);
  }
});

test('commitAndPush: recupera de push rejeitado puxando e tentando de novo (cenário real de corrida com a nuvem)', () => {
  const { root, cloneADir, cloneBDir, originDir } = initRepoWithRemote();
  try {
    // Clone B (simula a sessão de nuvem) empurra primeiro.
    writeFileSync(path.join(cloneBDir, 'da-nuvem.txt'), 'trabalho da nuvem\n', 'utf8');
    sh('git add -A', cloneBDir);
    sh('git commit -m "trabalho da nuvem"', cloneBDir);
    sh('git push', cloneBDir);

    // Clone A (simula a tarefa agendada local) está desatualizado --
    // NÃO deu pull antes, exatamente o bug real que este módulo existe
    // pra corrigir -- e tenta empurrar seu próprio commit.
    writeFileSync(path.join(cloneADir, 'do-scanner.txt'), 'trabalho do scanner\n', 'utf8');
    const logs = [];
    const result = commitAndPush(cloneADir, 'trabalho do scanner', (m) => logs.push(m));

    assert.equal(result.ok, true, `esperava recuperação bem-sucedida, motivo da falha se houver: ${result.reason}`);
    assert.equal(result.committed, true);
    assert.equal(result.recovered, true);
    assert.ok(logs.some((l) => l.includes('divergência')), 'deveria logar que detectou a divergência');
    assert.ok(logs.some((l) => l.includes('recuperado')), 'deveria logar a recuperação bem-sucedida');

    // Os DOIS commits (nuvem + scanner) precisam estar em origin agora.
    const log = sh('git log --oneline', originDir);
    assert.match(log, /trabalho da nuvem/);
    assert.match(log, /trabalho do scanner/);
  } finally {
    cleanup(root);
  }
});

test('pullLatest: repositório sem remote configurado não derruba a chamada, só loga e devolve ok:false', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zto-git-sync-test-'));
  try {
    sh('git init', root);
    sh('git config user.email "x@test.local"', root);
    sh('git config user.name "X"', root);
    const logs = [];
    const result = pullLatest(root, (m) => logs.push(m));
    assert.equal(result.ok, false);
    assert.ok(logs.length > 0);
  } finally {
    cleanup(root);
  }
});

test('pullLatest: puxa de verdade quando há commit novo no remote', () => {
  const { root, cloneADir, cloneBDir, originDir } = initRepoWithRemote();
  try {
    writeFileSync(path.join(cloneBDir, 'da-nuvem.txt'), 'x\n', 'utf8');
    sh('git add -A', cloneBDir);
    sh('git commit -m "da nuvem"', cloneBDir);
    sh('git push', cloneBDir);

    const result = pullLatest(cloneADir, () => {});
    assert.equal(result.ok, true);
    assert.equal(existsSync(path.join(cloneADir, 'da-nuvem.txt')), true);
  } finally {
    cleanup(root);
  }
});
