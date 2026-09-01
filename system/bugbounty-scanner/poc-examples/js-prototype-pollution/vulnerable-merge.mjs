// O padrão exato que heuristics-js.mjs (prototype_pollution_risk)
// sinaliza: for...in + atribuição indexada num objeto de destino, sem
// checar __proto__/constructor/prototype antes de escrever. Não é
// reimplementação de nenhum repositório real -- é o padrão genérico
// que a heurística procura, escrito aqui só pra ter algo real e
// executável pra rodar a PoC contra.
export function vulnerableMerge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object' && source[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
      vulnerableMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// Controle: mesma função, com a checagem que normalmente refuta o
// achado quando presente.
export function safeMerge(target, source) {
  for (const key in source) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (typeof source[key] === 'object' && source[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
      safeMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
