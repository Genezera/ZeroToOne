# bugbounty-scanner/ — pipeline de bug bounty com custo mínimo

Dois estágios, custo bem diferente, ligados por um repositório GitHub
compartilhado (`https://github.com/Genezera/ZeroToOne`, privado). O
Estágio 1 cobre múltiplos programas e cinco linguagens com o mesmo desenho.

## Estado operacional atual — 04/09/2026

- GitHub Actions monitora o HEAD dos repositórios permitidos a cada 15
  minutos e dispara a varredura delta somente dos repositórios cujo HEAD
  mudou. Programa com ao menos 2 submissões e taxa de duplicate >=80% fica
  fora da varredura histórica rotineira (`monitor-only`), mas continua no
  monitor e é reabilitado automaticamente quando recebe commit novo. A
  descoberta/promoção de novos alvos roda diariamente na nuvem em modo
  `--metadata-only`, sem executar código de terceiros; a varredura de
  segurança continua a cada 6 horas como rede de proteção e a sincronização
  de outcomes da HackerOne roda a cada hora. Os quatro workflows usam o mesmo grupo de concorrência,
  permissões mínimas explícitas e actions pinadas por SHA.
- O serviço Windows coordena os analisadores pesados da descoberta,
  diagnóstico, heartbeat,
  backoff e watchdog. A cada 30 minutos, `cloud_health` consulta os outcomes
  reais das quatro automações no GitHub Actions; falha terminal ou silêncio
  além da tolerância entra no mesmo backoff/alerta de recuperação do serviço.
  Com `ZERO2ONE_CLOUD_PRIMARY=1`, scan e sync ficam
  delegados aos workflows para evitar dois writers concorrentes. O SQLite é uma materialized view local:
  cada job o hidrata de `queue.jsonl`/`submissions.jsonl`/ledger sem emitir
  eventos duplicados antes de trabalhar.
- A descoberta pesada integra Slither, OSV-Scanner, Semgrep e CodeQL. O CodeQL
  roda JS/TS buildless, sem executar scripts do repositório analisado, em
  rotação persistente; builds de Go/JVM continuam fora do CodeQL até terem
  isolamento descartável equivalente.
- `search-prior-art` cobre issues/PRs, commits, advisories e, quando recebe
  `programHandle`, pagina o feed público recente de Hacktivity. Cobertura
  truncada não é marcada como método concluído.
- `audit-system` valida fila sem ids duplicados, cardinalidade fila↔SQLite,
  integridade do ledger, política, toolchain, integrações e contratos dos
  workflows. `doctor` continua disponível para diagnosticar só dependências.
- Nada envia relatório automaticamente. `human_ready -> submitted` exige
  aprovação humana e reexecuta os gates. Reports privados permanecem
  invisíveis, portanto o projeto reduz — mas não pode zerar — o risco de
  duplicate.
- Programa ausente do registro, com `roeReviewNeeded: true` ou com revisão
  expirada é bloqueado antes da seleção de leitura. Uma liberação exige
  `roeReviewed: true`, `reviewedAt` e `nextReviewAt`; as revisões atuais vencem
  em 30 dias e precisam ser refeitas contra a página oficial do programa.

## Regra operacional de novidade e submissão

Não existe consulta pública capaz de garantir que um finding não é
duplicata: reports privados da plataforma são invisíveis ao pesquisador.
O sistema agora distingue explicitamente quatro perguntas que antes eram
misturadas:

1. **Identidade local exata:** evita inserir novamente o mesmo alerta do
   scanner.
2. **Identidade semântica:** `semantic-fingerprint.mjs` correlaciona
   repositório + arquivo + função + fraqueza + source/transformação/sink/
   controle ausente/correção esperada, sem depender de linha, programa ou
   redação do relatório.
3. **Busca pública de anterioridade:** `duplicate_checks` registra fontes,
   consultas, resultados, data e match encontrado. Resultado limpo recebe
   `private_unknown`, nunca “unique”.
4. **Outcome da plataforma:** `submissions` registra um report externo uma
   única vez e o liga a um ou mais findings. `duplicate` passa a ser dado de
   aprendizado por report, não uma contagem inflada por detector.

Antes de `human_ready` e novamente antes de `submitted`, a máquina de
estados falha fechado se não houver:

- avaliação de impacto estruturada com entrada comprovadamente controlada
  pelo atacante, vítima, fronteira de segurança, resultado observável, C/I/A,
  severidade estimada Medium+ e racional explícito (Low é documentado, mas
  não entra na fila de envio desta campanha);
- nova consulta ao scope snapshot vigente com `eligibleForBounty=true`
  explícito para o ativo exato; ativo apenas informativo ou com elegibilidade
  desconhecida fica bloqueado;
- checagem de anterioridade com issues/PRs, commits, advisories e Hacktivity ou busca
  web, pelo menos três formulações distintas, `foundExisting=false`, menos
  de 24 horas e risco no máximo 25/100;
- `noveltyStatus=regression` acompanhado de `noveltyProof`: SHA completo do
  commit introdutor e de seu parent, data de introdução de no máximo 48 horas,
  mesmo comando executado nos dois refs, parent com resultado
  `not_vulnerable` e commit com resultado `vulnerable`;
- validação E4 `end_to_end` emitida pelo regression sandbox para o mesmo
  `noveltyProof`, e `DeploymentEvidence confidence=high` identificando repo,
  commit imutável e package/contrato/endereço afetado; o commit de deployment
  precisa ser exatamente o commit introdutor comprovado;
- zero submissões anteriores com outcome `duplicate` no mesmo programa ou
  repositório, calculado do histórico local e impossível de sobrescrever pelo
  JSON fornecido ao CLI;
- relatório registrado e programa permitido pela política local.

Na transição final, `humanApproval` precisa confirmar explicitamente
`reportReviewed=true`, `technicalValidationConfirmed=true` e
`programRulesReconfirmed=true`. Requisitos da política são adicionados ao
rascunho e ao gate: por exemplo `aiUseDisclosed` para OKG,
`noProductionTestingConfirmed` para Vercel e `localForkConfirmed` mais
`priorAuditChecked` para StackingDAO. Um simples nome de ator não basta mais.

Esse é o **modo anti-duplicate estrito** adotado depois de 6/6 submissões
reais voltarem como duplicate. `private_unknown`, código apenas "recente" e
busca pública limpa não liberam mais envio. Isso reduz muito o volume e não
promete o impossível: ainda pode existir um report privado sobre a mesma
regressão entre a introdução e o envio. O objetivo do gate é estreitar essa
janela ao máximo e impedir novamente a seleção de bugs antigos e óbvios.

O score de risco é uma heurística transparente de priorização, não uma
probabilidade científica. Código antigo, programa maduro, repositório muito
popular, root cause óbvio e duplicates anteriores aumentam o risco; mudança
recente, programa novo, ativo recém-adicionado e regressão verificada
reduzem. Match público sempre bloqueia.

### Fechamento da lista de 8 pontos da revisão de 03/09/2026

Depois do 6º relatório seguido voltar duplicate (Kiwi.com), uma revisão
externa apontou 8 problemas concretos. Os 4 primeiros (entidade Submission,
duplicate check bloqueante, fingerprint semântico, SecurityImpactGate) já
tinham sido implementados quando a lista foi fechada; os 4 que faltavam:

- **"Delta hunting" na descoberta** (`code-age.mjs` + `promote-targets.mjs`):
  `code-age <owner/repo> <path> [ref]` calcula `codeAgeDays` de verdade a
  partir do commit mais recente que tocou um arquivo (1 chamada de API,
  honesto sobre não ser blame da linha exata — ver limitação no próprio
  retorno). `promoteTargets`/`scoreCandidate` agora aceitam
  `duplicateHistoryByProgram` (dado real de `outcome-intelligence.mjs`) e
  penalizam repo de programa com histórico ruim de duplicate. Na fase pesada,
  programas com ao menos 2 submissões e taxa de duplicate >=80% ficam
  `monitor-only`: não consomem a varredura histórica rotineira, continuam no
  monitor de HEAD e voltam ao scanner somente no delta de um commit novo.
  `discovery-runner.mjs` e `scan-runner.mjs` calculam isso do banco real.
- **Dimensões ortogonais** (`finding-dimensions.mjs`): `technicalValidity`,
  `securityImpact`, `novelty`, `submissionState` computados por cima de
  `state`+`impactAssessment`+`duplicateCheck`, sem substituir a máquina de
  estados. Aparece em `get <id>` e `submission-preflight` como
  `dimensions`.
- **Ranking por EV** (`ev-ranking.mjs`, comando `rank-finding <id>
  [--opts='{"expectedBountyUsd":N,"researchCostUsd":N}']`): `EV = P(válido)
  × P(novo) × P(impacto aceito) × bounty − custo`, cada P(...) uma tabela
  pequena e citável (nunca modelo treinado — a amostra real ainda é só 6
  outcomes). `submission-stats` também ganhou `byWeakness` (que já cobre
  "por detector" neste esquema — `finding.type` carrega os dois juntos,
  ex. `semgrep_detect_child_process`). "Por idade do código" como quebra
  agregada continua em aberto; `codeAgeDays` é calculado sob demanda e agora
  fica gravado como evidência ligada ao finding.
- **Contrato de eventos versionado** (`db.mjs::LEDGER_SCHEMA_VERSION`):
  todo evento `bugbounty_*` gravado no ledger carrega `schemaVersion` desde
  03/09/2026. `correlationId` determinístico (`investigation-id.mjs`) liga
  validação, code age, relatório, duplicate check, impacto e outcome do mesmo
  finding entre ambientes.

### Fluxo pelo CLI

Os exemplos abaixo usam JSON ilustrativo; evidência deve vir da investigação
real:

```powershell
node system/bugbounty-scanner/cli.mjs record-impact-assessment "FINDING_ID" --patch='{"technicalValidity":"confirmed","attackerControlledInput":true,"attacker":"usuário remoto","victim":"outro usuário","securityBoundary":"isolamento entre contas","observableOutcome":"leitura de dado alheio","confidentiality":"low","integrity":"none","availability":"none","impactScope":"other_user","reportable":true,"severityRating":"medium","severityRationale":"violação de autorização entre contas","rationale":"reproduzido com duas contas próprias"}'

node system/bugbounty-scanner/cli.mjs record-duplicate-check "FINDING_ID" --patch='{"methods":["github_issues","github_commits","github_advisories","hacktivity"],"queries":["função + efeito","source + sink + controle ausente","commit + regressão + componente"],"results":[],"foundExisting":false,"signals":{"codeAgeDays":2,"programAgeDays":120,"repoStars":400,"obviousness":"medium"},"noveltyProof":{"kind":"verified_regression","introducedCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","parentCommit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","introducedAt":"2026-09-01T12:00:00Z","baseline":{"ref":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","result":"not_vulnerable","command":"node poc.mjs","observedOutcome":"controle não reproduz"},"candidate":{"ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","result":"vulnerable","command":"node poc.mjs","observedOutcome":"exploit reproduz"}}}'

node system/bugbounty-scanner/cli.mjs submission-preflight "FINDING_ID"
node system/bugbounty-scanner/cli.mjs submission-stats
```

Busca pública rastreável (inclui Hacktivity quando `programHandle` é
informado):

```json
{
  "repository": "owner/repo",
  "programHandle": "handle_hackerone",
  "since": "2026-08-28T00:00:00Z",
  "queries": [
    "root cause e função",
    "source sink e efeito",
    "controle ausente e impacto"
  ]
}
```

```powershell
node system/bugbounty-scanner/cli.mjs search-prior-art --config="prior-art.json"
node system/bugbounty-scanner/cli.mjs audit-system
```

O feed de Hacktivity é global e não expõe reports privados. O adapter pagina
localmente até cruzar `since` (máximo 50 páginas × 50 itens); se não cruzar,
marca a cobertura como incompleta e não adiciona `hacktivity` aos métodos que
o gate aceita.

### Executor isolado de regressão

`verify-regression --config=<arquivo.json>` não aceita um par de resultados
declarado manualmente como prova. Ele clona um repositório **público do
GitHub**, confirma que `parentCommit` é o parent real de
`introducedCommit` e executa exatamente o mesmo comando nos dois checkouts.
O comando precisa terminar com exit code zero e imprimir, em linha isolada,
um e somente um destes marcadores:

```text
ZTO_RESULT=NOT_VULNERABLE
ZTO_RESULT=VULNERABLE
```

Cada execução ocorre em Docker sem rede, sem variáveis secretas do host,
com root filesystem/read-only mount do checkout, capabilities removidas e
limites de PID, CPU, memória e tempo. O código é copiado para um `tmpfs`
gravável dentro do contêiner; um harness local opcional pode ser montado
read-only como `/harness`. Resultado faltante, contraditório, exit não-zero,
timeout, parent incorreto ou `baseline != not_vulnerable` /
`candidate != vulnerable` bloqueia a prova.

Runtimes permitidos ficam numa allowlist versionada em
`regression-sandbox.mjs` (`node22`, `python313`, `go127`, `jdk21`,
`foundry`). O arquivo `test/fixtures/regression-smoke.json` é apenas um
smoke test público da infraestrutura; a mudança de newline usada ali **não
é um finding de segurança**. Para um finding real, use um harness específico
e execute:

```powershell
node system/bugbounty-scanner/cli.mjs verify-regression --config="caminho\regression.json"
```

O `noveltyProof` retornado tem o formato aceito pelo gate anti-duplicate,
mas ainda precisa ser combinado com busca pública recente e impacto
comprovado. O executor prova a regressão; não prova ausência de report
privado. Para contar no gate, a prova precisa ter sido registrada pelo
próprio `verify-regression --finding-id=...`: `record-duplicate-check`
confere um atestado `isolated_regression` idêntico no banco. O comando
genérico `record-validation` recusa esse tipo/provenance reservado, então
colar um JSON manual com `kind: "verified_regression"` não libera envio.

### Exposição pública de longa data (informativa; nunca prova novidade)

`verify-longstanding-exposure --config=<arquivo.json>` clona o repositório
público, confirma via `git show` a data real do commit introdutor (sem
confiar em uma data alegada) e via `merge-base --is-ancestor` se ele ainda
está no histórico de `origin/HEAD`. O resultado é evidência auditável da
idade do código e pode alimentar `codeAgeDays`.

Ele **não é um caminho alternativo para o gate anti-duplicate**. Código
antigo teve mais tempo para ser descoberto e reportado, inclusive em reports
privados invisíveis. Por isso `noveltyStatus: "longstanding_exposure"` é
recusado por `duplicateCheckGate`; somente uma regressão recente verificada
parent seguro → commit vulnerável pode liberar a etapa de novidade. Esta
restrição corrige uma exceção metodologicamente invertida criada em
04/09/2026 e impede que “não encontrei nada publicamente em anos” seja
tratado como prova de ausência.

```powershell
node system/bugbounty-scanner/cli.mjs verify-longstanding-exposure --config="caminho\longstanding.json"
```

### Busca pública de anterioridade

`search-prior-art --config=<arquivo.json>` recebe `repository` no formato
`owner/repo` e pelo menos três `queries`. Ele consulta pela API oficial do
GitHub issues/PRs, mensagens de commits e advisories publicados do próprio
repositório. Uma falha ou rate limit aborta toda a busca; nunca converte
resultado parcial em “limpo”. Cada hit fica `candidate=true` e
`disposition=unreviewed`, o que bloqueia o gate até revisão humana explícita
como `ruled_out`.

```json
{
  "repository": "owner/repo",
  "queries": [
    "função afetada efeito observável",
    "source sink controle ausente",
    "componente classe de fraqueza regressão"
  ]
}
```

