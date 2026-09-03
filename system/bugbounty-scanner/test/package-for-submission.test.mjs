import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPackageableState, slugFromReportPath, findScreenshotsDir, buildReadmeContent, packageFinding } from '../package-for-submission.mjs';

test('isPackageableState é true a partir de human_ready em diante, false antes disso', () => {
  assert.equal(isPackageableState('human_ready'), true);
  assert.equal(isPackageableState('submitted'), true);
  assert.equal(isPackageableState('duplicate'), true);
  assert.equal(isPackageableState('candidate'), false);
  assert.equal(isPackageableState('corroborated_static'), false);
  assert.equal(isPackageableState('scope_verified'), false);
});

test('slugFromReportPath tira extensão e diretório', () => {
  assert.equal(slugFromReportPath('research/bugbounty/reports/foo-bar.md'), 'foo-bar');
  assert.equal(slugFromReportPath('C:\\x\\y\\baz.md'), 'baz');
});

test('findScreenshotsDir devolve null quando a pasta não existe', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'pkg-test-'));
  assert.equal(findScreenshotsDir('reports/nao-existe.md', base), null);
});

test('findScreenshotsDir devolve o caminho quando a pasta existe', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'pkg-test-'));
  const dir = path.join(base, 'existe');
  mkdirSync(dir);
  assert.equal(findScreenshotsDir('reports/existe.md', base), dir);
});

test('buildReadmeContent lista os screenshots quando existem', () => {
  const finding = { id: 'X::y::z', program: 'Kubernetes', platform: 'HackerOne', asset: 'a/b', state: 'human_ready' };
  const content = buildReadmeContent(finding, 'report.md', ['a.png', 'b.png']);
  assert.match(content, /report\.md/);
  assert.match(content, /a\.png/);
  assert.match(content, /b\.png/);
  assert.match(content, /Kubernetes/);
});

test('buildReadmeContent avisa honestamente quando não há screenshot nenhum', () => {
  const finding = { id: 'X::y::z', program: 'Kubernetes', platform: 'HackerOne', state: 'human_ready' };
  const content = buildReadmeContent(finding, 'report.md', []);
  assert.match(content, /no screenshots folder found/);
});

test('buildReadmeContent avisa que falta zip quando nenhum foi detectado', () => {
  const finding = { id: 'X::y::z', program: 'Kubernetes', platform: 'HackerOne', state: 'human_ready' };
  const content = buildReadmeContent(finding, 'report.md', []);
  assert.match(content, /- \[ \] Check whether a PoC archive/);
});

test('buildReadmeContent marca o checklist do zip como feito quando um zip é detectado', () => {
  const finding = { id: 'X::y::z', program: 'Kubernetes', platform: 'HackerOne', state: 'human_ready' };
  const content = buildReadmeContent(finding, 'report.md', [], ['poc.zip']);
  assert.match(content, /- \[x\] PoC archive present: `poc\.zip`/);
  assert.match(content, /`poc\.zip` — PoC archive, already in this folder/);
  assert.doesNotMatch(content, /- \[ \] Check whether a PoC archive/);
});

test('packageFinding recusa achado ausente', () => {
  const result = packageFinding(null, { path: 'x.md' });
  assert.equal(result.ok, false);
});

test('packageFinding recusa estado ainda não pronto (ex.: candidate)', () => {
  const result = packageFinding({ id: 'x', state: 'candidate' }, { path: 'x.md' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /human_ready/);
});

test('packageFinding recusa quando não há relatório registrado', () => {
  const result = packageFinding({ id: 'x', state: 'human_ready' }, null);
  assert.equal(result.ok, false);
  assert.match(result.reason, /record-report/);
});

test('packageFinding recusa quando o relatório registrado não existe mais no disco', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'pkg-test-'));
  const result = packageFinding({ id: 'x', state: 'human_ready' }, { path: 'reports/nunca-existiu.md' }, { repoRoot });
  assert.equal(result.ok, false);
  assert.match(result.reason, /não existe mais/);
});

