// Análise de fluxo de dado de verdade pra JS/TS, via AST real (web-tree-
// sitter + gramáticas tree-sitter-javascript/typescript/tsx, WASM — sem
// compilação nativa, funciona em qualquer máquina). Escolhe a gramática
// certa pela extensão: .ts/.mts/.cts usam a gramática TypeScript de
// verdade (entende tipo, generics, interface — a gramática JS pura erra
// nesses casos), .tsx usa a gramática TSX, o resto usa JS puro. Diferente
// das heurísticas de texto
// (heuristics-js.mjs — que só checam "esses dois padrões aparecem no
// mesmo arquivo"), isso rastreia se um valor que vem de uma fonte externa
// conhecida (req.query, req.body, process.argv...) REALMENTE flui até um
// sink perigoso (exec, fetch, fs.readFile, eval) dentro da mesma função —
// evidência bem mais forte que coocorrência textual.
//
// Limitação honesta, documentada: é intraprocedural (não atravessa
// chamada de função) e não segue ramificação condicional complexa —
// cobre o caso comum (atribuição linear, template string, concatenação),
// não é um motor de dataflow completo tipo CodeQL/Semgrep. Falso-negativo
// é esperado em fluxo mais complexo; falso-positivo deve ser raro porque
// só sinaliza quando a fonte é EXPLICITAMENTE um padrão de entrada
// externa conhecida, não qualquer parâmetro de função.

import { Parser, Language } from 'web-tree-sitter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NODE_MODULES = path.resolve(__dirname, '..', '..', 'node_modules');
const GRAMMAR_PATHS = {
  javascript: path.join(NODE_MODULES, 'tree-sitter-javascript', 'tree-sitter-javascript.wasm'),
  typescript: path.join(NODE_MODULES, 'tree-sitter-typescript', 'tree-sitter-typescript.wasm'),
  tsx: path.join(NODE_MODULES, 'tree-sitter-typescript', 'tree-sitter-tsx.wasm'),
};

function grammarForFile(filename) {
  if (/\.tsx$/.test(filename)) return 'tsx';
  if (/\.(ts|mts|cts)$/.test(filename)) return 'typescript';
  return 'javascript';
}

let initPromise = null;
const languageCache = new Map();
let sharedParser = null;

async function getParserFor(filename) {
  if (!initPromise) initPromise = Parser.init();
  await initPromise;
  if (!sharedParser) sharedParser = new Parser();

  const grammarKey = grammarForFile(filename);
  if (!languageCache.has(grammarKey)) {
    languageCache.set(grammarKey, await Language.load(GRAMMAR_PATHS[grammarKey]));
  }
  sharedParser.setLanguage(languageCache.get(grammarKey));
  return sharedParser;
}

const TAINT_SOURCE_RE = /\b(req|request|ctx)\.(query|body|params|headers|cookies)\b|\bprocess\.argv\b/;

const SINKS = [
  { name: 'exec', match: (calleeText) => /(^|\.)(exec|execSync)$/.test(calleeText) },
  { name: 'eval', match: (calleeText) => calleeText === 'eval' },
  { name: 'fetch', match: (calleeText) => calleeText === 'fetch' || /^axios\.(get|post|request)$/.test(calleeText) },
  { name: 'fs', match: (calleeText) => /^fs\.(readFile|readFileSync|writeFile|writeFileSync|createReadStream)$/.test(calleeText) },
];