```powershell
node system/bugbounty-scanner/cli.mjs search-prior-art --config="caminho\prior-art.json"
```

A saída é só um `duplicateCheckDraft`: Hacktivity ou uma busca web
independente continua obrigatória porque não há API pública que exponha
reports privados de terceiros. Mesmo quando todas as fontes públicas vêm
limpas, o status continua `private_unknown` até a prova de regressão ser
anexada.

`submission-preflight` é somente leitura e devolve `ready`, a razão, toda a
evidência usada, o fingerprint e o histórico local de duplicates relevantes.
`sync-my-reports` importa os reports do próprio pesquisador via Hacker API
quando as credenciais estiverem configuradas; nunca promete acesso a reports
privados de terceiros.

## Estágio 1 — Scanner local (grátis, roda sozinho, sem IA)
`scan-runner.mjs` roda uma varredura por linguagem/plataforma:

**Clarity (StackingDAO, Immunefi):** busca código-fonte atualizado dos
contratos rastreados (`targets.mjs`) via API pública da Hiro, roda
heurísticas de texto (`heuristics.mjs` — ex.: inconsistência entre
`tx-sender`/`contract-caller` em checagens de autorização, transferências
sem checagem de auth visível), e persiste os `.clar` neste repositório
(código pequeno o bastante para valer a pena guardar como evidência).

**JavaScript/TypeScript (Vercel Open Source, HackerOne):**
`targets-js.mjs` + `heuristics-js.mjs` — `eval`/`new Function`,
`exec`/`execSync` com comando montado por interpolação, regex com
quantificador aninhado/ReDoS, poluição de protótipo (`for...in` sem
checagem contra `__proto__`), SSRF (`fetch`/`axios` com destino
variável), path traversal (`fs.*` com caminho concatenado sem
`path.normalize`). Ver `research/bugbounty/vercel-open-source/NOTES.md`.

**Análise de fluxo de dado por AST de verdade (`heuristics-js-ast.mjs`,
só JS/TS)** — camada A MAIS sobre as heurísticas de texto, não substitui:
usa `web-tree-sitter` (parser WASM, sem compilação nativa) com as
gramáticas reais `tree-sitter-javascript`/`tree-sitter-typescript`/
`tree-sitter-tsx` (escolhida pela extensão do arquivo) pra rastrear se um
valor que vem de fonte externa conhecida (`req.query`/`req.body`/
`req.params`/`process.argv`) REALMENTE flui até um sink perigoso (`exec`,
`fetch`, `fs.readFile`, `eval`) dentro da mesma função — via atribuição,
alias, template string ou concatenação. Achado `tainted_data_flow` é
evidência bem mais forte que coocorrência textual, porque confirma o
caminho do dado, não só que dois padrões aparecem perto um do outro.
**Limitação documentada, não escondida**: intraprocedural (não atravessa
chamada de função) e não segue ramificação condicional complexa — é
propositalmente conservador (só sinaliza fonte EXPLICITAMENTE externa, não
qualquer parâmetro de função) pra manter falso-positivo raro, aceitando
falso-negativo em fluxo mais complexo. Essa é a primeira dependência npm
real do projeto (`web-tree-sitter`, `tree-sitter-javascript`,
`tree-sitter-typescript` — todas usam WASM prebuild, sem `node-gyp`/
compilador C++ necessário) — decisão deliberada: regex não tem como
verificar fluxo de dado de verdade, só coocorrência textual.

**Go, Kotlin/Java e Swift/ObjC (Block Open Source, Bugcrowd — ex-Square):**
`targets-go.mjs`/`heuristics-go.mjs` (injeção de comando via shell, TLS
inseguro, `math/rand` em contexto de segredo — mesma família do `gosec`),
`targets-jvm.mjs`/`heuristics-jvm.mjs` (bypass de validação TLS,
exposição de ponte JS em WebView, injeção de comando — classes de bug
Android já pagas em programas reais), `targets-swift.mjs`/
`heuristics-swift.mjs` (bypass de validação TLS em URLSession, ponte JS
insegura em WKWebView). Ver
`research/bugbounty/block-open-source/NOTES.md` para por que "Square Open
Source" só aparece sob o nome Block, numa plataforma diferente
(Bugcrowd, não HackerOne).

Todas as linguagens buscam via API pública do GitHub (sem conta/token) e
usam `heuristics-shared.mjs` (`hardcoded_secret` — valor literal atribuído
a campo tipo api_key/secret/password/token, filtrando placeholders óbvios)
além da heurística específica da linguagem. Repos não-Clarity são grandes
demais para persistir no git — só o texto do achado (com trecho de
contexto) vai para a fila; um cache de SHA de blob por arquivo
(`scanner-seen-repo-shas.json`, compartilhado entre todas as linguagens)
evita rebuscar/rescanear arquivo que não mudou.

Todas as varreduras só gravam na fila compartilhada
(`research/bugbounty/queue.jsonl`) o que for **novo para a fila local**
(deduplicação exata via `scanner-seen.json`; isso não prova novidade na
plataforma). Se achar algo novo localmente,
faz commit + push automaticamente.

**Retroalimentação de veredito** (`verdict-stats.mjs`): a cada rodada,
recalcula a taxa de falso-positivo por tipo×linguagem e tipo×programa a
partir de tudo que já foi revisado em `queue.jsonl` (`research/bugbounty/
heuristic-stats.md`/`.json`), e anexa um campo `historicalConfidence` em
achados NOVOS do mesmo tipo/linguagem quando já há amostra suficiente
(mínimo 5 revisados — nunca com base em 1-2 pontos de dado). Como
`queue.jsonl` reescreve a linha de cada item em vez de só adicionar, uma
revisão de veredito não deixaria rastro histórico nenhum sem isso — por
isso todo item recém-revisado ou com veredito mudado desde a última rodada
(`scanner-seen-verdicts.json` guarda o snapshot anterior) também vira uma
entrada `bugbounty_verdict` no ledger `research` (auditável,
`verifyChain('research')` continua íntegro). Tudo registrado em arquivo
simples, revisável a olho — nunca um modelo caixa-preta.

**Painel do centro de operações** (`status-dashboard.mjs`):
`research/bugbounty/STATUS.md`, regenerado a cada rodada — alvos ativos
por linguagem/programa, quantos itens estão pendentes vs. já revisados na
fila, e os últimos vereditos. Lotes futuros (cross-referência de
dependência/CVE, descoberta de alvo) só adicionam sua própria seção aqui.

Também há um painel visual completo (`generate-dashboard.mjs`) —
`research/bugbounty/dashboard.html`, regenerado a cada rodada, autocontido
(abre local via `file://`, sem servidor). É um INSTANTÂNEO daquele momento,
não uma página com dado ao vivo (o repositório é privado — uma página
publicada não tem como ler o repo sem expor credencial). Pra ver sempre a
versão mais recente, abra o arquivo local depois de cada rodada.

**Cross-referência de dependência conhecida vulnerável** (`dep-scanner.mjs`,
via OSV.dev, API pública sem conta/token): acha manifesto com versão EXATA
(nunca faixa de semver) — `package-lock.json` (npm), `go.mod` (Go, formato
já fixa versão), `build.gradle`/`.kts` (Maven, só padrão literal
`"grupo:artefato:versão"`, sem resolver catálogo/variável) — consulta em
lote (`POST /v1/querybatch`) e só busca detalhe completo do que bateu.
Acha exatamente o mesmo tipo de manifesto em QUALQUER pasta do repositório
(não só as pastas escolhidas pra heurística de código — a maioria dos
manifestos fica na raiz de cada módulo, fora do escopo restrito de
`pathPrefixes`), excluindo diretório de teste/fixture (achado real do dia:
`wire-gradle-plugin/src/test/projects/*/build.gradle` gerava falso-positivo
— fixture de teste de compatibilidade, não dependência real do produto —
corrigido e coberto por teste). **Swift/CocoaPods fica de fora**:
confirmado ao vivo que "CocoaPods"/"SwiftPM" não são ecossistemas
suportados pelo OSV.dev — limitação real da fonte de dado, documentada,
não escondida. Achado vira `known_vulnerable_dependency` na MESMA fila/
pipeline de sempre. Validado com achado real: `cashapp/hermit` usa
`github.com/cloudflare/circl@v1.3.8` e `golang.org/x/crypto@v0.54.0`, ambos
com vulnerabilidade publicada real (GHSA-2x5j-vhc8-9cwm, GO-2026-5932).

Testado contra código real: no lado Clarity, acha exatamente o achado real
confirmado (`set-token-uri`) e não gera ruído nos contratos já confirmados
seguros; nas outras 4 linguagens, roda contra o código real de
`vercel/flags`, `cashapp/hermit`, `cashapp/misk`, `square/wire`,
`afterpay/sdk-android`, `cashapp/cash-app-pay-android-sdk`,
`afterpay/sdk-ios` e `cashapp/cash-app-pay-ios-sdk` (1.049 arquivos,
0 erros) sem quebrar e sem falso-positivo óbvio — ver
`system/bugbounty-scanner/test/` (37 testes).

### Operação contínua, recuperação e observabilidade

O workflow `bugbounty-change-monitor.yml` consulta somente metadados de HEAD
dos repositórios permitidos a cada 15 minutos. Um HEAD novo passa a lista
exata de `owner/repo` e o contexto completo (base observada, commit novo,
parent e timestamps) para `scan-runner.mjs`; alvos estáveis não são
reprocessados e a seleção delta ignora o filtro `monitor-only` para não perder
uma regressão fresca. O cursor só avança depois que esse scan termina com
sucesso, portanto falha ou timeout é tentado novamente na próxima rodada.
Cada delta fica em `research/bugbounty/change-events.jsonl` com SHA anterior,
commit novo, parent, data e indicação de mudança direta. O evento é sinal de
prioridade temporal, nunca uma alegação de vulnerabilidade.

Finding criado nessa via guarda `changeContext` e recebe identidade terminada
em `::commit:<SHA>`. Isso impede o cache `scanner-seen.json` de esconder uma
regressão porque o mesmo detector já tinha produzido falso positivo na mesma
função em outro commit. O gate final vincula `noveltyProof`, E4 e
`DeploymentEvidence` ao mesmo commit/repositório observado; `changeContext`
sozinho continua sendo apenas proveniência e prioridade, nunca prova.

Rodadas sem alteração são byte-estáveis: não atualizam timestamps, não deixam
o checkout sujo e não criam commit vazio. Inclusão ou remoção de alvo atualiza
e publica o baseline, mas não é tratada como vulnerabilidade nem como mudança
de código pré-existente.

`install-service-tasks.ps1` instala duas tarefas independentes no Windows:

- `ZeroToOne_BugBountyService`, ciclo a cada 5 minutos: sincroniza outcomes
  do HackerOne a cada hora, roda um doctor do toolchain a cada 24 horas,
  scan a cada 6 horas e discovery a cada 24 horas. Jobs pesados nunca se
  sobrepõem e um lease impede duas instâncias.
- `ZeroToOne_BugBountyWatchdog`, a cada 10 minutos: lê o heartbeat por outra
  entrada do Task Scheduler e alerta via Telegram somente quando o estado
  muda para indisponível ou volta a saudável.

O estado é escrito atomicamente em `logs/bugbounty-runtime-state.json`;
falhas usam backoff exponencial, ficam no ledger e provocam alerta. As
tarefas reiniciam até três vezes, recuperam execução perdida, aceitam
bateria, podem acordar o computador e são disparadas novamente no logon.
Os logs giram em 10 MiB (`.log` e `.log.1`). As tarefas diárias antigas são
apenas desabilitadas para evitar execução dupla, não apagadas. Estado atual:

Inicialização usa `scheduleAnchorAt`; `lastSuccessAt` só é preenchido depois
de uma execução real. Estados antigos são migrados automaticamente para não
confundir "instalado" com "job executado com sucesso".

```powershell
node system/bugbounty-scanner/cli.mjs runtime-status
node system/bugbounty-scanner/cli.mjs doctor
node system/bugbounty-scanner/cli.mjs mission-control
```

`mission-control` é a visão end-to-end: cruza auditoria do repositório e da
política, execução real dos quatro workflows cloud, heartbeat local, contagem
dos estados do pipeline e outcomes de submissão. Cada workflow tem tolerância
maior que sua cadência nominal (1h monitor, 4h sync, 18h scan, 48h discovery)
para absorver jitter do scheduler sem esconder falha. Última execução terminal
falha, ausência de sucesso ou sucesso velho tornam o componente `unhealthy` e
o comando sai diferente de zero.

Instalação/reinstalação idempotente:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File system/bugbounty-scanner/install-service-tasks.ps1
```

As tarefas usam o usuário interativo atual para preservar acesso seguro às
credenciais do usuário e à chave Git; portanto executam continuamente
enquanto essa sessão estiver logada. Rodar deslogado exigiria armazenar uma
senha no Task Scheduler ou migrar segredos/SSH para uma conta de serviço —
isso não é feito automaticamente porque aumentaria materialmente a
superfície de exposição.

## Prova de conceito executável (Solidity, via Foundry fork local)
Diferente de só ler código, o agente de nuvem agora escreve e RODA um
exploit de verdade contra achado Solidity plausível: instala o Foundry
(`curl -L https://foundry.paradigm.xyz | bash`, sem conta), faz **fork
local** de um RPC público sem conta (`https://ethereum.publicnode.com`
confirmado funcionando — testado nesta sessão contra o mainnet real,
leu o `totalSupply` real do USDC pra validar o mecanismo) e roda
`forge test --fork-url ... -vvv`. Isso nunca transmite transação pra rede
real e nunca usa conta/chave privada com fundo real — só endereço gerado
localmente (`makeAddr`) financiado apenas dentro do fork
(`vm.deal`), mesmo princípio de "duas contas próprias, sem tocar dado
real" que um caçador de bug bounty web usa, adaptado pra contrato.
Princípio de menor impacto: a PoC só precisa provar o mínimo necessário
(ex.: "a chamada reentrante é aceita antes da atualização de estado"),
nunca precisa demonstrar drenagem completa de fundos. Se a PoC FALHAR
(um `require`/`modifier` bloqueou o ataque que a leitura sugeria), isso
vira evidência forte de falso-positivo, documentada como tal — não
descartada. Ver `research/bugbounty/reports/TEMPLATE.md`, seção "Prova de
conceito executável".

## Prova de conceito executável (Go, via `go test` real) — 31/08/2026

Mesmo princípio da PoC Solidity (rodar de verdade, nunca só ler), bem
mais simples de montar: Go não precisa de fork/rede nem de framework
especial — `go test` já é parte do toolchain padrão. Convenção:

1. Clonar o repositório afetado no commit já registrado como
   `deploymentEvidence` (ou anotar o commit se ainda não estiver
   registrado).
2. Escrever um arquivo `_test.go` chamando a função exportada real
   (nunca reimplementar a lógica) — preferir pacote `_test` externo
   (`package foo_test`) quando a API pública já basta pra disparar o
   bug, já que isso reproduz exatamente como um consumidor downstream
   real chamaria, o mesmo tipo de pergunta de alcançabilidade que já é
   central nesta missão (ex.: achado `cosmossdk.io/math` do OKG).
3. Rodar `go test -run TestNomeDoTeste -v ./caminho/do/pacote/...` a
   partir da raiz do módulo clonado.
4. Colar a saída REAL (PASS/FAIL + qualquer panic/trace), nunca
   parafrasear — `record-validation --type=go_test_poc
   --result=pass|fail --output="..."`.

