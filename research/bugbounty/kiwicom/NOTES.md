# Kiwi.com (HackerOne) — notas de pesquisa

## Rodada 2026-09-02 — pivô pra programas genuinamente novos (pedido explícito do usuário), achado real em `js-iam-middleware`

Depois do 5º relatório seguido fechado sem pagamento (Kubernetes,
duplicata de um report já existente fechado Informative), o usuário
pediu explicitamente: "quero que voce siga pelo melhor caminho até
encontrar e não repetir esses 5 relatorios que cairam em duplicate".
Isso motivou uma mudança deliberada de estratégia, não só de alvo:
todos os 5 achados anteriores eram bugs de **padrão conhecido**
(SSRF via redirect, command injection via `execSync`, comparação
`==` em vez de tempo-constante) em repositórios **muito populares**
(Next.js, Vercel CLI, Kubernetes core) — exatamente o tipo de bug que
qualquer scanner automatizado (inclusive o de outros pesquisadores)
encontra de forma idêntica. A hipótese pra reduzir risco de duplicata
desta vez: priorizar (a) programas genuinamente novos pra este
pipeline (menos pesquisadores já passaram por eles) e (b) bugs de
**lógica de negócio específica do código**, que exigem ler múltiplos
arquivos junto e rastrear o fluxo de dados manualmente — não um
padrão que um grep/semgrep genérico já capturaria.

`kiwicom/js-iam-middleware` foi promovido automaticamente pela rodada
de descoberta desta mesma sessão (rotação maior pedida pelo usuário).
Pacote pequeno e focado (`@kiwicom/iam`, 12 arquivos-fonte reais) —
middleware de autenticação/autorização (IAP do Google + diretiva de
autorização GraphQL) usado internamente pela Kiwi.com. Categoria
exatamente onde os achados reais desta sessão já saíram antes
(auth/credencial), mas aqui é lógica de aplicação específica, não um
primitivo criptográfico genérico.

### Achado: troca de posição de argumentos em `isUserAuthorized` → `getUser`

`src/authorizationDirective.ts::isUserAuthorized` tem assinatura
`(serviceUA, email, permission, iamURL, iamToken,
servicePermissionsIdentifier = "")` e chama internamente:

```ts
const user = await getUser(serviceUA, servicePermissionsIdentifier, email, iamURL, iamToken);
```

Essa chamada bate certinho com a assinatura de `getUser` (`serviceUA,
servicePermissionsIdentifier, email, iamURL, iamToken, fetcher`) — não
tem bug aqui. **O bug real está um nível acima**: dentro da classe
`AuthorizationDirective.visitFieldDefinition` (o código que roda de
verdade quando um campo GraphQL protegido é resolvido), a chamada a
`isUserAuthorized` é:

```ts
await isUserAuthorized(
  AuthorizationDirective.serviceUA,
  AuthorizationDirective.servicePermissionsIdentifier,  // <- posição 2
  email,                                                 // <- posição 3
  this.args.permission,                                  // <- posição 4
  AuthorizationDirective.iamURL,                         // <- posição 5
  AuthorizationDirective.iamToken,                       // <- posição 6
)
```

Mas `isUserAuthorized` espera, nessas mesmas posições, `(serviceUA,
email, permission, iamURL, iamToken, servicePermissionsIdentifier)`.
Ou seja: **todos os 5 argumentos depois do primeiro estão na posição
errada** — o identificador estático do serviço vai pro parâmetro
`email`, o e-mail real do usuário vai pro parâmetro `permission`, a
permissão exigida de verdade vai pro parâmetro `iamURL`, a URL real
do IAM vai pro parâmetro `iamToken`, e **o token de autenticação real
do serviço** (o segredo que autentica o serviço junto ao backend de
IAM) acaba no parâmetro `servicePermissionsIdentifier`.

### Achado forense: exatamente onde e quando isso quebrou (commit real, 31/03/2020)

