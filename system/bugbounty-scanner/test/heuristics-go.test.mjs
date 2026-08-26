import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGoCommandInjection, findGoInsecureTLS, findGoWeakRandomForSecrets, scanGoSource } from '../heuristics-go.mjs';

test('findGoCommandInjection acha exec.Command("sh","-c", Sprintf(...))', () => {
  const src = `
    cmd := exec.Command("sh", "-c", fmt.Sprintf("curl %s", url))
  `;
  const findings = findGoCommandInjection(src, 'x.go');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'command_injection_risk');
});

test('findGoCommandInjection NÃO sinaliza exec.Command sem shell', () => {
  const src = `cmd := exec.Command(binPath, args...)`;
  assert.equal(findGoCommandInjection(src, 'x.go').length, 0);
});

test('findGoInsecureTLS acha InsecureSkipVerify: true', () => {
  const src = `tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}`;
  const findings = findGoInsecureTLS(src, 'x.go');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'insecure_tls');
});

test('findGoInsecureTLS NÃO sinaliza InsecureSkipVerify: false', () => {
  const src = `tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: false}}`;
  assert.equal(findGoInsecureTLS(src, 'x.go').length, 0);
});

test('findGoWeakRandomForSecrets acha math/rand perto de variável "token"', () => {
  const src = `
    import "math/rand"
    func genToken() string {
      token := rand.Int63()
      return fmt.Sprint(token)
    }
  `;
  const findings = findGoWeakRandomForSecrets(src, 'x.go');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'weak_random_for_secret');
});

test('findGoWeakRandomForSecrets NÃO sinaliza se o arquivo nem importa math/rand', () => {
  const src = `token := crypto_rand.Int63()`;
  assert.equal(findGoWeakRandomForSecrets(src, 'x.go').length, 0);
});

test('scanGoSource roda sem quebrar em código limpo', () => {
  const src = `
    func add(a, b int) int {
      return a + b
    }
  `;
  assert.equal(scanGoSource(src, 'clean.go').length, 0);
});
