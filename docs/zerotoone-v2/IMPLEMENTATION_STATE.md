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

## Fases 2, 4 e 5 — reconciliação completa (2026-09-01)

**Contexto desta reescrita**: o usuário re-entregou o mesmo documento de
auditoria (`ZeroToOneRelatoriodoSistema.pdf`, 29/08/2026) numa sessão
posterior, sem saber quanto dele já tinha sido implementado nos dias
entre a entrega original e agora. Esta seção substitui a nota de "ficou
desatualizada" por um reconciliamento real, seção por seção do prompt
mestre (item 13 da auditoria), contra o estado verdadeiro do
repositório — não contra o que "deveria" ter sido feito.

### O que a auditoria pediu e JÁ ESTÁ FEITO (com evidência verificável)

- **6.1 Scope Registry canônico** — feito na Fase 1 (`scope-registry.mjs`,
  TTL por tipo de fonte, `scopeGate` nunca trata `null` como elegível).
  Estendido depois: `program-policy.mjs` (bloqueio duro por política de
  programa, injetado automaticamente em toda transição), snapshot do
  OKG criado (estava faltando, capava achado real em
  `corroborated_static` pra sempre por falta de arquivo, não por mérito
  técnico).
- **6.2 DeploymentEvidence** — schema feito na Fase 1
  (`recordDeploymentEvidence`/`latestDeploymentEvidence`: repo, commit,
  branch/tag, endereço de deploy, chainId, blockNumber, bytecodeHash,
  confidence, notes). Usado de verdade nos 2 achados que chegaram a
  `human_ready`/`submitted` (endereço mainnet real do Gateway Wallet
  confirmado por 3 fontes independentes).
- **6.3 Máquina de estados rigorosa** — feito na Fase 1, os 14 estados
  exatos do prompt mestre + `known_duplicate` (Fase 3) +
  `inconclusive->false_positive` (única saída de um estado que antes
  não tinha nenhuma, achado real construindo o validador de PoC do OKG).
- **6.5 Persistência real** — SQLite via `node:sqlite` nativo (Fase 1),
  substituindo `queue.jsonl`+Git como banco operacional. `queue.jsonl`
  continua existindo só como *export* legível, não como fonte de
  verdade.
