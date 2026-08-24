# Ranking dos 51 mecanismos brutos — Rodadas 1 e 2

**Data:** 23/08/2026
**Base:** `research/round1_raw_partial.json` (31 mecanismos, famílias financeiras/cripto) + `research/round2_raw_partial.json` (20 mecanismos, famílias Brasil/Pix, Micro-SaaS, Automação PME, Serviços de agentes de IA).
**Critério geral:** expectativa líquida plausível após custos, tempo até primeira receita, giro de capital, drawdown/ruína, robustez, escalabilidade, automação, durabilidade da vantagem, qualidade da evidência, facilidade de implantação com exatamente US$200, dependência de terceiros, custo operacional, e resultado no cenário pessimista. Nenhum dos 51 mecanismos foi testado com dinheiro real até agora — toda "evidência" aqui é pesquisa de mesa (documentação oficial, blogs, ferramentas de monitoramento), não resultado observado.

**Resultado:** 21 eliminados agora, 30 sobreviventes (apresentados em 29 entradas — duas variantes de LP em stablecoin foram fundidas em uma única entrada, ver nota). Nenhum mecanismo passou de pontuação 62/100 — trate qualquer coisa acima de ~50 como "vale investigar mais a fundo antes de comprometer capital", não como "pronto para operar".

---

## Grupo 1 — Eliminados agora (21)

### A. Retorno líquido esperado nulo/negativo já admitido pela própria descrição (competição institucional/HFT/MEV) — 7 mecanismos

1. **Arbitragem triangular dentro de uma única exchange** (BTC/USDT, ETH/USDT, ETH/BTC) — família Arbitragem financeira legal. A própria pesquisa conclui "provavelmente próximo de zero a levemente negativo para varejo"; nicho dominado por bots institucionais colocados junto ao matching engine.
2. **Arbitragem DEX-DEX/DEX-CEX em L2 com flash loan** — família Arbitragem financeira legal. Janela de oportunidade caiu de 8s (2023) para 340ms (2026); gas consome 40-70% do lucro bruto; conclusão da própria pesquisa é "provavelmente zero ou negativo".
3. **Provisão de liquidez (market making) em par cripto líquido via API** — família Ineficiências de microestrutura. Duplicata funcional do mecanismo de MM em CEX; a própria pesquisa admite "provavelmente perto de zero ou negativo em pares muito líquidos".
4. **Arbitragem triangular intra-exchange (3 pares no mesmo book)** — família Ineficiências de microestrutura. Duplicata do item 1; mesma auto-admissão de retorno nulo/negativo.
5. **Arbitragem triangular intra-exchange (CEX, 3 pares)** — família Arbitragem triangular. Terceira ocorrência do mesmo mecanismo; a própria pesquisa cita ~86% do volume cripto sendo bot, gaps fecham em <200ms.
6. **Arbitragem triangular on-chain em pools de DEX/AMM (L2)** — família Arbitragem triangular. ~US$1,4 bi extraídos por sandwich bots na Ethereum em 2025; bots pagam até 90% do lucro potencial só em gas para garantir a posição.
7. **Arbitragem triangular intra-exchange (bot)** — família Diferenças entre mercados. Quarta ocorrência do mesmo mecanismo triangular, mesma conclusão de retorno ~nulo.

### B. Capital mínimo real acima de US$200 (a própria pesquisa admite) — 3 mecanismos

8. **Arbitragem triangular cross-exchange com prêmio cambial BR** (BRL→BTC→USDT→BRL) — família Arbitragem triangular. `min_capital_usd: 300`, acima do teto da missão.
9. **BDR vs. ação/ADR subjacente na B3** — família Diferenças entre mercados. `min_capital_usd: 2.000`; a própria pesquisa diz "0% executável no orçamento de $200 — o mecanismo simplesmente não é executável nesse capital".
10. **Basis trade regulado — futuro de Bitcoin (BIT) da B3 vs. spot** — família Funding/basis/yield. Hedge completo exige ~US$1.150-1.200 (contrato + margem + spot); com $200 só dá para pagar a margem sem o spot, o que transforma a "arbitragem neutra" em aposta direcional alavancada.

