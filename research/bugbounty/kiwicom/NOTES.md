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
