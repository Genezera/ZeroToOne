// Heurísticas puras de varredura de código JavaScript/TypeScript — mesmo
// espírito do heuristics.mjs (Clarity): encontram CANDIDATOS a investigar,
// não confirmam vulnerabilidade nenhuma. Baseadas em regras conhecidas de
// analisadores estáticos reais (eslint-plugin-security, semgrep), não
// inventadas — mas aqui é regex simples sobre texto, então falso-positivo
// é esperado e aceitável: é triagem, não veredito.

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

export function scanJsSource(source, filename) {
  return [
    ...findEvalUsage(source, filename),
    ...findCommandInjectionRisk(source, filename),
    ...findReDoSRisk(source, filename),
  ];
}
