// Heurísticas para código Swift/Objective-C (iOS) — classes de bug
// conhecidas em bug bounty mobile: bypass de validação de certificado TLS
// em URLSession, e ponte JS insegura em WKWebView.

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function contextSnippet(source, index, radius = 70) {
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + radius);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * URLSessionDelegate didReceiveChallenge que chama completionHandler com
 * .useCredential incondicionalmente (sem checar challenge.protectionSpace
 * .serverTrust contra nada) — aceita qualquer certificado, desligando a
 * validação TLS (risco de MITM). Achado clássico e valioso em bug bounty
 * mobile.
 */
export function findSwiftTLSBypass(source, filename) {
  const findings = [];
  if (!/didReceiveChallenge/.test(source)) return findings;
  const regex = /completionHandler\s*\(\s*\.useCredential\s*,\s*URLCredential\s*\(\s*trust\s*:/g;
  let match;
  while ((match = regex.exec(source))) {
    findings.push({
      type: 'tls_validation_bypass',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `completionHandler(.useCredential, URLCredential(trust: ...)) — aceita o certificado do servidor sem validar contra nada (confirmar se há checagem de serverTrust antes). Risco de MITM. Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * WKUserContentController.add(...) (registra ponte JS -> nativo) num
 * arquivo que também carrega URL/HTML potencialmente não confiável
 * (loadHTMLString ou load(URLRequest) com uma variável, não um recurso
 * local fixo) — risco de exposição da ponte a conteúdo não confiável.
 */
export function findWKWebViewJsBridge(source, filename) {
  const findings = [];
  const addRegex = /\.add\s*\(\s*self\s*,\s*name\s*:/g;
  const untrustedLoad = /\.load\s*\(\s*[a-zA-Z_]\w*\s*\)|loadHTMLString\s*\(\s*[a-zA-Z_]\w*\s*,/;
  let match;
  while ((match = addRegex.exec(source))) {
    if (untrustedLoad.test(source)) {
      findings.push({
        type: 'webview_js_bridge_exposure',
        file: filename,
        function: `line:${lineAt(source, match.index)}`,
        severity: 'a_investigar',
        note: `WKUserContentController.add registra ponte JS->nativo, e o mesmo arquivo carrega conteúdo a partir de uma variável (não um recurso local fixo) — confirmar se a ponte fica exposta a conteúdo não confiável. Contexto: "${contextSnippet(source, match.index)}"`,
      });
    }
  }
  return findings;
}

export function scanSwiftSource(source, filename) {
  return [
    ...findSwiftTLSBypass(source, filename),
    ...findWKWebViewJsBridge(source, filename),
  ];
}
