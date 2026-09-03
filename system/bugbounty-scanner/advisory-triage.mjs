// Fecha, de forma permanente, a maior fatia do backlog descoberto em
// 03/09/2026: 202/394 candidatos brutos (51%) eram `known_vulnerable_dependency`
// -- uma CVE/GHSA já PUBLICADA num manifesto de dependência. Isso não é
// "não investigado ainda", é estruturalmente não-novo por construção: o
// próprio conceito de "advisory publicado" É a divulgação pública que
// state-machine.mjs::known_duplicate já exige (knownIssueSource com
// título+tipo+url rastreável). Sem isto, cada rodada de descoberta só
// empilha mais desses no estado `candidate` pra sempre, sem nunca virar
// sinal nem ruído explícito -- exatamente o tipo de acúmulo que motivou
// a revisão externa inteira desta sessão.
//
// NUNCA fecha como false_positive: o CVE é real, a dependência realmente
// está no manifesto. O que nunca foi verificado é ALCANÇABILIDADE (o
// código vulnerável é de fato importado/chamado) -- e isso continua
// exatamente como estava, sem fingir uma investigação que não aconteceu.
// known_duplicate é o veredito certo porque captura os dois fatos ao
// mesmo tempo: comportamento real (a CVE existe), mas não é novo (já
// divulgado publicamente, rastreável).

const GHSA_PATTERN = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i;

/** Extrai um GHSA ID do texto de reasoning do osv-scanner-runner.mjs, se
 * existir. Pura -- só regex sobre uma string. */
export function extractGhsaId(reasoning) {
  const match = String(reasoning || '').match(GHSA_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Decide se um finding `known_vulnerable_dependency` pode ser
 * auto-triado como known_duplicate, e monta o knownIssueSource
 * necessário. Devolve `null` quando não há GHSA extraível no reasoning
 * -- nunca inventa uma fonte, deixa o achado como candidate mesmo
 * (achado real: 21/202 tinham reasoning vazio, sem nenhum id --
 * provavelmente uma falha de parsing anterior no osv-scanner-runner.mjs,
 * documentado como gap separado, não escondido aqui fingindo sucesso).
 * Pura -- recebe o finding já carregado, não toca banco nem rede.
 */
export function knownIssueSourceForVulnerableDependency(finding) {
  if (finding?.type !== 'known_vulnerable_dependency') return null;
  const ghsaId = extractGhsaId(finding.reasoning);
  if (!ghsaId) return null;
  return {
    title: `Vulnerabilidade de dependência já publicada (${ghsaId})`,
    sourceType: 'advisory',
    url: `https://github.com/advisories/${ghsaId}`,
  };
}
