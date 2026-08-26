import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSwiftTLSBypass, findWKWebViewJsBridge, scanSwiftSource } from '../heuristics-swift.mjs';

test('findSwiftTLSBypass acha completionHandler(.useCredential, URLCredential(trust:)) incondicional', () => {
  const src = `
    func urlSession(_ session: URLSession, didReceiveChallenge challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
      let credential = URLCredential(trust: challenge.protectionSpace.serverTrust!)
      completionHandler(.useCredential, URLCredential(trust: challenge.protectionSpace.serverTrust!))
    }
  `;
  const findings = findSwiftTLSBypass(src, 'x.swift');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'tls_validation_bypass');
});

test('findSwiftTLSBypass NÃO sinaliza arquivo sem didReceiveChallenge', () => {
  const src = `completionHandler(.useCredential, URLCredential(trust: trust))`;
  assert.equal(findSwiftTLSBypass(src, 'x.swift').length, 0);
});

test('findWKWebViewJsBridge acha ponte JS registrada junto de load de URL variável', () => {
  const src = `
    userContentController.add(self, name: "native")
    webView.load(request)
  `;
  const findings = findWKWebViewJsBridge(src, 'x.swift');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'webview_js_bridge_exposure');
});

test('findWKWebViewJsBridge NÃO sinaliza ponte JS sem load de conteúdo variável no arquivo', () => {
  const src = `userContentController.add(self, name: "native")`;
  assert.equal(findWKWebViewJsBridge(src, 'x.swift').length, 0);
});

test('scanSwiftSource roda sem quebrar em código limpo', () => {
  const src = `
    func add(_ a: Int, _ b: Int) -> Int {
      return a + b
    }
  `;
  assert.equal(scanSwiftSource(src, 'clean.swift').length, 0);
});
