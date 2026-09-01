# ⚠️ RASCUNHO — REVISÃO HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de análise de código-fonte
público. **PoC não foi executada ao vivo, por decisão consciente, não
por limitação de ferramental** — ver seção "Prova de conceito
executável" abaixo para o motivo exato. **Não foi enviado a nenhuma
plataforma.** Antes de copiar/colar e enviar, confira:

- [ ] Escopo confirmado — o ativo afetado está no escopo do programa AGORA
      (escopo pode mudar; reconfirme na página do programa antes de enviar)
- [ ] Categoria confirmada — bate com uma categoria que o programa
      declara como elegível para recompensa (não é metadado/cosmético)
- [ ] Evidência conferida — os trechos de código citados realmente
      existem como descrito — reconfirme o SHA atual de `canary` antes
      de enviar, o código pode ter mudado desde a última verificação
- [ ] Não é duplicata — checado contra os 61 security advisories
      públicos do repositório e contra issues/PRs abertos (ver seção de
      evidência); reconfirme na Hacktivity/seus próprios envios antes
      de enviar

---

## Título
SSRF via Redirect Allowlist Bypass in Next.js Image Optimizer (`images.remotePatterns`/`domains`)

## Programa / Plataforma
Vercel Open Source via HackerOne — https://hackerone.com/vercel-open-source

## Categoria / Severidade declarada
Server-Side Request Forgery (CWE-918). `asset_type: Source Code`,
target `vercel/next.js`, `eligible_for_bounty: true`, `max_severity:
critical` (confirmado via `cli.mjs check-scope "Vercel Open Source"
"vercel/next.js"`). Não estou autoatribuindo Critical — esse é o teto
do ativo, não uma avaliação desta vulnerabilidade específica. A
exploração depende de um pré-requisito externo específico (ver
"Pré-requisitos" e "Impacto"), então recomendo deixar a severidade
final para a calculadora/triagem do programa.

## Ativo afetado
- Repositório: `vercel/next.js`
- Arquivos:
  - `packages/next/src/server/image-optimizer.ts` (validação de
    entrada e lógica de fetch/redirect)
  - `packages/next/src/shared/lib/match-remote-pattern.ts` (matching de
    hostname contra `remotePatterns`)
- Linhas: `image-optimizer.ts` L159-236 (`validateParams`), L233
  (chamada a `hasRemoteMatch`), L521-587 (`fetchExternalImage`,
  recursão de redirect em L580-586); `match-remote-pattern.ts`
  (`hasRemoteMatch`/`matchRemotePattern`, uso de `picomatch.makeRe`)
- Commit no momento da última reconfirmação: `9c626ac94b8bcd8195e4f4d789824f90e0c95fe5`
  (branch `canary`) — reconfirmado ao vivo contra este SHA em rodada
  independente após a análise original, achado permanece idêntico.

## Resumo
O único ponto onde o Next.js valida a URL de uma imagem externa contra
o allowlist configurado pelo desenvolvedor (`images.remotePatterns`/
`domains`) é `ImageOptimizerCache.validateParams`, chamado UMA VEZ, na
entrada do fluxo. Se a resposta do host (já allowlisted) for um
redirect HTTP, `fetchExternalImage` segue esse redirect chamando a si
mesma recursivamente — mas nunca revalida o novo host contra o mesmo
allowlist. Isso permite que qualquer host configurado em
`remotePatterns` que possa ser induzido a responder com um redirect
sirva como trampolim para o Next.js buscar conteúdo de QUALQUER outro
host público, contornando por completo a garantia de segurança que
`images.remotePatterns` documenta oferecer.

## Cadeia de chamada confirmada
1. `image-optimizer.ts:159-236` (`ImageOptimizerCache.validateParams`)
   — para URL absoluta, exige `hasRemoteMatch(domains, remotePatterns,
   hrefParsed)` (linha 233); se não bater com nenhum `domain`/
   `remotePattern` configurado, rejeita com HTTP 400. Este é o único
   ponto de entrada validado.
2. `match-remote-pattern.ts` (`hasRemoteMatch`/`matchRemotePattern`) —
   confirma que `pattern.hostname` é testado via
   `picomatch.makeRe(pattern.hostname).test(url.hostname)`, suportando
   hostname com wildcard (`**.example.com`) — padrão documentado do
   Next.js, tipicamente usado para CDN/bucket de conteúdo
   gerado por usuário com subdomínio variável.
3. Uma vez validada, a URL segue para `fetchExternalImage(href,
   dangerouslyAllowLocalIP, maximumResponseBody)`. Dentro dela
   (`image-optimizer.ts:521-587`): se a resposta é um redirect
   (301/302/303/307/308, `isRedirect()`), o código monta `const
   redirect = new URL(locationHeader, href).href` e **chama
   `fetchExternalImage` recursivamente com essa NOVA URL** (linhas
   580-586) — sem nunca voltar a chamar `hasRemoteMatch`/
   `validateParams`. Essas duas funções só aparecem no método estático
   de entrada, nunca dentro de `fetchExternalImage`.
