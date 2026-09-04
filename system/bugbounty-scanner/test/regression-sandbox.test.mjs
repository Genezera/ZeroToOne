import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildDockerArgs, parseRegressionMarker, runContainerCheck, validateRegressionConfig,
  validateLongstandingExposureConfig,
} from '../regression-sandbox.mjs';

const base = {
  repositoryUrl: 'https://github.com/example/project',
  introducedCommit: 'a'.repeat(40),
  parentCommit: 'b'.repeat(40),
  runtime: 'node22',
  command: 'node poc.mjs',
};

test('config de regressão aceita apenas GitHub público, SHA completo, runtime e workdir seguros', () => {
  const valid = validateRegressionConfig(base);
  assert.equal(valid.repositoryUrl, 'https://github.com/example/project.git');
  assert.equal(valid.validationScope, 'component');
  assert.equal(validateRegressionConfig({ ...base, validationScope: 'end_to_end' }).validationScope, 'end_to_end');
  assert.throws(() => validateRegressionConfig({ ...base, repositoryUrl: 'http://github.com/example/project' }), /somente/);
  assert.throws(() => validateRegressionConfig({ ...base, repositoryUrl: 'https://gitlab.com/example/project' }), /somente/);
  assert.throws(() => validateRegressionConfig({ ...base, introducedCommit: 'abc' }), /SHAs completos/);
  assert.throws(() => validateRegressionConfig({ ...base, runtime: 'custom-image' }), /runtime não permitido/);
  assert.throws(() => validateRegressionConfig({ ...base, workdir: '../escape' }), /workdir/);
  assert.throws(() => validateRegressionConfig({ ...base, command: 'echo ok\necho bad' }), /uma linha/);
  assert.throws(() => validateRegressionConfig({ ...base, validationScope: 'marketing' }), /validationScope/);
});

test('config de exposição de longa data aceita só GitHub público e SHA completo (não precisa runtime/command -- não executa nada)', () => {
  const valid = validateLongstandingExposureConfig({
    repositoryUrl: 'https://github.com/example/project', introducedCommit: 'a'.repeat(40),
  });
  assert.equal(valid.repositoryUrl, 'https://github.com/example/project.git');
  assert.equal(valid.introducedCommit, 'a'.repeat(40));
  assert.throws(() => validateLongstandingExposureConfig({ repositoryUrl: 'http://github.com/example/project', introducedCommit: 'a'.repeat(40) }), /somente/);
  assert.throws(() => validateLongstandingExposureConfig({ repositoryUrl: 'https://gitlab.com/example/project', introducedCommit: 'a'.repeat(40) }), /somente/);
  assert.throws(() => validateLongstandingExposureConfig({ repositoryUrl: 'https://github.com/example/project', introducedCommit: 'abc' }), /SHA completo/);
  assert.throws(() => validateLongstandingExposureConfig(null), /objeto JSON/);
});

test('marcador exige exatamente um veredito explícito em linha isolada', () => {
  assert.equal(parseRegressionMarker('diagnóstico\nZTO_RESULT=VULNERABLE\n'), 'vulnerable');
  assert.equal(parseRegressionMarker('ZTO_RESULT=NOT_VULNERABLE\n'), 'not_vulnerable');
  assert.throws(() => parseRegressionMarker('texto sem marcador'), /não emitiu/);
  assert.throws(() => parseRegressionMarker('ZTO_RESULT=VULNERABLE\nZTO_RESULT=NOT_VULNERABLE'), /contraditórios/);
  assert.throws(() => parseRegressionMarker('prefixo ZTO_RESULT=VULNERABLE'), /não emitiu/);
});

test('linha Docker não recebe segredos e aplica isolamento obrigatório', () => {
  const args = buildDockerArgs({ image: 'node:test', checkoutPath: 'C:\\checkout', command: 'node poc.mjs' });
  const joined = args.join(' ');
  assert.match(joined, /--network none/);
  assert.match(joined, /--read-only/);
  assert.match(joined, /--cap-drop ALL/);
  assert.match(joined, /no-new-privileges/);
  assert.match(joined, /--pids-limit 128/);
  assert.match(joined, /--cpus 1/);
  assert.match(joined, /--memory 1g/);
  assert.match(joined, /--user 65534:65534/);
  assert.doesNotMatch(joined, /HACKERONE|TELEGRAM|GITHUB_TOKEN/);
});

test('integração Docker executa PoC simples sem rede e classifica o marcador', { timeout: 180_000 }, (t) => {
  const docker = process.env.DOCKER_EXE || 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
  const dir = mkdtempSync(path.join(tmpdir(), 'zto-docker-test-'));
  try {
    const result = runContainerCheck(validateRegressionConfig({ ...base, command: "printf 'ZTO_RESULT=NOT_VULNERABLE\\n'" }), dir, { docker });
    assert.equal(result.result, 'not_vulnerable');
    assert.match(result.isolation, /no-network/);
  } catch (error) {
    if (/ENOENT|pipe|daemon|image|pull access denied/i.test(error.message)) t.skip(`Docker indisponível: ${error.message}`);
    else throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