`git log` completo (não superficial) mostra o commit exato:
`f1a1d76ec7c1dbab1ec059da2b0d6a3c6d9c3cc1` ("feat: add param for
permissions identification (#123)", Martin Bajanik, 31/03/2020).
O diff mostra o desenvolvedor inserindo o novo parâmetro
`servicePermissionsIdentifier` **corretamente** na chamada interna
`isUserAuthorized -> getUser` (2ª posição, batendo com a nova
assinatura de `getUser`), mas **inserindo o mesmo valor na posição
errada** na chamada externa `visitFieldDefinition -> isUserAuthorized`
(2ª posição também, mas `isUserAuthorized` só ganhou esse parâmetro
como o **6º**, opcional, no final da própria assinatura). Um erro
clássico de "atualizei uma das duas chamadas que precisavam mudar,
errei a posição na outra". **Confirmado que isso está live até hoje**:
o conteúdo de `authorizationDirective.ts` na tag mais recente (`v2.3.0`,
a versão real publicada no npm) é idêntico ao HEAD atual — 6+ anos sem
correção.

**Por que nunca foi pego**: `getUser.test.ts` existe e testa `getUser`
diretamente, com argumentos na ordem correta — nunca testa
`isUserAuthorized` nem `visitFieldDefinition`, que são exatamente onde
o bug mora. Não existe `authorizationDirective.test.ts`. `isUserAuthorized`
e `authorizationDirective` são o **padrão de uso documentado e
principal do pacote** pra GraphQL (README mostra exatamente esse
código como exemplo), não um canto morto.

### PoC real executado (não só lido/deduzido)

Transcrição fiel de `getUser.ts`/`authorizationDirective.ts` (linha por
linha, direto do repositório real) num script Node.js isolado, com
valores realistas simulando um deploy real:

- `serviceUA = "my-backend-service/1.0"`
- `servicePermissionsIdentifier = "my-backend-service"` (estático, configurado uma vez)
- `realUserEmail = "alice@example.com"` (varia por requisição)
- `requiredPermission = "read:billing-secrets"` (a permissão exigida pelo campo GraphQL protegido)
- `iamURL = "https://iam.internal.example.com"`
- `iamToken = "Bearer sk_live_REAL_SECRET_SERVICE_TOKEN_XYZ"` (o segredo real do serviço)

Rodado 2x: uma vez com um `fetcher` mock (só pra capturar URL/headers
sem tocar rede nenhuma), uma vez com o `node-fetch@2.6.x` REAL (a
dependência exata que o pacote usa, instalada e testada de verdade,
não suposta). Resultado real, capturado ao vivo:

```
URL requisitada de verdade:  read:billing-secrets/v1/user?service=bearer sk_live_real_secret_service_token_xyz&email=my-backend-service
Header Authorization enviado: https://iam.internal.example.com
```

Ou seja: **o token de autenticação real do serviço acaba embutido
dentro da URL da requisição** (como parâmetro de query, em vez de
dentro do header `Authorization` onde deveria estar), enquanto o
header `Authorization` carrega a URL do IAM (não-secreta) em vez do
segredo. Com o `node-fetch@2.6.x` real, isso falha com `TypeError:
Only HTTP(S) protocols are supported` (a URL malformada, começando
com `read:...`, não é reconhecida como HTTP(S)).

**O que isso prova e o que não prova, com honestidade**: prova, com
execução real contra a dependência real, que a diretiva de
autorização GraphQL deste pacote **nunca funciona como documentado**
— toda chamada lança exceção em vez de conceder ou negar acesso
corretamente (falha fechada, não aberta — não é um bypass de
autorização). O que É demonstrável como problema de segurança
independente disso: o segredo real do serviço é literalmente colocado
dentro de uma string de URL no processo de montar essa requisição —
uma classe conhecida (CWE-598-adjacente) de exposição de segredo via
query string, relevante mesmo que a requisição falhe, porque URLs são
tipicamente capturadas por infraestrutura de log/tracing com muito
mais frequência do que headers. Testei especificamente se a mensagem
de erro ecoa a URL/segredo de volta pra quem chama (o que tornaria
isso divulgação direta pra um atacante externo via resposta GraphQL)
— tanto com `fetch` nativo do Node quanto com o `node-fetch@2` real, a
mensagem de erro NÃO inclui a URL. Não afirmo essa versão mais forte
do achado porque testei e não se sustentou.

### Rodada de revisão externa (03/09/2026) — separando causa comprovada de consequência não comprovada

Revisão externa colada pelo usuário apontou, com precisão técnica
real, que o relatório usava "Leaks... into a Request URL" no título e
enquadrava o achado como CWE-598 (Insertion of Sensitive Information
Into Sent Data) — mas o próprio PoC mostra que o `node-fetch@2.6.x`
real lança `TypeError: Only HTTP(S) protocols are supported` **antes
de qualquer I/O de rede**. Ou seja: nunca provei o segredo saindo do
processo, só a montagem da string dentro dele. "Leak" implica
travessia de fronteira que não está demonstrada.

Retitulado e reestruturado em torno de **CWE-628 (Function Call with
Incorrectly Specified Arguments)** como causa raiz comprovada com
confiança total, com o problema do segredo-na-URL rebaixado
explicitamente a "defeito real, mas travessia de fronteira não
confirmada" — nunca mais chamado de "leak"/divulgação confirmada.

Também investiguei e respondi de verdade a pergunta mais interessante
da revisão: **o valor `permission` (que acaba no lugar de `iamURL`)
poderia ser controlado por um atacante, de forma a virar uma URL
`https://` válida e a requisição sair de verdade?** Confirmado que
NÃO: `AuthorizationDirective.graphql` declara
`directive @requires(permission: String!) on FIELD_DEFINITION` — é um
argumento de diretiva GraphQL, definido por quem escreve o schema, um
cliente GraphQL nunca influencia esse valor. O próprio README documenta
exemplos reais (`payment-card.read`, `payment-card.write` num campo
`paymentCard`) que reforçam: strings de permissão reais nesse pacote
nunca parecem uma URL — a falha observada é estrutural, não um
acidente do meu valor de exemplo escolhido.

Nenhum código mudou, nenhuma evidência nova de PoC — só a
correspondência entre o que é afirmado e o que está de fato provado.
Commit `d31666b`/`5a29d28`.

### Terceira revisão externa (03/09/2026) — a mais rigorosa até aqui, instrumentou rede de verdade

Usuário colou uma terceira revisão que instrumentou de verdade
`http`/`https`/DNS/TLS (confirmando zero chamada de rede), testou
`node-fetch@2.6.7` E `2.6.9`, e testou múltiplos formatos de
`permission`. Verifiquei cada afirmação checável de forma independente
antes de aplicar — todas bateram:

- `package.json` declara `node-fetch` como `^2.6.0` (faixa, não pin) —
  "pins" estava errado, corrigido.
- A diretiva SDL real é `@requires`, não `@authorization` — 3 correções.
- **CWE-683 (Function Call With Incorrect Order of Arguments)** é
  ChildOf CWE-628 confirmado ao vivo na própria página do MITRE, e é a
  classificação exata (ordem incorreta, não só "incorretamente
  especificado" genericamente) — trocado de 628 sozinho para 683
  como principal, 628 como pai/contexto.
- `getUser` faz `.toLowerCase()` no token antes de usar — "as plain
  text" estava impreciso.
- Meus próprios scripts de PoC omitem `userCache.get`/`.set` — "line-
  for-line transcription" era literalmente falso. Corrigido pra nomear
  a omissão e explicar por que não muda o resultado (a linha de cache-
  write nunca é alcançada nesse caminho quebrado de qualquer forma).
- **Testei eu mesmo, ao vivo**: o valor real documentado no README
  (`payment-card.read`) produz um erro DIFERENTE do meu exemplo
  inventado (`Only absolute URLs are supported` vs `Only HTTP(S)
  protocols are supported`) — ambos falham antes de I/O de rede, mas
  "the same failure" era impreciso. Citei o código-fonte real do
  `node-fetch` (`request.js::getNodeRequestOptions`) confirmando que os
  dois erros vêm do mesmo lugar, antes de qualquer socket abrir.
- Suavizado "every real invocation" (absoluto demais) e "primary usage
  pattern" (subjetivo) para o que foi de fato testado/documentado.
- Corrigido número de linha desatualizado (51 → 56-63).

Nenhum print precisou ser refeito — toda correção foi de precisão de
texto, não mudança no que os prints mostram ou no que os scripts fazem.
Commit `86cfda8`/`6f53908`.

### Quarta rodada (03/09/2026) — busca por consumidor real (negativa) + cadeia condicional verificada e corretamente descartada

**Busca por consumidor público real**: usuário propôs um plano de 3
passos (PoC de integração real, busca por consumidor, só então
considerar teste ao vivo). Rodei o passo 2 com o `gh` CLI já
autenticado neste projeto (a tentativa anônima anterior batia em
"Requires authentication"), 5 termos de busca diferentes, org
`kiwicom` inteira (193 repos públicos). Resultado: 100% dos hits vêm
do próprio `kiwicom/js-iam-middleware` — zero consumidor externo
público. Não descarta consumidor privado (limite estrutural de sempre),
mas fecha a hipótese de achar impacto real via GitHub público.

**Cadeia condicional com permissão em formato de URL — verificada e
corretamente excluída do relatório**: usuário trouxe uma análise
mostrando que, SE `@requires(permission: "http://...")` fosse um valor
real de schema, o token realmente sairia pela rede e o resolver seria
autorizado. Reproduzi isso eu mesmo com um servidor HTTP local real
(não simulado) — confirma exatamente: `authorized result: true`,
servidor recebeu `service=bearer%20mixed_case_token`. Mecanismo real,
mas **não vai pro relatório**: `permission` já está provado como
controlado só por quem escreve o schema (ponto 7 do call chain) — sem
isso, é uma corrente condicional que depende de uma pré-condição
impossível, exatamente o tipo de coisa que as revisões anteriores já
avisaram pra não forçar.

**Propagação de erro Non-Null do GraphQL — verificada com o pacote
`graphql` real**: confirma que erro num campo `Non-Null` zera a
resposta INTEIRA (`data: null`), mesmo com outro campo não-relacionado
pedido na mesma query. Isso é real e vale pro relatório — mudei o
título pra liderar com o impacto funcional/disponibilidade (bem mais
defensável) em vez de "token na URL" (sempre secundário), e adicionei
esse fato ao Impact.

**Decisão consciente de NÃO reconstruir a PoC como integração GraphQL
completa** (instalar `@kiwicom/iam@2.3.0` do npm de verdade, servidor
`apollo-server`/`graphql-tools` real, controle positivo) — melhoraria
o rigor da PoC mas não muda a conclusão de impacto, e custaria uma 3ª
rodada de print do usuário pra ganho marginal. Registrado como parada
deliberada, não descuido.

Commit `1575137`.

### Quinta rodada (03/09/2026) — precisão contra a especificação real do GraphQL + limpeza final de wording

Revisão apontou que minha afirmação sobre `Non-Null` estava ampla
demais: só zera a resposta INTEIRA se TODO campo da raiz até o erro
for Non-Null, não qualquer campo Non-Null em qualquer lugar. Verifiquei
contra a especificação real (`spec.graphql.org`, seção 6 Execution) —
confirmado, texto literal: "If all fields from the root of the request
to the source of the field error return Non-Null types, then the
'data' entry in the response should be null." Reescrito com precisão.

Mais uma leva de correções de wording, todas aplicadas: "throws
synchronously" → "returns a rejected promise before http.request, DNS
resolution, or socket creation" (mais preciso, são funções async, não
throw síncrono); "the real IAM token" → "lowercased token value" nos
pontos que descrevem o valor final na URL; removido "the version real
consumers install"/"not an unused code path" (não provados); "well-
tested in isolation" → "has a passing isolated cache test"; removida
inteiramente a especulação sobre custom fetcher/APM do Impact (não
prova disclosure, só convida contestação).

**Achado real de processo**: o zip da PoC só existia em
`E:\dev-toolchains\poc-repos\`, nunca dentro da pasta `ready-to-submit`
— reconstruído com o novo script `verify-nonnull-propagation.mjs` (usa
o pacote `graphql` real, output real já capturado) e colocado
diretamente dentro da pasta de entrega, testado via extração limpa do
zero (round-trip completo: `npm install` + os 3 scripts, tudo bate).

Título mudou mais uma vez: "...Reject Every Protected Field
Resolution" (absoluto demais) → "...Breaks the Documented GraphQL
@requires Authorization Flow" (o que está realmente provado).

Commit `f93b6f8`.

### Escopo confirmado

`kiwicom/js-iam-middleware` nunca tinha snapshot de escopo formal
capturado (mesmo gap já visto em Kubernetes/OKG antes desta sessão
cobri-los) — bloqueava `check-scope`. Adicionado bloco Kiwi.com em
`capture-scope-snapshots.mjs` (mesmo padrão, confidence "medium"), 2
testes novos, `check-scope` confirmado ao vivo:
`{allowed: true, bountyEligible: true, maxSeverity: "high"}`.

### Duplicate-check

Busquei por `isUserAuthorized`, `argument`, `authorization` nas
issues/PRs do repositório (API do GitHub, sem necessidade de
autenticação) — zero resultado relacionado. Um resultado
inicialmente alarmante (PR #209, título literal "HackerOne Bug Bounty
program") investigado a fundo: só altera `package.json`/`package-
lock.json`/`yarn.lock`, provavelmente um PR administrativo/automatizado
de setup do programa, sem relação nenhuma com este achado. Zero GitHub
Security Advisories no repositório. `getUser.test.ts` existe (testa só
`getUser` direto, args corretos) mas não existe
`authorizationDirective.test.ts` nenhum — confirma que esse caminho
específico nunca foi coberto por teste automatizado, reforçando a
lição de que "grep some pattern" nunca acharia isso, precisa ler os
dois arquivos juntos e rastrear posição de argumento manualmente.

## Rodada 2026-09-03 (agente de nuvem) — 46 candidatos de `known_vulnerable_dependency`/`semgrep_*` refutados, releitura independente de `authorizationDirective.ts` confirma achado anterior

Fila `candidate` desta rodada não continha nenhum achado dos 4
programas mencionados no prompt agendado (StackingDAO/Vercel/Block/
Circle) — só Kiwi.com, Kubernetes e Plaid (programa novo, descoberto
02/09). `program-policy.json` já bloqueia Block Open Source
(`aiResearchBanned`, RoE explícita do Bugcrowd) e Circle BBP (pedido
direto do usuário) — nenhum dos dois foi tocado, achados/pesquisa
antigos deles intactos.

Todos os 46 candidatos de Kiwi.com nesta rodada (1
`known_vulnerable_dependency` em `k8s-vault-operator/go.mod`
[go-jose, `// indirect`, sem call site] + 45 em
`js-iam-middleware/yarn.lock`) foram refutados como falso-positivo,
com leitura real de código pra cada categoria (não só "presença no
manifesto"):

- `jsonwebtoken@8.5.1`/`jws@3.2.2`: `validateIAPToken.ts` chama
  `jwt.verify(iapToken, pubKey, {algorithms: ["ES256"]})` — algoritmo
  travado explicitamente, exatamente a mitigação que as duas CVEs
  publicadas (GHSA-hjrf-2m68-5959/CVE-2022-23541,
  GHSA-8cf7-32gw-wr33/CVE-2022-23539) exigem verificar via advisory
  oficial. Nenhuma das duas precondições (mistura simétrico/assimétrico
  na mesma função de retrieval; combinação chave-algoritmo inválida)
  existe no código real.
- `node-fetch@2.6.1`: usado só contra URL fixa do Google IAP
  (gstatic.com), sem headers sensíveis nem redirect cross-origin — a
  CVE (vazamento de header em redirect) não se aplica.
- `body-parser`/`path-to-regexp` (transitivos do `express`): `express`
  é importado só pelos tipos TS (`Request`/`Response`/`NextFunction`),
  nunca instanciado como app — não alcançável pelo código próprio do
  pacote.
- Demais 40 pacotes: confirmados via `package.json` real como
  devDependency-only (ferramental de build/release: eslint, ava, ts-
  node, semantic-release e seus transitivos) — nunca publicados no
  npm (`files` só inclui `dist`), nunca instalados por consumidor do
  pacote.

Enquanto investigava `jsonwebtoken`, li `authenticationMiddleware.ts`
e (pra 3º arquivo de leitura profunda proativa da rodada)
`getUser.ts`/`userCache.ts`, que levaram de volta a
`authorizationDirective.ts` — e reproduzi, só de leitura (sem rodar
nada), o EXATO mesmo achado de troca de posição de argumento já
documentado acima (`isUserAuthorized` chamada de dentro de
`visitFieldDefinition` com os 5 argumentos finais fora de ordem).
Confirma independentemente a análise anterior, incluindo a conclusão
de que falha fechada (nega acesso, não é bypass) — não é achado novo,
o finding `Kiwi.com::kiwicom/js-iam-middleware/src/
authorizationDirective.ts::visitFieldDefinition::positional_argument_mismatch`
já está em `human_ready` aguardando decisão humana, não recriado nem
tocado nesta rodada. `userCache.ts` tem o mesmo padrão de lookup por
chave dinâmica (`this.cache[identifier]` com `identifier` derivado de
email do usuário) que `getPubKey`/`cachedKeys`, mas o formato da chave
(`${email}:${service}`, sempre com sufixo) impede a colisão com
`"__proto__"` que existe em `cachedKeys` — não é um problema.
