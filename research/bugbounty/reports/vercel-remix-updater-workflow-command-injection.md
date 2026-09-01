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
      existem como descrito (não foi paráfrase/alucinação) — reconfirme
      o SHA atual de `main` antes de enviar, o código pode ter mudado
- [ ] Não é duplicata — checado contra relatórios já enviados por você
      a este programa

---

## Título
Command Injection via Unsanitized `workflow_dispatch` Input in `update-remix-run-dev.js` CI Workflow

## Programa / Plataforma
Vercel Open Source via HackerOne — https://hackerone.com/vercel-open-source

## Categoria / Severidade declarada
OS Command Injection (CWE-78). `asset_type: Source Code`, target
`vercel/vercel`, `eligible_for_bounty: true`, `max_severity: critical`
(confirmado via `cli.mjs check-scope "Vercel Open Source" "vercel/vercel"`,
dataset estruturado do HackerOne). Não estou autoatribuindo Critical —
esse é o teto do ativo, não uma avaliação desta vulnerabilidade
específica; ver "Pré-requisitos" e "Impacto" abaixo para o raciocínio
real de severidade, incluindo o motivo pelo qual isto não é RCE
não-autenticado.

## Ativo afetado
- Repositório: `vercel/vercel`
- Arquivos:
  - `.github/workflows/update-remix-run-dev.yml` (declaração do trigger)
  - `utils/update-remix-run-dev.js` (lógica vulnerável)
- Linhas: workflow linhas 4-8 (input sem validação) e linha 30 (input
  passado sem escapar); script linhas 20, 30, 32, 64, 66
- Commit no momento da análise: `e06cc643cec6a47bd9344af7f4589c736d95ed15`
  (branch `main`) — confirmado como HEAD atual via API do GitHub em
  01/09/2026, não é snapshot de uma varredura antiga.

## Resumo
O workflow `update-remix-run-dev.yml` aceita um input de texto livre
(`new-version`) via `workflow_dispatch`, sem nenhuma validação de
formato. Esse valor flui, após só um `.trim()` e uma substituição
trivial de caractere, para três chamadas `execSync()` com template
string dentro de `utils/update-remix-run-dev.js` — que rodam via shell
real (`/bin/sh -c`), não via `spawn()`/`execFile()` com array de
argumentos (o padrão seguro já usado em ~20 outros lugares do mesmo
repositório). Qualquer colaborador com permissão para disparar
`workflow_dispatch` neste repositório pode injetar comando arbitrário
no runner do GitHub Actions que executa este workflow.

## Cadeia de chamada confirmada
1. `.github/workflows/update-remix-run-dev.yml:4-8` — declara o input
   `new-version` como `type: string`, sem `pattern` nem qualquer
   validação de formato no schema do `workflow_dispatch`.
2. `.github/workflows/update-remix-run-dev.yml:30` — `await script({
   github, context }, "${{ inputs.new-version }}")` — o valor bruto do
   input vai direto, como string interpolada pelo próprio GitHub
   Actions antes mesmo do JS rodar, para o primeiro argumento posicional
   da função exportada por `update-remix-run-dev.js`.
3. `utils/update-remix-run-dev.js:20` — `newVersion = newVersion.trim();`
   — única transformação aplicada ao valor inteiro do input. Nenhuma
   validação de formato semver, nenhum allowlist de caracteres.
4. `utils/update-remix-run-dev.js:30` — `` const branch =
   `vercel-remix-run-dev-${newVersion.replaceAll('.', '-')}`; `` — só
   substitui o caractere "." por "-"; qualquer outro caractere
   (crase, `$(`, `;`, `&&`, `|`, quebra de linha) é preservado
   literalmente.
5. `utils/update-remix-run-dev.js:32` — `` execSync(`git ls-remote
   --heads origin ${branch}`, { encoding: 'utf-8' }) `` — `branch`
   interpolado direto numa template string passada para `execSync`,
   que por padrão roda via `/bin/sh -c` no Node.js (diferente de
   `spawn(cmd, args[])`, que passa argumentos direto ao `execve()` sem
   invocar um shell). Confirmei o contraste comparando com o padrão
   usado no restante do repositório — ex. `packages/python/src/start-dev-server.ts:322/459/1115`,
   `packages/ruby/src/start-dev-server.ts:148`,
   `packages/rust/src/lib/start-dev-server.ts:145` — todos usam
   `spawn()` com array de argumentos, nunca uma template string.
