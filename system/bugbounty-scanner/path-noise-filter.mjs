// Filtro compartilhado (OSV-Scanner + Semgrep -- mesma causa raiz, dois
// lugares) pra path que NUNCA é atacável de verdade: fixture de teste,
// template de demo, mock. Achado real, pego rodando OSV-Scanner ao vivo
// contra `vercel/vercel` (monorepo oficial do Vercel Open Source, não
// um submódulo de terceiro -- por isso o fix de "não inicializar
// submódulo" do Slither/OSV-Scanner não ajuda aqui, causa raiz diferente):
// 4364 "vulnerabilidade" reportadas, 4283 (98%) em `examples/*` (templates
// de demo tipo "como fazer deploy de Gatsby na Vercel", nunca executado
// contra tráfego real) ou `**/test/fixtures/**` (yarn.lock CONGELADO de
// propósito dentro de teste do detector de build -- existe só pra
// determinismo do teste, nunca é instalado/rodado de verdade). Sobrou
// 81 achado genuíno (pnpm-lock.yaml da raiz do repo, código real em
// packages/cli/src/**).
//
// Checagem por SEGMENTO exato do path (não substring cru) -- evita falso
// positivo tipo um diretório real chamado `latest/` ou `contest/` sendo
// pego por engano por um match de substring em "test".
//
// NUNCA inclui `vendor/` aqui de propósito: vendor É código real,
// compilado/embarcado no binário final (diferente de fixture de teste),
// uma dependência vendorizada pode muito bem ser genuinamente alcançável.
const NOISE_SEGMENTS = new Set([
  'examples', 'example', 'demo', 'demos', 'sample', 'samples',
  'test', 'tests', '__tests__', 'testdata',
  'fixture', 'fixtures', '__fixtures__',
  'mock', 'mocks', '__mocks__',
]);

/** true quando algum segmento do path (relativo ao repo) é uma pasta de
 * teste/demo/fixture/mock conhecida -- sinal de que o "achado" ali dentro
 * nunca roda contra tráfego real, então nunca deveria virar `candidate`. */
export function isNonProductionPath(relativePath) {
  if (!relativePath) return false;
  return relativePath.split('/').some((segment) => NOISE_SEGMENTS.has(segment.toLowerCase()));
}
