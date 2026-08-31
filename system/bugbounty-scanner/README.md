# bugbounty-scanner/ — pipeline de bug bounty com custo mínimo

Dois estágios, custo bem diferente, ligados por um repositório GitHub
compartilhado (`https://github.com/Genezera/ZeroToOne`, privado). O
Estágio 1 cobre três programas e cinco linguagens com o mesmo desenho.

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
(`research/bugbounty/queue.jsonl`) o que for **genuinamente novo**
(controle de duplicidade via `scanner-seen.json`). Se achar algo novo,
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

Automação: tarefa do Windows Task Scheduler `ZeroToOne_BugBountyScanner`,
diária às 9h — mesma tarefa cobre todos os estágios/linguagens, não há
tarefa separada por linguagem ou plataforma.

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

## O que ainda é 100% manual (regra da plataforma, não escolha)
- Criar conta no Immunefi/GitHub — só o usuário.
- Enviar o relatório de verdade para o programa — só o usuário, depois de
  revisar o rascunho.
- Receber o pagamento — só o usuário.

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

`state-machine.mjs` agora **exige** `ctx.duplicateCheck = { methods:
[...], ts, query }` com `"github_issues"` presente em `methods` antes
de permitir `scope_verified -> human_ready` — sem isso a transição
falha com uma razão explicando o que falta, não silenciosamente. Grave
com `record-duplicate-check <id> --patch='{"methods":["github_issues"],"query":"...","foundExisting":false}'`
(usa a API pública do GitHub, sem autenticação, pra repositório
público — `GET /repos/{owner}/{repo}/issues?state=all`). Tabela própria
`duplicate_checks` no banco (mesmo padrão de `validations`/
`deployment_evidence`), consultável via `latestDuplicateCheck`.

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
precision@K, mutation testing) — essa parte continua não iniciada
(Fase 2 completa exige CodeQL/Semgrep/Slither/OSV-Scanner como adapters
SARIF, o que é um esforço bem maior). Esta é a fatia pequena e barata
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
| E4 | **Não usado.** Exigiria distinguir "ambiente isolado end-to-end" de `reproduced_local` simples, e o sistema hoje não guarda esse dado separado. Documentado como lacuna, não fingido. |
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