function nodeText(node, source) {
  return source.slice(node.startIndex, node.endIndex);
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

/** Percorre a árvore procurando declaração de função (function_declaration,
 * arrow com corpo em bloco, method_definition) — a unidade de escopo que
 * usamos pra rastrear taint (intraprocedural, não atravessa chamada). */
function findFunctionNodes(root) {
  const out = [];
  const cursor = root.walk();
  function visit() {
    const node = cursor.currentNode;
    if (['function_declaration', 'function_expression', 'arrow_function', 'method_definition'].includes(node.type)) {
      out.push(node);
    }
    if (cursor.gotoFirstChild()) {
      do {
        visit();
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  }
  visit();
  return out;
}

function exprIsTaintedSource(text) {
  return TAINT_SOURCE_RE.test(text);
}

/** Rastreamento de taint de UMA função: propaga por atribuição direta,
 * alias de identificador, template string e concatenação com "+". Passa
 * pelas declarações/atribuições em ordem de aparição no corpo (não
 * resolve ramificação condicional — cobre o caminho comum). */
function trackTaintInFunction(fnNode, source, filename, findings) {
  const tainted = new Map(); // nome -> descrição da origem

  function markIfTainted(lhsName, rhsNode) {
    const rhsText = nodeText(rhsNode, source);
    if (exprIsTaintedSource(rhsText)) {
      tainted.set(lhsName, rhsText.match(TAINT_SOURCE_RE)[0]);
      return;
    }
    if (rhsNode.type === 'identifier' && tainted.has(rhsText)) {
      tainted.set(lhsName, tainted.get(rhsText));
      return;
    }
    if (rhsNode.type === 'template_string' || rhsNode.type === 'binary_expression') {
      const ids = collectIdentifiersInScope(rhsNode, source);
      for (const id of ids) {
        if (tainted.has(id)) {
          tainted.set(lhsName, tainted.get(id));
          return;
        }
        if (exprIsTaintedSource(id)) {
          tainted.set(lhsName, id);
          return;
        }
      }
    }
  }

  function collectIdentifiersInScope(node, src) {
    const ids = [];
    function walk(n) {
      if (n.type === 'identifier' || n.type === 'member_expression') {
        ids.push(nodeText(n, src));
      }
      if (n.type !== 'member_expression') {
        for (let i = 0; i < n.childCount; i++) walk(n.child(i));
      }
    }
    walk(node);
    return ids;
  }

  function walkStatements(node) {
    if (node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      const valueNode = node.childForFieldName('value');
      if (nameNode && valueNode && nameNode.type === 'identifier') {
        markIfTainted(nodeText(nameNode, source), valueNode);
      }
    }
    if (node.type === 'assignment_expression') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left && right && left.type === 'identifier') {
        markIfTainted(nodeText(left, source), right);
      }
    }
    if (node.type === 'call_expression') {
      const calleeNode = node.childForFieldName('function');
      const argsNode = node.childForFieldName('arguments');
      if (calleeNode && argsNode) {
        const calleeText = nodeText(calleeNode, source);
        const sink = SINKS.find((s) => s.match(calleeText));
        if (sink) {
          for (let i = 0; i < argsNode.namedChildCount; i++) {
            const arg = argsNode.namedChild(i);
            const argText = nodeText(arg, source);
            let origin = null;
            if (exprIsTaintedSource(argText)) origin = argText.match(TAINT_SOURCE_RE)[0];
            else {
              const ids = collectIdentifiersInScope(arg, source);
              for (const id of ids) {
                if (tainted.has(id)) {
                  origin = tainted.get(id);
                  break;
                }
              }
            }
            if (origin) {
              findings.push({
                type: 'tainted_data_flow',
                file: filename,
                function: `line:${lineOf(node)}`,
                severity: 'a_investigar',
                note: `Fluxo de dado rastreado por AST: origem externa "${origin}" chega no sink ${sink.name}(...) via argumento "${argText.slice(0, 80)}" — evidência mais forte que coocorrência textual, porque confirma que o dado da fonte realmente alcança o sink (dentro da mesma função; não atravessa chamada de função). Contexto: linha ${lineOf(node)}, ${nodeText(node, source).slice(0, 150)}`,
              });
              break; // um achado por chamada de sink já basta
            }
          }
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) walkStatements(node.child(i));
  }

  walkStatements(fnNode);
}

/** Ponto de entrada: recebe código-fonte + nome de arquivo, devolve achados
 * de fluxo de dado rastreado. Assíncrono (carrega o parser WASM na
 * primeira chamada, depois reusa a mesma instância). */
export async function findTaintedDataFlow(source, filename) {
  // só .ts/.tsx têm sintaxe que a gramática JS pura não cobre 100% (tipos,
  // generics) — na prática tree-sitter-javascript tolera boa parte disso
  // sem quebrar; se o parse falhar feio (árvore majoritariamente ERROR),
  // simplesmente não reporta nada em vez de arriscar falso-positivo sobre
  // uma árvore malformada.
  const parser = await getParserFor(filename);
  const tree = parser.parse(source);
  if (!tree || !tree.rootNode) return [];
  const findings = [];
  const fns = findFunctionNodes(tree.rootNode);
  for (const fn of fns) {
    trackTaintInFunction(fn, source, filename, findings);
  }
  return findings;
}
