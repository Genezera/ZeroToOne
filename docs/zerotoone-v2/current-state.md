# ZeroToOne — estado real do repositório (Fase 0, auditoria v2)

Gerado manualmente em 2026-08-29, reconstruindo cada número a partir dos
arquivos reais do repositório — não a partir do PDF anterior. Onde o PDF
divergir do repositório, o repositório é a verdade e a divergência é
anotada.

## Comandos executados (baseline reproduzível)

```
$ git status --short
(vazio — working tree limpo no início desta auditoria)

$ npm test
ℹ tests 175
ℹ pass 175
ℹ fail 0
ℹ duration_ms 5657.09
```

Não existiam `AGENTS.md` nem `CLAUDE.md` na raiz antes desta auditoria.

## Inventário real de módulos

### `system/bugbounty-scanner/` — 22 módulos de produção + 15 arquivos de teste
```
cve-digest.mjs        dep-scanner.mjs        digest-runner.mjs
discover-targets.mjs  discovery-runner.mjs   fetch-repo.mjs
fetch.mjs             generate-dashboard.mjs heuristics-go.mjs
heuristics-js-ast.mjs heuristics-js.mjs      heuristics-jvm.mjs
heuristics-shared.mjs heuristics-solidity.mjs heuristics-swift.mjs
heuristics.mjs        scan-runner.mjs        status-dashboard.mjs
targets-go.mjs        targets-js.mjs         targets-jvm.mjs
targets-solidity.mjs  targets-swift.mjs      targets.mjs
verdict-stats.mjs
```
124 testes, todos passando.

### Módulos arquivados da fase anterior (intactos, não tocados nesta auditoria)
`system/daily-floor/`, `system/market-maker/`, `system/risk-gate/`,
`system/product-pipeline/`, `system/ledger/` (o ledger é compartilhado
pelas duas fases), `checkpoint/`, `experiments/`. 51 dos 175 testes totais
pertencem a esses módulos.

### `system/ledger/ledger.mjs` — mecanismo real (lido linha a linha)
`appendEntry(env, entry)` grava `{...entry, ts, env, prevHash: lastHash(env)}`
e computa `hash = sha256(JSON.stringify(record))`. `verifyChain(env)`
recalcula e compara. **É tamper-evident (qualquer edição de entrada antiga
quebra a verificação), não tamper-proof** — quem reescrever o arquivo
inteiro pode recalcular toda a cadeia do zero; não há checkpoint assinado
nem âncora fora do próprio arquivo. Confirma exatamente o ponto 5.6 da
auditoria externa.

## A fila (`research/bugbounty/queue.jsonl`) — 35 itens, reconstruído agora

| Veredito | Contagem | % |
|---|---|---|
| `confirmado` | 3 | 8,57% |
| `falso_positivo` | 31 | 88,57% |
| `inconclusivo` | 1 | 2,86% |
| `pending` | 0 | 0% |

Por tipo de heurística (contagem real, recalculada):

| Tipo | Total | Observação |
|---|---|---|
| `ssrf_risk` | 13 | **13/13 revisados = falso_positivo (100%)** |
| `known_vulnerable_dependency` | 6 | 0 confirmado |
| `ai_deep_read_finding` | 5 | 2 confirmado, 2 falso_positivo, 1 inconclusivo |
| `reentrancy_risk` | 3 | 0 confirmado |
| `unguarded_transfer` | 2 | 0 confirmado |
| `prototype_pollution_risk` | 2 | 0 confirmado |
| `unchecked_call_return` | 2 | 0 confirmado |
| `delegatecall_risk` | 1 | 0 confirmado |
| `auth_arg_inconsistency` | 1 | 1 confirmado |

Esses números batem exatamente com os do documento de auditoria externa —
confirmados de forma independente, direto do arquivo, não copiados do PDF.

### Os 3 itens marcados `confirmado` — o que cada um realmente tem

**1. `StackingDAO::ststx-token.clar::set-token-uri::auth_arg_inconsistency`**
(confidence: alta) — inconsistência real `tx-sender` vs `contract-caller`
confirmada por leitura de ~25 funções administrativas do contrato. Só
altera metadado (URI), não move fundo. Sem PoC executável (Clarity não
tem esse mecanismo no sistema hoje). Sem scope snapshot oficial — a
elegibilidade vem do `NOTES.md`, escrito a partir de leitura manual da
página do Immunefi, não de um snapshot versionado com hash/data.