Exemplo de referência real e executável (não é achado novo — usa uma
vulnerabilidade já pública/corrigida/retratada de propósito, só pra
provar que o mecanismo funciona de ponta a ponta):
`system/bugbounty-scanner/poc-examples/go-legacy-dec-overflow/` — PoC
real contra `cosmossdk.io/math@v1.1.2` (GHSA-7225-m954-23v7), rodada de
verdade (`go test -v`, panic real `"Int overflow"` capturado). O
próprio `README.md` do exemplo documenta uma armadilha real capturada
durante a construção: um valor "grande o bastante pra estourar o
limite antigo" também estoura o limite novo (corrigido) pelo mesmo
motivo (ambos limitam magnitude, só com cálculo diferente) — não prova
sozinho qual CVE específico foi corrigido. PoC de overflow/limite
precisa mirar a janela estreita de discrepância, não só "usar um número
gigante".

**Gargalo real que isso NÃO resolve sozinho**: a máquina de estados já
aceita qualquer `validations.result="pass"` genericamente — o que
faltava não era código, era convenção documentada + exemplo real. Acha
achado Go em `corroborated_static` ainda depende de alguém (agente de
nuvem ou humano) escrever a PoC específica pra aquele achado — não tem
como isso ser 100% automático (a PoC precisa entender o bug
específico), mas agora existe um caminho conhecido e testado, igual já
existia pra Solidity.

## Prova de conceito executável (JVM, via `javac`/`java` puro) — 31/08/2026

`insecure_deserialization` (o achado JVM mais sério que
`heuristics-jvm.mjs` sinaliza — `ObjectInputStream` sobre bytes não
confiáveis) não precisa de Gradle/Maven pra provar o mecanismo: uma
classe "estágio-de-prova" com `readObject()` sobrescrito (seta uma flag
observável, NUNCA um gadget de RCE de verdade — nunca
`Runtime.exec`/`ProcessBuilder`) já prova o núcleo do CWE-502: o
desserializador instancia e roda código de uma classe que o ATACANTE
escolheu, não a vítima. Exemplo real e executável (não achado novo, só
demonstra o mecanismo — os alvos Kotlin reais desta missão,
`wire-schema`/`hermit`, são do Block Open Source, banido pra pesquisa
assistida por IA):
`system/bugbounty-scanner/poc-examples/jvm-insecure-deserialization/`
(`javac *.java && java PocMain`, saída real PASS capturada).

**Ressalva real**: pra achado de verdade num projeto Kotlin/Gradle real
(não este exemplo standalone), o comando certo é o runner do próprio
projeto (`./gradlew test --tests "..."` ou `mvn test -Dtest=...`), não
`javac` direto — este exemplo prova que a JVM em si é insegura por
design nesse padrão, não substitui rodar dentro do build system real
quando houver achado Kotlin de verdade.

## Prova de conceito executável (JS/TS, via `node --test`) — 31/08/2026

Diferente de Solidity/Go/JVM, não precisa de convenção nova nenhuma —
é literalmente a MESMA ferramenta (`node --test`) que já roda a suíte
inteira deste projeto. Exemplo real pro padrão
`prototype_pollution_risk`:
`system/bugbounty-scanner/poc-examples/js-prototype-pollution/`
(`node --test .../poc.test.mjs`) — prova que `JSON.parse` sozinho não
aciona o setter especial de `__proto__` (cria uma propriedade comum de
string), mas um merge recursivo ingênuo que depois faz
`target[key] = ...` com essa chave SIM aciona, poluindo
`Object.prototype` globalmente (confirmado testando um objeto novo,
sem nenhuma relação com o ataque). Inclui teste de controle (a mesma
entrada contra uma versão com a checagem `__proto__`/`constructor`/
`prototype`, que não é afetada) — mesmo padrão de "sempre mostrar o
caso que NÃO quebra" já estabelecido nos relatórios desta missão.

**Cobertura de convenção de PoC agora**: Solidity (Foundry/Hardhat),
Go (`go test`), JVM (`javac`/`java`, ou o build system real do
projeto), JS/TS (`node --test`). Só falta Swift (sem alvo ativo hoje —
os 3 programas escaneados não têm repositório Swift em escopo no
momento).

## Solidity (Circle BBP, HackerOne — emissora do USDC)
`targets-solidity.mjs` + `heuristics-solidity.mjs` — o primeiro alvo
descoberto pelo próprio módulo de descoberta automática (Lote 5), não
curadoria manual do zero. 4 classes de vulnerabilidade de contrato
inteligente bem estabelecidas: `reentrancy_risk` (chamada externa antes de
escrita de estado — o padrão do hack da The DAO), `unchecked_call_return`,
`tx_origin_auth_risk`, `delegatecall_risk`. Ver
`research/bugbounty/circle-bbp/NOTES.md` — inclui achado real (6
candidatos na primeira rodada, com observação honesta de que a maioria
está em script de deploy, não contrato de produção exposto a usuário).

## Estágio 0 — Descoberta automática de alvo (semanal, tarefa própria)
`discover-targets.mjs` + `discovery-runner.mjs`: rebusca
`hackerone_data.json`/`bugcrowd_data.json` do mesmo dataset público
`arkadiyt/bounty-targets-data`, extrai TODO alvo `github.com/...` em
escopo de QUALQUER programa com recompensa real (não só os 3 já
rastreados), compara contra os 5 `targets-*.mjs` e escreve
`research/bugbounty/discovered-targets.json` com o que for genuinamente
novo (tamanho, linguagem, estrelas, última atividade, programa/plataforma
de origem). **Só sugere — nunca escreve em `targets-*.mjs` sozinho**: esses
arquivos são escritos à mão com comentário explicando o porquê de cada
escolha, e curadoria de escopo pra monorepo grande exige julgamento humano.
Primeira rodada real: 194 candidatos com recompensa real no dataset
inteiro, 186 ainda não rastreados por nós — inclui exatamente os outros 16
repositórios do Vercel Open Source que eu tinha escolhido manualmente não
rastrear (grande demais ou já muito escrutinado), agora disponíveis pra
revisão.

Tarefa agendada **própria e semanal** (`ZeroToOne_TargetDiscovery`,
domingo 10h) — isolada da tarefa diária de propósito, porque buscar
metadado do GitHub (tamanho/linguagem/atividade) de dezenas de candidatos
novos por rodada consome bem mais do limite de 60 req/hora da API anônima
do que o scan diário sozinho consumiria. Teto de 30 buscas de metadado por
rodada, com o que sobrar ficando registrado (não escondido) pra próxima
rodada.

**Bug real corrigido em 31/08/2026**: até então, "o que sobrar pra próxima
rodada" nunca de fato rotacionava — toda rodada pegava sempre os mesmos
primeiros 30 candidatos da lista (a única filtragem era contra os
`targets-*.mjs`, que nunca mudam sozinhos), então os outros 156
descobertos na primeira rodada real nunca tinham recebido metadado em
NENHUMA rodada seguinte, pra sempre. `prioritizeCandidates()` (pura,
testada) + `research/bugbounty/discovery-metadata-seen.json`
(`{"owner/repo": timestampDaÚltimaChecada}`, no mesmo espírito do
`scanner-seen.json` do scan diário) agora garantem que quem nunca foi
checado vem primeiro; só depois de cobrir todo mundo genuinamente novo
o orçamento sobrando passa a refrescar as entradas mais antigas.

**Sinal de "programa novo" (31/08/2026)**: `GET /hackers/programs/{handle}`
da Hacker API devolve `started_accepting_at` — a data real de
lançamento do programa (confirmado ao vivo: Circle BBP lançou em
28/05/2024). Dentro do grupo "nunca visto" de `prioritizeCandidates`,
quem está no programa mais recentemente lançado vem primeiro — a ideia
é simples: programa mais novo tende a ter menos pesquisador já
escrutinando, é onde a chance de achar algo genuinamente inédito é
maior (aprendido do jeito difícil: 2 achados nesta missão já se
revelaram duplicata pública em programas maduros). Busca a idade de
todo handle HackerOne distinto encontrado na rodada (não só os 30 que
vão receber metadado de repo), com concorrência limitada a 5 chamadas
simultâneas via `mapWithConcurrency()` — sequencial media ~3s por
handle e passava de 1 minuto só nessa etapa com ~23 handles reais;
concorrente cai pra ~16s no total. Melhor esforço sempre: se a
credencial da Hacker API não estiver configurada no ambiente que roda
isso, a rodada continua normalmente sem o sinal de idade, registrando
o motivo (`programAgeSkippedReason`) em vez de falhar a rodada inteira.

**Dois bugs reais encontrados construindo isso, ambos corrigidos**: (1)
`getProgram` fazia `body.data` como todo outro endpoint deste cliente,
mas `GET /hackers/programs/{handle}` é o único que devolve o recurso
direto na raiz (`{id, type, attributes}`, sem envelope `data`) —
confirmado só depois de ver o corpo bruto da resposta, já que o erro
era silencioso (`toProgramSummary(undefined)` devolvia `null` sem
lançar exceção nenhuma). (2) `discovery-runner.mjs` nunca importava
`SOLIDITY_TARGETS` na lista de "já rastreado" passada pra
`diffAgainstKnownTargets` — os 5 repositórios Solidity já cobertos
apareciam como "candidato novo" toda semana, gastando orçamento de
metadado à toa (confirmado ao vivo: 194 candidatos "novos" viravam 189
depois da correção).

**Sinal de "popularidade/duplicata conhecida" na LEITURA PROFUNDA
(02/09/2026)**: o sinal de "programa novo" acima só afeta quais
repositórios NOVOS entram pra lista rastreada -- não ajuda quando o
repo já está rastreado há tempo, que foi exatamente o caso do 3º achado
seguido revelado como duplicata pública (SSRF em
`packages/next/src/server/image-optimizer.ts`, `vercel/next.js` --
report HackerOne #3988959, fechado como duplicata de #3943945, com um
TERCEIRO report #3971664 também já fechado como duplicata do mesmo
original -- ver `research/bugbounty/vercel-open-source/NOTES.md`,
rodada 2026-09-02, pra narrativa completa). `selectDeepReadCandidates`
(`list-deep-read-candidates.mjs`) sempre ordenou só por "quantos
arquivos NÓS já lemos" -- zero noção de quão famoso um repositório é
pra quem está de fora. Duas camadas de sinal novas, ambas opcionais
(default `{}`, comportamento idêntico a antes se nenhuma for passada):
1. **Estrelas do GitHub** (`loadRepoPopularityCache` +
   `refreshRepoPopularity`, cache em
   `research/bugbounty/repo-popularity-cache.json`) -- repositório com
   `>= POPULAR_REPO_STAR_THRESHOLD` (10 mil, constante exportada) vai
   pra uma camada "popular" depois de tudo que não é mega-famoso,
   mesmo tendo menos arquivos lidos. Reusa `fetchRepoMetadata` de
   `discover-targets.mjs` (agora exportada) -- mesma chamada
   `GET /repos/{owner}/{repo}`, sem gasto extra de orçamento de API:
   só ~46 repos rastreados no total (bem diferente das centenas de
   candidatos novos por rodada da descoberta semanal), cache com TTL
   de 30 dias evita rebuscar toda rodada.
2. **Outcome real "duplicate" de plataforma** (`countKnownDuplicatesByRepo`,
   consulta `platform_outcomes` JOIN `findings` no `zerotoone.db`) --
   sinal empírico direto, mais forte que qualquer proxy estático; repo
   que já voltou duplicata pelo menos uma vez vai pro fim da fila,
   pior ofensor primeiro. Casamento por substring no `id` composto
   (não igualdade exata contra `file`/`asset`) porque o formato desses
   dois campos não é 100% consistente entre achados antigos.
   **Limitação real encontrada construindo isso**: o achado do SSRF
   acima nunca tinha sido de fato persistido via `upsertFinding` no
   banco (só existia na narrativa da NOTES.md, apesar de rodadas
   anteriores citarem ele como `corroborated_static`) -- então esse
   sinal ainda não pega ESSE caso específico, só achados registrados
   corretamente daqui pra frente. Não fabriquei um registro histórico
   pra "consertar" isso; documentado como pendência real em vez disso.
   Verificado ao vivo rodando `list-deep-read-candidates.mjs` de
   verdade: `nitrojs/nitro` (11163★), `sveltejs/svelte` (88040★) e
   `nuxt/nuxt` (60807★) -- curados recentemente em `JS_TARGETS` com
   poucos arquivos lidos ainda -- foram corretamente empurrados pra
   depois de dezenas de contratos Circle BBP obscuros (1-800★), em vez
   de pularem pra frente da fila só por terem poucos arquivos lidos.
   `npm test`: 424/424 depois da mudança (16 testes novos, zero
   quebrado).

**Sinal de "arquivo tocado recentemente", dentro do ESCANEAMENTO em si
(02/09/2026)**: os dois sinais acima decidem qual REPOSITÓRIO ler --
mas fama do repo inteiro não protege um ARQUIVO específico de já ter
sido lido por muita gente de fora. Um PR mesclado mês passado no
`vercel/next.js` teve muito menos escrutínio que uma rotina estável de
anos, mesmo dentro do repo mais famoso que existe. `listRecentlyChangedFiles`
(`fetch-repo.mjs`) resolve isso com só 2 chamadas de API (custo
constante, não escala com o tamanho do repo -- a alternativa óbvia,
"último commit" por arquivo, inviabilizaria repo grande sob o limite
anônimo de 60 req/hora):
1. `GET .../commits?until=<agora-90d>&per_page=1` acha o commit mais
   recente ANTES do corte -- linha de base pra comparar.
2. `GET .../compare/{linhaDeBase}...{branch}` devolve todo path tocado
   entre os dois num response só.

`prioritizeFilesForScan` ganhou um 3º parâmetro opcional
(`recentlyChanged`, default `null` -- comportamento idêntico a antes
quando omitido): dentro do grupo "nunca visto", arquivo recente vem
primeiro. `scan-runner.mjs` busca o sinal só quando o repo excede
`MAX_FILES_PER_TARGET` (é exatamente aí que a ordem de corte importa;
repo pequeno escaneia tudo de qualquer jeito) -- melhor esforço, erro
de rede não trava a rodada.

**Limitação real, confirmada ao vivo**: o array `files` da API de
compare do GitHub trunca em 300 entradas, sem paginação disponível
nesse endpoint. Testado contra `vercel/flags` (repo ativo): bateu
exatamente no teto de 300. Contra `circlefin/stablecoin-xlm` (repo
parado): devolveu `Set` vazio corretamente (não `null` -- achou linha
de base, só não tem mudança desde então). Pra repo hiperativo, os 300
são uma AMOSTRA do que mudou, não a lista completa -- não inverte o
sinal (arquivo fora da amostra vira "sem dado", tratado como não-recente,
o mesmo que já acontecia antes desta função existir), só limita quantos
arquivos recentes um repo assim consegue sinalizar de uma vez. `npm
test`: 428/428 depois desta mudança (4 testes novos, zero quebrado).

**Gap real encontrado de passagem, ainda não resolvido**: `JVM_TARGETS`
(`targets-jvm.mjs`) está VAZIO hoje -- os 4 alvos curados à mão são
todos Block Open Source (`_PAUSED_JVM_TARGETS_MANUAL`, corretamente
pausados desde 31/08/2026) e nenhum dos 13 alvos auto-promovidos
(`targets-auto-promoted.mjs`) é JVM (todos Go, confirmado ao vivo).
Categoria JVM inteira sem cobertura ativa até algum programa novo
elegível ser encontrado e curado -- não é bug de código, é lista vazia
mesmo.

