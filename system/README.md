# system/ — infraestrutura de execução da missão ZeroToOne

Código real, testado, sem mocks. Duas peças construídas até agora:

## ledger/
Ledger append-only, encadeado por hash (`ledger.mjs`). Um arquivo
`ledger.<ambiente>.jsonl` por ambiente (`research`, `simulation`, `paper`,
`shadow`, `canary`, `production`, `audit`) — nunca misturar PnL fictício com
dinheiro real. `verifyChain()` detecta adulteração de qualquer entrada já
gravada. Os arquivos `.jsonl` reais ficam em `../ledger/` (fora deste
diretório, ver `.gitignore` — dados de ledger não são versionados como
código, mas devem ser copiados para backup periodicamente).

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
Ainda não implementado — próximo passo. Vai gerar candidatos a produtos/
ferramentas digitais para publicação em marketplaces self-serve.

## Uso
Módulos ESM (`.mjs`), sem dependências externas. Requer Node.js (testado com
v24.18). Variáveis de ambiente `ZERO2ONE_LEDGER_DIR` e
`ZERO2ONE_RISK_LIMITS_PATH` permitem apontar para diretórios/arquivos
alternativos (usado pelos testes para isolamento; não definir em produção).
