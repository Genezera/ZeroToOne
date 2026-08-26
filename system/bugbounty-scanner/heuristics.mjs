// Heurísticas puras de varredura de código Clarity — encontra CANDIDATOS a
// investigar, não confirma vulnerabilidade nenhuma. A análise de verdade
// (entender se é explorável) continua sendo trabalho ativo de IA/humano,
// não deste script. Isso só reduz o que precisa de atenção cara.

/** Divide o código-fonte em blocos top-level (define-public, define-private
 * etc.), respeitando balanceamento de parênteses (Clarity é uma s-expr). */
export function splitTopLevelForms(source) {
  const forms = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && start !== -1) {
        forms.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return forms;
}

function extractDefName(form) {
  const m = form.match(/^\(define-(public|private|read-only)\s+\(([a-zA-Z0-9_\-!?]+)/);
  return m ? { kind: m[1], name: m[2] } : null;
}

/**
 * Acha funções públicas que fazem checagem de autorização (check-is-protocol
 * / check-is-admin) usando `tx-sender` como argumento, enquanto O RESTO do
 * arquivo majoritariamente usa `contract-caller` para o mesmo tipo de
 * checagem — inconsistência que já rendeu um achado real (ver
 * research/bugbounty/stackingdao/NOTES.md, set-token-uri).
 */
export function findAuthInconsistencies(source, filename) {
  const forms = splitTopLevelForms(source);
  const authCallRegex = /\(contract-call\?\s+\.dao\s+(check-is-protocol|check-is-admin)\s+(tx-sender|contract-caller)\)/g;

  const usageByArg = { 'tx-sender': 0, 'contract-caller': 0 };
  const perFunction = [];

  for (const form of forms) {
    const def = extractDefName(form);
    if (!def || def.kind !== 'public') continue;
    authCallRegex.lastIndex = 0;
    let match;
    while ((match = authCallRegex.exec(form))) {
      const arg = match[2];
      usageByArg[arg] = (usageByArg[arg] || 0) + 1;
      perFunction.push({ function: def.name, checkFn: match[1], arg });
    }
  }

  const majorityArg = usageByArg['contract-caller'] >= usageByArg['tx-sender'] ? 'contract-caller' : 'tx-sender';
  const minorityArg = majorityArg === 'contract-caller' ? 'tx-sender' : 'contract-caller';

  // só sinaliza se houver uma clara maioria (>=2 no padrão dominante) E
  // pelo menos uma função destoando — evita ruído em arquivos pequenos
  if (usageByArg[majorityArg] < 2 || usageByArg[minorityArg] === 0) return [];

  return perFunction
    .filter((f) => f.arg === minorityArg)
    .map((f) => ({
      type: 'auth_arg_inconsistency',
      file: filename,
      function: f.function,
      checkFn: f.checkFn,
      usedArg: f.arg,
      expectedArg: majorityArg,
      severity: 'a_investigar',
      note: `${f.function} usa ${f.arg} em ${f.checkFn}, mas o padrão dominante no arquivo (${usageByArg[majorityArg]}/${usageByArg[majorityArg] + usageByArg[minorityArg]} ocorrências) é ${majorityArg}.`,
    }));
}

/**
 * Acha funções públicas que transferem valor (stx-transfer?/ft-transfer?)
 * sem nenhuma checagem de autorização (check-is-protocol/check-is-admin/
 * asserts! com is-eq contra tx-sender) em nenhum lugar do corpo da função.
 * Falso-positivo é esperado e aceitável aqui — é triagem, não veredito.
 */
export function findUnguardedTransfers(source, filename) {
  const forms = splitTopLevelForms(source);
  const transferRegex = /\((stx-transfer\?|ft-transfer\?|contract-call\?[^)]*\btransfer\b)/;
  const guardRegex = /(check-is-protocol|check-is-admin|is-eq\s+tx-sender|is-eq\s+contract-caller)/;

  const findings = [];
  for (const form of forms) {
    const def = extractDefName(form);
    if (!def || def.kind !== 'public') continue;
    if (transferRegex.test(form) && !guardRegex.test(form)) {
      findings.push({
        type: 'unguarded_transfer',
        file: filename,
        function: def.name,
        severity: 'a_investigar',
        note: `${def.name} faz uma transferência sem nenhuma checagem de autorização visível no corpo da função (pode estar em outro lugar, ex. trait/decorator — confirmar manualmente).`,
      });
    }
  }
  return findings;
}

export function scanSource(source, filename) {
  return [...findAuthInconsistencies(source, filename), ...findUnguardedTransfers(source, filename)];
}
