# system/ — infraestrutura de execução da missão ZeroToOne

Código real, testado, sem mocks.

## ledger/
Ledger append-only, encadeado por hash (`ledger.mjs`). Um arquivo
`ledger.<ambiente>.jsonl` por ambiente (`research`, `simulation`, `paper`,
`shadow`, `canary`, `production`, `audit`) — nunca misturar PnL fictício com
dinheiro real. `verifyChain()` detecta adulteração de qualquer entrada já
gravada. Os arquivos `.jsonl` reais ficam em `../ledger/` (fora deste
diretório) e SÃO versionados no git junto com o código — trilha de
auditoria com histórico completo, não só o estado atual.

## risk-gate/
Trava de risco obrigatória (`risk-gate.mjs`) antes de qualquer ação com
dinheiro real. Lê `checkpoint/risk_limits.json` (espelho legível-por-máquina
de `checkpoint/RISK_LIMITS.md` — só o usuário edita esse arquivo).
`checkRealMoneyAction()` nunca se autoaprova: exige `approvedByUser === true`
vindo de uma confirmação explícita do usuário no chat, repassada por quem
chama a função. Bloqueia automaticamente por: falta de aprovação explícita,
valor acima do máximo por experimento, menção a alavancagem, perda diária ou
perda acumulada atingindo os limites definidos. Toda checagem (aprovada ou
bloqueada) é gravada no ledger `audit` — trilha de auditoria completa mesmo
quando nada é executado.

## Testes
`node --test "system/test/*.test.mjs"` — 9 testes, cobrindo encadeamento de
hash, detecção de adulteração, e todos os bloqueios do risk-gate (sem
aprovação, acima do limite, alavancagem, hard stop).

## product-pipeline/
Primeiro candidato construído e testado: `br-series-fetcher` (actor Apify
que busca séries do Banco Central — Selic, CDI, câmbio, IPCA — com
fatiamento automático de intervalo e retry validado). Ver
`product-pipeline/README.md` para a estratégia de portfólio e o histórico
(incluindo um candidato abortado por conflito de termos de uso, antes de
qualquer código de produção ser escrito em cima dele).

## market-maker/ (ARQUIVADO)
Shadow test de market making — ver nota de arquivamento em
`market-maker/README.md`. Projeto mudou de foco pra 100% bug bounty
(2026-08-28); código mantido como histórico, sem execução automática.

## daily-floor/ (ARQUIVADO)
Composição diária na melhor conta remunerada — ver nota de arquivamento em
`daily-floor/README.md`. Foi o único mecanismo com retorno positivo E
verificado da fase de crescimento de capital; mantido como histórico.

## bugbounty-scanner/
Foco único do projeto a partir de 2026-08-28. Scanner estático
multi-linguagem (Clarity, JS/TS, Go, Kotlin/Java, Swift/ObjC) contra 3
programas reais (StackingDAO/Immunefi, Vercel/HackerOne, Block Open
Source/Bugcrowd), mais retroalimentação de veredito, cross-referência de
dependência/CVE, descoberta automática de alvo e um agente de nuvem que
lê código de verdade e rascunha relatório pronto pra copiar/colar (nunca
envia — regra da plataforma). Ver `bugbounty-scanner/README.md` para a
arquitetura completa.

## Uso
Módulos ESM (`.mjs`), sem dependências externas (exceto `apify` dentro de
`product-pipeline/products/br-series-fetcher/`, ainda não instalado).
Requer Node.js (testado com v24.18). Variáveis de ambiente
`ZERO2ONE_LEDGER_DIR` e `ZERO2ONE_RISK_LIMITS_PATH` permitem apontar para
diretórios/arquivos alternativos (usado pelos testes para isolamento; não
definir em produção).

## Rodar todos os testes
`node --test "system/**/test/*.test.mjs"` cobre ledger, risk-gate,
market-maker (16) e daily-floor (18) — mais `br-series-fetcher/test` e o
`npm test` da raiz para risk-gate/ledger. Total: 59+ testes reais nesta
árvore, incluindo múltiplas chamadas de integração contra APIs reais
(BCB, Bybit).
