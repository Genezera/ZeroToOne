// Heurísticas para código Go — mesmo espírito das outras: candidatos a
// investigar, baseados em regras reais e conhecidas (mesma família de
// checagens do gosec: G204 injeção de comando via shell, G404 uso de
// math/rand em contexto de segurança, G402 TLS inseguro).

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function contextSnippet(source, index, radius = 60) {
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + radius);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * exec.Command invocando um shell ("sh"/"bash"/"cmd"/"powershell") com "-c"
 * e um segundo argumento montado por fmt.Sprintf ou concatenação — risco
 * de injeção de comando. exec.Command(bin, args...) SEM shell não é
 * sinalizado (padrão seguro do Go: não há interpretação de shell).
 */
export function findGoCommandInjection(source, filename) {
  const findings = [];
  const regex = /exec\.Command\s*\(\s*["'](?:\/bin\/)?(sh|bash|cmd|powershell)["']\s*,\s*["']-c["']\s*,\s*(fmt\.Sprintf\(|[a-zA-Z_][\w.]*\s*\+)/g;
  let match;
  while ((match = regex.exec(source))) {
    findings.push({
      type: 'command_injection_risk',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `exec.Command com shell (${match[1]} -c) e comando montado por Sprintf/concatenação — risco de injeção se alguma parte vier de entrada não confiável. Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * InsecureSkipVerify: true (ou VerifyPeerCertificate desativado) em
 * tls.Config — desliga a verificação de certificado TLS, abrindo caminho
 * para MITM.
 */
export function findGoInsecureTLS(source, filename) {
  const findings = [];
  const regex = /InsecureSkipVerify\s*:\s*true/g;
  let match;
  while ((match = regex.exec(source))) {
    findings.push({
      type: 'insecure_tls',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `InsecureSkipVerify: true desliga a verificação de certificado TLS — risco de MITM se este código roda em produção (não em teste). Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * math/rand usado para gerar algo com nome de token/secret/password/key/
 * session/nonce — math/rand não é criptograficamente seguro
 * (previsível); crypto/rand é o certo para isso.
 */
export function findGoWeakRandomForSecrets(source, filename) {
  const findings = [];
  if (!/\bmath\/rand\b/.test(source)) return findings;
  const varRegex = /\b(token|secret|password|apikey|api_key|sessionid|session_id|nonce)\w*\s*(:=|=)\s*/gi;
  const randCallRegex = /\brand\.(Int|Int63|Intn|Read|Float64)\s*\(/g;
  let match;
  while ((match = varRegex.exec(source))) {
    const windowStart = match.index;
    const windowEnd = Math.min(source.length, match.index + 300);
    const window = source.slice(windowStart, windowEnd);
    randCallRegex.lastIndex = 0;
    if (randCallRegex.test(window)) {
      findings.push({
        type: 'weak_random_for_secret',
        file: filename,
        function: `line:${lineAt(source, match.index)}`,
        severity: 'a_investigar',
        note: `Uso de math/rand perto de uma variável chamada "${match[1]}" — math/rand é previsível (não criptográfico); crypto/rand é o certo para tokens/segredos. Contexto: "${contextSnippet(source, match.index)}"`,
      });
    }
  }
  return findings;
}

export function scanGoSource(source, filename) {
  return [
    ...findGoCommandInjection(source, filename),
    ...findGoInsecureTLS(source, filename),
    ...findGoWeakRandomForSecrets(source, filename),
  ];
}
