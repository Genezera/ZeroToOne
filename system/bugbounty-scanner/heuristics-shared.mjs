// Heurística compartilhada entre linguagens (JS/TS, Go, Kotlin/Java,
// Swift/ObjC) — sintaxe de atribuição `chave = "valor"` / `chave: "valor"`
// é parecida o suficiente entre essas linguagens pra usar uma regex só.
// Candidato a investigar, não confirma segredo real nenhum (muito
// falso-positivo esperado: placeholders, valores de teste, etc. — por
// isso filtra os padrões óbvios de placeholder antes de sinalizar).

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function contextSnippet(source, index, radius = 60) {
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + radius);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

const PLACEHOLDER = /^(x{3,}|0{3,}|1{3,}|todo|changeme|example|sample|test|fake|dummy|insert[_-]?key|replace[_-]?me|<[^>]+>|\$\{[^}]+\})$/i;
const PLACEHOLDER_PREFIX = /^your[_-]?(api[_-]?key|token|secret|password)/i;

function isPlaceholder(value) {
  return PLACEHOLDER.test(value) || PLACEHOLDER_PREFIX.test(value);
}

export function findHardcodedSecrets(source, filename) {
  const findings = [];
  const regex = /\b(api[_-]?key|apikey|secret[_-]?key|secret|password|passwd|private[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']([A-Za-z0-9+/=_.\-]{8,})["']/gi;
  let match;
  while ((match = regex.exec(source))) {
    const value = match[2];
    if (isPlaceholder(value)) continue;
    findings.push({
      type: 'hardcoded_secret',
      file: filename,
      function: `line:${lineAt(source, match.index)}`,
      severity: 'a_investigar',
      note: `Valor literal atribuído a um campo chamado "${match[1]}" — pode ser segredo real vazado ou só valor de teste/exemplo (confirmar manualmente). Contexto: "${contextSnippet(source, match.index)}"`,
    });
  }
  return findings;
}
