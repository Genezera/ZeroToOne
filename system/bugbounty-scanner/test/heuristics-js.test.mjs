import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEvalUsage, findCommandInjectionRisk, findReDoSRisk, findPrototypePollutionRisk, findSsrfRisk, findPathTraversalRisk, scanJsSource } from '../heuristics-js.mjs';

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

test('scanJsSource combina as sete heurísticas + AST e roda sem quebrar em código limpo', async () => {
  const src = `
    export function safeAdd(a, b) {
      return a + b;
    }
    export const ID_RE = /^[a-zA-Z0-9_-]+$/;
  `;
  const findings = await scanJsSource(src, 'clean.ts');
  assert.equal(findings.length, 0);
});

test('scanJsSource inclui achado de fluxo de dado rastreado por AST', async () => {
  const src = `
    function handler(req) {
      exec("ping " + req.query.host);
    }
  `;
  const findings = await scanJsSource(src, 'x.js');
  assert.ok(findings.some((f) => f.type === 'tainted_data_flow'));
});

test('findPrototypePollutionRisk acha for...in atribuindo por chave sem guarda contra __proto__', () => {
  const src = `
    function merge(target, source) {
      for (const key in source) {
        target[key] = source[key];
      }
      return target;
    }
  `;
  const findings = findPrototypePollutionRisk(src, 'x.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'prototype_pollution_risk');
});

test('findPrototypePollutionRisk NÃO sinaliza quando já guarda contra __proto__', () => {
  const src = `
    function merge(target, source) {
      for (const key in source) {
        if (key === '__proto__' || key === 'constructor') continue;
        target[key] = source[key];
      }
    }
  `;
  assert.equal(findPrototypePollutionRisk(src, 'x.js').length, 0);
});

test('findSsrfRisk acha fetch com destino montado por template literal interpolado', () => {
  const src = `
    async function proxy(userUrl) {
      return fetch(\`https://\${userUrl}/data\`);
    }
  `;
  const findings = findSsrfRisk(src, 'x.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'ssrf_risk');
});

test('findSsrfRisk NÃO sinaliza fetch com string literal fixa', () => {
  const src = `fetch('https://api.example.com/data')`;
  assert.equal(findSsrfRisk(src, 'x.js').length, 0);
});

test('findPathTraversalRisk acha fs.readFile com caminho concatenado sem guard de path', () => {
  const src = `
    function read(userFilename) {
      return fs.readFile('/uploads/' + userFilename, cb);
    }
  `;
  const findings = findPathTraversalRisk(src, 'x.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'path_traversal_risk');
});

test('findPathTraversalRisk NÃO sinaliza quando path.normalize/resolve/join está por perto', () => {
  const src = `
    function read(userFilename) {
      const safePath = path.join(UPLOAD_DIR, path.normalize(userFilename));
      return fs.readFile(safePath + '', cb);
    }
  `;
  assert.equal(findPathTraversalRisk(src, 'x.js').length, 0);
});