### C. Risco jurídico alto (derivativos cripto sem autorização CVM para residentes brasileiros), sem mitigação prática disponível hoje — 4 mecanismos

11. **Funding rate arbitrage / cash-and-carry (spot comprado + perpétuo vendido)** — família Arbitragem financeira legal. Risco jurídico "médio-alto"; CVM fechou Termo de Compromisso com a Binance em 2024 por oferta irregular de derivativos a brasileiros.
12. **Depósito em vault de market making de perpétuos (Hyperliquid HLP / GMX GM pool)** — família Market making. A própria pesquisa chama isto de "o ponto mais delicado do conjunto" e recomenda tratar como "zona cinzenta de risco regulatório real, não como uma via livre" — sem fronteira legal esclarecida.
13. **Funding rate harvesting (cash-and-carry) em exchange cripto global** — família Funding/basis/yield. Risco jurídico explicitamente rotulado "ALTO" pela própria pesquisa; Ato Declaratório CVM 17.961 (2020), multa à Binance (2024), Bybit expulsando usuários brasileiros de produtos de derivativos a partir de set/2026.
14. **Arbitragem de funding rate cross-exchange** — família Funding/basis/yield. Mesmo risco "ALTO" do item 13, dobrado por operar em duas exchanges estrangeiras simultaneamente.

*(Nota: os itens 11, 13 e 14 são a mesma estratégia de fundo — cash-and-carry em perpétuo cripto — redescoberta três vezes por sub-agentes diferentes, com rótulos de risco jurídico inconsistentes entre si: "médio-alto" numa versão, "ALTO" nas outras duas. Ver Observações do rankeador.)*

### D. Já bloqueado/indisponível na prática para residente no Brasil — 2 mecanismos

15. **Provisão de liquidez em mercado de previsão (Polymarket)** — família Market making. Bloqueado para novas operações a partir do Brasil desde abril/2026 (CMN classificou como derivativo não conforme); `available_in_brazil: false`. Não é mais risco, é fato consumado.
16. **Monetização de bots/GPTs (OpenAI GPT Store / Poe)** — família Serviços de agentes de IA. Poe exclui explicitamente o Brasil da lista de países elegíveis para pagamento a criadores; elegibilidade da OpenAI para o Brasil não confirmada. `available_in_brazil: false`.

### E. Risco jurídico elevado por reclassificação regulatória + risco documentado de bloqueio de conta, redundante com sobreviventes — 3 mecanismos

17. **Arbitragem geográfica de cripto (prêmio Brasil)** [família microestrutura] — duplicata do item sobrevivente "Arbitragem interexchange BR"; sem dado atual confiável sobre o tamanho do prêmio.
18. **Arbitragem triangular fiat-cripto-fiat via P2P/PIX** (BRL→USDT→BRL) — família Arbitragem triangular. Operar isso de forma recorrente se aproxima de atividade de câmbio não autorizada (Resolução BCB 521/2025); já existe caso documentado de bloqueio de conta bancária de vendedor P2P recorrente no Brasil.
19. **Arbitragem cross-exchange de cripto dentro do Brasil** [família diferenças] — duplicata funcional do item sobrevivente "Arbitragem interexchange BR".
20. **Arbitragem cripto Brasil-exterior ('prêmio Brasil')** [família diferenças] — duplicata do mesmo mecanismo; agravado porque a Resolução BCB 561 (a partir de out/2026) proíbe liquidação cambial via cripto/stablecoin com contraparte no exterior, fechando parte do canal que hoje sustenta esse prêmio.

