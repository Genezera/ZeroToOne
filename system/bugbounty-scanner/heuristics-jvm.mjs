// Heurísticas para código Kotlin/Java — classes de bug conhecidas e já
// pagas em programas reais de bug bounty Android/JVM: bypass de validação
// de certificado TLS, exposição de ponte JavaScript no WebView, injeção
// de comando via Runtime/ProcessBuilder.

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function contextSnippet(source, index, radius = 70) {
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + radius);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * TrustManager que aceita qualquer certificado (checkClientTrusted/
 * checkServerTrusted com corpo vazio ou só retorno) ou HostnameVerifier
 * que sempre retorna true — desliga a validação de TLS por completo.
 * Achado clássico e valioso em bug bounty Android/mobile.
 */
export function findTrustManagerBypass(source, filename) {
  const findings = [];
  const trustMethod = /(checkClientTrusted|checkServerTrusted)\s*\([^)]*\)\s*(?:throws\s+[\w.]+\s*)?\{\s*\}/g;
  const hostnameVerifier = /HostnameVerifier\s*\(\s*\)\s*\{[^}]*?return\s+true\s*;?\s*\}/gs;
  let match;
  while ((match = trustMethod.exec(source))) {
    findings.push({
      type: 'tls_validation_bypass',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `${match[1]} com corpo vazio — aceita qualquer certificado, desligando a validação TLS (risco de MITM). Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  while ((match = hostnameVerifier.exec(source))) {
    findings.push({
      type: 'tls_validation_bypass',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `HostnameVerifier que sempre retorna true — aceita qualquer hostname (risco de MITM). Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * addJavascriptInterface em um WebView com setJavaScriptEnabled(true) no
 * mesmo arquivo — expõe métodos Java/Kotlin nativos ao JS que roda dentro
 * do WebView; se o WebView pode navegar para conteúdo não confiável, isso
 * é execução remota de código (classe de CVE Android bem documentada).
 */
export function findWebViewJsBridge(source, filename) {
  const findings = [];
  if (!/setJavaScriptEnabled\s*\(\s*true\s*\)/.test(source)) return findings;
  const regex = /addJavascriptInterface\s*\(/g;
  let match;
  while ((match = regex.exec(source))) {
    findings.push({
      type: 'webview_js_bridge_exposure',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `addJavascriptInterface com JavaScript habilitado no mesmo arquivo — expõe objeto nativo ao JS do WebView; risco sério se o WebView pode carregar conteúdo não confiável/remoto. Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * Runtime.exec / ProcessBuilder com comando montado por concatenação de
 * string ou interpolação — risco de injeção de comando.
 */
export function findJvmCommandInjection(source, filename) {
  const findings = [];
  const regex = /(Runtime\.getRuntime\(\)\.exec|ProcessBuilder)\s*\(\s*("(?:[^"\\]|\\.)*"\s*\+|arrayOf\([^)]*\+|listOf\([^)]*\+)/g;
  let match;
  while ((match = regex.exec(source))) {
    findings.push({
      type: 'command_injection_risk',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `${match[1]}(...) com comando montado por concatenação de string — risco de injeção se alguma parte vier de entrada não confiável. Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

export function scanJvmSource(source, filename) {
  return [
    ...findTrustManagerBypass(source, filename),
    ...findWebViewJsBridge(source, filename),
    ...findJvmCommandInjection(source, filename),
  ];
}
