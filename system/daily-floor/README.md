# daily-floor/ — o único resultado positivo real, automatizado de verdade

> **ARQUIVADO (2026-08-28)**: o projeto ZeroToOne mudou de foco para 100%
> caça de bug bounty, por decisão explícita do usuário. Este módulo não
> recebe mais manutenção nem execução automática — a tarefa agendada
> `ZeroToOne_DailyFloor` já está desativada. Código mantido como
> referência histórica (funcionou, foi o único mecanismo positivo E
> verificado entre 111+ mecanismos pesquisados). Pode ser reativado no
> futuro se o usuário pedir explicitamente.

O único mecanismo, de 111+ pesquisados e 19+ backtests reais, com retorno
líquido positivo E verificado: parquear o capital na melhor conta
remunerada disponível (garantia FGC, sem CNPJ, sem trabalho humano
recorrente). Modesto (~US$0,08-0,10/dia sobre US$200), mas real e composto
diariamente — nunca fica no vermelho por definição do próprio produto.

**Regra de liquidez total (2026-08-26, RISK_LIMITS.md)**: o usuário precisa
poder ter o capital inteiro disponível a qualquer momento. As três contas em
`accounts.mjs` (Nubank, Mercado Pago, PicPay) são contas remuneradas com
liquidez D+0/D+1 — passam nessa regra. Isso também DESQUALIFICA
retroativamente uma alternativa encontrada na pesquisa (CDB de banco médio
só supera o piso segurando 2+ anos) mesmo tendo taxa nominal melhor —
liquidez trava, então não serve, independente do retorno.

## Peças
- `tax.mjs` — tabela regressiva de IR sobre renda fixa (pura, testada).
- `accrual.mjs` — matemática de composição diária (252 dias úteis/ano,
  convenção padrão de mercado no Brasil).
- `rates.mjs` — busca a taxa CDI real de HOJE direto do Banco Central
  (reaproveita `product-pipeline/products/br-series-fetcher`, já testado).
- `accounts.mjs` — ofertas reais conhecidas (Nubank, Mercado Pago, PicPay),
  cada uma com fonte e data de verificação; marca como "stale" sozinho se a
  taxa não for reconfirmada em 30 dias (não confiar em dado velho
  silenciosamente).
- `daily-runner.mjs` — roda uma vez por dia: busca CDI real, escolhe a
  melhor conta, calcula rendimento líquido sobre o saldo atual, grava no
  ledger `paper` (proteção contra duplicidade: rodar 2x no mesmo dia não
  cria entrada dupla).

## Automação real (não depende de sessão do Claude ficar aberta)
Tarefa agendada do **Windows Task Scheduler** (`ZeroToOne_DailyFloor`),
todo dia às 9h05, executa `run-daily.cmd` → `daily-runner.mjs`, com log em
`logs/daily-floor.log`. Verificado rodando de ponta a ponta via
`Start-ScheduledTask` (LastTaskResult=0, sucesso). Isso sobrevive a
reinícios de sessão/processo do Claude — é automação de sistema operacional
de verdade, não um cron que dura só enquanto uma conversa está aberta.

Para checar: `Get-ScheduledTaskInfo -TaskName "ZeroToOne_DailyFloor"`
Para remover: `Unregister-ScheduledTask -TaskName "ZeroToOne_DailyFloor"`

## O que ISSO NÃO faz (limite real, não escolha minha)
Não move dinheiro de verdade. Rastreia, com dados 100% reais, quanto
US$200 RENDERIA se estivesse na melhor conta — mas a alocação real exige
que o usuário efetivamente deposite/ative o rendimento na conta escolhida
(ação dele, não posso mexer em conta/senha de ninguém). Uma vez confirmado
que o capital real está lá, este sistema já está pronto para ser apontado
para o saldo real (troca de `STARTING_PRINCIPAL_USD` e confirmação manual).

## Testes
`node --test "system/daily-floor/test/*.test.mjs"` — 18 testes, incluindo
2 de integração contra a API real do BCB (proteção de duplicidade
verificada com chamada real duas vezes seguidas).
