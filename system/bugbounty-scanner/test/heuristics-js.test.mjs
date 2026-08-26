import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEvalUsage, findCommandInjectionRisk, findReDoSRisk, scanJsSource } from '../heuristics-js.mjs';

test('findEvalUsage acha eval() e new Function()', () => {
  const src = `
    function run(userInput) {
      return eval(userInput);
    }
    const f = new Function('a', 'b', userCode);
  `;
  const findings = findEvalUsage(src, 'x.js');
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.type === 'eval_usage'));
});

test('findEvalUsage NÃO sinaliza código sem eval/Function', () => {
  const src = `function add(a, b) { return a + b; }`;
  assert.equal(findEvalUsage(src, 'x.js').length, 0);
});

test('findCommandInjectionRisk acha exec com template literal interpolado', () => {
  const src = `
    import { exec } from 'child_process';
    function build(branch) {
      exec(\`git checkout \${branch}\`);
    }
  `;
  const findings = findCommandInjectionRisk(src, 'x.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'command_injection_risk');
});

test('findCommandInjectionRisk NÃO sinaliza execFile com array de argumentos', () => {
  const src = `
    import { execFile } from 'child_process';
    execFile('git', ['checkout', branch]);
  `;
  assert.equal(findCommandInjectionRisk(src, 'x.js').length, 0);
});

test('findCommandInjectionRisk NÃO sinaliza exec com string literal fixa', () => {
  const src = `execSync('npm install');`;
  assert.equal(findCommandInjectionRisk(src, 'x.js').length, 0);
});

test('findReDoSRisk acha quantificador aninhado em literal de regex', () => {
  const src = `const re = /(a+)+b/; if (re.test(input)) {}`;
  const findings = findReDoSRisk(src, 'x.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'redos_risk');
});

test('findReDoSRisk NÃO sinaliza regex normal', () => {
  const src = `const re = /^[a-z0-9]+$/i;`;
  assert.equal(findReDoSRisk(src, 'x.js').length, 0);
});

test('findReDoSRisk NÃO confunde divisão matemática com regex', () => {
  const src = `
    const ratio = total / count / weight;
    const avg = sum / values.length;
  `;
  assert.equal(findReDoSRisk(src, 'x.js').length, 0);
});

test('scanJsSource combina as três heurísticas e roda sem quebrar em código limpo', () => {
  const src = `
    export function safeAdd(a, b) {
      return a + b;
    }
    export const ID_RE = /^[a-zA-Z0-9_-]+$/;
  `;
  const findings = scanJsSource(src, 'clean.ts');
  assert.equal(findings.length, 0);
});
