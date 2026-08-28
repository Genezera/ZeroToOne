import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDependencyManifest } from '../fetch-repo.mjs';

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