**`filesRead` virou `coverageRatio` na priorização de leitura profunda
(02/09/2026)**: os dois sinais acima (`refreshRepoPopularity`,
`countKnownDuplicatesByRepo`) decidem qual repo é mais promissor, mas
`selectDeepReadCandidates` ainda ordenava por `filesRead` cru dentro de
cada camada -- um repo de 1 arquivo TOTAL com 1 já lido (100% coberto,
nada sobrando) parecia idêntico a um repo de 1000 arquivos com 1 lido
(0,1% coberto, quase tudo por ler). Achado real usando a própria lista
corrigida pra escolher o que ler: `vercel/ms` e `vercel/async-sema`
continuavam no TOPO mesmo depois do conserto de popularidade, porque
`filesRead=1` é baixo em termos absolutos independente do repo ser
minúsculo.

`refreshRepoPopularity` ganhou `totalScannableFiles` (mesma chamada de
metadado que já buscava `stars`, mais uma listagem de árvore usando o
`defaultBranch` que a resposta já trazia -- token do GitHub configurado
neste projeto dá 5000 req/hora, confirmado ao vivo, então o custo extra
não é problema real). A linguagem certa pra aplicar o predicado
`isScannable*File` de `fetch-repo.mjs` é inferida da EXTENSÃO do que já
foi lido (`inferScannablePredicate`) -- mais direto que confiar na
"linguagem primária" que o GitHub reporta, que pode não bater com qual
heurística deste projeto se aplica.

`selectDeepReadCandidates` ganhou uma 4ª categoria, `fullyCovered`
(separada de `safe`, mesmo padrão de `blocked`/`unresolved`): repo cujo
`coverageRatio` (filesRead/totalScannableFiles) já chegou em 1 sai da
lista de leitura por completo -- não faz sentido nenhum sugerir revisitar
algo sem nada sobrando. Dentro de `safe`, cada camada agora ordena por
`coverageRatio` (menos coberto primeiro) quando os DOIS lados comparados
têm o dado; sem isso, cai pro critério antigo (`filesRead` puro) -- nunca
deixa "ainda não foi medido" desvantajar um repo.

Verificado ao vivo, não só em teste: `circlefin/evm-cpn-contracts` (7/7
arquivos) apareceu corretamente em `fullyCovered`. `vercel/ms` e
`vercel/async-sema` NÃO caíram pra 100% como eu esperava de início --
investigando o porquê revelou que `isScannableFile` (a mesma função que
o scanner de verdade já usa pra TODO repo JS/TS, não só este recurso
novo) conta `examples/*.js` e arquivos de config `.ts`
(`jest.config.ts`, `tsdown.config.ts`, `lint-staged.config.ts`) como
"escaneável" -- não é bug desta mudança, é a definição de "escaneável"
que já existia no projeto inteiro, agora só ficou visível porque
antes ninguém media cobertura percentual de repo nenhum. Resultado:
`vercel/async-sema` mostrou 20% coberto (1/5) e `vercel/ms` 25% (1/4)
em vez de "100%" -- mais preciso, não menos, do que eu esperava.

7 testes novos. `npm test`: 439 → **446/446**, zero quebrado.

**`JVM_TARGETS` deixou de estar vazio (02/09/2026)**: os 4 alvos manuais
pausados são todos Block Open Source, e nenhum dos 13 auto-promovidos
até agora é JVM (todos Go — a rotação semanal de `discover-targets.mjs`
processa um lote capado por rodada e ainda não tinha chegado num
candidato JVM elegível). Em vez de esperar a rotação, varri o dataset
inteiro (195 candidatos únicos) por heurística de nome de repo
(`android|kotlin|java|spring|gradle`) — 3 candidatos novos genuínos:
`tronprotocol/java-tron` (214MB, monorepo de nó de blockchain inteiro,
precisaria de `pathPrefixes` curados como misk/wire — descartado por
tamanho, não por mérito), `plaid/plaid-link-android` e
`auth0/auth0-java`. Escolhido o segundo: 10,4MB (cabe sem pathPrefix),
320 estrelas, push HOJE (manutenção ativa de verdade), programa
Bugcrowd com `maxPayoutUsd` conhecido no dataset (US$50.000, teto do
programa — não confirmado por ativo específico ainda).

Scope snapshot real capturado (`capture-scope-snapshots.mjs` ganhou um
6º branch, mesmo padrão do Block Open Source: Bugcrowd não expõe
`eligible_for_bounty` por ativo no dataset público, `confidence: "low"`,
precisa confirmação manual antes de qualquer achado chegar a
`human_ready`). `check-scope "Auth0 by Okta" "auth0/auth0-java"`
confirma ao vivo: `allowed: true`, `bountyEligible: null` (honesto —
sabemos que o ativo está listado, não a elegibilidade de recompensa).

Verificado ao vivo pela pipeline real, não só configuração: `listRepoFiles`
+ `isScannableJvmFile` encontraram 3594 arquivos `.java` escaneáveis de
verdade (de 3856 no repo inteiro); baixei um arquivo real
(`AuthAPI.java`, 76KB) e rodei `scanJvmSource` contra ele — zero achado
nesta rodada, resultado honesto, nem todo arquivo tem bug. 4 testes
novos em `capture-scope-snapshots.test.mjs`. `npm test`: 446 → **448/448**.

## Digest de segurança (mesma tarefa semanal)
`cve-digest.mjs` + `digest-runner.mjs`: cruza contra os GitHub Security
Advisories (GHSA, API pública, sem conta) **só dos pacotes que o
`dep-scanner.mjs` já achou vulnerável pelo menos uma vez** — não é feed
geral de CVE (seria majoritariamente ruído), é sinal focado no que já
sabemos que usamos. Escreve `research/bugbounty/security-digest.md`, só
pra decisão manual (ou de revisão por IA numa rodada futura) sobre criar
heurística nova — **nunca escreve detecção sozinho sem revisão**, mesmo
espírito anti-fabricação do resto do projeto. Validado ao vivo: achou 10
advisories reais pra `golang.org/x/crypto` (vários **críticos**, incluindo
bypass de autenticação SSH), a maioria que o cruzamento por versão exata
do OSV.dev sozinho não tinha capturado — sinal genuinamente complementar,
não redundante.

