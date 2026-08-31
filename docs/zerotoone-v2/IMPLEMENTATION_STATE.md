# ZeroToOne v2 — estado de implementação

Rastreia o progresso do plano descrito em
`ZeroToOne_Auditoria_e_Prompt_Mestre.md` (auditoria externa + prompt
mestre, recebido do usuário em 29/08/2026). Atualizado ao final de cada
fase concluída.

## Fase 0 — Auditoria do repositório e baseline

**Status: concluída em 2026-08-29.**

Feito:
- `git status` verificado limpo antes de qualquer mudança.
- Suíte de testes existente rodada sem alteração: 175/175 passando,
  5,66s (`npm test`).
- Árvore do projeto mapeada por completo (22 módulos de scanner + 15
  arquivos de teste + módulos arquivados da fase financeira).
- Todos os 35 itens de `queue.jsonl` reconstruídos a partir do arquivo
  real (não copiados do PDF) — 3 confirmado / 31 falso_positivo /
  1 inconclusivo, 0 pending.
- Os 3 itens "confirmado" foram lidos por completo (reasoning +
  rascunho de relatório quando existia) e avaliados contra os critérios
  mais rígidos da auditoria externa — nenhum atende hoje a
  `scope_verified` no sentido que a Fase 1 vai definir.
- Prompt real do agente de nuvem capturado por completo via
  `RemoteTrigger get` (não resumido) — usado para `threat-model.md`.
- Tarefas agendadas do Windows confirmadas via `Get-ScheduledTask`.
- Fonte de escopo confirmada como dataset comunitário (não snapshot
  oficial) via grep direto em `circle-bbp/NOTES.md`.
- Documentos produzidos: `current-state.md`, `gap-analysis.md`,
  `threat-model.md` (este diretório).

