import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTaintedDataFlow } from '../heuristics-js-ast.mjs';

test('findTaintedDataFlow acha req.query fluindo direto até exec()', async () => {
  const src = `
    function handler(req, res) {
      exec("ping " + req.query.host);
    }
  `;
  const findings = await findTaintedDataFlow(src, 'x.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'tainted_data_flow');
  assert.ok(findings[0].note.includes('req.query'));
});

test('findTaintedDataFlow rastreia através de variável intermediária (alias)', async () => {
  const src = `
    function handler(req) {
      const host = req.query.host;
      const cmd = "ping " + host;
      exec(cmd);
    }
  `;
  const findings = await findTaintedDataFlow(src, 'x.js');
  assert.equal(findings.length, 1);
});

test('findTaintedDataFlow rastreia através de template string', async () => {
  const src = `
    function proxy(req) {
      const url = \`https://\${req.query.target}/data\`;
      fetch(url);
    }
  `;
  const findings = await findTaintedDataFlow(src, 'x.js');
  assert.equal(findings.length, 1);
  assert.ok(findings[0].note.includes('fetch'));
});

test('findTaintedDataFlow NÃO sinaliza sink com argumento totalmente literal/interno', async () => {
  const src = `
    function run() {
      exec("ls -la /var/log");
      fetch("https://api.internal.example.com/health");
    }
  `;
  const findings = await findTaintedDataFlow(src, 'x.js');
  assert.equal(findings.length, 0);
});

test('findTaintedDataFlow NÃO sinaliza variável que não veio de fonte externa conhecida, mesmo sendo parâmetro', async () => {
  const src = `
    function helper(internalConfig) {
      exec("run " + internalConfig.mode);
    }
  `;
  const findings = await findTaintedDataFlow(src, 'x.js');
  assert.equal(findings.length, 0);
});

test('findTaintedDataFlow roda sem quebrar em arquivo vazio/sem função', async () => {
  const findings = await findTaintedDataFlow('const x = 1;', 'x.js');
  assert.deepEqual(findings, []);
});

test('findTaintedDataFlow acha em arrow function também', async () => {
  const src = `
    const handler = (req) => {
      fs.readFile(req.body.path, cb);
    };
  `;
  const findings = await findTaintedDataFlow(src, 'x.js');
  assert.equal(findings.length, 1);
});

test('findTaintedDataFlow usa a gramática TypeScript de verdade em .ts (tipo/generics não quebram o parse)', async () => {
  const src = `
    interface Req { query: Record<string, string> }
    function handler<T extends Req>(req: T, res: Response): void {
      const target: string = req.query.target;
      fetch(\`https://\${target}/data\`);
    }
  `;
  const findings = await findTaintedDataFlow(src, 'x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'tainted_data_flow');
});

test('findTaintedDataFlow usa a gramática TSX de verdade em .tsx (JSX não quebra o parse)', async () => {
  const src = `
    function Page({ req }) {
      exec("run " + req.params.id);
      return <div>ok</div>;
    }
  `;
  const findings = await findTaintedDataFlow(src, 'x.tsx');
  assert.equal(findings.length, 1);
});
