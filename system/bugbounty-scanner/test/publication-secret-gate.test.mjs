import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanTextForSecrets } from '../publication-secret-gate.mjs';

test('reconhece formatos sensíveis em relatórios e JSON sem devolver seus valores', () => {
  const cases = [
    ['github_token', 'gh' + 'p_' + 'A'.repeat(36)],
    ['aws_access_key', 'AK' + 'IA' + 'Z'.repeat(16)],
    ['telegram_bot_token', '123456789:' + 'Q'.repeat(35)],
    ['private_key', '-----BEGIN ' + 'PRIVATE KEY-----'],
    ['jwt', 'eyJ' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20)],
    ['authorization_header', 'Authorization: ' + 'Bearer ' + 'd'.repeat(32)],
    ['cookie_header', 'Cookie: session=' + 'e'.repeat(32)],
    ['signed_url', 'https://example.invalid/?X-Amz-Signature=' + 'f'.repeat(64)],
    ['secret_assignment', 'api_key = "' + 'g'.repeat(32) + '"'],
  ];
  for (const [detector, content] of cases) {
    for (const text of [content, JSON.stringify({ rawOutput: content })]) {
      const findings = scanTextForSecrets(text, { env: {} });
      assert.ok(findings.some((hit) => hit.detector === detector), detector);
      assert.equal(JSON.stringify(findings).includes(content), false);
    }
  }
});

test('detecta credencial configurada sem formato conhecido e Basic composto do HackerOne', () => {
  const env = { HACKERONE_USERNAME: 'test-user', HACKERONE_API_TOKEN: 'opaque-test-credential-long-enough' };
  for (const value of [env.HACKERONE_API_TOKEN, Buffer.from(`${env.HACKERONE_USERNAME}:${env.HACKERONE_API_TOKEN}`).toString('base64')]) {
    const findings = scanTextForSecrets(`output: ${value}`, { env });
    assert.ok(findings.some((hit) => hit.detector === 'configured_credential'));
    assert.equal(JSON.stringify(findings).includes(value), false);
  }
});

test('não marca referências a variáveis de ambiente, placeholders curtos ou achados sem valores', () => {
  const text = [
    'process.env.GITHUB_TOKEN', 'Authorization: Bearer <REDACTED>',
    'cookie: session=<REDACTED>', 'const password = "example";',
    'Valor e contexto omitidos para não republicar possíveis credenciais.',
  ].join('\n');
  assert.deepEqual(scanTextForSecrets(text, { env: {} }), []);
});