test('packageFinding copia relatório + screenshots pra pasta nova, sem screenshot', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'pkg-test-'));
  const readyDir = path.join(repoRoot, 'ready');
  const screenshotsBase = path.join(repoRoot, 'screenshots');
  mkdirSync(path.join(repoRoot, 'reports'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'reports', 'meu-achado.md'), '# Relatorio real\nconteudo aqui', 'utf8');

  const finding = { id: 'Programa::a/b::fn::tipo', program: 'Programa', platform: 'HackerOne', asset: 'a/b', state: 'human_ready' };
  const report = { path: 'reports/meu-achado.md' };

  const result = packageFinding(finding, report, { readyDir, screenshotsBase, repoRoot });

  assert.equal(result.ok, true);
  assert.equal(result.screenshotCount, 0);
  const destDir = path.join(readyDir, 'meu-achado');
  assert.equal(existsSync(path.join(destDir, 'meu-achado.md')), true);
  assert.equal(readFileSync(path.join(destDir, 'meu-achado.md'), 'utf8'), '# Relatorio real\nconteudo aqui');
  assert.equal(existsSync(path.join(destDir, 'README.md')), true);
});

test('packageFinding copia os screenshots junto quando a pasta existe', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'pkg-test-'));
  const readyDir = path.join(repoRoot, 'ready');
  const screenshotsBase = path.join(repoRoot, 'screenshots');
  mkdirSync(path.join(repoRoot, 'reports'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'reports', 'outro-achado.md'), '# Outro', 'utf8');
  const shotDir = path.join(screenshotsBase, 'outro-achado');
  mkdirSync(shotDir, { recursive: true });
  writeFileSync(path.join(shotDir, '01-fonte.png'), 'fake-png-bytes', 'utf8');
  writeFileSync(path.join(shotDir, '02-run.png'), 'fake-png-bytes-2', 'utf8');

  const finding = { id: 'Programa::x::fn::tipo', program: 'Programa', platform: 'HackerOne', state: 'human_ready' };
  const report = { path: 'reports/outro-achado.md' };

  const result = packageFinding(finding, report, { readyDir, screenshotsBase, repoRoot });

  assert.equal(result.ok, true);
  assert.equal(result.screenshotCount, 2);
  const destDir = path.join(readyDir, 'outro-achado');
  const files = readdirSync(destDir).sort();
  assert.deepEqual(files, ['01-fonte.png', '02-run.png', 'README.md', 'outro-achado.md']);
});

test('packageFinding detecta um zip colocado manualmente na pasta e atualiza o checklist do README na próxima chamada -- regressão real (03/09/2026)', () => {
  // Acontecido de verdade: zip colocado à mão na pasta depois de rodar
  // packageFinding uma vez, relatório revisado, packageFinding rodado
  // de novo pra atualizar o relatório -- o README sobrescrito voltava a
  // dizer "nenhum zip foi colocado aqui" mesmo com o zip bem ali do
  // lado, porque nada olhava o que já existia na pasta antes de
  // reescrever. Este teste reproduz exatamente essa sequência.
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'pkg-test-'));
  const readyDir = path.join(repoRoot, 'ready');
  const screenshotsBase = path.join(repoRoot, 'screenshots');
  mkdirSync(path.join(repoRoot, 'reports'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'reports', 'achado-zip.md'), '# v1', 'utf8');

  const finding = { id: 'Programa::z::fn::tipo', program: 'Programa', platform: 'HackerOne', state: 'human_ready' };
  const report = { path: 'reports/achado-zip.md' };

  // 1ª chamada: sem zip nenhum ainda.
  const first = packageFinding(finding, report, { readyDir, screenshotsBase, repoRoot });
  assert.equal(first.ok, true);
  assert.deepEqual(first.zipFileNames, []);
  let readme = readFileSync(path.join(first.destDir, 'README.md'), 'utf8');
  assert.match(readme, /- \[ \] Check whether a PoC archive/);

  // Usuário coloca o zip à mão na pasta (fora do fluxo do script).
  writeFileSync(path.join(first.destDir, 'poc.zip'), 'fake-zip-bytes', 'utf8');

  // Relatório é revisado, packageFinding roda de novo pra atualizar.
  writeFileSync(path.join(repoRoot, 'reports', 'achado-zip.md'), '# v2 revisado', 'utf8');
  const second = packageFinding(finding, report, { readyDir, screenshotsBase, repoRoot });
  assert.equal(second.ok, true);
  assert.deepEqual(second.zipFileNames, ['poc.zip']);
  readme = readFileSync(path.join(second.destDir, 'README.md'), 'utf8');
  assert.match(readme, /- \[x\] PoC archive present: `poc\.zip`/);
  assert.doesNotMatch(readme, /- \[ \] Check whether a PoC archive/);
  // O relatório em si também foi atualizado, não só o README.
  assert.equal(readFileSync(path.join(second.destDir, 'achado-zip.md'), 'utf8'), '# v2 revisado');
  // O zip continua lá -- packageFinding nunca mexe em .zip, só lê.
  assert.equal(existsSync(path.join(second.destDir, 'poc.zip')), true);
});
