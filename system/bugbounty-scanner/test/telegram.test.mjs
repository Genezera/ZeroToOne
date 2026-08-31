import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotifyForTransition, formatTransitionMessage, NOTABLE_STATES } from '../telegram.mjs';

test('shouldNotifyForTransition é true só pros estados que valem aviso em tempo real', () => {
  assert.equal(shouldNotifyForTransition('human_ready'), true);
  assert.equal(shouldNotifyForTransition('reproduced_local'), true);
  assert.equal(shouldNotifyForTransition('known_duplicate'), true);
  assert.equal(shouldNotifyForTransition('paid'), true);
});

test('shouldNotifyForTransition é false pros estados cedo demais ou "não é nada"', () => {
  assert.equal(shouldNotifyForTransition('candidate'), false);
  assert.equal(shouldNotifyForTransition('corroborated_static'), false);
  assert.equal(shouldNotifyForTransition('false_positive'), false);
  assert.equal(shouldNotifyForTransition('inconclusive'), false);
});

test('NOTABLE_STATES nunca inclui um estado que não existe na máquina de estados real', async () => {
  const { STATES } = await import('../state-machine.mjs');
  for (const s of NOTABLE_STATES) {
    assert.ok(STATES.includes(s), `"${s}" está em NOTABLE_STATES mas não é um estado real`);
  }
});

test('formatTransitionMessage inclui programa, ativo, estado e motivo', () => {
  const finding = { program: 'Circle BBP', asset: 'src/Foo.sol', id: 'x' };
  const msg = formatTransitionMessage(finding, 'human_ready', 'rascunho de relatório pronto');
  assert.match(msg, /Circle BBP/);
  assert.match(msg, /src\/Foo\.sol/);
  assert.match(msg, /human_ready/);
  assert.match(msg, /rascunho de relatório pronto/);
});

test('formatTransitionMessage escapa HTML no motivo e no ativo (parse_mode=HTML no envio real)', () => {
  const finding = { program: 'X', asset: '<script>alert(1)</script>' };
  const msg = formatTransitionMessage(finding, 'human_ready', 'a < b & c > d');
  assert.doesNotMatch(msg, /<script>/);
  assert.match(msg, /&lt;script&gt;/);
  assert.match(msg, /a &lt; b &amp; c &gt; d/);
});

test('formatTransitionMessage usa file como fallback quando asset está ausente', () => {
  const finding = { program: 'X', file: 'foo.go' };
  const msg = formatTransitionMessage(finding, 'reproduced_local', 'ok');
  assert.match(msg, /foo\.go/);
});
