---
name: registry_round2_partial
status: Lote 2 completo (4/4 agentes, sem falhas). 20 mecanismos novos.
  Dados brutos em research/round2_raw_partial.json.
---

# Lote 2 — Brasil/Pix, Micro-SaaS, Automação para PMEs, Serviços de agentes de IA

Diferença marcante em relação ao lote 1 (cripto/arbitragem financeira): estes
mecanismos dependem de **prestar um serviço/produto real e contínuo**, não de
capturar um spread que tende a ser arbitrado até zero pela concorrência. Em
compensação, quase todos têm capital mínimo maior que zero apenas no sentido
formal — o verdadeiro custo é **tempo/trabalho**, não capital, o que muda o
critério de viabilidade com US$200.

## Brasil/Pix (5 mecanismos) — ceticismo saudável do próprio agente
- **Rendimento turbinado em conta de pagamento (105-120% CDI)**: o agente foi
  explícito — "isso não é um mecanismo de geração de riqueza, é só alocação
  eficiente de caixa". Retorno líquido ~11-14% a.a. (basicamente a Selic menos
  IR), risco praticamente zero (FGC), mas não é uma vantagem descoberta, é o
  preço do dinheiro no Brasil. Útil como *piso* de comparação para qualquer
  outra ideia (se uma estratégia não bate isso líquido de risco, não vale o
  esforço).
- **Cashback reinvestido**: mesma lógica — reduz custo de gasto que já
  ocorreria, não gera patrimônio líquido novo sem volume real de consumo.
- **Correspondente bancário Pix (cash-in/cash-out)**: risco jurídico médio —
  exige credenciamento formal (Resolução CMN 4.935/2021) e não se enquadra em
  MEI, precisa de Ltda/SLU. Capital mínimo real ~US$200, mas com fricção
  regulatória que pode não valer a pena nessa escala.
- **Float de fatura de cartão + Tesouro Selic**: variação do mecanismo 1,
  mesma lógica de "não é vantagem, é eficiência".
- **Afiliados de produtos financeiros ("indique e ganhe")**: legal se as
  indicações forem reais; a linha proibida é auto-indicação/contas fictícias.

## Micro-SaaS (5 mecanismos)
SaaS vertical via Stripe, extensão paga na Chrome Web Store, "wrapper fino de
IA" para um workflow específico, plugin WordPress freemium, app para Shopify
App Store. Capital mínimo baixo (US$20-75). **Achados jurídicos concretos e
não óbvios**: plugins WordPress hospedados no wordpress.org devem ser GPL —
qualquer pessoa pode redistribuir de graça a parte que você venderia (mitigável
vendendo a parte premium fora do repositório oficial); wrappers de IA sobre
API da OpenAI têm restrição de reusar output para treinar modelo concorrente;
LGPD/GDPR se aplicam a qualquer coleta de dado de usuário. Nenhum desses é
"vantagem que paga alguém" no sentido de arbitragem — é modelo de negócio
clássico (resolver um problema estreito, cobrar assinatura), então a pergunta
"quem paga e por quê" tem resposta óbvia (cliente paga por conveniência/tempo
economizado), mas a validação de demanda real é o gargalo, não o capital.

## Automação comercial para PMEs (5 mecanismos)
Agência local de automação com assinatura mensal, comissão de indicação em
SaaS verticais (Trinks, Zenvia), revenda de acesso à API oficial do WhatsApp
via BSP, venda de templates de automação (n8n), fee por performance
(no-show evitado / cobrança recuperada). **Achados jurídicos concretos**:
revenda de WhatsApp Business API exige adesão estrita às políticas da Meta
(violação bloqueia o número, derrubando o serviço de todos os clientes daquele
número simultaneamente — risco de concentração real); Sustainable Use License
do n8n permite vender templates/consultoria mas proíbe revender acesso
hospedado como SaaS de terceiros; "fee por performance" precisa de contrato
com métrica de baseline clara para não virar disputa de pagamento.

## Serviços de agentes de IA (5 mecanismos)
Gigs em Fiverr/Upwork com produção assistida por IA, prospecção B2B direta de
relatórios sob encomenda, atendimento/qualificação de leads via WhatsApp para
negócios locais, enriquecimento de dados B2B com IA sobre fontes públicas,
monetização de GPTs/bots em app stores de IA (rotulado pelo próprio agente
como "baixa viabilidade atual para o Brasil"). **Achados jurídicos**: renda do
exterior via Fiverr/Upwork é tributável no IRPF + IOF ~1,1-3,5% (Wise/Payoneer
reduzem); scraping de dados pessoais B2B cai sob LGPD mesmo sendo "dados de
empresa" (nomes/e-mails de pessoas físicas) — só fontes públicas com opt-out,
nunca scraping de site que proíbe isso nos termos (ex. LinkedIn).

## Leitura transversal do lote 2

Nenhum destes mecanismos promete um "edge" matemático como os do lote 1 — são
negócios/serviços legítimos onde a origem do lucro é óbvia (alguém paga por
tempo economizado, alcance, ou conveniência). O risco dominante não é "a
vantagem vai ser arbitrada até zero" (como em cripto), é **execução, demanda
real e conformidade regulatória/contratual** (LGPD, políticas de plataforma,
enquadramento tributário). Isso muda o tipo de experimento barato necessário:
não é "rodar um backtest", é "conseguir um cliente/piloto real disposto a
pagar" — evidência de demanda, não evidência estatística.

## Pendente (14 de 24 famílias ainda não pesquisadas)
Mercados de previsão, DeFi, automação de serviços digitais, revenda de
APIs, arbitragem de dados, produtos digitais, geração de leads, afiliados,
bounties, bug bounty, automação de marketplaces, revenda/arbitragem de
preços, capacidade computacional ociosa, ferramentas pay-per-use.
