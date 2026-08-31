import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDependencyManifest, prioritizeFilesForScan } from '../fetch-repo.mjs';

test('isDependencyManifest reconhece os 4 nomes de manifesto suportados', () => {
  assert.ok(isDependencyManifest('a/b/package-lock.json'));
  assert.ok(isDependencyManifest('go.mod'));
  assert.ok(isDependencyManifest('module/build.gradle'));
  assert.ok(isDependencyManifest('module/build.gradle.kts'));
});

test('isDependencyManifest ignora arquivo que não é manifesto', () => {
  assert.equal(isDependencyManifest('a/package.json'), false);
  assert.equal(isDependencyManifest('a/README.md'), false);
});

test('isDependencyManifest ignora manifesto dentro de diretório excluído (node_modules, vendor, etc.)', () => {
  assert.equal(isDependencyManifest('a/node_modules/foo/package-lock.json'), false);
  assert.equal(isDependencyManifest('vendor/go.mod'), false);
});

test('isDependencyManifest ignora manifesto dentro de fixture de teste (achado real do dia: wire-gradle-plugin/src/test/projects/.../build.gradle)', () => {
  assert.equal(isDependencyManifest('wire-gradle-plugin/src/test/projects/android-kotlin-ksp-source-set/build.gradle'), false);
  assert.equal(isDependencyManifest('pkg/testdata/build.gradle'), false);
});

function f(path) {
  return { path, sha: 'x' };
}

test('prioritizeFilesForScan põe arquivo nunca visto antes de arquivo já visto', () => {
  const files = [f('a.go'), f('b.go'), f('c.go')];
  const result = prioritizeFilesForScan(files, new Set(['a.go']));
  assert.deepEqual(result.map((x) => x.path), ['b.go', 'c.go', 'a.go']);
});

test('prioritizeFilesForScan mantém a ordem original dentro de cada grupo (estável)', () => {
  const files = [f('z.go'), f('a.go'), f('m.go')];
  const result = prioritizeFilesForScan(files, new Set(['a.go']));
  assert.deepEqual(result.map((x) => x.path), ['z.go', 'm.go', 'a.go']);
});

test('prioritizeFilesForScan sem nenhum arquivo visto ainda mantém a ordem original (primeira rodada de um alvo novo)', () => {
  const files = [f('z.go'), f('a.go'), f('m.go')];
  const result = prioritizeFilesForScan(files, new Set());
  assert.deepEqual(result.map((x) => x.path), ['z.go', 'a.go', 'm.go']);
});

test('prioritizeFilesForScan com TUDO já visto (repo pequeno, cobertura completa há tempos) mantém a ordem original', () => {
  const files = [f('z.go'), f('a.go'), f('m.go')];
  const result = prioritizeFilesForScan(files, new Set(['a.go', 'm.go', 'z.go']));
  assert.deepEqual(result.map((x) => x.path), ['z.go', 'a.go', 'm.go']);
});

test('prioritizeFilesForScan: reprodução do bug real (okx/go-wallet-sdk) -- depois de 3 rodadas com teto 450, os 1001 arquivos são todos vistos pelo menos uma vez', () => {
  const files = Array.from({ length: 1001 }, (_, i) => f(`file-${String(i).padStart(4, '0')}.go`));
  const seen = new Set();
  const CAP = 450;
  for (let round = 0; round < 3; round++) {
    const ordered = prioritizeFilesForScan(files, seen);
    const thisRound = ordered.slice(0, CAP);
    thisRound.forEach((x) => seen.add(x.path));
  }
  assert.equal(seen.size, 1001, 'todo arquivo deveria ter sido visto em até 3 rodadas (450*3 > 1001)');
});