*(Nota de contagem: os itens 17, 19 e 20 são a mesma ideia central do sobrevivente #1 do ranking abaixo — arbitragem de spread entre exchanges de cripto, doméstica ou Brasil-exterior — descoberta quatro vezes por sub-agentes de famílias diferentes.)*

Total eliminado: **21 mecanismos.**

---

## Grupo 2 — Ranking dos 30 sobreviventes (29 entradas)

Tabela-resumo (ordem decrescente de pontuação):

| # | Pontuação | Mecanismo | Família |
|---|---|---|---|
| 1 | 62 | Agência local de automação (setup + assinatura) para PMEs | Automação PME |
| 2 | 58 | Agente de atendimento/qualificação de leads via WhatsApp (assinatura) | Serviços de agentes de IA |
| 3 | 56 | Gigs de pesquisa/redação/dados via Fiverr/Upwork com produção assistida por IA | Serviços de agentes de IA |
| 4 | 52 | SaaS web vertical independente (Stripe) | Micro-SaaS |
| 5 | 48 | Precificação por performance (fee sobre no-show evitado) | Automação PME |
| 6 | 44 | App de nicho para Shopify App Store | Micro-SaaS |
| 6 | 44 | Comissão de indicação em programas de afiliados de SaaS verticais (Trinks/Zenvia) | Automação PME |
| 8 | 40 | Wrapper fino de IA para workflow específico | Micro-SaaS |
| 8 | 40 | Relatórios sob encomenda via prospecção B2B direta | Serviços de agentes de IA |
| 10 | 38 | Extensão de navegador paga (Chrome Web Store) | Micro-SaaS |
| 10 | 38 | Arbitragem interexchange de cripto entre corretoras brasileiras | Arbitragem financeira legal |
| 12 | 36 | Plugin WordPress freemium (Freemius) | Micro-SaaS |
| 13 | 34 | Sub-revenda de acesso à API do WhatsApp via BSP | Automação PME |
| 14 | 32 | Captura de rendimento turbinado (>100% CDI) em contas Pix — **piso de comparação** | Brasil/Pix |
| 14 | 32 | Venda de templates de automação em marketplace | Automação PME |
| 16 | 30 | Arbitragem de prazo de fatura do cartão de crédito + Selic (float) | Brasil/Pix |
| 17 | 28 | LP concentrada em Uniswap v3 (par volátil) | Market making |
| 18 | 27 | Spread de juros stablecoin (Aave/Curve lending) | Funding/basis/yield |
| 19 | 26 | Arbitragem de stablecoin via P2P brasileiro (USDT/PIX) | Arbitragem financeira legal |
| 20 | 25 | Market making em order book de exchange centralizada | Market making |
| 21 | 24 | Arbitragem intramercado B3 (fracionário vs. lote-padrão) | Ineficiências de microestrutura |
| 21 | 24 | Correspondente bancário / agente de recebimento Pix | Brasil/Pix |
| 23 | 23 | Vault de yield delta-neutro de terceiros (Ethena sUSDe) | Funding/basis/yield |
| 24 | 22 | LP em pool de stablecoins estilo Curve (inclui variante par estável L2) | Market making / Microestrutura |
| 25 | 21 | Yield farming delta-neutro em DEX (LP + hedge com perpétuo) | Funding/basis/yield |
| 26 | 20 | Arbitragem em eventos de despeg de stablecoins | Arbitragem triangular |
| 26 | 20 | Marketing de afiliados para produtos financeiros ('indique e ganhe') | Brasil/Pix |
| 26 | 20 | Enriquecimento e estruturação de leads B2B com IA | Serviços de agentes de IA |
| 29 | 18 | Cashback em compras reais reinvestido em renda fixa | Brasil/Pix |

Detalhamento (mesma ordem):

**1. Agência local de automação para PMEs (62) — Automação PME.** É o mecanismo com a evidência mais concreta de demanda real do lote todo: estudos de caso documentados de redução de no-show de 19-31% com lembretes automáticos via WhatsApp (rede pública do Ceará, clínicas privadas), e a origem do lucro é óbvia (tempo/recepcionista economizado). Principal motivo de desconfiança: a maioria dos negócios de serviço B2B local falha por falta de vendas, não por perda de capital — o "cheapest_refuting_experiment" (20 outreachs reais) ainda não foi rodado, e o enquadramento MEI é incerto (CNAE de automação sob encomenda pode exigir ME formal, elevando custo fixo).

**2. Agente de atendimento/qualificação de leads via WhatsApp, assinatura (58) — Serviços de agentes de IA.** Essencialmente a mesma tese de negócio do #1 (WhatsApp + automação para PME local), com preços de mercado citados (R$500-1.400/mês cobrados por agências) confirmados em documentação oficial da Meta. Principal motivo de desconfiança: risco de "alucinação" do agente gerando dano reputacional com o primeiro cliente-piloto, e alta sobreposição com o mecanismo #1 — não são realmente duas apostas independentes, são a mesma família de risco/retorno.

**3. Gigs de pesquisa/redação/dados via Fiverr/Upwork com IA (56) — Serviços de agentes de IA.** Estrutura de taxas e regras de uso de IA confirmadas em fonte oficial (Fiverr 20% flat, Upwork ~10%); é o mecanismo mais "garantido de eventualmente funcionar" porque não depende de convencer ninguém de um problema novo, só de competir num mercado já validado. Principal motivo de desconfiança: categoria "serviços com IA" está saturada desde 2023-2024, moat é baixo, e a própria pesquisa estima US$0-100 líquidos no primeiro mês para a maioria dos vendedores novos sem histórico.

**4. SaaS web vertical independente via Stripe (52) — Micro-SaaS.** Custos de infraestrutura bem documentados (Stripe, Cloudflare, domínio) e a validação mais barata é literalmente pedir um pré-pagamento antes de escrever código. Principal motivo de desconfiança: a evidência de retorno é puramente anedótica — "relatos qualitativos" indicam que a maioria dos micro-SaaS solo nunca ultrapassa algumas centenas de dólares de MRR, e uma fração relevante fica em zero.

**5. Precificação por performance — fee sobre no-show evitado (48) — Automação PME.** Variante comercial do #1 que reduz o risco percebido pelo cliente ("só paga se funcionar"), apoiada nos mesmos dados de redução de no-show. Principal motivo de desconfiança: fluxo de caixa mais lento (exige 30-60 dias de comprovação de resultado) e risco real de fazer todo o trabalho e não receber se o cliente contestar a métrica — "inadimplência disfarçada de resultado não comprovado".

**6. App de nicho para Shopify App Store (44) — Micro-SaaS.** Economia de plataforma favorável (0% de revenue share até US$1 milhão de receita vitalícia) e processo de revisão documentado oficialmente. Principal motivo de desconfiança: barreira técnica mais alta que os outros micro-SaaS (GraphQL Admin API obrigatória, webhooks GDPR, 2-4+ semanas só de revisão antes de qualquer receita possível).

**6. Comissão de indicação em SaaS verticais — Trinks/Zenvia Finder (44) — Automação PME.** Risco financeiro praticamente nulo (cadastro gratuito, comissão recorrente com percentuais confirmados em página oficial: 50%/20% Trinks, 10% Zenvia). Principal motivo de desconfiança: nenhuma fonte confirma taxa de conversão real de indicação em cliente pagante, e a receita escala linearmente com o tamanho da sua rede pessoal, não com esforço.

**8. Wrapper fino de IA para workflow específico (40) — Micro-SaaS.** Custo de tokens irrisório (gpt-4o-mini a US$0,15/milhão de tokens de entrada) permite margem bruta >90% no curto prazo, e a validação via "concierge MVP" manual é barata. Principal motivo de desconfiança: é o mecanismo com o moat mais frágil do lote inteiro — qualquer funcionalidade pode ser absorvida pelo próprio provedor do modelo (OpenAI/Google/Anthropic) da noite para o dia, ameaça que a própria pesquisa chama de "estrutural".

**8. Relatórios sob encomenda via prospecção B2B direta (40) — Serviços de agentes de IA.** Sem taxa de marketplace (você fica com 100% do valor cobrado), produto já validável com um relatório-amostra grátis. Principal motivo de desconfiança: taxa de resposta de cold outreach tipicamente 1-5%, sem proteção de escrow contra calote, e a evidência de preço/conversão é extrapolada de mercados adjacentes (geração de leads), não medida diretamente neste nicho.

**10. Extensão de navegador paga (38) — Micro-SaaS.** Canal de distribuição orgânico (busca interna da Chrome Web Store) reduz custo de aquisição a quase zero, e o capital de risco é baixo (~US$20-50). Principal motivo de desconfiança: evidência de sucesso é fraca ("mais de US$500 mil movimentados por TODOS os desenvolvedores da plataforma desde o lançamento" não diz nada sobre a mediana individual), e risco real de banimento permanente da conta de desenvolvedor por violação de política de permissões/privacidade.

**10. Arbitragem interexchange de cripto entre corretoras brasileiras (38) — Arbitragem financeira legal.** O único mecanismo de arbitragem cripto do lote 1 que sobrevive por conta própria: fenômeno confirmado por ferramenta de monitoramento dedicada (CoinTraderMonitor) e não se autodescreve como comprimido a zero. Principal motivo de desconfiança: a própria pesquisa admite retorno "não verificado com dados ao vivo" e estimativa honesta de "0-3% ao mês" — pequeno o bastante para que taxas de saque/rede possam consumir a margem inteira, e a mesma ferramenta que confirma o fenômeno já é usada por outros arbitradores, comprimindo a oportunidade.

**12. Plugin WordPress freemium via Freemius (36) — Micro-SaaS.** Distribuição orgânica no maior CMS do mundo, Freemius já aceita Pix para compradores brasileiros. Principal motivo de desconfiança: exigência de licença GPL no repositório oficial enfraquece a proteção da camada paga (qualquer um pode redistribuir de graça o que você vende), e a distribuição de receita entre os "dezenas de milhares" de plugins é fortemente assimétrica.

**13. Sub-revenda de acesso à API do WhatsApp via BSP (34) — Automação PME.** Modelo clássico de distribuidor (compra no atacado, revende no varejo com markup), com preço de piso do BSP citado (~US$59/mês). Principal motivo de desconfiança: só fica economicamente positivo com múltiplos clientes dividindo o custo fixo — com um cliente só, a margem é provavelmente negativa, e o preço citado vem de fontes secundárias, não da página oficial.

**14. Captura de rendimento turbinado (>100% CDI) em contas Pix — piso de comparação (32) — Brasil/Pix.** Este é o "chão" da missão: risco praticamente nulo (FGC até R$250 mil, Selic/CDI a 14% a.a.), evidência média-alta, capital mínimo zero. Não há vantagem real aqui — é só eficiência de alocação de caixa, e o próprio relatório é honesto sobre isso ("não é um mecanismo de geração de riqueza"); qualquer estratégia mais arriscada deste ranking precisa, líquida de risco, superar isto para valer a pena. Em valores absolutos: dezenas de reais por ano sobre US$200.

**14. Venda de templates de automação em marketplace (32) — Automação PME.** Ativo digital replicável a custo marginal quase zero, e o limite legal da licença n8n (consultoria/templates sim, revenda de hospedagem não) está claramente mapeado. Principal motivo de desconfiança: a única fonte de retorno otimista ("US$3K-25K/mês") é uma anedota de fórum que a própria pesquisa trata com ceticismo explícito, e o cenário realista citado é US$0-200/mês sem audiência prévia.

**16. Arbitragem de prazo de fatura do cartão de crédito + Selic (30) — Brasil/Pix.** Mecânica bem documentada (dado oficial do Bacen para a taxa de rotativo), custo de capital zero (usa gasto que já ocorreria). Principal motivo de desconfiança: risco de cauda assimétrico e severo — um único deslize (não quitar a fatura integralmente) aciona rotativo de ~428% a.a., podendo transformar um ganho de R$10-14 em uma dívida que supera o capital original em poucos meses.

**17. LP concentrada em Uniswap v3, par volátil (28) — Market making.** Mecânica de fee tiers documentada oficialmente pela Uniswap, sem KYC nem risco de banimento de conta. Principal motivo de desconfiança: em mercados com tendência, a própria pesquisa nota que o impermanent loss/LVR tende a compensar total ou parcialmente a receita de taxa — na prática, funciona mais como uma aposta direcional/de volatilidade disfarçada de "yield" do que como renda passiva.

**18. Spread de juros stablecoin — Aave/Curve lending (27) — Funding/basis/yield.** O perfil de risco mais conservador do cluster de yield cripto (sem derivativo, sem hedge ativo, contratos maduros e auditados). Principal motivo de desconfiança: a taxa líquida citada (Aave USDC ~3,8-5,2% a.a.) é *menor* que a Selic/CDI brasileira atual (~14% a.a.) — ou seja, para um capital em BRL, isto é dominado pelo piso de comparação (#14) a menos que haja uma razão específica para querer exposição em dólar/cripto, o que não foi o argumento apresentado.

**19. Arbitragem de stablecoin via P2P brasileiro, USDT/PIX (26) — Arbitragem financeira legal.** Fenômeno real e documentado (a própria Binance alerta sobre fraudes comuns no P2P). Principal motivo de desconfiança: risco de fraude de contraparte pode zerar até 100% de uma única operação (estorno de PIX após liberação da cripto), e não há nenhuma estimativa numérica confiável de retorno — só "presumo potencial de poucos pontos percentuais".

**20. Market making em order book de exchange centralizada (25) — Market making.** Uso de API para bots é explicitamente permitido pelas exchanges, mecânica bem documentada. Principal motivo de desconfiança: a própria pesquisa não conseguiu quantificar retorno líquido com confiança ("pode variar de baixo dígito % positivo... a negativo"), e o notional mínimo por ordem (5 USDT na Binance) já consome fatia relevante de US$200, limitando quantos pares dá para operar simultaneamente.

**21. Arbitragem intramercado B3 — fracionário vs. lote-padrão (24) — Ineficiências de microestrutura.** Único mecanismo de arbitragem 100% dentro do sistema financeiro regulado brasileiro (B3/CVM), sem uso de cripto. Principal motivo de desconfiança: evidência qualitativa apenas (nenhum estudo quantitativo do descolamento real entre os dois livros), e tributação de day-trade (20% sem faixa de isenção) reduz ainda mais uma margem que já era pequena.

**21. Correspondente bancário / agente de recebimento Pix (24) — Brasil/Pix.** Função econômica real (bancos terceirizam atendimento porque é mais barato que agência própria). Principal motivo de desconfiança: a pesquisa não conseguiu confirmar o dado mais importante — a comissão real para uma simples transação Pix de baixo valor (a faixa de 3-6% encontrada parece ser para produtos de crédito, não para cash-in/cash-out) — e a atividade não é elegível para MEI, exigindo constituição societária mais cara antes da primeira receita.

**23. Vault de yield delta-neutro de terceiros — Ethena sUSDe (23) — Funding/basis/yield.** O mais passivo de todo o lote (só depósito, protocolo cuida do resto). Principal motivo de desconfiança: o rendimento já comprimiu para ~3,7-4,5% a.a. em 2026 (abaixo de picos históricos de até 30%) — de novo, abaixo da Selic — e uma fração do colateral fica com custodiantes centralizados, não 100% on-chain, o que é uma concessão de risco em troca de um retorno já modesto.

**24. LP em pool de stablecoins estilo Curve, incl. variante de par estável em L2 (22) — Market making/Microestrutura.** Duas entradas quase idênticas do lote 1 fundidas aqui; retorno citado de 3-7% a.a., risco de mercado baixo por ser par quase-1:1. Principal motivo de desconfiança: mesmo argumento do #18 — retorno nominal abaixo da Selic doméstica —, mais o risco de cauda real de despeg (já ocorreu com USDC em 2023).

**25. Yield farming delta-neutro em DEX, LP + hedge com perpétuo (21) — Funding/basis/yield.** Tenta capturar taxa de swap com exposição de preço neutralizada. Principal motivo de desconfiança: complexidade operacional alta para US$200 (custo de gas de cada rebalanceamento manual pode consumir a maior parte do rendimento de taxas), zona cinzenta jurídica (não claramente proibido, mas não testado) e evidência de retorno é baixa-média.

**26. Arbitragem em eventos de despeg de stablecoins (20) — Arbitragem triangular.** Legalmente limpo e capital seguro se restrito a stablecoins bem lastreadas (USDC/USDT). Principal motivo de desconfiança: depende de um evento raro e imprevisível (a própria fonte nota que "poucos aproveitaram" o despeg de 2023) — o tempo de espera entre eventos pode ser meses a anos, deixando o capital ocioso.

**26. Marketing de afiliados para produtos financeiros — 'indique e ganhe' (20) — Brasil/Pix.** Risco financeiro zero, mecânica confirmada em regulamento oficial da XP/Rico. Principal motivo de desconfiança: escala limitada pelo tamanho da sua rede pessoal real — não é repetível indefinidamente sem virar um negócio de conteúdo/audiência à parte, o que foge do escopo de "US$200".

**26. Enriquecimento e estruturação de leads B2B com IA (20) — Serviços de agentes de IA.** Tecnicamente simples e barato de validar. Principal motivo de desconfiança: a própria pesquisa o descreve como "o mais comoditizável dos mecanismos analisados" — compete diretamente com ferramentas SaaS prontas (Clay, Apollo, ZoomInfo) que já fazem o mesmo por US$0,01-0,30/contato, deixando pouco espaço de preço para um serviço manual.

**29. Cashback em compras reais reinvestido em renda fixa (18) — Brasil/Pix.** Risco zero, mas a própria pesquisa é explícita: "isso não transforma US$200 em mais dinheiro por si só — é redução de custo sobre gasto que você já faria, não geração líquida de patrimônio". Principal motivo de desconfiança: não é realmente um mecanismo de crescimento do capital de US$200, é um hábito de consumo; incluído no ranking só porque não é tecnicamente inviável, mas fica no chão do grupo.

---

## Observações do rankeador

1. **Redundância massiva na Rodada 1.** A mesma estratégia foi redescoberta de forma independente por sub-agentes de "famílias" diferentes múltiplas vezes: arbitragem triangular intra-exchange aparece **7 vezes** (5 eliminadas, todas com a mesma auto-admissão de retorno ~zero/negativo), arbitragem de "prêmio Brasil"/cross-exchange doméstica aparece **4 vezes**, e cash-and-carry de funding rate em perpétuo aparece **4 vezes**. Isso não é evidência de robustez (múltiplas fontes convergindo) — é o mesmo processo de busca reencontrando os mesmos resultados de buscas na internet parecidas, categorizado sob rótulos de família diferentes. Antes de uma rodada 3, vale reforçar nos prompts de descoberta que o sub-agente cheque explicitamente se o mecanismo já foi coberto por outra família.

2. **Inconsistência no rótulo de risco jurídico para a mesma estratégia.** A arbitragem de funding rate/cash-and-carry em derivativos cripto foi rotulada "baixo" implicitamente em uma variante mais antiga, "médio-alto" em outra e "ALTO" em duas outras — todas descrevendo essencialmente a mesma exposição regulatória (CVM proíbe oferta de derivativos cripto a brasileiros sem autorização). Isso sugere que a avaliação de risco jurídico está sendo refeita do zero por cada sub-agente em vez de usar uma referência compartilhada, o que é uma fonte real de viés (a pontuação final de um mecanismo pode depender de qual sub-agente calhou de escrever sobre ele).

3. **A Selic/CDI doméstica (14% a.a. em ago/2026) domina boa parte do cluster de "yield cripto de baixo risco".** Aave USDC (~3,8-5,2% a.a.), Ethena sUSDe (~3,7-4,5% a.a.) e pools de stablecoin estilo Curve (~3-7% a.a.) todos rendem, em termos nominais, *menos* que simplesmente deixar o capital numa conta Pix remunerada no Brasil — e ainda adicionam risco de contrato inteligente, depeg e custódia que a conta Pix não tem. Isso só faria sentido como parte de uma estratégia de diversificação cambial deliberada, argumento que nenhum dos mecanismos do lote 1 chegou a fazer explicitamente.

4. **Viés claro entre as duas rodadas.** A Rodada 1 (famílias financeiras/cripto) é dominada por mecanismos cuja própria descrição admite que a vantagem já foi arbitrada a zero pela competição institucional/HFT/MEV — dos 31 mecanismos, 20 foram eliminados, a maioria por essa razão. A Rodada 2 (Brasil/Pix, micro-SaaS, automação PME, agentes de IA) produziu proporcionalmente muito mais sobreviventes de pontuação razoável (apenas 1 de 20 eliminado) porque a origem do lucro é um problema real resolvido para um cliente real, não uma ineficiência de precificação que máquinas mais rápidas já capturam. Isso é consistente com o achado do STATE.md sobre AurumOS/Snowball (sinais direcionais de cripto refutados com rigor estatístico em ambos os projetos anteriores) — reforça que buscar mais variantes financeiras/cripto tem retorno marginal decrescente, enquanto as 14 famílias não pesquisadas (revenda de APIs, arbitragem de dados, afiliados, produtos digitais, revenda/arbitragem de preços, ferramentas pay-per-use) provavelmente têm um padrão mais parecido com a Rodada 2 do que com a Rodada 1.

5. **Lacuna: nenhum "cheapest_refuting_experiment" foi executado ainda.** Todos os 51 mecanismos têm um experimento de refutação barato sugerido no próprio registro, e nenhum foi rodado. O ranking acima é inteiramente baseado em plausibilidade de pesquisa de mesa — a pontuação de qualquer sobrevivente pode mudar bastante assim que o primeiro experimento real (mesmo sem dinheiro, como os testes de simulação/somente-leitura sugeridos) for executado.

6. **Números otimistas de retorno vêm desproporcionalmente de fontes com interesse comercial.** Vários mecanismos citam retornos de "blogs que vendem bots de arbitragem" ou "empresas de scanner de funding rate" como única fonte — a própria pesquisa sinaliza isso como viés promocional em pelo menos 4 mecanismos (funding rate arbitrage, arbitragem triangular, templates de automação, extensão de navegador). Vale tratar qualquer número de retorno citado sem fonte independente/auditada como teto otimista, não como expectativa central.

7. **Nenhum mecanismo contabiliza o custo de oportunidade do tempo do operador.** Os "pisos" (conta Pix remunerada, float de fatura, cashback) são honestamente descritos como gerando "dezenas de reais por ano" sobre US$200 — o que é matematicamente correto, mas lembra que em capital tão pequeno, a escolha de mecanismo importa menos do que ter um plano de aporte de capital adicional ao longo do tempo. Mesmo uma vantagem líquida de 15% ao ano bem executada sobre US$200 é ~US$30/ano — vale alinhar expectativa com o usuário sobre isso antes de decidir onde investir esforço de validação.
