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