## Estágio 2 — Agente de nuvem (custo real, só quando há trabalho)
Routine "ZeroToOne Bug Bounty Analyst" (`trig_01QQeYvKRi9qJD4QkzkbqsSe`,
https://claude.ai/code/routines/trig_01QQeYvKRi9qJD4QkzkbqsSe), sessão de
IA de verdade rodando em ambiente isolado na nuvem (não no seu Windows).

**Disparo duplo:**
- **Webhook de `push`** no repositório — dispara IMEDIATAMENTE quando o
  scanner local encontra algo novo e sincroniza. Este é o gatilho
  principal, orientado a evento, não a relógio.
- **Cron diário de segurança** (11h15 UTC = 8h15 São Paulo) — rede de
  proteção caso um webhook falhe na entrega.

O primeiro passo do agente é sempre: checar se há item "pending" na fila.
Se não houver, encerra imediatamente — é o que mantém o custo baixo quando
não há nada de novo. Só gasta uso de verdade analisando quando há
candidato genuíno para investigar.

O agente lê o código, tenta REFUTAR a suspeita (mesmo padrão cético usado
na auditoria manual desta sessão), atualiza `queue.jsonl` com veredito e
justificativa, e só escreve um rascunho de relatório em
`research/bugbounty/reports/` se confirmar algo elegível para recompensa
(nunca metadado/cosmético). **Nunca envia nada — todo rascunho começa com
aviso de que precisa de revisão humana antes de qualquer envio real.**

## O que ainda é manual
- Criar conta no Immunefi/GitHub — só o usuário.
- Enviar o relatório de verdade para o programa — só o usuário, depois de
  revisar o rascunho.
- Receber o pagamento — só o usuário.

Construir o harness específico de cada finding ainda exige julgamento. A
execução parent↔commit introdutor já pode ser feita por
`verify-regression --config=... --finding-id=...`: dois checkouts em Docker,
sem rede/segredos/capabilities e com filesystem base read-only. Resultado
contraditório, timeout ou parent incorreto falha fechado. Isso prova a
regressão executada; não prova ausência de report privado. Para código
que nunca foi seguro (não regressão),
`verify-longstanding-exposure --config=... --finding-id=...` verifica a
idade real do commit introdutor via git, sem executar nada, mas o resultado
é somente contexto de risco e não libera envio.

## Comandos úteis
- Rodar o scanner manualmente: `node system/bugbounty-scanner/scan-runner.mjs`
- Testes: `node --test "system/bugbounty-scanner/test/*.test.mjs"`
- Ver o histórico de rodadas do agente de nuvem: página da routine acima.

## Gate obrigatório de duplicata antes de human_ready (31/08/2026)
Dois achados seguidos (arc-remote-signer, submetido e fechado como
duplicata; ColdStorageAddressBookModule, achado publicamente na issue
[#111](https://github.com/circlefin/buidl-wallet-contracts/issues/111)
6+ meses antes) chegaram perto de envio sem que ninguém checasse
issues/PRs do repositório afetado — numa das duas rodadas isso tinha
até sido sinalizado explicitamente como lacuna ("sem acesso à API do
GitHub agora") e ninguém revisitou antes de recomendar envio.

`state-machine.mjs` agora exige o registro estruturado descrito no início
deste README antes de permitir `scope_verified -> human_ready`. O gate é
reexecutado em `human_ready -> submitted` e antes de
`package-for-submission`: achado legado já marcado como pronto não contorna
a política. `signals` e `noveltyProof` ficam na tabela `duplicate_checks`,
no `queue.jsonl` portátil e no ledger. A ausência de qualquer parte bloqueia
com uma razão explícita; ela nunca vira aprovação por default.

**Hacktivity da Hacker API — explorado, não deu certo pra este uso
(deixado documentado pra não redescobrir depois):** `GET
/hackers/hacktivity` funciona e devolve atividade real, mas é sempre o
feed GLOBAL de toda a HackerOne — nenhuma das variantes de filtro
testadas (`filter[program][]`, `filter[program_id][]`,
`filter[handle][]`, `?program=`, nem o path aninhado
`/hackers/programs/{handle}/hacktivity`) restringe por programa. Usar
isso pra "quanta atividade tem o programa X" exigiria paginar o feed
global inteiro e filtrar no cliente — caro demais pra ser prático como
sinal de concorrência hoje. Fica registrado como caminho já tentado e
descartado, não como pendência.

## Notificações em tempo real via Telegram (31/08/2026)

`telegram.mjs` — cliente fino pra Bot API do Telegram, mesmo padrão de
`h1-api.mjs` (credenciais só via `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`,
nunca em arquivo). Diferença importante: `sendTelegramMessage` **nunca
lança** — uma falha de notificação (credencial ausente, rede fora) só
vira um aviso no log, nunca derruba o scan/transição de estado real que
a chamou. Três canais:

1. **Transição de estado notável** — hookado direto em
   `db.mjs::recordTransition`, então dispara TANTO do scanner local
   QUANTO do agente de nuvem (os dois passam pela mesma função) sem
   precisar editar o prompt da rotina. Só notifica pra
   `reproduced_local`, `scope_verified`, `human_ready`,
   `known_duplicate`, `duplicate`, `informative`, `rejected`,
   `triaged`, `paid`, `resolved` (`NOTABLE_STATES` em `telegram.mjs`) —
   `candidate`/`corroborated_static` ficam de fora de propósito (cedo
   demais, a maioria vira `false_positive` logo em seguida — seria
   ruído).
2. **Resumo diário** (`scan-runner.mjs`, ao final de toda rodada,
   achado novo ou não) — a resposta real pra "como sei que ainda está
   rodando" sem abrir nenhum arquivo.
3. **Resumo semanal** (`discovery-runner.mjs`) — candidatos novos e
   qual o programa mais recentemente lançado visto na rodada.

Envio é *fire-and-forget* (não `await`ado) só dentro de
`recordTransition`, que continua síncrona de propósito — os processos
que a chamam (scanner local, CLI do agente de nuvem) não usam
`process.exit()` no caminho de sucesso, então a promessa solta tem
tempo de completar antes do Node encerrar naturalmente. Os resumos
diário/semanal SÃO `await`ados, já que `runScan()`/`runDiscovery()` já
são funções assíncronas.

## Quarentena automática de regra ruim (31/08/2026 — Fase 2, item P1)

`quarantine.mjs` — implementa a seção 6.11 da auditoria externa
(`ZeroToOne_Auditoria_e_Prompt_Mestre.md`). Caso concreto que motivou
isso e que a própria auditoria já tinha identificado: `ssrf_risk`
chegou a **13 revisões, 13 falso-positivo, 0% de precisão** e continuava
gerando candidato novo toda vez que o padrão batia em código de
terceiro — confirmado ao vivo contra `research/bugbounty/heuristic-stats.json`
real antes de implementar (não é hipotético).

Usa a MESMA estatística por tipo×linguagem que `verdict-stats.mjs` já
calculava (nenhuma fonte de dado nova): se uma regra tem amostra
suficiente (padrão: 5+ revisões) e taxa de falso-positivo no limiar
(padrão: 100%, mesmo caso do `ssrf_risk`), ela para de gerar candidato
novo em QUALQUER dos 3 pontos de entrada do scanner (heurística por
linguagem via `runLanguageScan`, contratos Clarity, e cruzamento de
dependência via `dep-scanner.mjs`) — nenhum caminho fica de fora.

**Isso é permanente por desenho, não um bug**: uma regra quarentenada
nunca mais chega na fila, então nunca mais acumula amostra nova pra "se
corrigir sozinha" sobre o mesmo padrão ruim. A única saída é reescrever
a heurística de verdade em `heuristics-*.mjs` e então adicionar a
chave `"tipo::linguagem"` em `research/bugbounty/quarantine-overrides.json`
(array de string, começa vazio) — isso libera a regra; se ela continuar
ruim, a estatística das próximas revisões reflete isso e ela pode
voltar a ser quarentenada. Nunca escondido: toda rodada regenera
`research/bugbounty/quarantine-status.md` (o que está quarentenado, taxa
de FP, quantos candidatos foram suprimidos NESTA rodada), e o resumo
diário do Telegram menciona quando algo é suprimido.

**O que isso NÃO é**: não é o sistema de benchmark/re-certificação
completo que a seção 6.10 da auditoria descreve (corpus rotulado,
precision@K, mutation testing) — essa parte continua não iniciada.
CodeQL/Semgrep/Slither/OSV-Scanner já existem como adapters; re-certificação
estatística e mutation testing continuam sendo trabalho distinto. Esta é a fatia pequena e barata
que resolve o problema concreto já confirmado (regra específica gerando
100% de ruído), não a arquitetura de ensemble inteira.

## Grau de evidência E0-E5 (31/08/2026 — seção 6.12 da auditoria)

`evidence-grade.mjs` — rótulo explícito e consultável (`cli.mjs
evidence-grade <id>`) pro "quão bem provado" de um achado, em vez de só
citar "grau E2"/"grau E3" em prosa dentro do campo `reasoning`. Não é
fonte de dado nova: deriva do que já está gravado (`filesRead`,
`validations`, `platformOutcome`).

| Grau | Significado |
|------|-------------|
| E0 | Só padrão textual, nenhum arquivo lido |
| E1 | 1 arquivo lido, confirma condição suspeita isolada |
| E2 | 2+ arquivos lidos (cadeia cross-file) ou `corroborated_static` |
| E3 | Validação real com `result=pass`, ou avançou até `reproduced_local`/`scope_verified`/`human_ready`/`submitted`, ou chegou a qualquer terminal pós-submissão (`triaged`/`duplicate`/`informative`/`rejected`/`paid`/`resolved`) |
| E4 | Validação `end_to_end` no regression sandbox, com image id e isolamento sem rede registrados; sandbox apenas de componente permanece E3 |
| E5 | Resultado real de plataforma: `triaged`/`paid`/`resolved` |

Um outcome negativo real (`duplicate`/`informative`/`rejected`) **não
rebaixa** o grau já alcançado — grau de evidência mede "quão bem
provado o comportamento está", não "quão pagável ficou depois".

**Bug real pego ao testar ao vivo antes de commitar** (motivo de existir
uma versão "certa" documentada aqui em vez de só a primeira que
compilou): a primeira implementação checava o `state` ATUAL do achado
contra uma lista que só incluía `reproduced_local`/`scope_verified`/
`human_ready`/`submitted`. O arc-remote-signer (enviado, depois fechado
como `duplicate` pelo próprio HackerOne) tem PoC real com `go test`
passando, mas nunca recebeu uma chamada formal `record-validation` —
só foi narrado em prosa no `NOTES.md`. Resultado: como o `state` de hoje
é `duplicate` (não está na lista) e não há `validations` com
`result=pass`, caiu pro balde de contagem de arquivo (E2), escondendo
que o próprio gate de `human_ready` na state machine já exige evidência
E3 pra deixar chegar até ali. Corrigido tratando qualquer terminal
pós-`human_ready` (inclusive os negativos) como prova de que E3 foi
alcançado em algum momento — e virou `arc-remote-signer -> E3` de
verdade. Ficam duas lições: (1) todo grau novo precisa ser
retro-testado contra achados reais antes de virar "pronto", exatamente
como quarentena e o sinal de novidade de programa foram; (2) o gap real
que isso expôs — achados com PoC executável real nem sempre têm
`record-validation` formal gravado, só prosa — continua **aberto**, não
é resolvido só por este grau saber contornar o sintoma.

## Bloqueio de programa por política (31/08/2026) — conserta a pausa do Block Open Source de vez

A pausa do Block Open Source por arquivo (`targets-jvm/go/swift.mjs`
exportando array vazio) não bastou sozinha: uma rodada de leitura
profunda (`misk-admin`, ver `block-open-source/NOTES.md`) rodou HORAS
depois da pausa ser publicada, provando que o agente de nuvem não
decide o que investigar só a partir desses 3 arquivos.

`program-policy.mjs` + `research/bugbounty/program-policy.json`
resolvem isso na raiz: `db.mjs::recordTransition` injeta
`ctx.programPolicy` automaticamente em TODA chamada — não fica a cargo
de quem chama (CLI local, CLI do agente de nuvem, qualquer conta)
lembrar de passar isso. `state-machine.mjs` checa no gate
`scope_verified->human_ready` e recusa a transição pra qualquer
`f.program` marcado com `aiResearchBanned: true`, com o motivo exato
citado na razão de falha. Isso não impede a pesquisa em si (que já
aconteceu antes de qualquer chamada a `transition`) — só impede o
achado de avançar formalmente no pipeline, em QUALQUER ambiente que
compartilhe o mesmo `state-machine.mjs` via git, o que cobre os dois
lados hoje (local e agente de nuvem).

`cli.mjs check-program "<nome>"` expõe a mesma checagem ANTES de
investir tempo de investigação — resposta sempre idêntica à que o gate
de `human_ready` daria depois, porque consultam a mesma fonte.

O achado mais forte já descoberto em Block Open Source
(`wire-schema/.../DirectoryRoot.resolve`, path traversal real, E3, PoC
Java executado de verdade) agora tem essa trava formal, além do aviso
já escrito em `block-open-source/NOTES.md`.

## Pipeline de promoção automática de alvo (31/08/2026)

Até aqui, o único jeito de um programa virar alvo de varredura ativa
era eu escolher manualmente um por um — o gargalo real por trás da
"amplitude estreita" identificada em 31/08/2026: só 4 programas com
achado (Circle BBP, Vercel Open Source, Block Open Source, StackingDAO)
de milhares disponíveis no dataset HackerOne+Bugcrowd que
`discover-targets.mjs` já cobre há semanas. A descoberta em si sempre
foi ampla; a promoção pra varredura de verdade é que era 100% manual.

`promote-targets.mjs` fecha essa lacuna reusando o candidato que
`discover-targets.mjs` já buscou e enriqueceu (linguagem, estrelas,
payout conhecido, idade do programa) — nenhuma chamada de rede nova.
Cada candidato vira exatamente um veredito, nunca some em silêncio:

- `blocked_program` — programa em `program-policy.json` (defesa em
  profundidade; o gate de verdade é o de `state-machine.mjs` acima).
- `unsupported_language` — só entra quem já tem heurística de verdade
  hoje (JS/TS, Go, Kotlin/Java, Swift/ObjC, Solidity); Rust/Python/
  Move/Cairo/C++/etc. ficam de fora não por serem menos importantes,
  mas por não existir detector ainda — problema maior, não escondido
  aqui.
- `too_large` (> 20MB) — monorepo grande demais pra escanear sem
  `pathPrefixes` curados à mão (o motivo original, já documentado em
  `discover-targets.mjs`, pelo qual a descoberta nunca escreveu
  targets-*.mjs sozinha); listado à parte pra revisão manual, não
  descartado nem promovido às cegas.
- `insufficient_signal` (score 0) — ver o bug real abaixo.
- `eligible` — pontuado (`scoreCandidate`, cada componente vira uma
  frase em `reasons`, nunca "score misterioso": até 100 pontos por
  teto de recompensa conhecido, até 30 por programa lançado há menos
  de 180 dias, +10 por 100+ estrelas, +10 por push nos últimos 90
  dias) e ranqueado; top-N (padrão 5 por rodada, teto absoluto 40 no
  total) vira alvo de verdade em `targets-auto-promoted.mjs`.

Cada `targets-<linguagem>.mjs` importa `AUTO_PROMOTED_TARGETS` e faz
`[...manual, ...automático.filter(linguagem)]` — curadoria à mão e
promoção automática nunca se misturam na mesma lista escrita à mão.
`targets-auto-promoted.mjs` é 100% gerado (cabeçalho avisa "não editar
à mão"); `research/bugbounty/targets-auto-promoted-log.json` guarda o
histórico completo de toda rodada, incluindo tudo que foi considerado
e recusado.

**Bug real pego na primeira rodada ao vivo** (mesmo padrão de todo
outro recurso desta sessão: testar contra dado real antes de
considerar pronto): ranquear por score e pegar o topo-N garante só "o
menos pior do lote", não "bom o bastante" — a rodada promoveu
`ExodusOSS/crypto` e `ExodusOSS/hydra` com score=0 e `reasons: []`
(candidato HackerOne sem payout conhecido no dataset em massa, sem
estrelas relevantes, sem push recente registrado). Corrigido com
`MIN_SCORE_TO_PROMOTE` — score precisa ser > 0 (pelo menos um sinal
positivo real) pra sequer entrar no ranking; sem isso vira
`insufficient_signal`, nunca promovido só pra preencher a rodada.
Aplicado retroativamente ao arquivo já publicado usando o score já
gravado em cada entrada (sem re-buscar nada) — `GO_TARGETS` ativo hoje:
só `kubernetes/apimachinery` e `okx/go-wallet-sdk`, ambos com sinal
real (estrelas + atividade recente).

**Limite honesto ainda aberto**: candidato HackerOne nunca pontua por
payout hoje (o dataset em massa do HackerOne não expõe isso por ativo,
diferente do Bugcrowd) — só `getStructuredScope` (API ao vivo,
autenticada) teria esse dado por ativo, e chamar isso pra todo
candidato sairia caro. Hoje um programa HackerOne só pontua por
estrelas/atividade/idade, nunca por recompensa conhecida — significa
que o ranking pode estar subestimando candidato HackerOne valioso
frente a um Bugcrowd com `max_payout` público. Fica registrado como
lacuna real, não como "resolvido".

## Truncamento de arquivo sempre pegava os mesmos, para sempre (31/08/2026)

Mesmo bug, mesmo formato, do já corrigido em `discover-targets.mjs::
prioritizeCandidates` — só que na camada de escaneamento de
código-fonte de verdade, não na de descoberta. Confirmado ao vivo:
`listRepoFiles` usa a Git Trees API do GitHub, cuja ordem é **estável
entre chamadas** (testei buscando duas vezes e comparando) — então
`MAX_FILES_PER_TARGET=450` sempre cortava exatamente os mesmos
primeiros 450, pra sempre. Achado real ao investigar `okx/go-wallet-sdk`
(1001 arquivos Go): 551 nunca eram escaneados, **435 deles (79%)** em
caminho de moeda/wallet/assinatura (`coins/stellar/`, `coins/tezos/`,
`coins/ton/` inteiros, nunca lidos nenhuma vez). `vercel/vercel` era
proporcionalmente pior: dentro do escopo já curado da "Vercel CLI",
`packages/client`/`packages/vc-native` (22 arquivos) ficavam 100% no
escuro.

`prioritizeFilesForScan` (`fetch-repo.mjs`) resolve do mesmo jeito que
a descoberta: usa `repoShas[repoKey]` (já existia, cache de SHA pra
detectar mudança) como o "já visto", prioriza quem nunca foi visto
antes de truncar. Um alvo de 1001 arquivos com teto 450 agora converge
pra cobertura completa em 3 rodadas em vez de nunca — verificado
matematicamente em teste, não só por inspeção.

## Token opcional do GitHub via GITHUB_TOKEN (31/08/2026)

Toda chamada à API do GitHub neste projeto (listagem de árvore, busca
de arquivo, metadado de repo, dataset de descoberta, advisories do
digest de segurança) passa por `githubHeaders()`
(`github-auth.mjs`). Sem `GITHUB_TOKEN` no ambiente, continua 100%
anônimo como sempre (60 req/hora por IP) — isso é estritamente
aditivo, nunca virou obrigatório. Motivo de existir: uma sessão de
pesquisa manual (checagem de duplicata + descoberta + scan, tudo no
mesmo dia) esgotou esse limite de verdade (`0/60` confirmado via
`GET /rate_limit`), causando erro 403 em 4 alvos Circle BBP numa
rodada real. Um token pessoal sem NENHUM scope marcado (só lê
repositório público, que já é anônimo por natureza) sobe o limite pra
5.000/hora. Gerar em github.com → Settings → Developer settings →
Personal access tokens → Tokens (classic) → Generate new token, sem
marcar nenhuma permissão, e configurar como variável de ambiente do
usuário (nunca em arquivo — mesmo padrão de `HACKERONE_API_TOKEN`/
`TELEGRAM_BOT_TOKEN`).

## `record-platform-outcome`: sincronizar submissão feita direto na HackerOne (31/08/2026)

`sync-report-status` (`cli.mjs`) só sabia atualizar um finding que já
estava em `submitted` COM `externalReportId` gravado — ou seja, só
funcionava pra submissão feita através do próprio fluxo deste projeto.
Não cobria o caso real que aconteceu: o usuário revisou o relatório já
pronto e enviou direto no site da HackerOne, sem passar por
`transition ... submitted` primeiro. `cmdRecordPlatformOutcome`
(`cli.mjs record-platform-outcome <id> --patch='{"platform":"HackerOne","externalReportId":"...","state":"duplicate","comments":"..."}'`)
fecha essa lacuna — grava o outcome real depois do fato, pra então
`transition <id> submitted` e `transition <id> <outcome>` fluírem pela
state machine normalmente, com os timestamps reais da plataforma, não
os do momento em que o comando foi rodado.

Primeiro uso real: o achado do Solana (`gateway-wallet` denylist)
enviado pelo usuário como report #3984747 — fechado como `duplicate`
em menos de 4 minutos, por um bot automático da HackerOne
(`hackerone-agent`), citando outro report já existente (#3517577) com
o mesmo mecanismo. Não é falha de metodologia: o achado era real, o
PoC era real, só perdeu a corrida pra outro pesquisador — mesmo padrão
já visto com o arc-remote-signer nesta sessão. Ver
`circle-bbp/NOTES.md` pro registro completo.

## Orçamento de envio por programa (31/08/2026) — a "corrida" contra outros pesquisadores é estrutural, não uma falha de ferramenta

Tentei checar o report que nos venceu (#3517577) pra entender quando
foi enviado — `HTTP 403`, confirmado ao vivo. A Hacker API só mostra
reports do próprio usuário; não existe visibilidade de reports privados
de terceiros, de propósito (é exatamente o que impede um pesquisador
de "espiar a fila" de outro). Hacktivity (já documentado antes como
dead end pra filtro por programa) também não ajudaria aqui: só mostra
report já **divulgado publicamente**, e um `duplicate` recente
provavelmente nunca chega a esse ponto. Isso significa que não dá pra
checar de antemão "alguém já está investigando isso" — só dá pra
reduzir a chance, nunca eliminar.

O que reduz de verdade: (1) preferir alvo menos batido (programa/repo
recém-adicionado tem menos gente já olhando — é exatamente o motivo de
existir o sinal de novidade de programa em `discover-targets.mjs` e o
pipeline de promoção automática); (2) em programa maduro e popular
como Circle BBP, dar menos peso a um achado do tipo "falta um
`require!` óbvio" — é exatamente o tipo de coisa que muitos
pesquisadores fazendo revisão sistemática do mesmo código público
tendem a achar de forma independente e quase simultânea, como
aconteceu duas vezes seguidas aqui.

`program-submission-budget.mjs` + `research/bugbounty/
program-submission-budget.json` — rastreiam quantos envios restam por
programa quando existe um limite real (informado pelo usuário, não
descoberto via API). Não é bloqueio automático como
`program-policy.mjs` (os mecanismos exatos de cada limite não são bem
conhecidos o bastante pra virar gate rígido com segurança) — é aviso
persistente, exposto em `cli.mjs check-program`, pra nunca depender de
lembrar disso numa sessão futura. Circle BBP: 2 usados (ambos
`duplicate`, sem pagamento), 2 restantes.

## Geração automática de rascunho de relatório + `pipeline-status` (31/08/2026)

Lacuna real que existia até aqui: `scope_verified->human_ready` já
EXIGE `ctx.report.path` (ver `state-machine.mjs`), mas nada gerava esse
arquivo automaticamente — o único jeito de satisfazer essa precondição
era alguém escrever a prosa inteira à mão. `generate-report.mjs`
fecha essa lacuna parcialmente, de propósito: monta o esqueleto
completo do `TEMPLATE.md` a partir do que já está gravado no banco pra
um achado em `scope_verified`/`human_ready`/`submitted` (arquivos
lidos, saída real de PoC com `result="pass"`, evidência de deploy,
checagem de duplicata), e grava via `recordReport`. O que ele
**não** tenta automatizar: as seções "Resumo", "Impacto" e "Correção
sugerida" saem como placeholder explícito — as duas rodadas de revisão
de relatório desta missão (Solana denylist) mostraram que isso exige
julgamento editorial de verdade (ordem da evidência, o que afirmar
exatamente, calibração de severidade), não é tarefa pra template. O
`reasoning` bruto completo do achado vai anexado no fim do documento
como matéria-prima pra quem for escrever essas seções.

```
node cli.mjs generate-report <id>
```

Nunca inventa uma saída de PoC que não existe — se não há validação
`result="pass"` registrada, a seção de PoC diz isso explicitamente em
vez de fabricar conteúdo.

`cli.mjs pipeline-status` complementa isso: varre todo achado
não-terminal e devolve, pra cada um, exatamente o que falta pra
avançar (leitura profunda pendente; PoC ainda não rodada vs. sem
validador local pra aquela linguagem — bloqueio estrutural, não falta
de esforço; relatório/checagem de duplicata faltando; bloqueio de
política; ou "aguardando decisão humana"). É a mesma pergunta ("viável
enviar? viável prosseguir? por quê não?") que antes exigia investigação
manual achado por achado, agora como comando repetível — só leitura,
nunca muda estado.

**Limite estrutural atual**: existem convenções executáveis para Solidity,
JS/TS, Go e JVM e um executor genérico de regressão isolada (`node22`,
`python313`, `go127`, `jdk21`, `foundry`). O sistema não inventa um harness
específico: `pipeline-status` continua bloqueando qualquer achado sem uma
validação `pass` registrada. Swift segue sem runtime isolado permitido.

## "Só recebo coisas da Circle BBP no Telegram" — causa real, não impressão (31/08/2026)

Usuário perguntou se isso era normal. Investigação real (não suposição)
achou DUAS causas mecânicas, independentes:

1. **`shouldNotifyForTransition` (`telegram.mjs`) só notifica em
   `NOTABLE_STATES`** (`reproduced_local`, `scope_verified`,
   `human_ready`, `duplicate`, `known_duplicate`, `informative`,
   `rejected`, `triaged`, `paid`, `resolved`) — de propósito, pra não
   virar ruído a cada `false_positive`/`inconclusive`. Até a convenção
   de PoC cobrir Go/JVM/JS-TS (ver seções acima, mesmo dia), **só
   Solidity conseguia sair de `corroborated_static`** — então só Circle
   BBP (o único alvo Solidity) algum dia alcançava um estado notável.
   Vercel/OKG tiveram investigação real e extensa, só que toda ela
   terminou em `false_positive`/`inconclusive` — silenciosos por
   desenho, não por falha.
2. **Mais sério**: a sessão de nuvem roda num ambiente separado que
   NÃO tem `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` (credencial só
   existe via `setx` nesta máquina Windows — o sandbox de nuvem não
   herda isso). `sendTelegramMessage` dentro de `recordTransition` é
   fire-and-forget (`.catch(() => {})`) — quando a credencial não
   existe, ela só devolve `{ok:false}` silenciosamente, nunca lança.
   **Resultado prático: nenhuma transição que a sessão de nuvem faz
   sozinha jamais conseguiu notificar, não importa quão notável** — só
   transições que eu executei localmente (via `cli.mjs` numa sessão
   real, aqui, com credencial de verdade) notificaram. Como a
   submissão/revisão de relatório do Circle BBP sempre passou por
   interação local comigo, foi exatamente essa a única fatia que
   sempre teve credencial disponível no momento da transição.

**Correção real** (não dá pra configurar variável de ambiente dentro do
sandbox de nuvem a partir daqui): `telegram-digest.mjs` lê o **ledger
compartilhado** (`ledger/ledger.research.jsonl`, git-sincronizado,
reflete transição de QUALQUER ambiente) desde um checkpoint salvo, acha
toda transição notável nova — de qualquer programa, de qualquer ator —
e notifica a partir DAQUI (ambiente local, que tem a credencial de
verdade). Mensagem individual se poucas (≤6), resumo agrupado por
programa se muitas (nunca vira spam de dezenas de mensagens numa
rodada só). Rodado como parte da tarefa diária já agendada
(`ZeroToOne_BugBountyScanner`), depois do scan e do sync com o GitHub.
Checkpoint semeado na ponta real do ledger no momento da construção
(31/08/2026) — a primeira rodada real não despeja as ~293 transições
históricas de uma vez, só notifica atividade genuinamente nova daqui
pra frente. 19 testes novos (`test/telegram-digest.test.mjs`).

## Sincronização git resiliente pras tarefas agendadas (31/08/2026)

Achado real em `logs/bugbounty-scanner.log` (30/08/2026, 12:21:37Z):
`git push` do scanner diário foi rejeitado (`! [rejected] master ->
master (fetch first)`) porque a sessão de nuvem tinha empurrado no meio
tempo — o código só logava o aviso e desistia, sem nunca ter puxado
antes de escanear nem tentado de novo depois. `git-sync.mjs`
(`pullLatest`/`commitAndPush`) corrige isso nos dois pontos: puxa antes
de cada rodada (scan diário E descoberta semanal), e se o push final
for rejeitado por divergência, tenta puxar-e-empurrar de novo UMA vez
antes de desistir (abortando qualquer merge parcial se a recuperação
também falhar, pra nunca deixar o repositório num estado quebrado pra
próxima execução). 5 testes reais (`test/git-sync.test.mjs`) — incluindo
o cenário exato da corrida real (dois clones de um bare repo, um
empurra primeiro, o outro recupera) rodando `git` de verdade, não mock.

## Slither contra os alvos Solidity — gratuito, 100% local (2026-09-01)

Pedido explícito do usuário: seguir pelo melhor caminho, mas **sem
gastar nada, só ferramenta gratuita/local, tudo em E:**. Slither
(Trail of Bits, AGPL-3.0, `pip install slither-analyzer`) já estava
instalado neste ambiente (`py -m slither`) — ~100 detectores reais
contra o projeto Solidity COMPILADO de verdade (via Foundry, que
também já estava instalado), não regex em texto como as 4 heurísticas
próprias em `heuristics-solidity.mjs` (que continuam existindo — são
rápidas e cobrem os casos mais óbvios; Slither é mais lento e mais
profundo, os dois se complementam).

`slither-runner.mjs`: clona (ou atualiza) o repositório em
`E:/dev-toolchains/slither-cache/` (fora do repo git do projeto, mesmo
padrão já usado pro toolchain Solana), roda `py -m slither . --json`,
filtra por impacto (`Medium`+ por padrão — `Informational` sozinho é
~86% do volume real observado, majoritariamente estilo/nomeação, não
segurança) e converte pro mesmo formato de achado que o resto do
pipeline usa (mesma convenção de id `program::owner/repo/arquivo::
função::tipo` de `scan-runner.mjs`, mapeando detector conhecido pro
vocabulário já existente — `reentrancy-eth`→`reentrancy_risk`,
`tx-origin`→`tx_origin_auth_risk` — e prefixando o resto com `slither_`
pra manter a proveniência rastreável). Roda na cadência SEMANAL
(`discovery-runner.mjs`, junto da descoberta de alvo), não na diária —
clonar+compilar é ordens de magnitude mais lento que heurística de
texto. Cada alvo tem seu próprio try/catch.

**Fricção real do Windows encontrada e contornada construindo isto**
(documentada, não escondida):
1. **MAX_PATH de 260 caracteres**: um clone com árvore de submódulo
   Foundry funda o bastante (`evm-xreserve-contracts` tem submódulo
   dentro de submódulo dentro de submódulo) estoura o limite mesmo
   num caminho-base curto. `core.longpaths=true` (config LOCAL do git
   nesse clone específico, nunca `--global`) ajuda mas não resolve
   toda árvore excepcionalmente funda — esse repo específico ficou de
   fora por ora (ver "O que não deu certo" abaixo).
2. **Submódulo com URL SSH** (`git@github.com:...`) falha em clone
   anônimo sem chave configurada — reescrito direto no `.gitmodules`
   pra HTTPS antes do `submodule update` (truque padrão de CI).
3. **Slither sempre sai com código != 0** quando encontra qualquer
   achado (até `Informational`) — não é falha da ferramenta; só é
   tratado como falha de verdade se o JSON de saída nunca foi escrito.
4. **`npm install` via `execFileSync` sem shell dá `ENOENT`** no
   Windows (`npm` é `.cmd`, não `.exe`) — e `npm.cmd` explícito dá
   `EINVAL` (bug conhecido do Node nessa combinação). `shell:true`
   foi a única forma que funcionou de verdade — seguro aqui porque o
   único argumento é a string literal `'install'`, nunca dado externo.

**O que não deu certo ainda** (não escondido, e agora CONFIRMADO ao vivo
em 01/09/2026, não só suposição): `evm-xreserve-contracts` tem árvore
de submódulo funda demais pro MAX_PATH mesmo com `core.longpaths` —
`npm install` falha e o próprio Slither trava na compilação em
seguida. `buidl-wallet-contracts` tem um nome de pacote inválido no
`package.json` (`@modular-account-libs`) que trava `npm install`; ao
contrário do que se supunha antes ("Slither provavelmente ainda
funcionaria nas partes só-Foundry"), rodar de verdade mostrou que NÃO
funciona — o Slither também trava na compilação sem os imports que o
`npm install` resolveria. Nenhum dos dois é corrigível sem editar
configuração do SISTEMA operacional (registry do Windows pro limite de
MAX_PATH) ou o repositório de terceiro em si — fora do escopo desta
missão (nunca mexo em configuração de sistema/segurança da máquina).
Dos alvos Solidity curados, `evm-cctp-contracts`, `evm-gateway-contracts`
e `evm-cpn-contracts` rodam de ponta a ponta com sucesso real; 2 de 5
permanecem genuinamente bloqueados, documentados, não escondidos.

**Resultado real da primeira rodada** (`circlefin/evm-cctp-contracts`,
o bridge CCTP oficial da Circle — 49 contratos, 102 detectores, 127
achados brutos): **7 achados reais em impacto Medium+** persistidos na
fila (`candidate`), todos em código de proxy/upgrade
(`AdminUpgradableProxy.sol`, `Create2Factory.sol`) — 4
`incorrect-return` (High), 3 `unchecked_call_return` (Medium).
**Calibração honesta, não só "achei 7 coisas"**: li a descrição
completa de um dos `incorrect-return` — descreve `ifAdmin()` chamando
`Proxy._fallback()` (que interrompe execução via assembly inline) —
esse é exatamente o padrão conhecido e intencional de proxy
transparente estilo OpenZeppelin (parar propositalmente a execução
Solidity depois do fallback/delegatecall), uma classe de
falso-positivo já documentada na comunidade pra esse detector
específico do Slither. Ferramenta madura tem sua própria classe de
falso-positivo também — não é motivo pra desconfiar da ferramenta,
é exatamente por isso que a fila continua em `candidate`, esperando a
mesma leitura profunda cética que qualquer outro achado desta missão
recebe antes de virar `corroborated_static`.

11 testes novos (`test/slither-runner.test.mjs`), incluindo Slither
rodando de VERDADE (não fixture) contra um contrato `tx.origin`
sintético mínimo (~1,5s, sem dependência externa) pra provar que a
invocação real funciona, não só o parser.

## "Recebendo a mesma coisa várias vezes, só de Circle" — não era duplicata, era demais de uma vez (01/09/2026)

Usuário reportou de novo. Desta vez conferi o LEDGER inteiro (fonte
real, não suposição): **todo evento é único** — nenhuma transição
repetida pro mesmo achado/estado. Não era bug de duplicação.

O problema real, achado nos timestamps: um achado avança
`corroborated_static -> reproduced_local -> scope_verified ->
human_ready` inteiro em segundos — às vezes **8 milissegundos** entre
duas transições — e cada uma das 3 disparava notificação separada.
16 dos 19 pushes já enviados eram Circle BBP (mesma causa raiz já
documentada: único programa com investigação real até agora) — na
prática, cada achado real virava 3 mensagens em sequência imediata,
todas dizendo "Circle BBP". Isso é o que o usuário via como "a mesma
coisa várias vezes".

Correção: `NOTABLE_STATES` (`telegram.mjs`) não inclui mais
`reproduced_local`/`scope_verified` — só `human_ready` (o momento real
de "olha isso") e os desfechos terminais. 1 achado real agora gera 1
notificação, não 3. Nada foi perdido — o painel continua mostrando o
funil completo de qualquer jeito, isso só afeta o que interrompe o
celular.

Bug secundário corrigido no mesmo lote: o digest (`telegram-digest.mjs`)
rodava DEPOIS do commit+push em `scan-runner.mjs` — a atualização do
próprio checkpoint nunca entrava no commit do dia, ficava sempre "um
dia atrasada". Invertida a ordem.

## Toolchain Go inteiro estava indo pra C: — corrigido, ~4GB reclamados (01/09/2026)

Usuário reforçou (2x) a regra permanente: nada instalado por este
projeto pode ir pra C:, tudo em E:. `go install` (usado pro OSV-Scanner
abaixo) tinha ido pra `C:\Users\Renan\go\bin\osv-scanner.exe` — GOPATH/
GOBIN/GOMODCACHE/GOCACHE do Go inteiro apontavam pra C: por padrão,
nunca configurados nesta missão antes. Medido antes de mexer:
`C:\Users\Renan\go` (2,67 GB de cache de módulo) +
`C:\Users\Renan\AppData\Local\go-build` (1,4 GB de cache de build) —
**mais de 4 GB acumulados em C:** de trabalho anterior desta missão
(toolchain Go do PoC do arc-remote-signer: `buf`, `protoc-gen-go`,
`protoc-gen-go-grpc`).

Corrigido pra valer, não só pro binário novo: `go env -w GOBIN/
GOMODCACHE/GOCACHE` pra `E:\dev-toolchains\...` (arquivo de config do
próprio Go, não config de sistema) + `setx GOPATH` (GOPATH tinha uma
variável de ambiente do SO conflitando, `go env -w` sozinho não bastava
pra esse um — mesmo padrão de credencial já usado nesta missão, afeta
só processo novo). Reinstalados os 4 binários em E: (confirmados
funcionando), DEPOIS apagado o `C:\Users\Renan\go` e `...\go-build`
antigos (nunca antes de confirmar o substituto funcionando). C: agora
livre desses ~4GB; qualquer `go install` futuro nesta máquina já cai em
E: automaticamente (variável persistente).

## OSV-Scanner contra os alvos JS/Go/JVM — gratuito, 100% local, em E: (01/09/2026)

Mesma filosofia do Slither: binário gratuito mantido por terceiro
(Google, Apache-2.0), `go install` (ver seção acima pro cuidado de
manter tudo em E:), sem conta/token. Complementa `dep-scanner.mjs`
(que continua existindo) em vez de substituir: reconhece muito mais
formato de manifesto (`yarn.lock`, `requirements.txt`, não só os 3 que
o parser caseiro entende), usa o matcher de versão mantido pelo
próprio Google.

**Decisão real de escopo**: roda contra JS/Go/JVM, NUNCA contra
Solidity. Testado ao vivo contra `evm-cctp-contracts` (Circle) com
submódulo Foundry inicializado (necessário pro Slither compilar):
o OSV-Scanner viu o `yarn.lock` de CADA submódulo vendorizado de
terceiro também (`lib/centre-tokens.git`, uma dependência-de-
dependência) — **centenas** de "vulnerabilidade" em pacote de dev/teste
(`express`, `handlebars`, `body-parser`) de um submódulo alheio, nunca
alcançável pelo contrato em si. Por isso `osv-scanner-runner.mjs` usa
cache PRÓPRIO (nunca reaproveita o clone do Slither) e nunca inicializa
submódulo — mantém o mesmo escopo "só o repositório em si" que
`dep-scanner.mjs` já tinha por natureza (a API do GitHub não expande
submódulo).

**3 bugs reais encontrados e corrigidos testando isto ao vivo contra
`okx/go-wallet-sdk` (OKG), antes de deixar rodar de verdade**:
1. **`upsertFinding` sempre sobrescreve `state`** (`ON CONFLICT DO
   UPDATE SET state=excluded.state`) — rodar isto (ou o Slither) toda
   semana contra um achado JÁ RESOLVIDO (`false_positive`/`human_ready`)
   resetaria ele pra `candidate` de novo, apagando investigação real.
   Achado ANTES de rodar contra um alvo real (não em produção) —
   corrigido em `discovery-runner.mjs`: só insere quando o id é
   genuinamente novo, nunca toca achado que já existe. Mesmo fix
   retroativo aplicado ao bloco do Slither.
2. **Caminho do arquivo vinha absoluto** (`result.source.path` do
   OSV-Scanner devolve `E:/dev-toolchains/osv-scanner-cache/...`, não
   relativo ao repositório) — sem corrigir, o id do achado vazava
   caminho local desta máquina pro banco/queue.jsonl compartilhado.
   Corrigido com `path.relative(repoDir, ...)`.
3. **Versão Go sem o prefixo "v"** — OSV-Scanner devolve `1.1.2` pra
   ecosystem Go, mas `dep-scanner.mjs::parseGoMod` (regex sobre o texto
   cru do go.mod) sempre preserva `v1.1.2`. Sem normalizar, os dois
   scanners geram id DIFERENTE pro MESMO pacote, e a proteção do item 1
   nunca encontra o achado antigo pra comparar. Confirmado ao vivo: o
   achado `cosmossdk.io/math` (já resolvido `false_positive` nesta
   sessão) só foi corretamente preservado, sem resetar, DEPOIS deste
   fix — antes dele, viraria `candidate` de novo silenciosamente.

Rodando na cadência semanal, mesmo motivo do Slither (mais lento que
heurística de texto). 13 testes novos
(`test/osv-scanner-runner.test.mjs`), incluindo o OSV-Scanner rodando
de verdade contra um `package-lock.json` sintético com uma dependência
realmente vulnerável (`minimist` 1.2.5, CVE-2021-44906).

## Semgrep contra os alvos JS/Go/JVM — terceiro scanner estático, gratuito, em E: (01/09/2026)

Terceira ferramenta externa integrada (mesmo padrão arquitetural do
Slither/OSV-Scanner: `prepareRepoFor*`/`run*OnRepo`/`parse*Json` puro/
`toQueueFindings` na mesma convenção de id). Diferença real de escopo:
Slither olha só corretude de contrato Solidity, OSV-Scanner olha só
dependência conhecida-vulnerável — nenhum dos dois olha o CÓDIGO da
própria aplicação JS/Go/JVM em busca de padrão perigoso (uso de
criptografia fraca, deserialização insegura, injeção). Semgrep (r2c/
Semgrep Inc., LGPL 2.1, `p/security-audit` — registro público de
regras, sem conta/API key) fecha essa lacuna.

Instalado numa **venv própria em E:**
(`E:/dev-toolchains/venv-security`), nunca no Python global do sistema
onde o Slither historicamente já vive (esse não foi movido — não fui
eu quem o instalou nesta missão, e mover um Python global em uso é
mais arriscado que isolar só o que é novo). Mesmo cuidado "nada novo em
C:" já aplicado ao Go inteiro na seção acima.

Mesma decisão de escopo do OSV-Scanner e pelo mesmo motivo (ruído de
submódulo vendorizado de terceiro): roda contra JS/Go/JVM, nunca contra
Solidity, clone próprio sem inicializar submódulo, cache isolado
(`E:/dev-toolchains/semgrep-cache/`) nunca compartilhado com as outras
duas ferramentas. Mesma proteção de `upsertFinding` (item 1 do OSV-
Scanner acima) aplicada de saída, não descoberta de novo — já sabia do
risco desta vez.

Verificado ao vivo contra `okx/go-wallet-sdk` (OKG): 40 achados reais
genuínos (uso de RC4, `math/rand` onde deveria ser `crypto/rand`,
`unsafe.Pointer`, SHA1), todos com caminho corretamente relativizado e
normalizado (`\` → `/`), todos novos (0 colisão de id com achado
pré-existente). ~14s para 1000 arquivos com o ruleset `p/golang` em
teste isolado — rápido o bastante pra cadência semanal junto dos outros
dois. 9 testes novos (`test/semgrep-runner.test.mjs`), incluindo o
Semgrep rodando de verdade contra um arquivo Go sintético com RC4 real.

Detector conhecido (RC4, deserialização insegura, SQLi, command
injection, path traversal, SSRF, prototype pollution, secret
hardcoded) mapeia pro mesmo vocabulário de tipo já usado pelas
heurísticas próprias, pra herdar quarentena/dashboard sem mudança
nenhuma; o Semgrep tem MUITO mais regra que isso, então o resto vira
`semgrep_<nome-curto-da-regra>` — rastreável, nunca escondido atrás de
um tipo genérico.

## CodeQL buildless em rotação JS/TS (04/09/2026)

`codeql-runner.mjs` cria um banco CodeQL do source tree JavaScript/TypeScript
sem executar `npm install`, package scripts ou build do repositório-alvo e
analisa com `javascript-security-extended`. O parser de SARIF só promove
resultado com `security-severity >= 7` e exclui caminhos não produtivos pela
mesma política dos demais scanners. A identidade da fila preserva regra,
arquivo e linha.

`analysis-rotation.mjs` escolhe primeiro alvo nunca analisado e depois o
sucesso mais antigo; falha grava tentativa/erro sem avançar o cursor de
sucesso. A rotação processa um alvo JS/TS por discovery para controlar CPU e
armazenamento. Go/JVM não entram: CodeQL nessas linguagens exige build do
projeto de terceiro, que só será habilitado quando o build estiver num job
descartável sem credencial de escrita.

O teste de integração executa o CLI oficial de verdade contra um fixture com
fluxo HTTP → `child_process.exec` e exige que a command injection apareça no
SARIF. `toolchain-doctor.mjs` trata CodeQL como a oitava dependência obrigatória.

## Pipeline de promoção: throughput e peso de novidade aumentados (01/09/2026)

Usuário perguntou diretamente por que só Circle BBP aparece com
frequência quando o HackerOne tem centenas de outros programas
disponíveis, inclusive vários sem nenhum report ainda — e deu
autonomia explícita pra melhorar identificação de alvo, achado que
paga, e achado que ninguém reportou ainda. Resposta em dois ajustes no
`promote-targets.mjs` já existente (não um recurso novo):

1. **Teto de promoção por rodada/total**: 5→**20** por rodada semanal,
   40→**200** total ativo. O teto de 5/40 original foi dimensionado
   pro limite de 60 requisições/hora do GitHub sem autenticação — desde
   a introdução do `GITHUB_TOKEN` (seção própria abaixo) o limite real
   é 5000/hora, então o teto artificial de 5/40 estava sobrando
   capacidade de sobra na mesa sem motivo técnico que ainda se aplique.
2. **Peso de novidade em dobro, janela quase o dobro**: sinal de
   "programa lançado há pouco tempo" (proxy direto pra "ninguém
   reportou ainda", pedido explícito do usuário) subiu de até 30 pontos
   em até 180 dias pra até **60 pontos em até 365 dias** — programa
   lançado há 300 dias antes marcava 0 ponto de novidade, hoje ainda
   marca ~10.

**Sinal considerado e rejeitado**: `average_time_to_bounty_awarded ===
null` no dataset do HackerOne (15 dos 226 programas ativos) parecia à
primeira vista um proxy direto de "baixa competição" — mas
investigação mostrou que mistura programa genuinamente novo com
programa antigo onde quase nada nunca é aprovado (Node.js, Django,
Ruby, Phabricator aparecem todos nesta lista, nenhum deles novo).
Descartado por ser ruidoso demais pra usar como pontuação; registrado
aqui como pesquisa real feita e não só ideia não tentada.

Nenhuma mudança de comportamento em `classifyCandidate` além do peso —
o veredito (`eligible`/`insufficient_signal`/`too_large`/
`unsupported_language`/`blocked_program`) e o `MIN_SCORE_TO_PROMOTE >
0` (bug do score=0 já documentado acima) continuam exatamente iguais.

## Bug real e sério: 98% de ruído de `examples/`/`test/fixtures` no OSV-Scanner (01/09/2026)

Rodando `discovery-runner.mjs` de ponta a ponta pela primeira vez com
os tetos novos de promoção (seção acima) pra provar que tudo funciona
junto de verdade — não só em teste isolado — o OSV-Scanner contra
`vercel/vercel` (repositório real do Vercel Open Source, curado à mão,
não um submódulo de terceiro) devolveu **4364 "vulnerabilidade" de
severidade 7.0+, todas marcadas como achado novo**. Antes de aceitar
isso como sucesso ("achei 4364 coisas!"), investiguei — mesma disciplina
já aplicada a cada ferramenta nova nesta sessão (nunca confiar no
número bruto sem entender de onde vem).

**Causa raiz**: `vercel/vercel` é um monorepo com `examples/` contendo
**333 lockfiles separados** — um template de demonstração por
framework (`examples/gatsby`, `examples/nextjs`, `examples/docusaurus`,
etc., cada um "como fazer deploy de X na Vercel"), nunca executado
contra tráfego real, e com dependência deliberadamente desatualizada
pra estabilidade do exemplo. Some a isso dezenas de `**/test/fixtures/
**/yarn.lock` — lockfile CONGELADO de propósito dentro de teste do
detector de build (`packages/build-utils/test/fixtures/05-zero-config-
gatsby/yarn.lock`), existe só pra determinismo do teste, nunca é
instalado/rodado de verdade. Diferente do problema de submódulo já
resolvido pro Slither/OSV-Scanner (aquele era conteúdo de FORA do
repositório, resolvido não inicializando submódulo) — aqui o ruído
está DENTRO do próprio repositório principal, então aquele fix não
ajuda em nada.

**Medição real** (script ad-hoc, apagado depois de usar): dos 4364,
**4283 (98,1%)** caem em `examples/`, `test/`, `tests/`, `fixtures/`
ou `mocks/`; sobraram **81 achados genuínos** — o `pnpm-lock.yaml` da
raiz do monorepo (dependência real do produto), 2 lockfile de script
interno (`scripts/internal-dependency-trace`, `scripts/node_bench`,
`packages/config`), e um punhado de achado real de Semgrep em código
de aplicação de verdade (`command_injection_risk` em
`packages/cli/src/commands/mcp/mcp.ts`, `path_traversal_risk` em
`packages/cli/scripts/build-binary.mjs`).

**Corrigido** com um filtro compartilhado novo
(`path-noise-filter.mjs`, `isNonProductionPath`) — casa por SEGMENTO
exato do path relativo (`examples`, `test`, `tests`, `__tests__`,
`testdata`, `fixture`, `fixtures`, `__fixtures__`, `mock`, `mocks`,
`__mocks__`, `demo`, `demos`, `sample`, `samples`), nunca por substring
cru (evita falso positivo tipo um diretório real `latest/` ou
`contest/` sendo pego por engano). Aplicado dentro de
`parseOsvScannerJson` e `parseSemgrepJson`, logo após relativizar o
caminho — acha real de qualquer um dos dois nunca mais entra na fila
vindo de pasta de teste/demo/fixture/mock. `vendor/` foi
propositalmente deixado DE FORA da lista: dependência vendorizada é
código real, embarcado no binário final, genuinamente alcançável —
diferente de fixture de teste.

**Contenção real**: o processo foi interrompido manualmente assim que
o número (4364, "novo desta vez") apareceu no log, ANTES da etapa de
`commitAndPush` — nada disso chegou a ser commitado/empurrado pro
repositório compartilhado. Só o banco SQLite LOCAL (gitignored, por
ambiente) ficou com os 4286 achados ruins por alguns minutos; limpos
com um `DELETE` restrito a `state='candidate'` (nunca toca achado já
revisado por humano) via script ad-hoc. Depois do fix, rodar o
OSV-Scanner e o Semgrep de novo contra o MESMO clone de
`vercel/vercel` confirmou: filtro elimina o ruído, os achados
genuínos (incluindo os de código de aplicação real do Semgrep)
continuam passando normalmente.

**Não escondido**: o filtro reduz RUÍDO ÓBVIO (nome de pasta
conhecido), não julga alcançabilidade de verdade — `scripts/
internal-dependency-trace` e `scripts/node_bench` continuam na fila
como `candidate` mesmo sendo tooling interno, não o produto publicado;
fica pra revisão humana decidir se isso está dentro do escopo do
programa, o filtro automático não tenta resolver essa nuance sozinho.
4 testes novos (`test/path-noise-filter.test.mjs`) mais 2 teste de
regressão (um em cada runner) confirmando que a mesma pasta que causou
o problema real (`examples/`, `test/fixtures/`) é ignorada, e que
código de produção real (`packages/cli/src/...`) nunca é afetado.
`npm test`: 394/394 depois do fix.

## Trava mecânica contra ler repositório de programa banido (01/09/2026)

Quarto incidente da mesma classe em 2 dias (ver
`research/bugbounty/block-open-source/NOTES.md`, seções "INCIDENTE" e
"near-miss", 31/08 a 01/09/2026): uma rodada de leitura profunda
proativa ia direto em `deep-read-log.json` escolher o repositório menos
lido, sem carregar `program-policy.json` antes, e acabava clonando/
lendo repositório do Block Open Source (`aiResearchBanned: true` — RoE
da Bugcrowd proíbe explicitamente uso de ferramenta de IA "durante a
pesquisa", ponto, independente do resultado). Sempre autocorrigido na
mesma rodada, nunca com achado promovido nem dado vazado a terceiro (o
gate `scope_verified->human_ready` de `state-machine.mjs` já bloqueia
isso automaticamente) — mas a LEITURA em si já configura a violação, e
a nota do próprio incidente mais recente é direta: "não há nenhuma
barreira mecânica no CLI/state machine que bloqueie a leitura em si",
só recomendação de prompt — e depender de disciplina de prompt já
falhou 4 vezes.

**Fix real, não só mais uma instrução pra lembrar**: `program-policy.mjs`
ganhou dois exports novos, `isProgramBanned(programa, policy)` (wrapper
booleano de `getBlockReason`) e `filterBannedTargets(candidatos,
policy)` (filtra fora candidato `{program, ...}` de programa bloqueado,
reusável por qualquer script). Em cima disso, `list-deep-read-candidates.mjs`
(novo) cruza `deep-read-log.json` (o que já foi lido, por repositório)
contra o MESMO dataset público que `discover-targets.mjs` já usa
(`hackerone_data.json`/`bugcrowd_data.json`) pra descobrir o(s)
programa(s) de cada repositório — cobre muito mais que os `targets-*.mjs`
curados, que nunca incluíram `cashapp/misk`/`circlefin/malachite`/etc.,
mas que já apareciam em `deep-read-log.json` por leitura profunda
proativa anterior.

Falha fechado em duas frentes independentes: (1) repositório com
QUALQUER programa associado banido é excluído, mesmo que outro
programa do mesmo repositório não esteja banido (um repositório pode
estar no escopo de mais de um programa); (2) repositório que não bate
com nenhum programa conhecido no dataset público vai pra lista
`unresolved`, nunca pra lista `safe` em silêncio — dataset desatualizado
ou repositório removido do escopo público merecem checagem manual, não
a suposição de "não achei = seguro pra ler".

Rodado ao vivo contra o estado real do projeto: 38 candidatos seguros
surgem corretamente ranqueados do menos lido pro mais lido, e os 7
repositórios do Block Open Source hoje em `deep-read-log.json`
(`cashapp/misk`, `cashapp/hermit`, `square/wire`, etc.) aparecem
corretamente na lista de excluídos, nunca na de seguros — a ferramenta
é literalmente mais rápida de rodar (`node list-deep-read-candidates.mjs`)
do que cruzar os dois JSON à mão, que é o ponto: o caminho mais fácil
também precisa ser o seguro, não só existir um caminho seguro que
ninguém usa. 24 testes novos (`test/program-policy.test.mjs` +
`test/list-deep-read-candidates.test.mjs`), cobrindo o núcleo puro
(`buildRepoProgramIndex`/`selectDeepReadCandidates`) sem precisar de
rede nos testes. `npm test`: 410/410 depois do fix.

**Limite honesto**: isto reduz drasticamente a chance de o incidente se
repetir (a lista de saída já vem sem o programa banido, não depende de
quem chama lembrar de filtrar), mas não FORÇA nenhuma sessão futura a
rodar esta ferramenta em vez de continuar lendo `deep-read-log.json`
direto — o prompt da rotina do agente de nuvem continua fora do alcance
de qualquer sessão individual editar. A trava mecânica de verdade
(impedir o achado de avançar até `human_ready`) já existia e continua
valendo; isto aqui ataca a causa (a leitura em si) tornando o caminho
seguro também o mais conveniente, não substitui o gate existente.

## Bug real: dado de teste vazando pro ledger de produção compartilhado (02/09/2026)

Achado pelo usuário lendo `git diff ledger/ledger.research.jsonl` e
notando 3 linhas com `findingId` óbvio de fixture
(`"Programa X::owner/repo-a/file1.ts::fn1::ssrf_risk"`) misturadas com
achados reais no ledger versionado em git — não um ledger temporário de
teste, o de produção que `ledger/ledger.mjs::verifyChain` protege.

**Causa raiz**: `db.mjs::recordPlatformOutcome` (e os outros `record*`
adicionados em 01-02/09/2026, ver seção "Bug real e sério" mais acima)
chama `appendEntry('research', {...})` diretamente — sem nenhum jeito
de o chamador injetar um ledger diferente. O único ponto de
redirecionamento é a variável de ambiente `ZERO2ONE_LEDGER_DIR`, lida
por `ledger.mjs::getLedgerDir()`. Os testes que exercitam essas funções
(`test/db.test.mjs`, `test/cli.test.mjs`, `test/migrate-to-v2.test.mjs`,
`test/generate-report.test.mjs`) já setam e restauram essa variável
dentro do próprio `withTempEnv` de cada arquivo — mas
`test/list-deep-read-candidates.test.mjs` tinha uma cópia mais antiga
desse mesmo helper (de antes de `recordPlatformOutcome` tocar o
ledger), sem essas duas linhas. Confirmado por inspeção cruzada dos 5
`withTempEnv` do projeto — são cópias locais por arquivo (não um
helper compartilhado importado), e só essa ficou desatualizada.

**Escala real do vazamento** (maior do que o usuário via no diff local
não commitado): varrendo o ledger inteiro por `findingId` começando
com `"Programa X::"`, apareceram **27 entradas poluídas**, em 9 rodadas
diferentes de `npm test` ao longo do dia (09:11 a 12:49), intercaladas
com achados reais genuínos (inclusive duas gravações reais do outcome
"duplicate" do achado SSRF, HackerOne #3988959). Duas dessas 27 já
tinham sido commitadas (`53292be`, `36f8138`) antes de qualquer sessão
notar.

**Correção**: (1) adicionadas as duas linhas faltantes de
`ZERO2ONE_LEDGER_DIR` ao `withTempEnv` de
`list-deep-read-candidates.test.mjs`, idêntico aos outros 4 arquivos —
`npm test` completo rodado de novo depois (448/448) confirmou zero
novas entradas `"Programa X::"` no ledger real. (2) Como o ledger é
encadeado por hash (`prevHash`/`hash` de cada entrada depende da
entrada anterior), simplesmente apagar as 27 linhas do meio do arquivo
quebraria a cadeia para as entradas genuínas que vieram depois delas.
Corrigido com um script único que: filtra as entradas
`"Programa X::"`, e recomputa a cadeia INTEIRA do zero usando o mesmo
algoritmo de `appendEntry` (mesma ordem de campos, mesmo
`sha256(JSON.stringify(...))`) — com autocheck embutido (aborta sem
escrever nada se qualquer hash recomputado de uma entrada anterior ao
primeiro ponto de remoção não bater com o hash já gravado, o que
confirmaria um erro na reconstrução). Rodou limpo: 434 → 407 entradas,
autocheck passou, e `verifyChain('research')` (a função real do
projeto, não uma reimplementação) confirmou `{valid: true, entries:
407}` no resultado final.

**Nunca reescrito**: os 2 commits que já continham parte da poluição
(`53292be`, `36f8138`) não foram alterados — reescrever histórico já
publicado exigiria force-push, uma operação destrutiva que este projeto
evita por padrão. A correção entra como um commit novo, de avanço, não
uma reescrita do passado.

## Segundo report real enviado — Command Injection em `update-remix-run-dev.js` (02/09/2026)

`vercel/vercel::utils/update-remix-run-dev.js` — `execSync()` com
template string recebendo, sem sanitização, o input livre
`workflow_dispatch::new-version`, em 4 pontos (linhas 32/64/66/67).
Passou por duas rodadas de revisão técnica externa (não deste
pipeline) antes do envio, que pegaram e corrigiram problemas reais:
afirmação de privilégio não verificada ("concretely, write
permission..." virou hedge explícito sobre não ter confirmado
restrição adicional do repositório), impacto amplo demais ("access to
whatever secrets/environment" virou "downstream impact depends on
permissions actually granted, not enumerated"), citação solta da
frase "production-equivalent deployment" da própria política deles
(troca por descrição factual, evita abrir flanco de definição), e um
risco real de reprodução: a seção "Steps to reproduce" estava escrita
como instrução imperativa pra rodar contra o `vercel/vercel` de
verdade — exatamente o que o Rules of Engagement do programa proíbe.
Corrigida pra descrição hipotética com aviso explícito, apontando pra
uma réplica isolada (https://github.com/Genezera/remix-injection-poc)
como o caminho seguro de verificação — réplica testada AO VIVO num
runner real do GitHub Actions antes do envio (não só planejada):
payload `1.0.0$(id 1>&2)` disparado de verdade, saída do `id`
capturada no log público quatro vezes (uma por ponto de injeção),
execução pública e permanente em
https://github.com/Genezera/remix-injection-poc/actions/runs/33637084151.

**Severidade**: preenchida com CVSS 4.0 puro (calculadora da própria
HackerOne, sem escolher rótulo manualmente) — `AV:N/AC:L/AT:N/PR:H/
UI:N/VC:H/VI:H/VA:H/SC:L/SI:L/SA:L`. `PR:H` (não `L`) refletindo que
"write access a um repositório específico" é privilégio concedido e
específico, não capacidade básica de qualquer conta — mesma
calibração de "não é unauthenticated RCE" que já estava no texto do
relatório. `SC/SI/SA:L` (não `N`) porque afirmar "None" seria alegar
certeza de zero impacto além do runner, que o relatório explicitamente
não prova nem descarta.

**Enviado**: HackerOne #3990360, confirmado ao vivo via `my-reports`
(estado inicial `"new"`). Registrado no sistema de tracking deste
projeto contra as 4 findings subjacentes (uma por linha vulnerável,
todas ainda em `state: candidate` -- nunca passaram pelas fases
formais do pipeline, mesma situação já documentada pro achado SSRF
#3988959): `record-platform-outcome` gravado nas 4, apontando pro
mesmo `externalReportId`. Tentativa de transição `candidate ->
submitted` falhou como esperado (aresta não existe na máquina de
estados -- só `human_ready -> submitted` é válida) e foi reportada
honestamente (`transition: null`), não forçada.

**Resultado real**: fechado pela HackerOne como duplicate de #3545083
(report original submetido ~7 meses antes deste, já avaliado e fechado
como *informative* -- não corrigido, não pago; o código continua
vulnerável hoje, confirmado por leitura direta do arquivo antes do
envio). `record-platform-outcome` atualizado nas 4 findings
subjacentes com `state: duplicate` e o contexto completo da análise
recebida; tentativa de transição `candidate -> duplicate` também
falhou honestamente pelo mesmo motivo estrutural de sempre (mesma
aresta ausente já documentada pro SSRF e pro registro inicial deste
achado) -- `queue.jsonl` confirma as 4 findings com `externalReportId
3990360` e referência a `3545083` persistidas.

**Lição real de metodologia pro duplicate-check** (a mais valiosa
desta rodada inteira): o analista notou que o report original
descrevia a MESMA instância de código como **"expression injection"**
(a classe de injeção via `${{ }}` de GitHub Actions, documentada pelo
próprio blog de segurança do GitHub), enquanto o nosso descrevia como
**"OS command injection via metacaractere de shell"** -- terminologias
diferentes pro mesmo root cause/mesmo par de arquivos. O
duplicate-check que fizemos antes do envio (issues/PRs do GitHub,
GitHub Security Advisories, busca pública) só usou termos da NOSSA
própria framing ("command injection", "execSync", "workflow_dispatch")
-- nunca teria encontrado um relatório privado descrito como
"expression injection" mesmo se essa busca alcançasse relatórios
privados (que não alcança, é o limite já documentado). Fica registrado
aqui, não só na memória de sessão, porque é generalizável: qualquer
achado futuro em CI/CD do GitHub Actions precisa considerar as DUAS
framings comuns da mesma classe de bug (expression/template injection
E command injection via shell) ao redigir e ao tentar duplicate-check,
não só a que pareceu mais natural escrever primeiro.

**Placar real até aqui**: 4 relatórios enviados, 4 fechados como
duplicate (nenhum bounty pago). Ver README.md raiz do projeto para o
placar completo e a leitura honesta desse padrão.

## Terceiro report, `program-policy.mjs` generalizado, empacotamento pra envio, e um bug real de latência na promoção (02/09/2026)

Terceiro relatório enviado (Kubernetes, `cluster-bootstrap`, comparação
HMAC não-constante em `DetachedTokenIsValid` — ver
`research/bugbounty/kubernetes/NOTES.md` pro achado completo, revisado
em várias rodadas de honestidade a partir de review externa). Fechado
como duplicate de um report já existente (#3612349, ele mesmo fechado
Informative) — o motivo de fechamento do original bateu quase palavra
por palavra com a calibração de severidade que a gente chegou sozinho
a partir de revisão externa, antes de saber que existia relatório
anterior. Placar agora: **5 relatórios enviados, 5 fechados sem
pagamento** (4 duplicate, 1 duplicate-de-informative).

Três mudanças estruturais nesta mesma rodada, pedidas diretamente pelo
usuário:

- **`program-policy.mjs` generalizado**: até aqui só existia
  `aiResearchBanned` (RoE de programa proibindo pesquisa por IA). Usuário
  pediu explicitamente, duas vezes, pra parar de investir em Circle BBP
  — não é RoE, é decisão dele. Adicionado campo `blocked` genérico
  (independente de `aiResearchBanned`) pra cobrir exatamente esse caso,
  com o mesmo enforcement em duas camadas que Block Open Source já tinha
  (gate em `state-machine.mjs` + filtro em `promote-targets.mjs`) — Circle
  BBP agora está estruturalmente fora do pipeline, não só "lembrado" por
  uma sessão de cada vez.
- **`package-for-submission.mjs`** (novo): usuário pediu pra deixar tudo
  pronto numa pasta pra só enviar. Junta relatório + screenshots de um
  achado `human_ready` em `research/bugbounty/ready-to-submit/<slug>/`
  (gitignored, pura conveniência local). Deliberadamente NÃO tenta gerar
  o mapeamento pros campos do formulário (título/descrição/severidade)
  — isso precisou de julgamento real e específico de programa toda vez
  que foi feito nesta sessão (Kubernetes usa CVSS 3.0 e tem campos que
  nenhum outro programa tem; Vercel usa CVSS 4.0) — um template genérico
  seria vago demais ou errado com confiança.
- **Bug real de latência na promoção automática, achado ao vivo**: rodei
  `discovery-runner.mjs` numa amplitude bem maior (20/rodada em vez de
  poucos, pedido do usuário: "quero uma rotação maior") e reparei que os
  11 alvos recém-promovidos (kubelet, kubeadm, kube-proxy, etc.) não
  seriam escaneados NESTA rodada — `JS_TARGETS`/`GO_TARGETS`/etc. são
  bindings de import ES resolvidos uma vez só no início do processo, e a
  promoção reescreve `targets-auto-promoted.mjs` em disco depois disso.
  Um alvo recém-promovido ficava uma semana inteira esperando a próxima
  execução agendada só pra ser escaneado pela primeira vez. Corrigido
  reconstruindo as listas de varredura a partir de `mergedAutoPromoted`
  (já calculado em memória pós-promoção) em vez dos imports estáticos —
  ver o comentário grande no topo de `discovery-runner.mjs`. 466/466
  testes passando.

## Bug real (não corrigido nesta rodada): `migrate-to-v2.mjs` duplica evento de satélite no ledger a cada sessão nova de nuvem (03/09/2026)

Achado comparando `git diff ledger/ledger.research.jsonl` desta rodada
contra a anterior: as duas têm exatamente `+18` linhas, e são as
*mesmas* 4 categorias de evento satélite (`bugbounty_platform_outcome`,
`bugbounty_deployment_evidence`, `bugbounty_report`,
`bugbounty_validation`) pros *mesmos* `findingId` que já apareciam bem
mais acima no arquivo — mesmo conteúdo semântico, `ts`/`hash`/`prevHash`
novos a cada vez. Nenhum comando desta sessão gravou isso de propósito
(não chamei `record-validation`/`record-report`/`record-deployment-evidence`
nem `transition` — só `migrate-to-v2.mjs`, `list-pending`, `status` e
`export-queue`).

**Causa raiz**: `migrate-to-v2.mjs::restoreSatelliteData` (comentário
já promete idempotência — "rodar isto de novo pra uma linha sem mudança
nenhuma não duplica... nem gera evento novo no ledger") checa
idempotência comparando contra `latest*(db, findingId)` — ou seja,
contra o banco SQLite local **desta mesma sessão**, que é reconstruído
do zero (`research/bugbounty/zerotoone.db`, gitignored, "cada ambiente
tem sua própria cópia efêmera", conforme o próprio prompt agendado
descreve) toda vez que um container de nuvem novo é provisionado. Numa
sessão de container único e contínua, a checagem funciona (chamar
`migrate-to-v2.mjs` duas vezes na mesma sessão não duplica nada, porque
`current` na segunda chamada já reflete o que a primeira gravou). Mas
entre sessões — exatamente o padrão real de uso deste pipeline, uma
sessão de nuvem efêmera nova a cada disparo agendado — `current` começa
sempre `null`/`undefined` pra todo `findingId`, então `same` é sempre
`false`, e cada finding com `platformOutcome`/`deploymentEvidence`/
`report`/`validationsHistory` em `queue.jsonl` tem seu evento satélite
re-gravado (e re-anexado ao ledger real) desde o zero, toda vez. Mesma
classe de "o dado sumia entre ambientes efêmeros" que a big comment no
topo de `restoreSatelliteData` já cita como motivação original da
função — só que a correção resolveu a perda de dado e introduziu
duplicação de ledger no processo.

**Escala**: pelo menos 2 rodadas consecutivas confirmadas (`84b5567` e
esta), 18 linhas cada — mas função existe desde 02/09/2026, então o
número real de rodadas afetadas é provavelmente maior; não investiguei
quantas por não ser o escopo desta sessão (revisão de achados, não
manutenção do pipeline). Ao contrário do bug de "dado de teste vazando
pro ledger" documentado acima, aqui o conteúdo duplicado é real
(nenhum dado de fixture/teste, nenhum `"Programa X::"`) — o problema é
puramente volume redundante num arquivo append-only encadeado por hash,
não corrupção de conteúdo.

**Não corrigido nesta rodada** — o ledger é auditável e encadeado por
hash (`prevHash`/`hash`), e mexer na lógica de gravação dele sem rodar
a suíte de teste completa e confirmar `verifyChain` de perto é risco
maior do que o benefício de um fix apressado numa rodada cujo escopo é
revisão de achados, não engenharia do scanner. Caminho de correção mais
provável, pra quem pegar isto depois: trocar a checagem de idempotência
de `restoreSatelliteData` pra usar `ledgerStates`/histórico real do
ledger (já lido no início de `migrateAll` via `readLedger` +
`deriveStatesFromLedger`, mesmo padrão já usado pra `driftDetected`
alguns parágrafos acima) em vez do banco SQLite efêmero da sessão atual.
