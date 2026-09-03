import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotifyForTransition, formatTransitionMessage, NOTABLE_STATES, sendTelegramMessage } from '../telegram.mjs';

// Achado real (03/09/2026): usuário recebeu ~17 notificações reais no
// Telegram dele com dado de fixture de teste ("Circle BBP"/"p::f::fn::type")
// -- cada `npm test` que passava por uma transição pra `duplicate` disparava
// sendTelegramMessage de verdade, porque TELEGRAM_BOT_TOKEN/CHAT_ID reais
// estavam configurados nesta máquina e nada aqui sabia que estava rodando
// dentro de teste. Este teste roda sob `npm test` de propósito -- exercita
// exatamente a mesma condição real (npm_lifecycle_event="test") que
// protege qualquer chamador, não só simula em isolamento.
test('sendTelegramMessage nunca envia de verdade quando npm_lifecycle_event="test" (como em `npm test`), mesmo com credenciais reais configuradas na máquina', async () => {
  // Força a condição real de proteção, independente de como este arquivo
  // foi invocado (`npm test` seta isto sozinho; `node --test <arquivo>`
  // direto não -- o teste precisa valer nos dois casos, não só quando
  // alguém lembra de rodar do jeito certo).
  const prev = process.env.npm_lifecycle_event;
  process.env.npm_lifecycle_event = 'test';
  try {
    const result = await sendTelegramMessage('mensagem de teste -- NUNCA deveria sair de verdade');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'credenciais não configuradas');
  } finally {
    if (prev === undefined) delete process.env.npm_lifecycle_event; else process.env.npm_lifecycle_event = prev;
  }
});

test('shouldNotifyForTransition é true só pros estados que valem aviso em tempo real', () => {
  assert.equal(shouldNotifyForTransition('human_ready'), true);
  assert.equal(shouldNotifyForTransition('known_duplicate'), true);
  assert.equal(shouldNotifyForTransition('paid'), true);
});

test('shouldNotifyForTransition é false pros estados cedo demais ou "não é nada"', () => {
  assert.equal(shouldNotifyForTransition('candidate'), false);
  assert.equal(shouldNotifyForTransition('corroborated_static'), false);
  assert.equal(shouldNotifyForTransition('false_positive'), false);
  assert.equal(shouldNotifyForTransition('inconclusive'), false);
});

test('shouldNotifyForTransition é false pra reproduced_local/scope_verified -- correção real de 01/09/2026', () => {
  // Não removidos por serem "não é nada" (são progresso real) -- removidos
  // porque um achado real cruza os dois em segundos/milissegundos a
  // caminho de human_ready (achado real no ledger: 8ms entre as duas
  // transições de um mesmo achado), então cada achado virava 3
  // notificações separadas em sequência imediata. Usuário reportou isso
  // como "recebendo a mesma coisa várias vezes". O painel continua
  // mostrando as duas -- isso só afeta o que interrompe o celular.
  assert.equal(shouldNotifyForTransition('reproduced_local'), false);
  assert.equal(shouldNotifyForTransition('scope_verified'), false);
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