6. O mesmo `branch` (já contendo o valor injetado) é reutilizado sem
   nova sanitização em `utils/update-remix-run-dev.js:64`
   (`` execSync(`git checkout -b ${branch}`) ``) e `:66`
   (`` execSync(`git commit -m ${branch}`) ``) — três pontos de injeção
   independentes, mesma causa raiz.

## Pré-requisitos
Permissão para disparar `workflow_dispatch` neste repositório —
concretamente, permissão de **write** em `vercel/vercel` (modelo padrão
do GitHub para quem pode disparar um workflow manual), **não**
privilégio de admin/mantenedor nem acesso direto a secret nenhum. Não
precisa de conta de usuário real além da própria — nenhum dado de
terceiro envolvido.

## Passo a passo de reprodução
**Não executado ao vivo — ver seção de PoC abaixo para o motivo.**
Passo a passo tal como aconteceria, caso alguém com a permissão acima
disparasse o workflow pela UI do GitHub Actions:

1. Ir em `vercel/vercel` → aba **Actions** → workflow **"Update
   @remix-run/dev"** → botão **"Run workflow"**.
2. No campo de texto livre **`new-version`**, inserir uma string
   contendo substituição de comando, por exemplo:
   `1.0.0$(id > /tmp/poc-executed)` (exemplo deliberadamente inofensivo
   — só grava a saída de `id` num arquivo temporário do próprio
   runner, prova execução sem exfiltrar nada nem alterar estado externo).
3. Disparar o workflow.
4. O runner monta e executa (linha 32 do script):
   `git ls-remote --heads origin vercel-remix-run-dev-1-0-0$(id > /tmp/poc-executed)`
   — o `/bin/sh -c` que o `execSync` invoca expande `$(id >
   /tmp/poc-executed)` ANTES de montar o argumento final do `git
   ls-remote`, ou seja, `id > /tmp/poc-executed` roda como comando
   independente no runner, com sucesso, independentemente do que o
   `git ls-remote` em si faça depois.

## Resultado atual vs. esperado
- **Atual:** o valor do input `new-version`, fornecido por quem
  dispara o workflow, é interpolado sem sanitização de metacaracteres
  de shell dentro de três `execSync()` — controle de execução de
  comando (não só de dado) na mão de quem preenche o campo.
- **Esperado:** o valor deveria ser validado contra um formato estrito
  (ex. semver: `/^\d+\.\d+\.\d+$/`) antes de qualquer uso, E/OU os
  comandos deveriam usar `execFileSync`/`spawn` com array de
  argumentos (nunca template string), que não invoca shell nenhum e
  torna irrelevante qualquer metacaractere no valor.

## Evidência
`.github/workflows/update-remix-run-dev.yml` (linhas 4-8 e 30):
```yaml
on:
  workflow_dispatch:
    inputs:
      new-version:
        type: string
        description: 'Optional version to update @remix-run/dev to inside of @vercel/remix-builder'
```
```yaml
            const script = require('./utils/update-remix-run-dev.js')
            await script({ github, context }, "${{ inputs.new-version }}")
```

`utils/update-remix-run-dev.js` (linhas 20, 30, 32, 64, 66):
```js
newVersion = newVersion.trim();
// ...
const branch = `vercel-remix-run-dev-${newVersion.replaceAll('.', '-')}`;
if (
  execSync(`git ls-remote --heads origin ${branch}`, { encoding: 'utf-8' })
    .toString()
    .trim()
) {
// ...
execSync(`git checkout -b ${branch}`);
execSync('git add -A');
execSync(`git commit -m ${branch}`);
execSync(`git push origin ${branch}`);
```

Contraste com o padrão seguro já usado no mesmo repositório
(`packages/python/src/start-dev-server.ts:322`):
```js
const child = spawn(spawnCmd, spawnArgs, {
  cwd: projectDir,
  env: getProtectedUvEnv(env),
  stdio: ['inherit', 'pipe', 'pipe'],
});
```

