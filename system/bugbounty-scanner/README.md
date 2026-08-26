# bugbounty-scanner/ — pipeline de bug bounty com custo mínimo

Dois estágios, custo bem diferente, ligados por um repositório GitHub
compartilhado (`https://github.com/Genezera/ZeroToOne`, privado). O
Estágio 1 cobre dois programas/linguagens diferentes com o mesmo desenho.

## Estágio 1 — Scanner local (grátis, roda sozinho, sem IA)
`scan-runner.mjs` roda duas varreduras independentes:

**Clarity (StackingDAO, Immunefi):** busca código-fonte atualizado dos
contratos rastreados (`targets.mjs`) via API pública da Hiro, roda
heurísticas de texto (`heuristics.mjs` — ex.: inconsistência entre
`tx-sender`/`contract-caller` em checagens de autorização, transferências
sem checagem de auth visível), e persiste os `.clar` neste repositório
(código pequeno o bastante para valer a pena guardar como evidência).

**JavaScript/TypeScript (Vercel Open Source, HackerOne):** busca lista de
arquivos + conteúdo bruto de repositórios rastreados (`targets-js.mjs`) via
API pública do GitHub (sem conta/token), roda heurísticas de texto
(`heuristics-js.mjs` — `eval`/`new Function`, `exec`/`execSync` com
comando montado por interpolação, regex com quantificador aninhado/ReDoS).
Repos JS/TS são grandes demais para persistir no git — só o texto do
achado (com trecho de contexto) vai para a fila; um cache de SHA de blob
por arquivo (`scanner-seen-js-shas.json`) evita rebuscar/rescanear arquivo
que não mudou. Ver `research/bugbounty/vercel-open-source/NOTES.md` para
por que este repo foi escolhido primeiro.

Ambas as varreduras só gravam na fila compartilhada
(`research/bugbounty/queue.jsonl`) o que for **genuinamente novo**
(controle de duplicidade via `scanner-seen.json`). Se achar algo novo,
faz commit + push automaticamente.

Testado contra código real: no lado Clarity, acha exatamente o achado real
confirmado (`set-token-uri`) e não gera ruído nos contratos já confirmados
seguros; no lado JS/TS, roda contra o código real de `vercel/flags` sem
quebrar e sem falso-positivo óbvio (divisão matemática não é confundida
com regex, por exemplo) — ver `system/bugbounty-scanner/test/`.

Automação: tarefa do Windows Task Scheduler `ZeroToOne_BugBountyScanner`,
diária às 7h15 — mesma tarefa cobre os dois estágios/linguagens, não há
tarefa separada por linguagem.

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