4. A única checagem que a chamada recursiva ainda aplica ao novo host é
   `isPrivateIp` (bloqueia IP privado/loopback/link-local, quando
   `dangerouslyAllowLocalIP` é `false`) — nenhuma validação de que o
   host de destino do redirect ainda bate com `remotePatterns`/
   `domains`.
5. Confirmado que os testes existentes não cobrem este caminho:
   `test/unit/image-optimizer/fetch-external-image.test.ts` testa só o
   guard de IP privado com IP literal (sem DNS, sem redirect
   cross-host); `test/e2e/image-optimizer/maximum-redirects-1.test.ts`
   testa redirect só para um path RELATIVO no MESMO host de teste
   (`new URL('/slow.png', href)` preserva o host) — nenhum teste cobre
   redirect para um host DIFERENTE do que foi validado.

## Pré-requisitos
Um host já presente em `images.remotePatterns`/`domains` da aplicação
alvo que possa ser induzido a responder com um redirect HTTP para outro
host — por exemplo: um bucket de armazenamento (S3 e equivalentes
suportam redirect por objeto via metadata de "website redirect"), um
CDN/proxy de terceiro cujo comportamento de redirect não é 100%
controlado pelo dono da aplicação, ou qualquer serviço allowlisted que
aceite conteúdo/configuração de usuário influenciando sua resposta.
Nenhuma conta ou dado de usuário real necessário para demonstrar a
mecânica em si (ver "Prova de conceito executável").

## Passo a passo de reprodução
**Não executado ao vivo — ver seção de PoC abaixo para o motivo.**
Passo a passo tal como a cadeia de código implica, caso um host
allowlisted seja induzido a redirecionar:

1. Aplicação configura `images.remotePatterns` incluindo um host de
   armazenamento de conteúdo de usuário (ex.: um bucket S3 com hosting
   estático habilitado).
2. Atacante consegue fazer esse host responder com um redirect (ex.:
   fazendo upload de um objeto com metadata `x-amz-website-redirect-location`
   apontando para `https://internal-service.local/admin` ou qualquer
   outro host público arbitrário).
3. Requisição: `GET /_next/image?url=https://<host-allowlisted>/objeto-redirecionador&w=128&q=75`.
4. `validateParams` valida a URL inicial contra `remotePatterns` —
   passa, pois o host inicial está genuinamente na allowlist.
5. `fetchExternalImage` recebe o redirect do host allowlisted, monta a
   nova URL e chama a si mesma recursivamente **sem revalidar contra
   remotePatterns** — apenas o guard de IP privado é reaplicado.
6. Se o destino do redirect não for um IP privado, o Next.js busca e
   processa o conteúdo desse host arbitrário como se fosse a imagem
   original.

## Resultado atual vs. esperado
- **Atual:** `remotePatterns`/`domains` só é aplicado ao host da URL
  inicial da requisição; qualquer redirect subsequente (até
  `maximumRedirects`, padrão 3) muda de host livremente, restrito
  apenas por um filtro de IP privado.
- **Esperado:** cada hop de redirect deveria revalidar o novo host
  contra o mesmo `hasRemoteMatch`/`remotePatterns` antes de segui-lo —
  exatamente a mesma garantia aplicada à URL inicial.

## Evidência
`image-optimizer.ts` — único ponto de validação, dentro do método
estático de entrada:
```ts
// ImageOptimizerCache.validateParams (L159-236)
if (!hasRemoteMatch(domains, remotePatterns, hrefParsed)) {
  return { errorMessage: '"url" parameter is not allowed' }
}
```

`image-optimizer.ts` — `fetchExternalImage`, recursão de redirect sem
revalidação (reconstrução fiel da lógica lida, não paráfrase da
intenção):
```ts
// fetchExternalImage (L521-587)
if (isRedirect(res.status) && res.headers.get('location')) {
  const redirect = new URL(res.headers.get('location')!, href).href
  // isPrivateIp ainda é checado para o novo host --
  // hasRemoteMatch/validateParams NUNCA são chamados aqui.
  return fetchExternalImage(redirect, dangerouslyAllowLocalIP, maximumResponseBody)
}
```

`match-remote-pattern.ts` — onde a validação que deveria ser reaplicada
vive, hoje só alcançável a partir do método estático de entrada:
```ts
export function hasRemoteMatch(domains, remotePatterns, url) {
  return (
    domains.some((domain) => url.hostname === domain) ||
    remotePatterns.some((p) => matchRemotePattern(p, url))
  )
}
```

