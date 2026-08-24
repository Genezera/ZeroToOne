---
name: automation_fit_top4
status: completo — 4/4 agentes, testando se os top-4 do ranking sobrevivem ao
  requisito "zero trabalho humano recorrente" (só ajuda na criação).
---

# Teste de automação total nos top 4 do ranking

| # ranking | Mecanismo | Veredito | Gargalo principal |
|---|---|---|---|
| 1 (62) | Agência de automação para PMEs | PARCIAL — falha no ponto crítico | Prospecção/fechamento de venda B2B local precisa de humano (dados 2026: AI SDR autônomo converte ~11% vs 38% híbrido; caso de "vendedor IA" avaliado em US$350M forjando clientes) |
| 2 (58) | Agente de atendimento WhatsApp | PARCIAL — menos automatizável que #1 | Mesmo bloqueio de aquisição do #1, **mais** risco de alucinação em conversa aberta com cliente final (casos reais documentados: bot da Cursor inventou política e causou cancelamentos; tribunal alemão responsabilizou clínica por chatbot alucinar credencial médica) |
| 3 (56) | Gigs Fiverr/Upwork com IA | **INCOMPATÍVEL** | Upwork proíbe por escrito envio de proposta/mensagem sem clique humano, com banimento como consequência declarada. Fiverr não proíbe tecnicamente, mas mentir sobre uso de IA quando perguntado é quebra de política com risco de suspensão permanente. |
| 4 (52) | SaaS via Stripe | PARCIAL | Build, cobrança e monitoramento leve são automatizáveis de ponta a ponta. Gargalo: aquisição paga de usuários sem marketing humano — evidência de que campanhas automáticas (Meta Advantage+) inflam custo até 10x em contas novas, o que colidiria com o limite de US$10/experimento do RISK_LIMITS.md. |

## Padrão estrutural encontrado (o achado mais importante desta rodada)

**Todos os quatro melhores candidatos do ranking anterior compartilham o mesmo
gargalo raiz: conseguir o(s) primeiro(s) cliente(s) pagante(s) sem venda
relacional humana.** Isso não é uma coincidência de execução — é estrutural:
negócios de serviço B2B local (PME, WhatsApp) dependem de confiança que hoje
nenhum agente autônomo gera de forma documentadamente eficaz; marketplaces de
freelance (Fiverr/Upwork) proíbem operação sem clique humano por política
explícita; aquisição paga sem supervisão de orçamento colide com os próprios
limites de risco já definidos pelo usuário.

**Implicação para a próxima rodada de descoberta:** o critério de busca
precisa mudar de "boa demanda + capital ≤ US$200" para "boa demanda + capital
≤ US$200 + **distribuição embutida em um canal que não exige venda
relacional**" — ou seja, mecanismos onde o cliente/comprador chega via um
marketplace, diretório, busca ou matching automático já existente (não via
o vendedor convencendo alguém), ou mecanismos que não têm "cliente" no
sentido comercial (sistemas puramente baseados em capital).

Famílias ainda não pesquisadas que se encaixam melhor nesse padrão:
- **Capacidade computacional ociosa** (marketplaces como Vast.ai/io.net —
  matching automático, sem venda)
- **Revenda automatizada de APIs / ferramentas pay-per-use** distribuídas via
  diretórios self-serve (RapidAPI e similares) — desenvolvedor descobre e
  assina sozinho
- **Produtos digitais** vendidos em marketplaces com busca própria (Gumroad,
  Etsy, lojas de templates) — descoberta via busca da plataforma, não venda
  direta
- **Arbitragem de dados/informação** empacotada como assinatura self-serve
- **Afiliados** com tráfego orgânico/conteúdo (sem contato direto com
  comprador)
- Mecanismos puramente financeiros automatizáveis (mas o ranking já mostrou
  que a maioria está comprimida a zero ou bloqueada juridicamente para BR —
  não re-abrir sem motivo novo)

## Não descartado, só rebaixado
#1 e #2 continuam tecnicamente possíveis se o usuário aceitar fazer ele mesmo
a parte de vendas/relacionamento inicial — mas isso contradiz o requisito
explícito de "zero trabalho meu". Ficam arquivados, não eliminados, caso o
requisito mude no futuro.
