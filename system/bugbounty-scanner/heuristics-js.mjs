// Heurísticas puras de varredura de código JavaScript/TypeScript — mesmo
// espírito do heuristics.mjs (Clarity): encontram CANDIDATOS a investigar,
// não confirmam vulnerabilidade nenhuma. Baseadas em regras conhecidas de
// analisadores estáticos reais (eslint-plugin-security, semgrep), não
// inventadas — mas aqui é regex simples sobre texto, então falso-positivo
// é esperado e aceitável: é triagem, não veredito.

import { findHardcodedSecrets } from './heuristics-shared.mjs';

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function contextSnippet(source, index, radius = 60) {
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + radius);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * eval(...) e new Function(...) — execução de código arbitrário se o
 * argumento vier de entrada não confiável (usuário, rede, config externa).
 */
export function findEvalUsage(source, filename) {
  const findings = [];
  const regex = /\beval\s*\(|new\s+Function\s*\(/g;
  let match;
  while ((match = regex.exec(source))) {
    findings.push({
      type: 'eval_usage',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `Uso de ${match[0].trim()} — execução de código arbitrário se o argumento depender de entrada não confiável. Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * child_process.exec/execSync com template literal interpolado ou
 * concatenação de string — risco de injeção de comando se a parte
 * interpolada vier de entrada não confiável. execFile/spawn com array de
 * argumentos NÃO são sinalizados (padrão seguro).
 */
export function findCommandInjectionRisk(source, filename) {
  const findings = [];
  const regex = /\b(exec|execSync)\s*\(\s*(`[^`]*\$\{[^}]*\}[^`]*`|[a-zA-Z_$][\w$.]*\s*\+\s*|["'][^"']*["']\s*\+\s*[a-zA-Z_$])/g;
  let match;
  while ((match = regex.exec(source))) {
    findings.push({
      type: 'command_injection_risk',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `${match[1]}(...) com argumento montado por interpolação/concatenação — risco de injeção de comando se alguma parte vier de entrada não confiável. Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * Regex com quantificadores aninhados (ex.: (a+)+, (a*)*) — padrão clássico
 * de ReDoS (Regular Expression Denial of Service): entrada adversarial
 * específica pode fazer o motor de regex travar em tempo exponencial.
 */
export function findReDoSRisk(source, filename) {
  const findings = [];
  // literais de regex JS, evitando confundir com divisão: exige que o `/`
  // de abertura venha depois de operador/pontuação/início de linha, não de
  // identificador ou fechamento de parêntese/colchete.
  const regexLiteral = /(^|[=(,:!&|?{;\n]\s*)\/((?:\\.|\[(?:\\.|[^\]\n])*\]|[^\/\n\\])+)\/[a-z]*/g;
  const nestedQuantifier = /\([^()]*[+*]\)[+*]/;
  let match;
  while ((match = regexLiteral.exec(source))) {
    const pattern = match[2];
    if (nestedQuantifier.test(pattern)) {
      const idx = match.index + match[1].length;
      findings.push({
        type: 'redos_risk',
        file: filename,
        function: `line:${lineAt(source, idx)}`,
        severity: 'a_investigar',
        note: `Regex com quantificador aninhado (padrão clássico de ReDoS): /${pattern}/. Contexto: "${contextSnippet(source, idx)}"`,
      });
    }
  }
  return findings;
}

/**
 * `for...in` atribuindo em `alvo[chave] = ...` sem checagem visível contra
 * `__proto__`/`constructor`/`prototype` — padrão clássico de poluição de
 * protótipo quando a chave vem de entrada externa (ex.: corpo de
 * requisição JSON.parse'd, merge/extend recursivo de config).
 */
export function findPrototypePollutionRisk(source, filename) {
  const findings = [];
  const forInRegex = /for\s*\(\s*(?:const|let|var)?\s*(\w+)\s+in\s+/g;
  let match;
  while ((match = forInRegex.exec(source))) {
    const varName = match[1];
    const window = source.slice(match.index, Math.min(source.length, match.index + 400));
    const assignRegex = new RegExp(`\\[\\s*${varName}\\s*\\]\\s*=`);
    if (assignRegex.test(window) && !/__proto__|hasOwnProperty|Object\.hasOwn/.test(window)) {
      findings.push({
        type: 'prototype_pollution_risk',
        file: filename,
        function: `line:${lineAt(source, match.index)}`,
        severity: 'a_investigar',
        note: `for...in atribuindo em [${varName}] sem checagem visível contra __proto__/constructor/prototype — risco de poluição de protótipo se a chave vier de entrada externa. Contexto: "${contextSnippet(source, match.index)}"`,
      });
    }
  }
  return findings;
}

/**
 * fetch/axios/http(s).get com URL montada por interpolação/variável (não
 * string literal fixa) — risco de SSRF se a parte variável vier de entrada
 * não confiável e não houver allowlist de destino.
 */
export function findSsrfRisk(source, filename) {
  const findings = [];
  const regex = /\b(fetch|axios\.get|axios\.post|axios\.request|http\.get|https\.get)\s*\(\s*(`[^`]*\$\{[^}]*\}[^`]*`|[a-zA-Z_$][\w$.]*\s*[,)])/g;
  let match;
  while ((match = regex.exec(source))) {
    findings.push({
      type: 'ssrf_risk',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `${match[1]}(...) com destino montado por interpolação/variável, não string fixa — risco de SSRF se alguma parte vier de entrada não confiável e não houver allowlist de host. Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * fs.readFile/writeFile/unlink/createReadStream com caminho montado por
 * interpolação/concatenação, sem path.normalize/resolve/join visível por
 * perto — risco de path traversal (ex.: "../../etc/passwd" via entrada).
 */
export function findPathTraversalRisk(source, filename) {
  const findings = [];
  const regex = /\bfs\.(readFile|readFileSync|writeFile|writeFileSync|unlink|unlinkSync|createReadStream|createWriteStream)\s*\(\s*(`[^`]*\$\{[^}]*\}[^`]*`|[a-zA-Z_$][\w$.]*\s*\+|["'][^"']*["']\s*\+)/g;
  let match;
  while ((match = regex.exec(source))) {
    const context = contextSnippet(source, match.index, 100);
    if (/path\.(normalize|resolve|join)/.test(context)) continue; // guard visível por perto
    findings.push({
      type: 'path_traversal_risk',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `fs.${match[1]}(...) com caminho montado por interpolação/concatenação, sem path.normalize/resolve/join visível por perto — risco de path traversal se alguma parte vier de entrada não confiável. Contexto: "${context}"`,
    });
  }
  return findings;
}

export function scanJsSource(source, filename) {
  return [
    ...findEvalUsage(source, filename),
    ...findCommandInjectionRisk(source, filename),
    ...findReDoSRisk(source, filename),
    ...findPrototypePollutionRisk(source, filename),
    ...findSsrfRisk(source, filename),
    ...findPathTraversalRisk(source, filename),
    ...findHardcodedSecrets(source, filename),
  ];
}
