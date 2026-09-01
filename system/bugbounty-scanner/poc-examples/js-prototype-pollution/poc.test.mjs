import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vulnerableMerge, safeMerge } from './vulnerable-merge.mjs';

// PoC real: entrada não confiável (ex.: body de requisição já
// desserializado por JSON.parse -- JSON.parse por si só NÃO cria
// __proto__ especial, é uma chave de string comum; o perigo é o
// que o merge faz com ela depois) atinge um merge recursivo sem
// checagem, e um objeto NOVO E NÃO RELACIONADO, criado depois do
// ataque, nasce corrompido -- prova poluição do Object.prototype
// global, não só do objeto de destino específico.
test('PoC: vulnerableMerge com entrada não confiável polui Object.prototype globalmente', () => {
  const attackerInput = JSON.parse('{"__proto__":{"polluted":"yes"}}');

  const before = {};
  assert.equal(before.polluted, undefined, 'setup inválido: já poluído antes da PoC rodar');

  vulnerableMerge({}, attackerInput);

  const unrelatedObject = {};
  assert.equal(
    unrelatedObject.polluted,
    'yes',
    'PoC deveria provar poluição global: um objeto NOVO, sem nenhuma relação com o ataque, herdou a propriedade via Object.prototype'
  );

  console.log('PoC result: Object.prototype poluído -- {}.polluted === "yes" em qualquer objeto novo do processo.');

  // Limpeza -- nunca deixar o processo de teste poluído pra outros
  // testes que rodem depois no mesmo processo.
  delete Object.prototype.polluted;
});

// Controle: a MESMA entrada de atacante, contra a versão com a
// checagem que normalmente refuta este tipo de achado quando presente
// no código real -- prova que a PoC testa a ausência da checagem
// específica, não um artefato do ambiente de teste.
test('Controle: safeMerge (com checagem de __proto__/constructor/prototype) não é afetado pela mesma entrada', () => {
  const attackerInput = JSON.parse('{"__proto__":{"polluted":"yes"}}');
  safeMerge({}, attackerInput);
  const unrelatedObject = {};
  assert.equal(unrelatedObject.polluted, undefined, 'safeMerge não deveria deixar a entrada poluir Object.prototype');
});
