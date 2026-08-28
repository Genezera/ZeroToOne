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
quantificador aninhado/ReDoS. Ver
`research/bugbounty/vercel-open-source/NOTES.md`.

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

Testado contra código real: no lado Clarity, acha exatamente o achado real
confirmado (`set-token-uri`) e não gera ruído nos contratos já confirmados
seguros; nas outras 4 linguagens, roda contra o código real de
`vercel/flags`, `cashapp/hermit`, `cashapp/misk`, `square/wire`,
`afterpay/sdk-android`, `cashapp/cash-app-pay-android-sdk`,
`afterpay/sdk-ios` e `cashapp/cash-app-pay-ios-sdk` (1.049 arquivos,
0 erros) sem quebrar e sem falso-positivo óbvio — ver
`system/bugbounty-scanner/test/` (37 testes).

Automação: tarefa do Windows Task Scheduler `ZeroToOne_BugBountyScanner`,
diária às 7h15 — mesma tarefa cobre todos os estágios/linguagens, não há
tarefa separada por linguagem ou plataforma.

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
