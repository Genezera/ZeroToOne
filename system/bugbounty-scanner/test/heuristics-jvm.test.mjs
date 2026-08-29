import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTrustManagerBypass, findWebViewJsBridge, findJvmCommandInjection, findJvmSqlInjectionRisk, findJvmInsecureDeserialization, scanJvmSource } from '../heuristics-jvm.mjs';

test('findTrustManagerBypass acha checkServerTrusted com corpo vazio', () => {
  const src = `
    new X509TrustManager() {
      public void checkClientTrusted(X509Certificate[] chain, String authType) {}
      public void checkServerTrusted(X509Certificate[] chain, String authType) {}
      public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[]{}; }
    }
  `;
  const findings = findTrustManagerBypass(src, 'x.java');
  assert.ok(findings.length >= 1);
  assert.ok(findings.every((f) => f.type === 'tls_validation_bypass'));
});

test('findTrustManagerBypass acha HostnameVerifier que sempre retorna true', () => {
  const src = `
    val verifier = HostnameVerifier() { hostname, session ->
      return true
    }
  `;
  const findings = findTrustManagerBypass(src, 'x.kt');
  assert.ok(findings.length >= 1);
});

test('findTrustManagerBypass NÃO sinaliza checkServerTrusted que valida de verdade', () => {
  const src = `
    public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
      defaultTrustManager.checkServerTrusted(chain, authType);
    }
  `;
  assert.equal(findTrustManagerBypass(src, 'x.java').length, 0);
});

test('findWebViewJsBridge acha addJavascriptInterface com JS habilitado', () => {
  const src = `
    webView.settings.setJavaScriptEnabled(true)
    webView.addJavascriptInterface(JsBridge(), "Android")
  `;
  const findings = findWebViewJsBridge(src, 'x.kt');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'webview_js_bridge_exposure');
});

test('findWebViewJsBridge NÃO sinaliza addJavascriptInterface sem JS habilitado no arquivo', () => {
  const src = `webView.addJavascriptInterface(JsBridge(), "Android")`;
  assert.equal(findWebViewJsBridge(src, 'x.kt').length, 0);
});

test('findJvmCommandInjection acha Runtime.exec com concatenação', () => {
  const src = `Runtime.getRuntime().exec("ping " + host)`;
  const findings = findJvmCommandInjection(src, 'x.java');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'command_injection_risk');
});

test('scanJvmSource roda sem quebrar em código limpo', () => {
  const src = `
    fun add(a: Int, b: Int): Int {
      return a + b
    }
  `;
  assert.equal(scanJvmSource(src, 'clean.kt').length, 0);
});

test('findJvmSqlInjectionRisk acha executeQuery com SQL concatenado', () => {
  const src = `val rs = stmt.executeQuery("SELECT * FROM users WHERE id = " + userId)`;
  const findings = findJvmSqlInjectionRisk(src, 'x.kt');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'sql_injection_risk');
});

test('findJvmSqlInjectionRisk NÃO sinaliza PreparedStatement.executeQuery() sem argumento', () => {
  const src = `val rs = preparedStmt.executeQuery()`;
  assert.equal(findJvmSqlInjectionRisk(src, 'x.kt').length, 0);
});

test('findJvmInsecureDeserialization acha new ObjectInputStream', () => {
  const src = `val ois = ObjectInputStream(socket.getInputStream()); val obj = ois.readObject()`;
  const findings = findJvmInsecureDeserialization(src, 'x.java');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'insecure_deserialization');
});
