---
status: IMUTÁVEL — só o usuário (Renan) pode alterar estes limites. Nenhum agente,
modelo ou versão de código pode modificar este arquivo autonomamente.
last_confirmed: 2026-08-23
---

# Limites de risco (definidos pelo usuário no prompt de missão original)

- Capital total sob discussão: **US$ 200**
- Máximo arriscado por experimento (pré-validação real): **US$ 10**
- Perda máxima diária: **US$ 10**
- Hard stop acumulado: **US$ 20** perdidos totais → missão de dinheiro real pausa
  até revisão humana
- **Sem alavancagem**
- **Sem chaves de API com permissão de saque** (apenas trade/read, nunca withdraw)
- **Nenhum dinheiro real é movimentado sem aprovação explícita do usuário no chat**,
  ação por ação
- Sizing pós-validação: fractional Kelly conservador, limitado por estes tetos —
  o sistema nunca pode aumentar sozinho seus próprios limites máximos
- **Liquidez total, sempre** (regra confirmada em 2026-08-26): o usuário precisa
  poder decidir, a qualquer momento, parar tudo e ter o capital inteiro
  disponível. Isso elimina automaticamente, sem exceção: CDB/LCI/LCA/CRI/CRA com
  carência ou prazo de resgate; qualquer posição travada até vencimento; qualquer
  mecanismo cujo retorno só apareça se o capital ficar parado por um prazo
  mínimo (ex.: o CDB de banco médio só supera o piso de 14% segurando 2+ anos —
  **isso está desqualificado por esta regra**, mesmo sendo "positivo" em termos
  de taxa anualizada). Contas remuneradas com liquidez D+0/D+1 (Nubank, Mercado
  Pago, PicPay) atendem. Capital em exchange de cripto NÃO atende plenamente —
  sacar de exchange para conta bancária real no Brasil não é instantâneo
  (confirmação de blockchain + possível retenção de compliance) — tratar como
  fricção real a ser medida antes de qualquer dinheiro real em mecanismos desse
  tipo, não como "líquido" por padrão.

# O que isso bloqueia por padrão

- Qualquer chamada de API que envolva `buy`, `sell`, `transfer`, `withdraw`,
  `place_order`, submissão de formulário com pagamento, ou criação de conta,
  **exige aprovação explícita no chat antes da execução**, mesmo que o usuário já
  tenha aprovado uma ação semelhante antes (aprovação não generaliza).
- Qualquer estratégia que dependa de martingale, grid que esconde risco de cauda,
  duplicar aposta após perda, ou alavancagem é eliminada na filtragem adversarial,
  não apenas "desencorajada".

# Ambientes (nunca misturar PnL fictício com dinheiro real)

1. Pesquisa/backtest
2. Simulação
3. Paper
4. Shadow (dados ao vivo, sem execução real)
5. Canary (dinheiro real mínimo, aprovado explicitamente)
6. Produção real

Cada ambiente grava em seu próprio ledger, com prefixo de arquivo indicando o
ambiente (ex.: `ledger.paper.jsonl`, `ledger.shadow.jsonl`, `ledger.canary.jsonl`).
Nunca agregar métricas de ambientes diferentes como se fossem a mesma evidência.