- **6.6 Ledger auditável** — cadeia hash-encadeada já existia; nomeada
  corretamente como *tamper-evident* (não *tamper-proof*, correção
  terminológica direta da auditoria, seção "Ledger à prova de
  adulteração"); `verifyChain()` roda de verdade e foi usada pra validar
  toda reconciliação de merge concorrente desta missão. Checkpoint
  assinado/externo (o resto do pedido 6.6) **não** foi feito — ver lista
  de pendências abaixo.
- **6.11 Quarentena automática de regra ruim** — feito 31/08/2026
  (`quarantine.mjs`), mecanismo genérico, não hardcoded pro caso
  `ssrf_risk` que a auditoria cita — confirmado ao vivo: `ssrf_risk::js`
  tinha 13/13 revisões falso-positivo, agora suprimido nas 3 vias de
  entrada do scanner.
- **6.12 Grau de evidência E0-E5** — feito 31/08/2026
  (`evidence-grade.mjs`, `cli.mjs evidence-grade <id>`), deriva de dado
  já gravado, E4 documentado como não-usado (não fingido).
- **Primeira vertical completa obrigatória (seção "PRIMEIRA VERTICAL
  OBRIGATÓRIA" + os 2 casos nomeados)** — feito na Fase 3, e os 2 casos
  específicos que a auditoria manda revalidar (`Withdrawals.sol`
  denylist e `wire-schema` path traversal) foram literalmente
  revalidados: o primeiro virou `known_duplicate` (achado público da
  ChainSecurity, 1 ano antes), o segundo chegou a `human_ready` com PoC
  Java real contra o JAR de produção do Maven Central.
- **Sandbox parcial** — nunca houve container/VM isolado dedicado (não
  construído, ver pendências), mas a separação real que existe e
  importa hoje é: cada ambiente (Windows local / sessão de nuvem) tem
  seu próprio banco SQLite nunca commitado, o conteúdo do repositório-alvo
  nunca é tratado como instrução (regra explícita no prompt da rotina
  desde a Fase 1), e nenhuma ferramenta de PoC roda contra rede
  real/conta com fundo real em nenhum dos exemplos construídos.

### Trabalho real que a auditoria NÃO previu, mas que resolveu problemas reais encontrados no caminho

- **Migração pro disco E:** (espaço em C: esgotado) — puramente
  operacional, sem relação com a auditoria.
- **Autenticação GitHub opcional** (`GITHUB_TOKEN`, 60→5000 req/h) e
  **integração real com a Hacker API da HackerOne** (`h1-api.mjs`,
  endpoint correto `/hackers/reports/{id}`) — infraestrutura de apoio
  que a auditoria não menciona mas que se provou necessária na prática
  (rate limit de verdade batido, precisava acompanhar submissão real).
- **Pipeline de auto-promoção de alvo** (`promote-targets.mjs`) — a
  auditoria pede "ranking de alvo por valor esperado" (6.18) num nível
  mais sofisticado; o que foi construído é uma versão mais simples
  (pontuação por payout/frescor/estrelas/atividade, cap de 5/rodada) que
  resolveu o problema real e mais urgente primeiro: **quase nenhum
  programa fora de Circle BBP tinha QUALQUER varredura ativa**, apesar
  da descoberta já cobrir o dataset inteiro há semanas.
- **2 submissões reais enviadas e fechadas como duplicate** (Solana
  denylist, arc-remote-signer) — a auditoria pede "outcome feedback"
  (6.21) de forma genérica; na prática isso gerou algo mais específico e
  imediatamente útil: `program-submission-budget.mjs`, rastreando que
  só restam 2 envios aceitáveis pro Circle BBP, com critério mais
  seletivo daqui pra frente.
- **Convenção de PoC executável pra Go, JVM e JS/TS** (31/08/2026,
  `poc-examples/`) — a auditoria (seção L) descreve perfis de PoC por
  *tipo de alvo* (contrato/backend/web/mobile), não por linguagem. O que
  foi construído resolve o gargalo real e mais imediato: até então, só
  Solidity conseguia sair de `corroborated_static` (nenhum validador
  local existia pras outras 3 linguagens ativamente escaneadas) — agora
  as 4 linguagens com alvo ativo hoje têm um caminho real e testado.
- **Automação de rascunho de relatório** (`generate-report.mjs`) e
  **`pipeline-status`** (visão do que falta pra cada achado avançar,
  sem investigação manual) — não citados explicitamente na auditoria,
  mas resolvem a lacuna prática que ficaria entre "grau de evidência
  E0-E5 calculado" e "relatório pronto pra revisão humana".
- **Notificação cross-ambiente via Telegram + sincronização git
  resiliente** (2026-09-01, `telegram-digest.mjs`/`git-sync.mjs`) —
  achado real: a sessão de nuvem nunca conseguia notificar (sem
  credencial no sandbox) e a tarefa agendada local podia perder o
  próprio push numa corrida com a nuvem (achado direto em log de
  produção, não hipotético). Nenhum dos dois estava no escopo da
  auditoria original.

### O que a auditoria pediu e CONTINUA genuinamente pendente

- **Operação 24/7 de descoberta de alvos** — concluída em 05/09/2026:
  `bugbounty-target-discovery.yml` roda diariamente na nuvem em modo
  `--metadata-only`, aplica política antes de consultar o GitHub e publica
  os alvos promovidos para o scan de 6 horas e o monitor de 15 minutos.
  Slither/OSV/Semgrep/CodeQL continuam no serviço local porque executar ou
  compilar repositórios de terceiros requer a toolchain/sandbox controlada.

- **6.4 Sandbox de execução isolado** — construído para a prova de regressão:
  container efêmero, usuário sem privilégio, rede bloqueada, root filesystem
  read-only, capabilities removidas e limites de CPU/RAM/PIDs. Continua
  pendente generalizar o mesmo isolamento para builds CodeQL Go/JVM e para
  qualquer futuro validador web/API/mobile; o scanner textual não executa
  código do alvo.
- **6.6 Checkpoints assinados/ancorados externamente** pro ledger — a
  cadeia hash existe e é verificada, mas continua *tamper-evident*
  reescrevendo o arquivo inteiro, não *tamper-proof*. Não implementado.
- **6.7/6.8 Ensemble de múltiplos analisadores** — Slither (Solidity,
  31/08/2026), OSV-Scanner (JS/Go/JVM, 01/09/2026) e Semgrep já
  construídos e integrados a `discovery-runner.mjs` (cadência semanal);
  ver seções datadas abaixo pra narrativa completa de cada um. CodeQL
  JS/TS buildless também está integrado em rotação desde 04/09/2026, sem
  executar scripts do alvo. Builds CodeQL Go/JVM continuam fora até terem
  isolamento descartável equivalente. Fluxo interprocedural/call-graph real além do que
  `heuristics-js-ast.mjs` já faz (AST intraprocedural em JS/TS) continua
  não construído — os três adapters novos consomem a saída JSON própria
  de cada ferramenta, não um formato SARIF unificado.
- **6.10 Benchmark de detector com corpus rotulado** (positivo/negativo
  por regra, CVEs com commit de correção, mutação) — não construído. A
  quarentena hoje reage a taxa de falso-positivo observada na produção
  real, não a um benchmark prévio.
- **Fase 4 inteira — validadores web/API/mobile** (extração de rota,
  matriz de autorização, duas contas de teste, laboratório mobile) —
  não iniciada. Ver avaliação de proporcionalidade abaixo.
- **Calibrador real (6.9 confiança multidimensional / seção "Calibrator"
  da arquitetura-alvo)** — usar resultado real de plataforma pra ajustar
  peso de heurística/severidade prevista. Ainda não dá: só 6 outcomes
  reais existem até agora (todos `duplicate`), amostra insuficiente pra
  calibrar qualquer coisa com significado estatístico.
- **SBOM/VEX (seção H)** — `dep-scanner.mjs` cruza manifest contra
  OSV.dev, mas não produz CycloneDX nem registra estado VEX explícito
  por CVE.

### Avaliação honesta de proporcionalidade (não estava na auditoria, mas precisa estar aqui)

A auditoria foi escrita como um documento de arquitetura genérico —
correto tecnicamente, mas sem visibilidade de que este é um projeto de
UMA pessoa, capital de missão de US$200, sem financiamento pra
infraestrutura paga. Alguns itens ainda pendentes valem muito mais que
outros nesse contexto real:

- ~~Alto valor, custo baixo, ainda não feito: OSV-Scanner via CLI e
  Slither pra Solidity~~ — **feito** (Slither 31/08/2026, OSV-Scanner
  01/09/2026, Semgrep 01/09/2026 como bônus fora do escopo original;
  ver seções datadas abaixo pra narrativa completa, incluindo o bug
  real de 98% de ruído de `examples/`/`test/fixtures` encontrado
  rodando o OSV-Scanner contra alvo real). Reconfirmado funcional ao
  vivo nesta sessão (02/09/2026): `osv-scanner.exe` responde
  `version: 2.5.1` e `py -m slither --version` responde `0.11.6` neste
  mesmo ambiente Windows.
- **Alto valor, parcialmente concluído**: sandbox de execução isolado
  (6.4) — concluído para regressão E4; generalização para builds CodeQL
  Go/JVM e validadores dinâmicos continua pendente.
- **Baixo valor pra este projeto específico, alto custo**: Fase 4 inteira (web/API/mobile)
  — os 4 programas ativos hoje (Circle BBP, Vercel, OKG, StackingDAO)
  são 100% SAST-de-repositório-público; nenhum deles tem uma superfície
  web/API/mobile dentro do escopo real de bounty que justifique
  construir extração de rota + matriz de autorização + laboratório
  mobile antes de ter um alvo concreto que precise disso.
- **Não vale a pena ainda**: benchmark de detector com corpus rotulado
  (6.10) — valioso quando há histórico suficiente de outcome real pra
  validar contra; com 2 outcomes totais, seria benchmark contra ruído.

## Bloqueio de programa por política + pipeline de promoção automática (31/08/2026)

Usuário percebeu (corretamente) que só Circle BBP tinha investigação de
verdade, apesar da descoberta já cobrir o dataset HackerOne+Bugcrowd
inteiro há semanas — confirmado com número real: só 4 programas com
QUALQUER achado (Circle BBP 13, Vercel Open Source 30, Block Open
Source 11, StackingDAO 5), de milhares de programas disponíveis. A
causa raiz não era a descoberta (ampla desde sempre) — era a promoção
pra varredura ativa ser 100% manual, um programa por vez.

Duas peças, construídas juntas porque a segunda depende da primeira
pra ser segura:

1. **`program-policy.mjs`** — resolve de vez o problema (já flagrado
   antes hoje) de a pausa por arquivo do Block Open Source não bastar
   sozinha (uma rodada de leitura profunda rodou horas depois da pausa
   ser publicada). Agora `db.mjs::recordTransition` injeta
   `ctx.programPolicy` automaticamente em TODA transição, e
   `state-machine.mjs` recusa `scope_verified->human_ready` pra
   qualquer programa marcado `aiResearchBanned` em
   `research/bugbounty/program-policy.json` — vale pra qualquer
   chamador (CLI local, CLI do agente de nuvem), não só quem lembra de
   checar. `cli.mjs check-program "<nome>"` expõe a mesma checagem
   antes de investir tempo de investigação.
2. **`promote-targets.mjs`** — pontua e promove automaticamente os
   candidatos que `discover-targets.mjs` já enriquece (linguagem,
   estrelas, payout, idade de programa), sem chamada de rede nova.
   Filtra por linguagem suportada (só as 5 com heurística de verdade
   hoje), tamanho de repo (>20MB vira "revisão manual", não descarte
   nem promoção às cegas), e política de programa (item 1 acima, defesa
   em profundidade). Gera `targets-auto-promoted.mjs` (nunca editado à
   mão) que cada `targets-<linguagem>.mjs` importa e mescla com a lista
   curada à mão, sempre separadas.

Rodada real ao vivo (não simulada): 195 candidatos no dataset, 30 com
metadado buscado nesta rodada, 4 promovidos inicialmente —
`kubernetes/apimachinery`, `okx/go-wallet-sdk`, e **2 com score=0 e
`reasons: []`** (`ExodusOSS/crypto`, `ExodusOSS/hydra`). Bug real: pegar
o topo-N por ranking garante só "o menos pior do lote", não "bom o
bastante" pra gastar orçamento de scan diário nele pra sempre. Corrigido
com `MIN_SCORE_TO_PROMOTE` (score precisa ser > 0, pelo menos um sinal
positivo real) e aplicado retroativamente ao arquivo já publicado
usando o score já gravado (sem re-buscar nada) — `GO_TARGETS` ativo
hoje: só os 2 com sinal real. Ver seção própria em
`system/bugbounty-scanner/README.md` pro detalhe completo, incluindo a
lacuna ainda aberta (candidato HackerOne nunca pontua por payout hoje —
só Bugcrowd expõe isso no dataset em massa).

Isso não resolve a amplitude de linguagem (Rust/Python/Move/Cairo/C++
continuam sem heurística — 19 candidatos reais dessa rodada ficaram de
fora só por isso, ver `targets-auto-promoted-log.json`) nem substitui
`getStructuredScope` ao vivo como fonte de elegibilidade por ativo —
ambos continuam lacunas reais, documentadas, não escondidas.

## Sessão local 2026-09-02 — reconciliação e itens novos da auditoria

**Contexto**: usuário reentregou o mesmo documento de auditoria pela
3ª vez, perguntando o que falta. Reconciliando de novo contra o estado
real, não contra a última atualização deste arquivo (01/09).

### Terceiro outcome real de plataforma (dado novo pra 6.9/6.21)
Report SSRF (`image-optimizer.ts` cross-host redirect bypass,
`vercel/next.js`) submetido de verdade à HackerOne (#3988959),
com PoC local real executada (control/treatment via `next@canary`
fresco, não simulada) e 5 screenshots reais anexados. Fechado como
`duplicate` de #3943945 pelo triager humano ~4h depois, que confirmou
a análise técnica batendo (mesma call chain, mesma técnica, mesma
correção sugerida) — não foi recusado por estar errado, só não foi o
primeiro a reportar.

**Gap real confirmado ao vivo nesta sessão**: esse outcome NÃO está
gravado em `zerotoone.db` — `cli.mjs status` mostra `duplicate: 2`
(Solana denylist + arc-remote-signer, os 2 já conhecidos), não 3.
Investigação direta (`countKnownDuplicatesByRepo`, ver seção do
scanner abaixo) confirmou que o finding do SSRF nunca foi de fato
persistido via `upsertFinding` — só existe como texto em
`research/bugbounty/vercel-open-source/NOTES.md`. Rodadas anteriores
desta mesma NOTES.md já citavam esse achado como `corroborated_static`,
o que significa que o `upsertFinding` correspondente nunca aconteceu
de verdade em NENHUMA rodada, cloud ou local. Não reconstruído aqui
com campos históricos inventados (seria fabricar dado); documentado
como pendência real de investigação — provavelmente um achado descrito
em prosa (NOTES.md/relatório) sem nunca passar pelo CLI de verdade em
nenhuma etapa do processo.

### Novos itens da auditoria endereçados nesta sessão (não estavam na Fase 1/3)
- **6.17 "Monitoramento de mudanças de alto valor"** — parcialmente
  feito. `listRecentlyChangedFiles` (`fetch-repo.mjs`) prioriza arquivo
  tocado nos últimos 90 dias dentro de repositório já rastreado, 2
  chamadas de API (custo constante), verificado ao vivo contra
  `vercel/flags` (ativo, bateu no teto de 300 da API de compare do
  GitHub) e `circlefin/stablecoin-xlm` (parado, `Set` vazio
  corretamente). Não cobre "novas rotas/funções públicas" nem "troca de
  dependência" especificamente — só "arquivo tocado recentemente" de
  forma genérica.
- **6.18 "Ranking de alvo por valor esperado"** — reforçado além do que
  `promote-targets.mjs` já fazia (Fase 1). `list-deep-read-candidates.mjs`
  ganhou duas camadas novas: estrelas do GitHub (repo
  >=10 mil vai pro fim, cache com TTL de 30 dias) e outcome real de
  duplicata por repo (repo que já voltou `duplicate` vai pro fim,
  pior ofensor primeiro). Motivador real: 3º achado seguido (SSRF acima)
  fechado como duplicata pública, quando o gap era estrutural — a
  priorização de leitura profunda nunca soube distinguir repo famoso de
  repo obscuro.
- **Gap novo encontrado, não estava documentado antes**: `JVM_TARGETS`
  está vazio hoje — os 4 alvos manuais são todos Block Open Source
  (pausados desde 31/08) e nenhum dos 13 alvos auto-promovidos é JVM
  (todos Go). Categoria inteira sem cobertura ativa.
- **Gap de processo novo, não estava documentado antes**: `filesRead`
  (contador usado por `selectDeepReadCandidates`) é absoluto, não
  percentual de cobertura — descoberto tentando usar a lista já
  corrigida: `vercel/ms`/`vercel/async-sema` apareceram no topo com "1
  arquivo lido" quando na verdade já estavam 100% cobertos (1 arquivo
  É o repo inteiro). Não corrigido ainda nesta sessão.

### Verificação
- `npm test`: **428/428** (era 225 na última atualização deste arquivo,
  01/09 — crescimento inclui trabalho do agente de nuvem em paralelo,
  não só desta sessão).
- `cli.mjs status` ao vivo: `candidate: 286` (crescimento grande vem de
  `known_vulnerable_dependency` do Kubernetes, programa novo desde a
  última atualização deste arquivo — não investigado ainda),
  `corroborated_static: 1`, `duplicate: 2`, `false_positive: 49`,
  `human_ready: 1`, `inconclusive: 2`, `known_duplicate: 2`.
- 2 conflitos de merge reais resolvidos nesta sessão contra rodadas
  concorrentes do agente de nuvem (mesma técnica de sempre: preservar
  os dois lados, nunca escolher um) — `circle-bbp/NOTES.md` (duas
  rodadas de leitura profunda paralelas) e nenhum em `deep-read-log.json`
  apesar de ambos os lados terem escrito nele (merge de linha automático
  funcionou, confirmado contando entradas antes/depois).

## Bloqueios externos conhecidos

- Nenhum ainda identificado que exija credencial ou acesso que o usuário
  precise fornecer — a Fase 1 é executável com o que já está disponível
  neste ambiente, mas envolve decisões de design que merecem confirmação
  antes de mudar comportamento de produção (o pipeline está rodando
  sozinho todo dia).

## Bug real encontrado (2026-09-02): `export-queue` descarta platform_outcomes/deployment_evidence/validations/reports

Achado ao tentar registrar via `record-platform-outcome` o outcome real
já conhecido (Duplicate, HackerOne #3988959) do achado
`ssrf_redirect_allowlist_bypass_risk` (`image-optimizer.ts`) — a mesma
tentativa já tinha falhado em sessões anteriores por outro motivo
("finding não encontrado", ver `research/bugbounty/vercel-open-source/NOTES.md`).
Desta vez o comando funcionou (o finding existe no banco pós-migração),
mas ao inspecionar `exportFindingsToQueueLines`
(`system/bugbounty-scanner/db.mjs:365-385`) ficou confirmado que **o
outcome gravado não aparece em `queue.jsonl` depois do `export-queue`**.

Causa raiz: `record-platform-outcome`, `record-deployment-evidence`,
`record-validation` e `record-report` gravam, respectivamente, nas
tabelas SQLite `platform_outcomes`, `deployment_evidence`,
`validations` e `reports` (todas em `db.mjs`) — mas:

1. `exportFindingsToQueueLines` só lê a tabela `findings` (`base = {
   ...f.raw }` + campos do objeto `f`); nunca faz `JOIN`/consulta
   nenhuma dessas 4 tabelas. Então nada nelas chega no `queue.jsonl`
   commitado.
2. Só `recordTransition` (mudança de `state`) anexa evento no ledger
   hash-chain (`db.mjs:229`, via `appendEntry('research', ...)`) — as
   outras 4 funções de `record-*` não tocam o ledger.

Ou seja: **o único dado que sobrevive entre um ambiente efêmero de
nuvem e o próximo, pra essas 4 categorias, é o que o comando devolve na
hora (stdout) ou o que uma sessão lembra de copiar manualmente pra
prosa em algum `NOTES.md`** — exatamente o mesmo modo de falha que a
migração v1→v2 foi feita pra resolver pro campo `state`, só que ainda
presente pras 4 tabelas satélite. `zerotoone.db` é `.gitignore`d por
design (cada ambiente tem o seu), então isso não é uma questão de
"esquecer de commitar o `.db`" — é estrutural: mesmo commitando
`queue.jsonl` certinho, os dados dessas 4 tabelas nunca chegam nele.

Mitigação aplicada nesta rodada (não resolve a causa raiz, só evita
perda de dado *desta* instância): outcome registrado também em prosa
em `research/bugbounty/vercel-open-source/NOTES.md`, que é commitado.
Não tentei consertar `exportFindingsToQueueLines`/`migrateEntry`/ledger
neste run — é mudança estrutural na máquina de estados/persistência
que merece revisão supervisionada, não uma correção de uma rodada
autônoma sem acompanhamento humano.

Correção real recomendada pra uma sessão futura supervisionada: (a)
`exportFindingsToQueueLines` deveria incluir o `platformOutcome` mais
recente (`latestPlatformOutcome`), a `deploymentEvidence` mais recente,
a lista de `validations` e o `report` de cada finding no JSON
exportado; (b) `migrateEntry` deveria restaurar essas 4 coisas no banco
quando presentes na linha da fila (hoje só restaura os campos nativos
de `findings`); (c) considerar se `record-platform-outcome` e as outras
3 também deveriam anexar um evento no ledger (mesmo padrão de
`recordTransition`), já que o ledger é descrito no resto deste
documento como a fonte mais confiável contra corrida entre ambientes
concorrentes.

### Correção aplicada (02/09/2026, sessão supervisionada, esta mesma sessão)

Os 3 itens acima, implementados e verificados ao vivo contra a produção
real, não só em teste:

- **(a) export**: `exportFindingsToQueueLines` agora lê
  `latestPlatformOutcome`/`latestDeploymentEvidence`/`listValidations`/
  `latestReport` por finding e inclui cada um (só quando existe, pra
  não poluir a maioria das linhas) na linha exportada, convertidos pro
  MESMO shape camelCase que as funções `record*` aceitam como entrada
  (`platformOutcomeToExport` etc. em `db.mjs`) — export e restore usam
  literalmente a mesma forma de dado, sem tradução duplicada.
- **(b) restore**: `migrateEntry` ganhou `restoreSatelliteData`,
  chamada nos 3 pontos onde o finding já existe no banco. Idempotente
  por comparação explícita contra o "latest" atual (não `INSERT` cego)
  — reprocessar a mesma linha não duplica satélite nem ledger;
  `validationsHistory` (lista) compara por `type+ts`, restaurando só o
  que ainda não existe.
- **(c) ledger**: as 4 funções `record*` satélite agora anexam evento
  real (`bugbounty_platform_outcome`/`bugbounty_deployment_evidence`/
  `bugbounty_validation`/`bugbounty_report`), devolvendo `ledgerHash`
  como `recordTransition` sempre devolveu.
- **Bug real #2 achado usando a correção pra valer**: `cmdRecordPlatformOutcome`
  (`cli.mjs`) tinha o comentário dizendo "mesmo padrão que
  sync-report-status já usa internamente" mas nunca de fato chamava
  `recordTransition` — só `sync-report-status` (a versão automática,
  via API real) fazia as duas coisas. Corrigido pra chamar
  `recordTransition` também quando o outcome é um dos 4 terminais
  (`duplicate`/`informative`/`rejected`/`triaged`), reportando
  honestamente em `transition.ok` quando a transição falha (nunca
  fabricando precondição pra forçar passar).
- **Uso real, não só teste**: outcome real do SSRF (`duplicate`,
  HackerOne #3988959) gravado via `cli.mjs record-platform-outcome` —
  primeira vez que esse comando roda contra a produção depois da
  correção. `transition.ok` veio `false` honestamente (`"corroborated_static"
  → "duplicate" não é permitida"`) porque este achado específico nunca
  passou pelo fluxo interno completo (foi enviado com base em revisão
  humana direta) — outcome ficou gravado do mesmo jeito, `state` não
  mudou, nada foi forçado. `export-queue` rodado depois confirmou ao
  vivo que `platformOutcome` agora aparece de verdade em
  `queue.jsonl` — a prova final de que o bug está corrigido, não só
  documentado.
- 11 testes novos (3 em `db.test.mjs`: ledger backing + export inclui/
  omite as 4 chaves; 4 em `migrate-to-v2.test.mjs`: round-trip completo
  reproduzindo o cenário exato do bug do SSRF, idempotência, outcome
  atualizado gera novo evento; 4 em `cli.test.mjs`: transição sucede
  quando `submitted`, falha honestamente quando não, outcome
  não-terminal não tenta transição, validação de `state` obrigatório).
  `npm test`: 428 → **439/439**, zero quebrado.
