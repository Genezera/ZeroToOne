import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackageLockJson, parseGoMod, parseGradleDeps, parseManifest, buildDependencyFinding } from '../dep-scanner.mjs';

test('parsePackageLockJson lê lockfile v2/v3 (campo packages, com escopo)', () => {
  const content = JSON.stringify({
    packages: {
      '': { name: 'root' },
      'node_modules/lodash': { version: '4.17.15' },
      'node_modules/@babel/core': { version: '7.20.0' },
      'node_modules/foo/node_modules/lodash': { version: '4.17.21' },
    },
  });
  const deps = parsePackageLockJson(content);
  assert.deepEqual(
    deps.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: '@babel/core', version: '7.20.0', ecosystem: 'npm' },
      { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
      { name: 'lodash', version: '4.17.21', ecosystem: 'npm' },
    ]
  );
});

test('parsePackageLockJson lê lockfile v1 (campo dependencies)', () => {
  const content = JSON.stringify({ dependencies: { lodash: { version: '4.17.15' } } });
  const deps = parsePackageLockJson(content);
  assert.deepEqual(deps, [{ name: 'lodash', version: '4.17.15', ecosystem: 'npm' }]);
});

test('parsePackageLockJson NÃO quebra com JSON inválido', () => {
  assert.deepEqual(parsePackageLockJson('{ isso não é json'), []);
});

test('parseGoMod lê require em bloco', () => {
  const content = `
module example.com/foo

go 1.21

require (
	github.com/gin-gonic/gin v1.6.0
	github.com/pkg/errors v0.9.1 // indirect
)
`;
  const deps = parseGoMod(content);
  assert.deepEqual(deps, [
    { name: 'github.com/gin-gonic/gin', version: 'v1.6.0', ecosystem: 'Go' },
    { name: 'github.com/pkg/errors', version: 'v0.9.1', ecosystem: 'Go' },
  ]);
});

test('parseGoMod lê require de linha única', () => {
  const content = `require github.com/gin-gonic/gin v1.6.0`;
  assert.deepEqual(parseGoMod(content), [{ name: 'github.com/gin-gonic/gin', version: 'v1.6.0', ecosystem: 'Go' }]);
});

test('parseGradleDeps acha padrão literal "grupo:artefato:versão"', () => {
  const content = `
dependencies {
    implementation "org.apache.logging.log4j:log4j-core:2.14.1"
    testImplementation 'junit:junit:4.13.2'
}
`;
  const deps = parseGradleDeps(content);
  assert.deepEqual(deps, [
    { name: 'org.apache.logging.log4j:log4j-core', version: '2.14.1', ecosystem: 'Maven' },
    { name: 'junit:junit', version: '4.13.2', ecosystem: 'Maven' },
  ]);
});

test('parseGradleDeps NÃO tenta resolver catálogo de versão/variável', () => {
  const content = `implementation(libs.log4j.core)`;
  assert.deepEqual(parseGradleDeps(content), []);
});

test('parseManifest despacha pelo nome do arquivo', () => {
  assert.equal(parseManifest('a/b/go.mod', 'require github.com/x/y v1.0.0').length, 1);
  assert.equal(parseManifest('a/build.gradle', '"a:b:1.0.0"').length, 1);
  assert.equal(parseManifest('a/README.md', 'nada aqui').length, 0);
});

test('buildDependencyFinding monta achado no formato da fila compartilhada', () => {
  const finding = buildDependencyFinding(
    { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
    { id: 'GHSA-29mw-wpgm-hmr9', summary: 'ReDoS in lodash' },
    'vercel/flags/package-lock.json',
    0
  );
  assert.equal(finding.type, 'known_vulnerable_dependency');
  assert.equal(finding.language, 'js');
  assert.equal(finding.osvId, 'GHSA-29mw-wpgm-hmr9');
  assert.ok(finding.note.includes('lodash@4.17.15'));
  assert.ok(finding.note.includes('GHSA-29mw-wpgm-hmr9'));
});

test('buildDependencyFinding menciona vulnerabilidades extras quando há mais de uma', () => {
  const finding = buildDependencyFinding(
    { name: 'foo', version: '1.0.0', ecosystem: 'Go' },
    { id: 'GHSA-xxxx', summary: 'algo' },
    'x/y/go.mod',
    2
  );
  assert.ok(finding.note.includes('+ 2 outra'));
  assert.equal(finding.language, 'go');
});
