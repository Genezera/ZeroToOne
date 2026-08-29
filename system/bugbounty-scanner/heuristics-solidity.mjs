// Heurísticas para Solidity — classes de vulnerabilidade de contrato
// inteligente bem estabelecidas (mesmo vocabulário usado por auditorias
// reais: Consensys Diligence, Trail of Bits, checklist da OpenZeppelin),
// não inventadas. Contexto: contrato Solidity mal-feito já causou perdas
// de centenas de milhões de dólares reais (The DAO — reentrância — é o
// caso mais famoso), por isso essas classes têm payout historicamente alto
// em bug bounty de smart contract.

import { findHardcodedSecrets } from './heuristics-shared.mjs';

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function contextSnippet(source, index, radius = 80) {
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + radius);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Chamada externa via .call{value:}(...) seguida de atualização de estado
 * (atribuição a variável de storage) DEPOIS da chamada, dentro da mesma
 * função — violação do padrão checks-effects-interactions. É a classe de
 * bug mais famosa de Solidity (The DAO, 2016, ~US$60M).
 */
export function findReentrancyRisk(source, filename) {
  const findings = [];
  const funcRegex = /function\s+(\w+)\s*\([^)]*\)[^{]*\{/g;
  let fm;
  while ((fm = funcRegex.exec(source))) {
    // acha o corpo da função balanceando chaves a partir da abertura
    let depth = 1;
    let i = fm.index + fm[0].length;
    const bodyStart = i;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    const body = source.slice(bodyStart, i - 1);
    const callMatch = /\.call\s*(\{[^}]*\})?\s*\(/.exec(body);
    if (!callMatch) continue;
    const afterCall = body.slice(callMatch.index + callMatch[0].length);
    const stateWriteAfter = /\b\w+\s*(\[[^\]]*\])?\s*(=|\+=|-=)\s*[^=]/.exec(afterCall);
    if (stateWriteAfter) {
      findings.push({
        type: 'reentrancy_risk',
        file: filename,
        function: fm[1],
        severity: 'a_investigar',
        note: `Função ${fm[1]} faz chamada externa (.call) e escreve estado DEPOIS da chamada — violação do padrão checks-effects-interactions, risco de reentrância clássica (padrão do hack da The DAO). Confirmar se há guard (nonReentrant/modifier de lock) antes de reportar. Contexto: "${contextSnippet(body, callMatch.index)}"`,
      });
    }
  }
  return findings;
}

/**
 * `.call(...)`/`.send(...)` sem checar o retorno booleano — falha
 * silenciosa: o contrato segue como se a transferência/chamada tivesse
 * dado certo mesmo quando falhou.
 */
export function findUncheckedCallReturn(source, filename) {
  const findings = [];
  const regex = /(\w+)\.call(\{[^}]*\})?\s*\([^;]*\)\s*;/g;
  let match;
  while ((match = regex.exec(source))) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const linePrefix = source.slice(lineStart, match.index);
    // se a linha atribui o retorno a uma variável (ex.: (bool ok, ) = x.call(...)) o retorno ESTÁ sendo capturado — não sinaliza
    if (/\(\s*bool\s+\w+/.test(linePrefix) || /=\s*$/.test(linePrefix.trim() + ' ')) continue;
    findings.push({
      type: 'unchecked_call_return',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `${match[1]}.call(...) sem capturar/checar o retorno booleano — falha da chamada externa passa despercebida. Padrão seguro: (bool ok, ) = ${match[1]}.call(...); require(ok, ...). Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * `tx.origin` usado em checagem de autorização (`require(tx.origin ==`,
 * `if (tx.origin ==`) — vulnerável a phishing via contrato intermediário
 * malicioso (o padrão correto é msg.sender).
 */
export function findTxOriginAuth(source, filename) {
  const findings = [];
  const regex = /(require|if)\s*\(\s*tx\.origin\s*==/g;
  let match;
  while ((match = regex.exec(source))) {
    findings.push({
      type: 'tx_origin_auth_risk',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `tx.origin usado em checagem de autorização — vulnerável a ataque de phishing (usuário autenticado interage com contrato malicioso que chama este contrato em nome dele). Padrão seguro é msg.sender. Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

/**
 * `delegatecall` com endereço que não é uma constante/imutável fixa no
 * próprio contrato — risco de colisão de storage / execução de código
 * arbitrário se o endereço vier de estado mutável ou argumento externo.
 */
export function findDelegatecallRisk(source, filename) {
  const findings = [];
  const regex = /(\w+)\.delegatecall\s*\(/g;
  let match;
  while ((match = regex.exec(source))) {
    const targetName = match[1];
    const isLikelyConstant = new RegExp(`\\b(constant|immutable)\\b[^;]*\\b${targetName}\\b`).test(source);
    if (isLikelyConstant) continue;
    findings.push({
      type: 'delegatecall_risk',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `${targetName}.delegatecall(...) — ${targetName} não aparenta ser constant/immutable; se o endereço vier de estado mutável ou argumento não confiável, risco de colisão de storage layout ou execução de código arbitrário no contexto deste contrato. Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}

export function scanSoliditySource(source, filename) {
  return [
    ...findReentrancyRisk(source, filename),
    ...findUncheckedCallReturn(source, filename),
    ...findTxOriginAuth(source, filename),
    ...findDelegatecallRisk(source, filename),
    ...findHardcodedSecrets(source, filename),
  ];
}
