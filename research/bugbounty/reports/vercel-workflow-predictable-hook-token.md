# ⚠️ RASCUNHO — REVISÃO HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de análise de código-fonte
público (e prova de conceito executada localmente via `node --test`,
usando apenas as dependências públicas já fixadas pelo próprio projeto —
nunca contra o sistema real). **Não foi enviado a nenhuma plataforma.**
Antes de copiar/colar e enviar, confira:

- [ ] Escopo confirmado — o ativo afetado está no escopo do programa AGORA
      (escopo pode mudar; reconfirme na página do programa antes de enviar)
- [ ] Categoria confirmada — bate com uma categoria que o programa
      declara como elegível para recompensa (não é metadado/cosmético).
      **Nota honesta**: o snapshot local de escopo (`scope-snapshots/vercel-open-source.json`)
      não lista categorias declaradas explicitamente (dataset comunitário,
      sem granularidade por categoria); todos os 19 alvos, incluindo
      `vercel/workflow`, estão marcados `severity: critical`,
      `eligible_for_bounty: true`. Confirme na página real do programa em
      HackerOne qual rótulo exato de categoria (ex. "Improper
      Authentication" / "Insecure Randomness" / "Broken Access Control")
      se aplica antes de enviar.
- [ ] Evidência conferida — os trechos de código e a saída da prova de
      conceito realmente existem/rodaram como descrito (não foi
      paráfrase/alucinação)
- [ ] Anterioridade pública checada e registrada — issues/PRs, advisories e
      Hacktivity/busca web, com pelo menos duas formulações e timestamp
      (**NÃO FEITO NESTA RODADA** — ver nota em Impacto)
- [ ] Risco de duplicata aceito conscientemente — busca pública limpa significa
      `private_unknown`, nunca prova que não existe report privado anterior
- [ ] Impacto estruturado confirmado — atacante, vítima, fronteira de
      segurança, resultado observável e C/I/A sustentados pela PoC
      a este programa

---

## Título
Token de hook/webhook em `vercel/workflow` é derivável a partir de metadados não-secretos do run (runId/workflowName/deploymentId ou startedAt), quebrando a única autorização documentada do endpoint público de webhook

## Programa / Plataforma
`Vercel Open Source` via `HackerOne` — programa cobre (entre outros)
`https://github.com/vercel/workflow`, listado no dataset comunitário
(`arkadiyt/bounty-targets-data`) como `severity: critical`,
`eligible_for_bounty: true`.

## Categoria / Severidade declarada
Mapeamento tentativo (não confirmado contra a página exata do programa,
ver checklist acima): **Improper Authentication / Insecure Use of
Cryptographic Primitives (uso de PRNG não-criptográfico e previsível para
gerar um segredo de autorização)** — CWE-330 (Use of Insufficiently
Random Values) / CWE-341 (Predictable from Observable State). Não é
achado cosmético/metadado: o próprio produto documenta o valor afetado
como "the only authorization" de um endpoint HTTP público.

## Ativo afetado
- Repositório: `vercel/workflow`
- Arquivos:
  - `packages/core/src/vm/index.ts` (linhas 52-61: `createContext`, `const rng = seedrandom(seed); g.Math.random = rng;`)
  - `packages/core/src/workflow.ts` (linhas 406-412 no HEAD analisado / linha 81 no pacote `dist/workflow.js` publicado: construção do `seed`; linhas 461-466: `generateUlid`/`generateNanoid`)
  - `packages/core/src/workflow/hook.ts` (linhas 98-99: `createHookImpl`, geração de `correlationId`/`token`)
  - `packages/core/src/workflow/create-hook.ts` (linhas 56-74: `createWebhook`, confirma ausência de opção de token customizado)
  - `packages/core/src/runtime/run-id-time.ts` (linhas 33-42: `runIdCreatedAt`, decodifica timestamp direto do `runId`)
- Linha(s) chave: `vm/index.ts:53,61`; `workflow.ts:412` (branch v5-beta, HEAD do GitHub) / `dist/workflow.js:81` (pacote publicado `@workflow/core@4.8.5`, dist-tag `latest`); `workflow/hook.ts:98-99`
- Commit/branch no momento da análise: HEAD do GitHub em
  `22a9668dcf51f9799c26be0a4c144670df46101e` (branch `main`, corresponde ao
  pacote publicado `@workflow/core@5.0.0-beta.48`, dist-tag `beta`).
  **Confirmado também na versão estável publicada `@workflow/core@4.8.5`**
  (dist-tag `latest`, a que qualquer `npm install workflow`/`@workflow/core`
  instala hoje sem opt-in de beta) — baixada diretamente do registry npm,
  não inferida. Reconfirmar SHA atual do branch `main` antes de enviar —
  o código pode ter mudado desde a varredura.

## Resumo
`createHook()`/`createWebhook()` geram um token de autorização usando um
PRNG determinístico (`seedrandom`, necessário para replay determinístico
do motor de workflows) semeado por `runId:workflowName:deploymentId`
(branch `main`/v5-beta) ou `runId:workflowName:+startedAt` (pacote
publicado estável 4.8.5) — três valores que a própria documentação e API
do produto tratam como **não-secretos** (`runId` é o identificador de
rotina aceito por `getRun(runId)`; `workflowName` é um literal do
código-fonte da aplicação; `deploymentId`/`startedAt` são metadados de
run/deployment rotineiramente visíveis). A documentação oficial declara
que, para `createWebhook()`, esse token é **"the only authorization
performed for incoming requests"** no endpoint público
`/.well-known/workflow/v1/webhook/:token`. Como o token não carrega
nenhuma entropia própria — é uma função determinística e 100%
reproduzível dos três valores acima — qualquer parte capaz de saber (ou
inferir) `runId`+`workflowName`+`deploymentId`/`startedAt` de um run
alheio pode recalcular localmente o mesmo token, sem nunca precisar
interceptá-lo, e usá-lo para chamar `resumeHook()`/`resumeWebhook()` e
injetar payload arbitrário num workflow em execução de outra parte —
por exemplo, auto-aprovar um fluxo de aprovação humana ou forjar o
callback de um provedor OAuth/pagamento que o desenvolvedor pretendia
manter secreto até ser entregue pelo canal legítimo (e-mail, `redirect_uri`, etc.).

## Cadeia de chamada confirmada
1. `packages/core/src/vm/index.ts:52-61` (`createContext`) —
   `const rng = seedrandom(seed); ... g.Math.random = rng;`. Todo
   `Math.random()` dentro da VM sandboxed do workflow passa a vir deste
   PRNG semeado (não de entropia real do host). O mesmo arquivo (linhas
   ~90-93) também redireciona `crypto.getRandomValues` para o mesmo `rng`.
2. `packages/core/src/workflow.ts:406-412` (branch analisado) chama
   `createContext({ seed: \`${workflowRun.runId}:${workflowRun.workflowName}:${workflowRun.deploymentId}\`, fixedTimestamp })`.
   No pacote **publicado e estável** `@workflow/core@4.8.5`
   (`dist/workflow.js:81`), a mesma construção usa
   `\`${workflowRun.runId}:${workflowRun.workflowName}:${+startedAt}\`` —
   variante confirmada, mesma vulnerabilidade estrutural.
3. `packages/core/src/runtime/run-id-time.ts:33-42` (`runIdCreatedAt`) —
   decodifica o `fixedTimestamp` DIRETO do próprio `runId` via
   `decodeTime(decode(ulidPart))`, formato ULID público e documentado.
   Ou seja, nenhuma informação além do `runId` é necessária para obter
   este componente do seed.
4. `packages/core/src/workflow.ts:461-466` — `generateUlid` (via
   `monotonicFactory(() => vmGlobalThis.Math.random())`) e
   `generateNanoid` (via `nanoid.customRandom(urlAlphabet, 21, size => ...Math.random()...)`)
   consomem o mesmo stream do `rng` semeado acima.
5. `packages/core/src/workflow/hook.ts:98-99` (`createHookImpl`) —
   `const correlationId = \`hook_${ctx.generateUlid()}\`; const token = options.token ?? ctx.generateNanoid();`.
6. `packages/core/src/workflow/create-hook.ts:56-74` (`createWebhook`)
   chama `createHook({ ...rest, isWebhook: true })` e **explicitamente
   rejeita** a opção `token`: `"`createWebhook()` does not accept a
   `token` option. Webhook tokens are always generated for you."` — ou
   seja, para webhooks o caminho de `generateNanoid()` acima é sempre o
   único gerador do token, nunca substituível por uma entropia mais forte
   escolhida pelo desenvolvedor.
7. Documentação oficial (`docs/content/docs/v5/api-reference/workflow/create-webhook.mdx`):
   `"createWebhook() creates a public endpoint at
   /.well-known/workflow/v1/webhook/:token, and the token in that URL is
   the only authorization performed for incoming requests resuming that
   webhook."` — confirma que este é o único gate de autorização do
   endpoint.
8. Documentação oficial (`docs/content/docs/v5/api-reference/workflow-api/get-run.mdx`):
   `const run = getRun("my-run-id")` — confirma `runId` como identificador
   de rotina, não secreto, aceito por uma API de leitura pública dentro do
   próprio produto.

## Pré-requisitos
Nenhuma conta ou acesso privilegiado ao alvo real. Só as dependências
públicas já fixadas pelo próprio projeto (`seedrandom@3.0.5`,
`nanoid@5.1.6`, `ulid@3.0.1` — versões exatas de
`packages/core/package.json`), instaladas localmente via `npm install`.
Nenhum dado ou conta de usuário real foi usado — os valores de
`runId`/`workflowName`/`deploymentId`/`fixedTimestamp` no PoC são
exemplos sintéticos com o formato correto, não dados reais de nenhum run.

## Passo a passo de reprodução
1. Instalar localmente as versões exatas fixadas pelo projeto:
   `npm install seedrandom@3.0.5 nanoid@5.1.6 ulid@3.0.1`.
2. Simular o processo "vítima" (o runtime real, executado uma vez): gerar
   `seed = \`${runId}:${workflowName}:${deploymentId}\`` com valores de
   exemplo, instanciar `seedrandom(seed)`, e chamar
   `generateUlid()`/`generateNanoid()` na mesma ordem do código real
   (`hook.ts:98-99`) para obter `correlationId` e `token`.
3. Simular o processo "atacante" (sem qualquer acesso ao processo real):
   com SOMENTE os mesmos três valores de metadado (tratados como
   públicos/deriváveis pelo próprio produto), reconstruir o mesmo `seed`
   do zero, instanciar um `seedrandom(seed)` independente, e repetir a
   mesma sequência de chamadas.
4. Comparar as duas saídas.

## Resultado atual vs. esperado
- **Atual:** o token de hook/webhook — documentado como a única barreira
  de autorização de um endpoint HTTP público — é 100% reproduzível a
  partir de três valores que o próprio produto trata como não-secretos em
  outras APIs (`getRun(runId)`, literal de código-fonte, metadado de
  deployment/timestamp de run). Duas execuções independentes do mesmo
  `seed`, sem qualquer canal entre elas, produzem o token idêntico.
- **Esperado:** um token usado como segredo de autorização de um endpoint
  público deveria ser derivado de entropia criptográfica fresca
  (`crypto.randomBytes`/`crypto.getRandomValues` do HOST, fora do sandbox
  determinístico), independente de qualquer valor que o próprio sistema
  também expõe/trata como identificador de rotina.

## Evidência
```ts
// packages/core/src/vm/index.ts:52-61
export function createContext(options: CreateContextOptions) {
  let { fixedTimestamp } = options;
  const { seed } = options;
  const rng = seedrandom(seed);
  const context = vmCreateContext();
  const g: typeof globalThis = runInContext('globalThis', context);
  // Deterministic `Math.random()`
  g.Math.random = rng;
  ...

// packages/core/src/workflow.ts:406-412 (branch main / v5-beta)
const {
  context,
  globalThis: vmGlobalThis,
  updateTimestamp,
} = createContext({
  seed: `${workflowRun.runId}:${workflowRun.workflowName}:${workflowRun.deploymentId}`,
  fixedTimestamp,
});

// dist/workflow.js:81 (pacote PUBLICADO @workflow/core@4.8.5, dist-tag "latest")
seed: `${workflowRun.runId}:${workflowRun.workflowName}:${+startedAt}`,

// packages/core/src/workflow.ts:461-466
const generateUlid = () => { mintCount += 1; return ulid(fixedTimestamp); };
const generateNanoid = nanoid.customRandom(nanoid.urlAlphabet, 21, (size) =>
  new Uint8Array(size).map(() => 256 * vmGlobalThis.Math.random())
);

// packages/core/src/workflow/hook.ts:98-99
const correlationId = `hook_${ctx.generateUlid()}`;
const token = options.token ?? ctx.generateNanoid();

// packages/core/src/workflow/create-hook.ts (createWebhook)
// "`createWebhook()` does not accept a `token` option. Webhook tokens
//  are always generated for you. Use `createHook()` with `resumeHook()`
//  for deterministic token patterns."
```

Trecho da documentação oficial
(`docs/content/docs/v5/api-reference/workflow/create-webhook.mdx`):
> `createWebhook()` creates a public endpoint at
> `/.well-known/workflow/v1/webhook/:token`, and the token in that URL is
> **the only authorization performed for incoming requests resuming that
> webhook**.

## Prova de conceito executável
Arquivo `poc.test.mjs` (rodado localmente, fora de qualquer infraestrutura
real — só as dependências públicas fixadas pelo próprio projeto):

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import seedrandom from 'seedrandom';
import { customRandom, urlAlphabet } from 'nanoid';
import { monotonicFactory } from 'ulid';

function buildRunPrimitives(seed, fixedTimestamp) {
  const rng = seedrandom(seed);
  const ulid = monotonicFactory(() => rng());
  const generateUlid = () => ulid(fixedTimestamp);
  const generateNanoid = customRandom(urlAlphabet, 21, (size) =>
    new Uint8Array(size).map(() => 256 * rng())
  );
  return { generateUlid, generateNanoid };
}

test('hook/webhook token is fully derivable from non-secret run metadata', () => {
  const runId = 'run_01J8Z3QF7K9M2N4P6R8T0V2X4Y';
  const workflowName = 'approvalWorkflow';
  const deploymentId = 'dpl_5xK2mQ9fRz3sT1uV7wYb';
  const fixedTimestamp = 1893456000000;
  const seed = `${runId}:${workflowName}:${deploymentId}`;

  const victim = buildRunPrimitives(seed, fixedTimestamp);
  const victimCorrelationId = `hook_${victim.generateUlid()}`;
  const victimToken = victim.generateNanoid();

  const attacker = buildRunPrimitives(seed, fixedTimestamp);
  const attackerCorrelationId = `hook_${attacker.generateUlid()}`;
  const attackerToken = attacker.generateNanoid();

  assert.equal(attackerCorrelationId, victimCorrelationId);
  assert.equal(attackerToken, victimToken);
});
```

Comando exato rodado: `node --test poc.test.mjs`

Saída real:
```
TAP version 13
# Subtest: hook/webhook token is fully derivable from non-secret run metadata
ok 1 - hook/webhook token is fully derivable from non-secret run metadata
  ---
  duration_ms: 1.333468
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 92.827301
```

Adicionalmente, confirmado que o pacote publicado e instalável hoje
(`@workflow/core@4.8.5`, dist-tag `latest` no registry npm) contém a
mesma vulnerabilidade estrutural no código compilado distribuído
(`dist/vm/index.js:15,19` e `dist/workflow.js:81,86`), baixado
diretamente do tarball do registry (`registry.npmjs.org/@workflow/core/4.8.5`),
não inferido a partir do branch de desenvolvimento.

**Limitação honesta**: a PoC demonstra o caso canônico — o token do
PRIMEIRO hook/webhook criado no run (nenhum draw anterior do mesmo stream
de PRNG). Para um hook que NÃO é a primeira operação de um run (steps,
waits ou hooks anteriores já consumiram `Math.random()` do mesmo stream),
reproduzir o token exato exigiria também conhecer/replayar a sequência
exata de draws anteriores — viável quando o atacante conhece o
código-fonte/fluxo de controle do workflow (comum: OSS, ou fluxo estático
e previsível, como o exemplo oficial "approval workflow" citado na
documentação, onde o hook é a primeira operação do run), mas não
demonstrado aqui para uma posição arbitrária no stream.

## Impacto
Um atacante que conhece (ou infere) `runId` + `workflowName` +
`deploymentId`/`startedAt` de um run alheio — todos tratados como
não-secretos pelo próprio produto — pode recalcular localmente, sem
qualquer acesso ao sistema real, o token do hook/webhook desse run e
usá-lo para chamar `resumeHook()`/`resumeWebhook()` com payload
arbitrário, resumindo/injetando dados num workflow de outra parte sem
nunca ter recebido o token pelo canal legítimo. Cenários documentados
oficialmente que dependem exatamente deste token como único controle:
fluxos de aprovação humana ("Waiting for approval from a user or admin"),
callbacks de webhook de terceiros (OAuth, Stripe, Slack). Isso é
potencialmente uma quebra de controle de acesso/autenticação de
severidade alta a crítica, dependendo de quão sensível é o payload que
cada aplicação específica espera receber pelo hook.

**Nota honesta sobre anterioridade/duplicata**: NÃO foi feita busca
pública (issues/PRs/advisories/Hacktivity) nesta rodada por restrição de
tempo/escopo da rotina automatizada — isso precisa ser feito antes de
qualquer envio real. Dado que este é um padrão de design estrutural
(não um bug de digitação isolado), e o pacote está em desenvolvimento
ativo com muitos commits/changesets recentes sobre "hook token"
(`.changeset/hook-token-reuse-after-dispose.md`,
`.changeset/reject-empty-hook-token.md`, etc. — todos sobre bugs
DIFERENTES, de ciclo de vida/reuso do token, não sobre previsibilidade),
há uma chance real de que a equipe já tenha considerado o modelo de
ameaça do seed determinístico; isso precisa ser verificado antes de
qualquer envio.

## Correção sugerida
Gerar o token de hook/webhook (e, de forma mais ampla, qualquer valor que
o produto documente como segredo de autorização) a partir de entropia
criptográfica real do HOST (`crypto.randomBytes`/`randomUUID` fora do
sandbox determinístico), independente do PRNG determinístico usado para
replay de `Math.random()`/`crypto.getRandomValues()` dentro da VM do
workflow. O determinismo de replay continua necessário para a lógica de
negócio do workflow (por isso o sandbox seedado existe), mas o TOKEN em
si — que cruza a fronteira de confiança para um endpoint HTTP público —
não deveria ser gerado dentro dessa VM sandboxed nem depender de um seed
construído só com identificadores que o próprio produto já trata como
não-secretos em outras APIs.

---
*Gerado automaticamente em 2026-09-04T04:23Z a partir do achado
`Vercel Open Source::vercel/workflow/packages/core/src/workflow.ts::createWorkflowSessionInner::predictable_hook_token_seed_risk`
na fila (`research/bugbounty/queue.jsonl`). Ver histórico completo do
veredito em `ledger/ledger.research.jsonl`.*