Verificação de duplicata/histórico (API do GitHub, não clone local):
script criado em 01/03/2023 (PR #9588), única mudança de lógica desde
então foi remover uma dependência de build em 17/12/2024 (PR #12762) —
o padrão `execSync` sem sanitização nunca foi tocado por nenhuma
revisão de segurança em mais de 3 anos, apesar do `.yml` ter passado
por 2 trocas de credencial recentes (PR #15463 em 11/03/2026, PR
#16042 em 20/04/2026 — "Replace NPM_TOKEN with OIDC trusted
publishing") que mexeram em token mas não neste padrão. Busca na API
de issues/PRs por "update-remix-run-dev": 116 resultados, todos PRs
automáticos de rotina ("[remix] Update @remix-run/dev to vX" ou
"Version Packages") — nenhum sobre segurança. Zero security advisory
do repositório cobre isto.

## Prova de conceito executável
**Não executada — `not_applicable`, por decisão consciente, não por
falta de caminho técnico.** Todo outro achado desta missão com PoC
real (Foundry contra fork local para Solidity, LiteSVM in-process para
Solana, servidor gRPC efêmero local para outro achado em Go) rodou
inteiramente numa cópia local, nunca contra infraestrutura do próprio
programa. Reproduzir isto de verdade exigiria disparar o
`workflow_dispatch` real no repositório de produção `vercel/vercel` —
a infraestrutura de CI do próprio Vercel, não uma cópia local — o que
seria uma ação ativa contra sistema de terceiro sem autorização prévia
especificamente para este tipo de teste. A cadeia acima (seção "Cadeia
de chamada confirmada") foi lida linha a linha, sem inferência por
analogia, e o comportamento do `execSync`/`/bin/sh -c` com substituição
de comando (`$(...)`) é comportamento documentado e determinístico do
shell POSIX, não uma hipótese. Recomendo ao time do Vercel reproduzir
isto num fork privado ou ambiente de teste próprio antes de aplicar a
correção — é uma verificação de poucos minutos.

## Impacto
Um colaborador com permissão de **write** em `vercel/vercel` (não
precisa ser mantenedor nem ter acesso a secret configurado) consegue
executar comando arbitrário no runner do GitHub Actions (`ubuntu-latest`)
que processa este workflow. Isso é uma escalação de privilégio real,
não RCE não-autenticado — a distinção importa e não estou inflando a
gravidade:

- O runner tem acesso ao `GITHUB_TOKEN` padrão do job (escopo definido
  pelas permissões do workflow/repositório) e a qualquer outro secret
  de nível repositório/organização configurado para rodar em GitHub
  Actions — nenhum dos quais um colaborador "write" comum
  necessariamente tem acesso direto fora deste contexto.
- O `github-token` explicitamente configurado no step
  (`secrets.VERCEL_CLI_RELEASE_BOT_TOKEN`) tem o comentário "TODO: this
  secret is deleted, replace with a new bot token or GitHub App" —
  isso **não neutraliza o achado**: a injeção via `execSync` roda ANTES
  das duas únicas chamadas `github.rest.*` no fim do script (que são o
  único uso desse token específico), e o `GITHUB_TOKEN` automático do
  job continua disponível independentemente do estado desse secret
  específico.
- Cenário de ameaça realista mesmo sem insider malicioso: uma conta de
  colaborador com "write" comprometida (phishing, token vazado)
  ganharia, através deste bug, acesso a qualquer segredo/ambiente que
  o runner tenha — mais do que a permissão nominal "write" no GitHub
  deveria conceder por si só.

## Correção sugerida
Duas mudanças independentes, qualquer uma já resolveria:
1. Validar `newVersion` contra um formato estrito assim que ele entra
   na função (ex. `if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion))
   throw new Error(...)`), antes de qualquer uso em `branch` ou
   `execSync`.
2. Trocar as 4 chamadas `execSync` com template string por
   `execFileSync(cmd, argsArray)` (ex. `execFileSync('git', ['checkout',
   '-b', branch])`) — mesmo padrão já usado em `spawn()` no restante do
   repositório. Isso elimina a classe inteira de injeção
   independentemente de qualquer validação de formato futura.

---
*Gerado manualmente em 2026-09-01 a partir de achado descoberto por
leitura de código dirigida (não por ferramenta automática), registrado
como
`Vercel Open Source::vercel/vercel/utils/update-remix-run-dev.js::module.exports::command_injection_risk`
no banco local, estado `corroborated_static`. Ver histórico completo do
veredito em `ledger/ledger.research.jsonl` e contexto da investigação em
`research/bugbounty/vercel-open-source/NOTES.md`, seção "Rodada
2026-09-01 (sessão local)".*
