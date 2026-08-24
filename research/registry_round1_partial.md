---
name: registry_round1_partial
status: PARCIAL — 6 de 24 famílias completadas antes de bater no limite de uso
  da sessão (reset 5:20pm America/Sao_Paulo, 23/08/2026). Combinações, ranking
  e ataque adversarial NÃO rodaram. Dados brutos completos em
  research/round1_raw_partial.json.
---

# Rodada 1 (parcial) — famílias financeiras/cripto

As 6 famílias que completaram foram, nessa ordem: Arbitragem financeira legal,
Market making, Ineficiências de microestrutura, Arbitragem triangular,
Diferenças entre mercados/moedas/instrumentos, Funding/basis/yield — ou seja,
**todo o bloco financeiro/cripto**, nenhuma família não-financeira ainda.
31 mecanismos brutos, com redundância pesada esperada (a mesma ideia de
arbitragem triangular ou funding-rate aparece com nomes ligeiramente
diferentes em 3-4 famílias distintas, porque as famílias se sobrepõem).

## Padrão que emergiu (consistente com a auditoria de AurumOS/Snowball)

Os próprios agentes de pesquisa já se autopoliciaram bem: várias entradas
concluem sozinhas que o retorno líquido provável é zero ou negativo para um
operador de varejo sem infraestrutura, por exemplo:
- **Arbitragem triangular intra-exchange**: dominada por HFT institucional,
  "provavelmente próximo de zero a levemente negativo" para varejo.
- **Arbitragem DEX-DEX/flash loan (MEV)**: janela de oportunidade caiu de ~8s
  (2023) para ~340ms (2026); gas consome 40-70% do lucro; "resultado
  realista é nulo ou levemente negativo".
- **Arbitragem interexchange BR (Foxbit x Mercado Bitcoin)**: mecanismo real,
  mas já monitorado publicamente por ferramentas de terceiros (Cointrader
  Monitor) — spread tende a estar comprimido.

## O que parece mais defensável (mas ainda não validado)

1. **Funding rate arbitrage / cash-and-carry (spot + perpétuo)** — mesma
   hipótese em que AurumOS e Snowball convergiram independentemente. Fontes
   citam ~8-30% a.a. bruto, mas **achado jurídico novo e importante**: a CVM
   fechou Termo de Compromisso com a Binance em ago/2024 (R$9,6mi) proibindo
   oferta de derivativos cripto a brasileiros sem autorização — a vedação
   recai sobre a plataforma, não sobre o indivíduo, mas gera risco de
   bloqueio/geo-restrição de conta. Status de Bybit/OKX/Kraken para
   usuários BR não verificado ainda. Isso muda o desenho do experimento:
   antes de qualquer teste, é preciso confirmar por escrito se a exchange
   escolhida está autorizada a oferecer derivativos a residentes no Brasil.
2. **Provisão de liquidez em pool de stablecoins (estilo Curve)** — risco
   estrutural baixo (sem exposição direcional relevante), retorno citado
   ~3-7% a.a. em condições normais, principal risco é depeg de uma das
   stablecoins do pool (precedente: USDC em março/2023). Vale como
   comparação de baseline de "quase-renda-fixa" DeFi.
3. **Vault de market making de perpétuos (Hyperliquid HLP / GMX GM pool)** —
   tese interessante: captura sistemática do lado perdedor agregado de
   traders de alavancagem de varejo (padrão bem documentado). Não avaliado
   a fundo ainda (item cortado no meio da leitura).

## Achado jurídico transversal a registrar

Regime tributário de cripto no Brasil está em transição em 2026: isenção de
ganho de capital até R$35.000/mês em vendas foi mantida (Câmara rejeitou a
MP 1.303/2025 que propunha alíquota única de 17,5% sem esse piso), mas o
tema não está definitivamente encerrado — **confirmar a regra vigente antes
de qualquer operação real**, não presumir a isenção antiga.

## Pendente para a próxima rodada (lote pequeno, por indicação do usuário)

- 18 famílias não-financeiras não pesquisadas ainda: DeFi, mercados de
  previsão, micro-SaaS, revenda de APIs, arbitragem de dados, produtos
  digitais, leads, afiliados, bounties, bug bounty, automação de
  marketplaces, revenda/arbitragem de preços, computação ociosa, automação
  para PMEs, ferramentas pay-per-use, serviços de agentes de IA, Brasil/Pix.
- Combinações inéditas, ranking e ataque adversarial ainda não rodaram para
  nenhuma família (nem as 6 financeiras).
- Dados brutos completos das 6 famílias financeiras estão em
  `research/round1_raw_partial.json` (não lido por completo, para economizar
  contexto — consultar sob demanda por mecanismo específico).
