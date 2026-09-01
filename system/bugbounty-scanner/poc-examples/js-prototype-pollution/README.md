# Exemplo de referência — PoC JS/TS real (não é um achado novo)

Isso NÃO é uma vulnerabilidade encontrada por esta missão — é um
exemplo de trabalho, real e executável, do padrão `prototype_pollution_risk`
que `heuristics-js.mjs` sinaliza: merge/atribuição recursiva via
`for...in` sem checar `__proto__`/`constructor`/`prototype` antes de
escrever no destino.

Diferente de Solidity/Go, JS/TS não precisa de nenhuma convenção nova
de ferramenta — **é literalmente `node --test`, a mesma ferramenta que
já roda a suíte inteira deste projeto** (`npm test`). Por isso este
exemplo não é uma pasta isolada por acidente: fica fora de qualquer
diretório `test/` do projeto de propósito, pra nunca ser varrido pela
suíte principal (`system/**/test/*.test.mjs`) — é referência, não faz
parte do `npm test`.

## Rodar

```
node --test system/bugbounty-scanner/poc-examples/js-prototype-pollution/poc.test.mjs
```

Saída real esperada:
```
PoC result: Object.prototype poluído -- {}.polluted === "yes" em qualquer objeto novo do processo.
✔ PoC: vulnerableMerge com entrada não confiável polui Object.prototype globalmente
✔ Controle: safeMerge (com checagem de __proto__/constructor/prototype) não é afetado pela mesma entrada
```

## Por que `JSON.parse('{"__proto__":...}')` funciona (nuance real, não óbvia)

`JSON.parse` **não** aciona o setter especial de `Object.prototype.__proto__`
— cria uma propriedade própria comum, de string `"__proto__"`, num
objeto qualquer (`CreateDataProperty` puro, não atribuição). O perigo
real só aparece depois, quando `vulnerableMerge` faz
`target[key] = ...` com `key === "__proto__"` vindo de dado
desserializado — **essa** atribuição via colchete segue semântica
normal de acesso a propriedade e aciona o setter herdado de
`Object.prototype`, mudando o protótipo de verdade. É exatamente por
isso que esta classe de bug é sutil: o dado em si (`JSON.parse`) parece
inofensivo isolado; o perigo está inteiramente em como o código
consumidor itera e escreve as chaves depois.

O teste de controle (`safeMerge`) prova que a checagem de
`__proto__`/`constructor`/`prototype` — o jeito mais comum de corrigir
isso — de fato neutraliza a mesma entrada exata, não uma entrada
diferente mais fraca.