**Verificação de duplicata (feita a fundo, não superficial)**: busquei
os 61 security advisories públicos do repositório `vercel/next.js`.
Nenhum cobre este caminho específico. Os dois mais próximos em tema são
mecanismos completamente diferentes: "Improper Middleware Redirect
Handling Leads to SSRF" (CVE-2025-57822) é sobre headers de requisição
refletidos via `NextResponse.next()` no Middleware, não sobre o Image
Optimizer; "SSRF in rewrites via attacker-controlled destination
hostname" (CVE-2026-64645) é sobre hostname dinâmico em regras
`rewrites()`/`redirects()` do `next.config.js`, também um subsistema
diferente. Busquei ainda issues/PRs mencionando `remotePatterns` +
`redirect`: encontrei a PR #92338 ("prevent DNS rebinding SSRF via
IP-pinned fetch agent"), mas ela (a) está aberta e sem CI aprovado há 5
meses, de uma conta externa não-mantenedora, nunca revisada por
mantenedor; (b) mesmo que fosse levada a sério, cobre só a race
condition de DNS rebinding no filtro de IP privado — nunca menciona
revalidar `remotePatterns` contra o host do redirect, que é o ponto
central deste achado. Reconfirmado o achado duas vezes, em sessões
independentes, contra dois clones frescos em SHAs diferentes do HEAD de
`canary` — permanece idêntico.

## Prova de conceito executável
**Não executada — `not_applicable`, por decisão consciente, não por
falta de caminho técnico.** Demonstrar isso de ponta a ponta exigiria
um host real, já configurado em `remotePatterns` de uma aplicação
real, que possa ser induzido a redirecionar — ou seja, teria que
envolver infraestrutura de terceiro fora do meu controle, o que não
tentei. A mecânica em si (`new URL(location, href)` seguido de fetch
recursivo sem nova validação) é lida linha a linha do código-fonte
real, não inferida por analogia, e o comportamento de `fetch`/redirect
HTTP é padrão e determinístico — não uma hipótese sobre o
funcionamento do runtime. Recomendo ao time do Next.js reproduzir
localmente: qualquer servidor de teste sob controle deles que responda
o allowlist inicial e depois um `Location:` para um segundo host já
demonstra a ausência de revalidação, sem precisar de nenhum serviço de
terceiro real.

## Impacto
Uma aplicação que configura `images.remotePatterns`/`domains`
esperando que ISSO restrinja de onde o Next.js busca conteúdo externo
tem essa garantia quebrada assim que qualquer host já allowlisted pode
ser levado a redirecionar — cenário plausível para buckets de
armazenamento de conteúdo de usuário, CDNs de terceiro, ou qualquer
serviço allowlisted fora do controle direto de quem configurou a
aplicação. Uma vez contornado o allowlist, o único freio restante é o
filtro de IP privado, que:
- Bloqueia alvos claramente internos (127.0.0.1, 169.254.169.254,
  etc.) quando resolvidos no momento da checagem, mas
- Tem sua própria janela TOCTOU entre a resolução DNS da validação e a
  resolução DNS do `fetch()` real (chamadas independentes) — um host
  com TTL de DNS baixo controlado pelo atacante pode responder IP
  público na checagem e IP interno no fetch real (DNS rebinding
  clássico), tornando mesmo esse freio contornável em certas condições.
- Não impede SSRF contra outros serviços públicos não-privados de
  forma alguma — o allowlist do desenvolvedor é a garantia documentada
  contra isso, e é exatamente o que este achado contorna.

Mesmo sem alcançar um alvo interno, a aplicação processa (via `sharp`)
e serve conteúdo de um host que o desenvolvedor nunca autorizou — uma
violação direta do modelo de segurança que `images.remotePatterns`
promete.

## Correção sugerida
Chamar `hasRemoteMatch(domains, remotePatterns, new URL(redirect))`
dentro de `fetchExternalImage` antes de seguir cada hop de redirect —
mesma checagem já aplicada na entrada, só que reaplicada a cada
mudança de host, não só uma vez. Complementarmente (endereça o ponto
secundário de TOCTOU/DNS rebinding, não o achado principal): fixar o
IP já resolvido na validação de IP privado via um agente HTTP
customizado com `lookup` fixo, em vez de deixar o `fetch()` real
re-resolver o DNS de forma independente.

---
*Gerado manualmente em 2026-09-01 a partir de achado descoberto por
leitura de código dirigida, reconfirmado de forma independente duas
vezes, registrado como
`Vercel Open Source::vercel/next.js/packages/next/src/server/image-optimizer.ts::fetchExternalImage::ssrf_redirect_allowlist_bypass_risk`
no banco compartilhado, estado `corroborated_static`. Ver histórico
completo do veredito em `ledger/ledger.research.jsonl` e contexto da
investigação em `research/bugbounty/vercel-open-source/NOTES.md`.*