**2. `Circle BBP::.../Withdrawals.sol::initiateWithdrawal_withdraw::ai_deep_read_finding`**
(confidence: média) — cadeia de chamada real, comparando 4 arquivos do
mesmo contrato (`Deposits.sol`, `Delegation.sol`, `Mints.sol`,
`Withdrawals.sol`), confirmando que `Withdrawals.sol` é a única função de
saque sem `notDenylisted`. **Verificado agora, lendo o rascunho de
relatório completo
([reports/circle-bbp-withdrawals-denylist.md](../../research/bugbounty/reports/circle-bbp-withdrawals-denylist.md)):
a seção "Prova de conceito executável" do `TEMPLATE.md` não existe nesse
relatório — não foi preenchida nem omitida com justificativa, simplesmente
não está lá.** Isso acontece porque a regra 3 do `TEMPLATE.md` e o passo
3d do prompt do agente de nuvem só exigem PoC Foundry para os 4 tipos de
heurística Solidity nativos (`reentrancy_risk`, `unchecked_call_return`,
`tx_origin_auth_risk`, `delegatecall_risk`) — este achado é
`ai_deep_read_finding` (leitura profunda proativa), tecnicamente fora
dessa regra, mas é Solidity, é sobre um contrato de produção financeira, e
é exatamente o tipo de achado (bypass de controle de acesso movendo fundo
real) que mais se beneficiaria de uma PoC. **Gap real, confirmado por
leitura direta do arquivo, não suposição da auditoria externa.** Também
não há: endereço de deploy, chain ID, block number, resolução de
proxy/implementation, nem confirmação de que o commit lido (`master`)
corresponde à versão realmente implantada.

**3. `Block Open Source::.../Root.kt::DirectoryRoot.resolve::path_traversal_risk`**
(confidence: média) — cadeia de 3 repositórios (`wire-schema`,
`ProtoParser.kt`, `okio`) rastreada e citada linha a linha. O próprio
relatório reconhece, na seção de reasoning, que não há confirmação de que
algum produto real da Block consome `.proto` de terceiro não confiável
via `protoPath` — é uma inferência plausível, não uma cadeia de
alcançabilidade fim-a-fim provada. Sem PoC (não é Solidity, o sistema não
tem hoje nenhum mecanismo de PoC fora de Foundry/Solidity).

**Conclusão de Fase 0 sobre os 3 "confirmados":** nenhum dos três atende,
hoje, aos critérios que a auditoria externa propõe para o estado
`scope_verified` (scope snapshot oficial + vínculo release/deploy). O
StackingDAO é o mais sólido tecnicamente (só metadado, então o dano é
baixo mas a cadeia é 100% local e verificável sem depender de
implantação). Os outros dois dependem de premissas não verificadas sobre
o que está realmente implantado em produção.

## O agente de nuvem — configuração real (via `RemoteTrigger get`)

Routine `trig_01QQeYvKRi9qJD4QkzkbqsSe` ("ZeroToOne Bug Bounty Analyst"),
modelo `claude-sonnet-5`, gatilhos: webhook de push + cron diário
`15 11 * * *` UTC.

`allowed_tools`: `["Bash", "Read", "Write", "Edit", "Glob", "Grep"]` — Bash
irrestrito, sem allowlist de comando, sem sandbox declarado além do
isolamento padrão do ambiente de nuvem (`env_01VYZ6WXQh5GbDgP7mfyw3H7`).

O prompt (texto integral capturado, não resumido) instrui explicitamente,
quando `forge` não está instalado:
```
curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup
```
Isso é exatamente o padrão `curl | bash` que a auditoria externa marca
como risco de supply chain (seção 6.4). Ver `threat-model.md` para
detalhamento.

## Tarefas agendadas (Windows Task Scheduler, confirmado via `Get-ScheduledTask`)

| Tarefa | Estado | Frequência |
|---|---|---|
| `ZeroToOne_BugBountyScanner` | Ready (ativa) | Diária, 9h |
| `ZeroToOne_TargetDiscovery` | Ready (ativa) | Semanal, domingo 10h |
| `ZeroToOne_DailyFloor` | Disabled | — (fase arquivada) |
| `ZeroToOne_MarketMakerShadow` | Disabled | — (fase arquivada) |

## Fonte de escopo — confirmado por grep direto

`research/bugbounty/circle-bbp/NOTES.md:20` confirma que a elegibilidade
do programa vem de `hackerone_data.json` (dataset comunitário
`arkadiyt/bounty-targets-data`), não de um snapshot da página oficial do
programa. Isso é verdade para os 4 programas rastreados — não existe hoje
nenhum objeto "scope snapshot" com hash/data de captura/data de expiração
em nenhum lugar do repositório.

## Divergências entre o PDF anterior e o repositório

Nenhuma divergência material encontrada nos números centrais (35 achados,
3/31/1, alvos por linguagem, contagem de testes). O PDF é descritivo e
"vende" a arquitetura em termos mais fortes do que ela sustenta
(`"totalmente automatizado"`, `"aprende sozinho"`, `"zero caixa-preta"`,
`"ledger à prova de adulteração"`) — ver `gap-analysis.md` para o
detalhamento de cada uma dessas afirmações contra o comportamento real do
código.