Resultado: **nenhuma divergência material** entre os números do PDF
anterior e o repositório real. As afirmações qualitativas do PDF
("totalmente automatizado", "aprende sozinho", "confirmado", "ledger à
prova de adulteração", "zero caixa-preta") não se sustentam sob os
critérios mais rígidos e foram corrigidas em `gap-analysis.md`.

## Fase 1 — P0: Scope Registry, máquina de estados, sandbox, persistência

**Status: concluída em 2026-08-30**, no escopo que o usuário confirmou
("tudo isso de uma vez" — as 4 frentes abaixo, numa rodada só).

### Scope Registry (`system/bugbounty-scanner/scope-registry.mjs`)
- Snapshot versionado por programa (`research/bugbounty/scope-snapshots/*.json`):
  `sourceType` (`official_page_fetch`/`community_dataset_structured`/
  `manual_human_confirmed`), `capturedAt`/`expiresAt` (TTL por tipo de
  fonte: 30/14/90 dias), `contentHash`, elegibilidade por ativo.
- Capturado AO VIVO (não fixture): `capture-scope-snapshots.mjs` busca o
  dataset comunitário (`arkadiyt/bounty-targets-data`) pros 4 programas +
  a página oficial real do Immunefi/StackingDAO (única das 4 fetchável
  sem sessão autenticada — confirmado ao vivo via WebFetch/WebSearch que
  HackerOne/Bugcrowd exigem login pra prosa de política completa).
  Confiança: `high` (StackingDAO, página oficial), `medium` (Circle BBP,
  Vercel — HackerOne expõe elegibilidade por ativo estruturada mesmo sem
  prosa), `low` (Block Open Source — Bugcrowd não expõe elegibilidade por
  ativo no dataset).
- `scopeGate()` nunca trata elegibilidade desconhecida (`null`) como
  elegível — só como "precisa confirmar". Bug real pego e corrigido
  durante a implementação (teste cobre o caso).
- 11 testes (`test/scope-registry.test.mjs`).

### Máquina de estados (`system/bugbounty-scanner/state-machine.mjs`)
- 14 estados do prompt mestre, com precondição programática por
  transição (não decisão de LLM) — ver seção 6.3 da auditoria externa.
  `scope_verified` exige `deploymentEvidence.confidence` diferente de
  `"unverified"` (documentar o gap não é o mesmo que fechá-lo).
- 13 testes (`test/state-machine.test.mjs`).

### Persistência (`system/bugbounty-scanner/db.mjs`)
- SQLite via `node:sqlite` (nativo do Node 24, WAL mode) — **zero
  dependência nova de npm**, mesma filosofia do `web-tree-sitter`
  (binário pronto, sem compilar nada). Toda transição de estado grava um
  evento real no ledger hash-chain existente (`ledger.research.jsonl`) —
  não duplica o mecanismo de auditoria, só referencia o hash.
- `zerotoone.db` **NUNCA é commitado** (`.gitignore`) — decisão tomada
  durante a implementação ao perceber que um `.db` binário não mescla
  como o `queue.jsonl` texto mescla (o merge conflict do ledger, resolvido
  mais cedo nesta sessão, seria bem pior com um arquivo binário). Cada
  ambiente (Windows local, agente de nuvem) reconstrói seu próprio banco
  local via `migrate-to-v2.mjs` (idempotente) a partir do `queue.jsonl`
  versionado, que continua sendo a única fonte de verdade compartilhada.
- `exportFindingsToQueueJsonl()` regenera `queue.jsonl` a partir do
  banco (schema v1 compatível — `status`/`verdict` — mais o campo novo
  `state`), pra painéis existentes continuarem funcionando durante a
  transição.
- 9 testes (`test/db.test.mjs`).

### Migração real dos 35 achados (`system/bugbounty-scanner/migrate-to-v2.mjs`)
- Rodada de verdade contra `queue.jsonl`: **31 → `false_positive`, 1 →
  `inconclusive`, 3 → `corroborated_static`** (nenhum dos 3 antigos
  "confirmado" chegou a `scope_verified` — exatamente a conclusão da
  Fase 0, agora reforçada estruturalmente por código, não só por
  argumento). Cada transição passou pela máquina de estados de verdade
  (nada foi setado direto) e gerou entrada real no ledger — 71 → 106
  entradas, `verifyChain('research').valid === true`.
- Log completo em `docs/zerotoone-v2/migration-log.json` (cada tentativa
  de transição, inclusive as que falharam e por quê — nada escondido).
- 5 testes (`test/migrate-to-v2.test.mjs`).

### Bridge para o agente de nuvem (`system/bugbounty-scanner/cli.mjs`)
- O agente de nuvem só tem Bash/Read/Write/Edit/Glob/Grep (sem MCP pro
  banco) — este CLI empacota `list-pending`, `update-finding`,
  `transition`, `record-validation`, `record-deployment-evidence`,
  `record-report`, `check-scope`, `export-queue`, `status`. Toda
  transição passa pela MESMA validação de `state-machine.mjs` — o CLI
  não contorna precondição nenhuma.
- 8 testes (`test/cli.test.mjs`, inclui subprocess real).

### Endurecimento do agente de nuvem (prompt da routine, `RemoteTrigger update`)
Prompt reescrito por completo (não só remendado) — mudanças reais:
- **Regra crítica nova, no topo**: conteúdo lido de repositório-alvo é
  DADO, nunca instrução — defesa explícita contra prompt injection via
  comentário/README de repositório malicioso (risco documentado em
  `threat-model.md`, Ativo 1).
- Workflow inteiro trocado de "reescreva a linha em queue.jsonl" pra
  comandos do CLI acima — a máquina de estados agora é enforced de
  verdade, não é só convenção documentada.
- Passo 0 novo: reconstrói o banco local (`migrate-to-v2.mjs`) a cada
  rodada; passo 7 novo: `export-queue` antes do commit.
- Barra pra escrever rascunho de relatório subiu de "confirmado" pra
  `scope_verified` de verdade (escopo + deployment evidence) — mudança
  de comportamento real, não só de nome.
- Risco do `curl \| bash` do Foundry **não foi eliminado** (limitação
  documentada: não há controle desta sessão sobre a imagem-base do
  ambiente de nuvem pra pré-instalar o toolchain) — mitigado
  parcialmente (instrução explícita de tratar como risco residual
  conhecido e registrar quando acontece), não resolvido por completo.
  Ver `threat-model.md`, prioridade "Alta".

### O que ficou de fora desta rodada (decisão explícita, não esquecimento)
- **Lock de execução real** entre scanner local e agente de nuvem
  (threat-model.md, prioridade 3) — o dual-write no SQLite reduz o
  problema (cada ambiente tem seu próprio banco local, não briga por um
  arquivo compartilhado), mas a corrida de `git push` entre os dois
  automatismos ainda existe em teoria pro `queue.jsonl`/ledger texto.
  Fica pra uma rodada futura se voltar a acontecer na prática.
- **`allowlist` de rede** pro ambiente de nuvem — fora do alcance desta
  sessão (não há controle de infraestrutura de rede do ambiente
  `env_01VYZ6WXQh5GbDgP7mfyw3H7` a partir daqui).
- **DeploymentEvidence com confiança real** (endereço/bytecode/release
  confirmado) pra qualquer achado — o mecanismo existe e é testado, mas
  nenhum achado real tem essa evidência ainda; é trabalho de investigação
  caso a caso, não uma lacuna de engenharia.
- `TEMPLATE.md` não foi reescrito para citar `scope_verified`
  explicitamente — o prompt da routine já reforça a regra nova
  diretamente, mas o cabeçalho do template em si ainda fala em
  "confirmado". Ajuste cosmético pendente, não bloqueante.

### Bug real pego e corrigido depois do commit inicial: idempotência da migração
Ao commitar/dar push desta fase, um `git pull` trouxe 2 achados novos que
o agente de nuvem tinha gerado com o prompt ANTIGO (rodada disparada
antes da atualização do prompt chegar). Rodar `migrate-to-v2.mjs` de novo
pra pegar esses 2 novos expôs que a checagem de idempotência original
(baseada só no estado já salvo no banco) não cobria o caso real que
importa: o agente de nuvem reconstrói um banco VAZIO a cada rodada
(ambiente efêmero, `.db` nunca commitado) — rodar a migração contra um
banco vazio faz TODO finding parecer novo, mesmo que `queue.jsonl` já
tenha sido exportado com o estado v2 real antes. Isso reproduziu de
verdade num teste: a primeira correção (checar só o banco) evitava
duplicar num MESMO ambiente persistente, mas não evitava duplicar entre
ambientes efêmeros diferentes — exatamente o caso do agente de nuvem.

Corrigido com duas checagens independentes em `migrateEntry`: (1) se a
própria linha da fila já vem com `state` (gravado por uma exportação v2
anterior) — sinal que sobrevive entre ambientes efêmeros — confia nela
sem replay; (2) se o banco local já tem o id além de `candidate` — protege
reexecução manual no mesmo ambiente antes do primeiro `export-queue`.
Validado de ponta a ponta simulando o cenário real do agente de nuvem:
`export-queue` real em cima do `queue.jsonl` de produção, banco local
apagado (ambiente "novo"), `migrate-to-v2.mjs` rodado de novo — ledger
ficou EXATAMENTE nas mesmas 143 entradas, confirmando idempotência real,
não só em teste unitário. 2 testes de regressão novos cobrem os dois
cenários (mesmo ambiente sem export; ambiente novo com export).

### Verificação
- `npm test`: **221/221 passando** (era 175 antes desta rodada; 46 testes
  novos: scope-registry 11, state-machine 13, db 9, migrate-to-v2 7, cli
  6 — mais os que já existiam).
- `verifyChain('research')`: válido, **143 entradas** (106 da migração
  inicial dos 35 achados + 37 de uma migração completa e limpa depois de
  reverter uma duplicação real causada pelo bug acima, corrigido antes de
  qualquer coisa ser commitada/enviada).
- Migração real rodada contra os 37 achados de produção (35 originais +
  2 que chegaram via merge de uma rodada do agente de nuvem com o prompt
  antigo, disparada antes da atualização chegar).
- Scan-runner.mjs: dual-write testado com smoke test direto contra o
  banco real de produção (linha de teste inserida e removida).
- `cli.mjs export-queue` **aplicado de verdade** em cima do `queue.jsonl`
  real (37 linhas, todas agora com o campo `state` novo além de
  `status`/`verdict` legado) — `status-dashboard.mjs`/`generate-dashboard.mjs`
  regenerados em cima do resultado sem quebrar, confirmando que os
  consumidores existentes continuam funcionando durante a transição.

## Fase 3 — primeira vertical completa (revalidação dos 2 casos obrigatórios)

**Status: concluída em 2026-08-30** para os 2 casos que o prompt mestre
nomeia explicitamente como obrigatórios de revalidação.

### Extensão da máquina de estados: `known_duplicate`
Faltava um estado pra "o código faz exatamente o que foi lido, mas já é
publicamente conhecido/aceito — não é novo". `false_positive` não servia
(o comportamento é real, não um erro de detecção). Novo estado terminal,
com precondição própria: exige `knownIssueSource` citando título + tipo
de fonte (`public_audit`/`advisory`/`issue`/`changelog`) + url ou quote —
nunca "parece conhecido" sem citação rastreável. Mapeia pro verdict
legado `falso_positivo` nos exports v1 (mesmo sinal prático: não é lead
a perseguir). 4 testes novos.

### Caso 1 — Circle BBP, `Withdrawals.sol` (denylist bypass no saque)
Resultado: **`known_duplicate`**, não `scope_verified`. Encontrado e lido
por completo (24 páginas, extração real via `pypdf`) o relatório PÚBLICO
de auditoria da ChainSecurity pra Circle Gateway (08/07/2025) —
`Withdrawals.sol` estava explicitamente no escopo revisado (commit
`5b5446f5...`), e a seção 8.1 ("Notes", definida no próprio relatório
como achados que não exigem correção) documenta textualmente: "denylisted
users can still withdraw their tokens from the wallet contract" — o
EXATO comportamento identificado de forma independente por este sistema,
só que já conhecido pela Circle e pela ChainSecurity mais de um ano
antes. Circle Gateway está em produção real desde agosto de 2025 (7
chains). Relatório-rascunho atualizado com aviso "NÃO ENVIAR" e a citação
completa. Cadeia de código da leitura original permanece correta — só a
conclusão sobre novidade mudou.

### Caso 2 — Block Open Source, `wire-schema` (path traversal em import de `.proto`)
Resultado: **`human_ready`** — primeiro achado do sistema inteiro a
chegar honestamente a esse estado sob a máquina v2. Checagem de
duplicata: nenhum advisory/issue do `square/wire` cobre este caminho
específico (PR #3657 relacionado só toca o lado de escrita do arquivo
gerado). Prova de conceito executável de verdade: programa Java usando o
JAR real de `okio-jvm` 3.12.0 (baixado do Maven Central — bytecode de
produção real, não reimplementação), sem precisar compilar o wire-schema
inteiro (evitaria um build Gradle multiplataforma) — confirma que
`Path.resolve(String)` (mecanismo exato de `DirectoryRoot.resolve`)
permite tanto import relativo com `..` quanto import absoluto escaparem
da raiz protegida, com leitura real de conteúdo de arquivo fora dela.
Grau de evidência subiu de E2 (cadeia de código) pra E3 (reprodução
determinística local). Bug pego rodando a própria PoC: um `startsWith()`
ingênuo pra checar "escapou" dava falso-negativo pro caso relativo,
porque a string ainda contém `..` de forma literal (Okio não normaliza
por padrão) — o sinal real é a resolução do sistema operacional em
`fileSystem.exists()`/leitura, não a aparência da string. Corrigido antes
de registrar o resultado. Escopo confirmado (`square/wire` em escopo
real do Bugcrowd), elegibilidade de recompensa por ativo não exposta
pelo dataset (confidence "low" — precisa confirmação manual antes de
enviar, sinalizado no próprio relatório).

### Verificação
- `npm test`: **225/225 passando**.
- `verifyChain('research')`: válido, **147 entradas** (143 do fim da
  Fase 1 corrigida + 4 desta rodada: reproduced_local, scope_verified e
  human_ready do caso Block, known_duplicate do caso Circle).
- Estado real da fila hoje: 33 `false_positive`, 1 `inconclusive`, 1
  `known_duplicate`, 1 `corroborated_static` (StackingDAO, não tocado
  nesta rodada), **1 `human_ready`** (pronto pra revisão humana de
  verdade, não um rascunho especulativo).
- PoC compilada e rodada de verdade (`javac`/`java` reais, JDK 21 local,
  dependência real do Maven Central) — não simulada nem descrita como se
  tivesse rodado.

### O que ficou de fora desta rodada
- **StackingDAO `set-token-uri`** (o 3º item em `corroborated_static`) —
  não revalidado ainda; candidato natural pro próximo lote. Impacto
  baixo (só metadado), então prioridade menor que os 2 casos já feitos.
- Checagem de duplicata pros outros 33 `false_positive`/1 `inconclusive`
  não foi refeita — eram refutados por motivo técnico (não-exploração),
  não por questão de novidade, então o gate de duplicata não muda o
  resultado deles.

### Reconciliação pós-merge: corrida real entre sessão interativa e agente de nuvem
Ao dar push da Fase 3, um `git pull` trouxe a primeira rodada real do
agente de nuvem sob o prompt endurecido — que, de forma independente e
concorrente, também investigou os mesmos 2 achados. Conflito real, não
só textual: o agente de nuvem levou `Circle BBP::Withdrawals.sol` até
`reproduced_local` (PoC Foundry real, rodada contra o fallback local do
harness do próprio repo — RPC público e `curl \| bash` do Foundry
bloqueados pela política de rede da sessão de nuvem, contornado via
binário oficial do GitHub) a partir do MESMO `corroborated_static` que eu
já tinha avançado pra `known_duplicate` minutos antes. Reconciliado
preservando as duas coisas: estado final fica `known_duplicate` (a
divulgação pública externa é mais decisiva que reprodução local pra
decidir reportabilidade), mas a PoC real do agente de nuvem foi
importada como `validation` no banco — evidência real, não descartada só
porque a decisão final mudou. O achado de StackingDAO (`set-token-uri`)
e um achado novo (`DockerCredentials.kt`, Block Open Source) que o
agente de nuvem investigou de forma independente e sem qualquer conflito
foram aceitos como estão — trabalho real, sem meu envolvimento nem
motivo de discordância. Ledger reconciliado por replay semântico
(mesma técnica de sempre) — 150 entradas, cadeia íntegra.

### Segunda reconciliação (30/08/2026): agente de nuvem avançou muito durante a primeira
Entre o push da reconciliação anterior e o próximo `git fetch`, o agente
de nuvem tinha rodado ~20 vezes mais (webhook de push é bem mais rápido
que uma sessão interativa revisando cada linha). Achados: (1) confirmou
o endereço mainnet real do `GatewayWallet`
(`0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`, 3 fontes independentes) e
levou `Withdrawals.sol` até `human_ready` por conta própria, sem
visibilidade ainda de `known_duplicate` — reconciliado da mesma forma
que antes: evidência real preservada (relatório e NOTES.md), estado
final continua `known_duplicate`; (2) 4 achados genuinamente novos,
importados como `corroborated_static`: `SignerService.Sign` sem auth
(`arc-remote-signer`), denylist ausente no saque do Gateway Wallet
**Solana** (codebase diferente da EVM — a auditoria ChainSecurity
encontrada é EVM-only, então este pode ser genuinamente não-duplicado,
ainda não verificado), `sso.ts::waitForVerification` (Vercel),
`compute-ratio` (StackingDAO). Ledger: 164 entradas, replay semântico
com deduplicação (as duas pontas do merge compartilhavam história de um
merge anterior, causando entradas repetidas que precisaram ser
filtradas antes do replay).

### Checagem dos 4 achados novos (30/08/2026) — resultado final
- **Solana Gateway Wallet** (denylist ausente no saque): `corroborated_static`.
  Verificado independentemente linha a linha; nenhum dos 2 audits
  públicos do Circle Gateway cobre Solana; Gateway ainda não está em
  mainnet lá. PoC não tentada — impossibilidade estrutural do próprio
  framework Anchor (`#[derive(Accounts)]`), não limitação de tempo.
- **arc-remote-signer** (`SignerService.Sign` sem auth): `corroborated_static`.
  Verificado independentemente (interceptors do servidor, TLS
  unidirecional). PoC avaliada e adiada por desproporção de esforço
  (AWS KMS + Datadog + enclave attestation na inicialização) — candidato
  real pra uma rodada de verticalização dedicada.
- **Vercel SSO** (`cli-auth/sso.ts`): `corroborated_static`. Alcançabilidade
  real fora do monorepo público segue genuinamente incerta — confirmado
  de forma independente 2x (minha verificação + uma rodada separada do
  agente de nuvem, sem saber uma da outra, mesma conclusão).
- **StackingDAO `compute-ratio`**: **fechado como `false_positivo`** com
  evidência on-chain direta (`api.hiro.so`, acessível nesta sessão) —
  `data-stbtc-v1`/`stbtc-token` têm exatamente 1 transação cada desde o
  deploy (a própria transação de deploy), zero uso real do mecanismo.

**Bug real encontrado e não corrigido ainda**: `check-scope` pra
StackingDAO sempre retorna `allowed=false` pra qualquer ativo, porque
`research/bugbounty/scope-snapshots/stackingdao.json` tem `assets:[]`
por desenho da Fase 1 (só política/categoria, contratos ficaram só em
`targets.mjs`). Isso bloqueia `scope_verified` pra QUALQUER achado
StackingDAO, não só os desta rodada. Pendência real de engenharia — o
próprio agente de nuvem achou isso tentando usar o CLI de verdade.

Estado final da fila: 37 `false_positive`, 3 `corroborated_static`
(candidatos reais pra uma vertical dedicada — Solana e arc-remote-signer
são os mais promissores), 1 `inconclusive`, 1 `known_duplicate`, 1
`human_ready`. Ledger: 167 entradas, íntegro. 4 rodadas de merge
reconciliadas nesta sessão (o agente de nuvem trabalhou em paralelo o
tempo todo via webhook de push) — todas por replay semântico do ledger +
reconstrução de `queue.jsonl` a partir do banco, nunca merge textual de
JSON.

### Segundo achado chega a `human_ready` (30/08/2026): PoC Go real pro `arc-remote-signer`
Corrigido o bug do scope-registry do StackingDAO (assets:[] recusava
tudo — populado a partir de targets.mjs, 2 testes novos). Depois, PoC
real pro achado `SignerService.Sign` sem auth: em vez do binário
completo (AWS KMS/Secrets Manager/Datadog/enclave — avaliado antes como
desproporcional), um teste Go local chama a função de produção real
`public.New()` com um `SignerServiceServer` mínimo, evitando as
dependências que não fazem parte do achado. Toolchain Go 1.27 + buf +
protoc-gen-go/-grpc, tudo via `go install`, sem Docker. Resultado real:
`go test` PASS, servidor real aceitou `Sign()` sem nenhuma credencial.
`corroborated_static → reproduced_local → scope_verified → human_ready`.
Fila: 2 `corroborated_static` (Solana, Vercel SSO), 37 `false_positive`,
1 `inconclusive`, 1 `known_duplicate`, **2 `human_ready`**. Ledger: 170
entradas.

## Fases 2, 4 e 5

**Nota (31/08/2026): esta seção ficou desatualizada por 2 dias de
trabalho real não registrado aqui** — arc-remote-signer foi submetido e
fechado como duplicata, o achado do Solana avançou até `reproduced_local`
com PoC real, Block Open Source foi pausado (regras do programa proíbem
pesquisa assistida por IA), ColdStorageAddressBookModule percorreu o
ciclo inteiro até ser identificado como duplicata pública, e a Hacker
API do HackerOne + Telegram foram integrados ao pipeline. Ver
`research/bugbounty/circle-bbp/NOTES.md`, `block-open-source/NOTES.md`
e `system/bugbounty-scanner/README.md` pro registro completo — reescrita
completa desta seção fica pra uma rodada dedicada só a isso, não junto
de uma mudança de código.

Fase 2 (adapters SARIF, Slither/OSV-Scanner/CodeQL, benchmark de
detector) e Fase 4 (validadores web/API/mobile) seguem majoritariamente
não iniciadas — são esforços grandes, ficam mais valiosos depois de mais
verticais completas confirmarem o padrão. **Exceção parcial, feita
31/08/2026**: o item específico de quarentena do `ssrf_risk` citado
aqui (seção 6.11 da auditoria) foi implementado de verdade —
`quarantine.mjs`, mecanismo genérico (não hardcoded só pro ssrf_risk),
confirmado ao vivo contra `heuristic-stats.json` real (`ssrf_risk::js`:
13/13 revisões falso-positivo, 100%, agora suprimido nas 3 vias de
entrada do scanner). Ver seção própria em
`system/bugbounty-scanner/README.md`. O resto da Fase 2 (ensemble SARIF
completo) continua não iniciado — essa foi deliberadamente a fatia
pequena e barata, não uma tentativa de fechar a fase inteira de uma vez.

Fase 5 (outcomes reais de plataforma, calibrador, ranking de alvo)
estava bloqueada esperando "pelo menos um envio real acontecer" — isso
já aconteceu (arc-remote-signer, #3981927, fechado duplicata). Parte da
Fase 5 já está parcialmente feita também: `h1-api.mjs` sincroniza status
real de relatório (`sync-report-status`), e `discover-targets.mjs` agora
prioriza por idade de programa (um dos fatores de ranking de alvo
citados na auditoria, não todos). O calibrador (usar resultado real de
plataforma pra ajustar confiança de heurística) continua não
implementado.

## Bloqueios externos conhecidos

- Nenhum ainda identificado que exija credencial ou acesso que o usuário
  precise fornecer — a Fase 1 é executável com o que já está disponível
  neste ambiente, mas envolve decisões de design que merecem confirmação
  antes de mudar comportamento de produção (o pipeline está rodando
  sozinho todo dia).
