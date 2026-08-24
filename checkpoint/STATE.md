---
last_updated: 2026-08-23T00:00:00Z (sessão de início)
veredito_atual: RESEARCH_IN_PROGRESS
---

# Checkpoint — Missão de crescimento de capital (US$ 200)

## Estado atual
- Sessão de kickoff. Ambiente auditado, projetos anteriores (AurumOS, Snowball)
  identificados e em auditoria por subagentes.
- Nenhum dinheiro real foi movimentado. Nenhuma conta nova foi criada.
- Ferramenta `trader-dev` (MCP) já está autenticada nesta máquina — plataforma de
  desenvolvimento/backtest de estratégias (Pine/TradingView-like), conta free,
  1000 créditos semanais, 1 crédito = 1 backtest. Ainda não usada nesta missão.

## Projetos anteriores encontrados (auditoria concluída — ver [[prior_projects_audit]])
- `C:\Users\Renan\Desktop\AurumOS` (Rust): testou 9 famílias de sinal de cripto
  (arb cross-exchange, market making, momentum, microestrutura etc.) com rigor
  estatístico real (FDR, walk-forward). Resultado: 9,8M sinais testados, 0
  aprovados — refutação honesta da família "sinal direcional/microestrutura".
  Nunca usou dinheiro real (só Bybit Demo). Pivô para funding-rate carry ficou
  bloqueado/inacabado.
- `C:\Users\Renan\Projetos\Snowball` (Node.js): mesma trajetória, de forma
  independente — testou momentum e pairs trading, refutou ambos por
  performance fraca fora da amostra, convergiu para funding-rate arbitrage
  delta-neutra cross-exchange. Nunca usou dinheiro real (sem chaves de
  exchange no código). Parou com "matemática ok, spread atual não paga custo
  com folga, amostra pequena" — não é uma refutação, é uma pausa por falta de
  evidência suficiente.
- Convergência independente de dois projetos na mesma hipótese remanescente
  (funding/basis arb) é o sinal mais forte herdado desta auditoria — mas ela
  não foi validada por nenhum dos dois. Ver síntese completa em
  [[prior_projects_audit]].

## Hipóteses abertas
1. Funding-rate / basis arbitrage cross-exchange delta-neutra (herdada de
   AurumOS + Snowball) — retestar com dados de HOJE, exigir amostra
   >=25-50 episódios antes de veredito, sem alavancagem. Não é "comprovada",
   é a hipótese financeira mais madura para investigar primeiro.
2. As ~24 famílias não-financeiras da missão (micro-SaaS, arbitragem de
   dados, afiliados, automação para PMEs, Pix/Brasil, etc.) — pesquisa
   exaustiva em andamento via workflow (rodada 1), ver [[research_registry]]
   quando concluído.

## Hipóteses rejeitadas
1. Sinais direcionais de cripto via microestrutura/momentum/padrões técnicos
   com ferramentas de varejo — refutado com rigor estatístico por AurumOS
   (9,8M sinais, 0 aprovados) e corroborado independentemente por Snowball
   (momentum/pairs com performance fraca out-of-sample). Não repetir esta
   pesquisa a menos que surja uma fonte de dado ou vantagem genuinamente nova.

## Evidências coletadas
(nenhuma ainda — nenhum experimento real executado nesta sessão)

## Experimentos executados
(nenhum ainda)

## Modo de operação (mudou nesta sessão — instrução do usuário)
O usuário pediu explicitamente para reduzir o tamanho dos lotes de agentes:
"isso está acabando muito rápido com os créditos... faça por partes, revise,
e lance mais e assim vai". Ver [[feedback_batch_size_agents]] na memória.
**A partir de agora: lotes pequenos (poucos agentes por vez), revisar com o
usuário, só então lançar o próximo lote.** Não repetir workflows grandes
(20+ agentes) mesmo com ultracode ligado.

## Rodada 1 de descoberta — PARCIAL (bateu no limite de uso da sessão)
Workflow de 24 famílias em paralelo + combinações + ranking + ataque
adversarial foi lançado, interrompido (processo reiniciou), retomado via
cache, e então bateu no limite de uso da sessão (reset 5:20pm
America/Sao_Paulo, 23/08/2026) depois de completar só 6 das 24 famílias —
todas do bloco financeiro/cripto (arbitragem financeira, market making,
microestrutura, arb triangular, diferenças entre mercados, funding/basis/
yield). 31 mecanismos brutos coletados, combinações/ranking/adversarial não
rodaram. Ver [[registry_round1_partial]] para a síntese e
`research/round1_raw_partial.json` para os dados brutos completos.

Achado novo relevante: CVM fechou Termo de Compromisso com a Binance em
ago/2024 proibindo oferta de derivativos cripto a brasileiros sem
autorização — afeta diretamente a hipótese de funding-rate arbitrage
herdada de AurumOS/Snowball; qualquer teste futuro precisa antes confirmar
por escrito se a exchange escolhida está autorizada para residentes no
Brasil.

## Lote 2 (Brasil/Pix, Micro-SaaS, Automação PME, Serviços de agentes de IA) — completo
4/4 agentes, sem falhas, 20 mecanismos. Custo: ~387k tokens de subagente,
~10,5 minutos, 92 chamadas de ferramenta (bem mais pesado que o esperado para
"só 4 agentes" — WebSearch/WebFetch consome bastante). Diferença qualitativa
importante em relação ao lote 1: são negócios/serviços reais (a origem do
lucro é óbvia — alguém paga por tempo/conveniência), não "edges" matemáticos
que tendem a ser arbitrados até zero. Risco dominante aqui é execução/demanda
real e conformidade (LGPD, políticas de plataforma), não competição
estatística. Ver [[registry_round2_partial]] e
`research/round2_raw_partial.json`.

Total acumulado: **51 mecanismos brutos em 10 de 24 famílias.**

## Decisão do usuário: parar descoberta, ir direto para ranking
Rodada de descoberta encerrada em 51 mecanismos / 10 de 24 famílias (decisão
explícita do usuário, não uma limitação técnica). Ranking completo (1 agente
só, ~219k tokens) — ver `research/ranking_round1_2.md`.

**Resultado do ranking:** 21 eliminados (7 por auto-admissão de retorno
~zero/negativo já comprimido por HFT/MEV; 3 por capital mínimo real >US$200;
4 por risco jurídico alto — CVM proíbe oferta de derivativos cripto a
brasileiros sem autorização; 2 já bloqueados de fato para BR; 3 redundantes).
30 sobreviventes, **nenhum acima de 62/100** — nada está "pronto para
operar", tudo precisa de validação real antes de qualquer capital.

**Top 5:** (1) Agência local de automação/assinatura para PMEs — 62; (2)
Agente de atendimento/qualificação de leads via WhatsApp — 58; (3) Gigs de
pesquisa/redação/dados via Fiverr/Upwork com IA — 56; (4) SaaS web vertical
via Stripe — 52; (5) Fee por performance (no-show evitado) — 48. Todos os
top 5 são negócios/serviços reais, nenhum é "trading edge".

**Achados-chave do ranking (ver seção "Observações do rankeador" no
arquivo):**
- Selic/CDI doméstica (14% a.a.) domina nominalmente vários "yields cripto de
  baixo risco" (Aave ~3,8-5,2%, Ethena ~3,7-4,5%, Curve-style ~3-7%) — esses
  só fariam sentido com uma tese explícita de diversificação cambial, que
  nenhum mecanismo apresentou.
- Redundância massiva na Rodada 1: mesma estratégia de arbitragem triangular
  redescoberta 7 vezes, funding-rate cash-and-carry 4 vezes, com rótulos de
  risco jurídico *inconsistentes* entre si para a mesma exposição — falta de
  referência jurídica compartilhada entre sub-agentes.
- **Realidade de escala**: mesmo um edge líquido de 15% a.a. bem executado
  sobre US$200 dá ~US$30/ano. Com capital tão pequeno, a escolha de
  mecanismo importa menos do que ter um plano de aporte de capital adicional
  ao longo do tempo — alinhar essa expectativa com o usuário.
- Nenhum dos 51 "cheapest_refuting_experiment" foi executado ainda — todo o
  ranking é pesquisa de mesa, não evidência observada.

## Decisão do usuário: requisito de automação total (CRÍTICO, muda critério)
Resposta literal do usuário: "será algo que você vai criar, você vai montar e
você vai deixar tudo automático sem eu precisar fazer nada, apenas ajudar na
criação". Ou seja: o usuário não fará vendas, atendimento, entrega ou
qualquer trabalho manual recorrente — só ajuda em passos de criação
(aprovações, contas, credenciais). Isso é um FILTRO NOVO sobre o ranking
existente: não basta o mecanismo ter boa demanda/evidência, o loop inteiro
(aquisição de cliente, entrega, cobrança, suporte) precisa ser executável por
agente/código, não por humano. Mecanismos como #1 (Agência PME) e #3 (gigs
Fiverr/Upwork) dependiam de venda/relacionamento humano no desenho original —
precisam ser re-testados especificamente nessa dimensão antes de avançar.
Segunda decisão do usuário: manter a métrica estritamente em US$200 (não
inflar para "validação de negócio com capital futuro").

## Teste de automação total nos top 4 — CONCLUÍDO (achado estrutural importante)
Resultado (ver [[automation_fit_top4]]): **nenhum dos top-4 passa
integralmente**. #1 (Agência PME) e #2 (Agente WhatsApp) — PARCIAL, falham no
ponto crítico (prospecção/fechamento de venda B2B local exige humano hoje,
com dados reais de 2026 confirmando isso). #3 (Gigs Fiverr/Upwork) —
INCOMPATÍVEL (ToS proíbe operação autônoma sem clique humano, risco de
banimento). #4 (SaaS via Stripe) — PARCIAL, gargalo é aquisição paga de
usuários (risco de estourar o limite de US$10/experimento em ads sem
retorno).

**Padrão estrutural**: todos os quatro falham pelo mesmo motivo raiz —
conseguir o primeiro cliente pagante sem venda relacional humana. Isso muda
o critério de busca para a próxima rodada: precisa ser "boa demanda + capital
≤US$200 + **distribuição embutida em canal self-serve/marketplace, sem venda
relacional**" (ex.: computação ociosa em marketplace tipo Vast.ai, APIs em
diretório self-serve tipo RapidAPI, produtos digitais em marketplace com
busca própria, afiliados via conteúdo orgânico). #1 e #2 ficam arquivados
(não eliminados) caso o requisito de "zero trabalho humano" mude no futuro.

## Lote 3 (computação ociosa, revenda de APIs, produtos digitais, afiliados orgânicos) — completo
4/4 agentes, 20 mecanismos, ~398k tokens de subagente. Ver
[[registry_round3_partial]] e `research/round3_raw_partial.json`.

**Achado estrutural mais importante da missão até agora**: existe uma troca
real e consistente entre os dois requisitos do usuário. Mecanismos com boa
evidência de retorno (lote 2) exigem venda relacional humana. Mecanismos
genuinamente zero-trabalho (lote 3) tendem a ser comoditizados/comprimidos
(Vast.ai: eletricidade residencial BR pode superar a receita bruta de GPUs
de entrada), muito lentos (afiliados orgânicos: 9-18 meses até receita
relevante; produtos digitais: 65% dos vendedores Etsy faturam <US$100/ANO),
ou com dado de retorno insuficiente para confiar (MCP servers: <5% geram
qualquer receita). **Nenhum mecanismo encontrado até agora é
simultaneamente zero-trabalho + rápido + com retorno bem evidenciado** — o
que é consistente com a "realidade obrigatória" da missão, não uma falha de
busca.

Total acumulado: **91 mecanismos brutos em 14 de 24 famílias.**

## Decisão do usuário (reforçada): mínimo de interação, eu decido e construo
Resposta: "tudo é você que vai fazer, eu vou ter que ter o MÍNIMO de
interação... tem que escalar e subir esses 200 rapidamente não importa o que
seja". Interpretação: mínimo (não zero) de interação aceitável; ênfase forte
em velocidade/escala. Decisão tomada (não vou mais perguntar qual mecanismo
— já pesquisamos o suficiente, hora de construir): **sistema de produção em
portfólio** — gero e publico continuamente pequenos produtos/ferramentas
digitais em marketplaces self-serve (Etsy, Gumroad, Apify Store, RapidAPI,
Adobe Stock), sem venda relacional, reinvestindo lucro em mais volume
(alavanca real encontrada na pesquisa: taxa de sucesso por item é baixa,
então quantidade de tentativas é o que move a agulha). Caixa ocioso sempre
rende via conta Pix remunerada (~14% a.a., piso automático). MANTIVE a
calibração honesta: nenhum mecanismo legal sobe "rápido" — isso foi dito ao
usuário uma vez, não vou repetir a cada mensagem.

**Limite que não é escolha minha, é regra da minha própria plataforma**: não
posso criar contas nem inserir credenciais/senhas em nome do usuário. Isso
define o mínimo de interação real necessário (setup único, não recorrente).

## FASE MUDOU: de pesquisa para construção (VEREDITO: RESEARCH_IN_PROGRESS,
## infraestrutura em construção, zero dinheiro real)
Construído e testado nesta sessão (código real, sem mocks, 9/9 testes
passando via `npm test`):
- `system/ledger/ledger.mjs` — ledger append-only encadeado por hash, um
  arquivo por ambiente (research/simulation/paper/shadow/canary/production/
  audit), `verifyChain()` detecta adulteração.
- `system/risk-gate/risk-gate.mjs` — trava obrigatória antes de qualquer
  ação com dinheiro real; nunca se autoaprova (exige `approvedByUser===true`
  vindo de confirmação explícita do usuário); bloqueia por: falta de
  aprovação, valor acima de US$10/experimento, menção a alavancagem, perda
  diária/acumulada atingindo os limites de RISK_LIMITS.md. Toda checagem
  (aprovada ou bloqueada) fica auditada no ledger `audit`.
- `checkpoint/risk_limits.json` — espelho legível-por-máquina dos limites.
- Git inicializado em `C:\Users\Renan\ZeroToOne` (versionamento real).

## Primeiro produto do pipeline: br-series-fetcher (construído, testado, NÃO publicado)
Enquanto o usuário cria as contas (Gumroad, Apify Store), construí o
primeiro candidato real: `system/product-pipeline/products/br-series-fetcher/`
— actor Apify que busca séries do SGS/Banco Central (Selic, CDI, câmbio,
IPCA) com fatiamento automático de intervalo (contorna o limite de volume
que o BCB passou a aplicar em março/2025) e retry que valida a FORMA da
resposta, não só o status HTTP (pego em produção nesta sessão: a API do BCB
devolveu 200 com corpo não-array uma vez, transitoriamente — o teste pegou
isso e o retry foi corrigido para tratar).

**Decisão adversarial importante durante a construção**: a primeira ideia
era agregar a BrasilAPI (CEP/CNPJ). Abortei antes de escrever código de
produção porque a BrasilAPI proíbe explicitamente "requisições em loop" nos
seus termos — incompatível com um actor de consulta em lote. Migrei para os
dados abertos oficiais do Banco Central (dadosabertos.bcb.gov.br), sem essa
restrição documentada. Isso é exatamente o tipo de ataque adversarial que a
missão pede — aplicado durante a construção, não só na pesquisa.

Testes: 6/6 passando, incluindo 4 testes de integração contra a API real do
BCB (não mocks) — um deles prova o valor-agregado central (busca >365 dias,
concatena 3+ blocos, sem duplicar/desordenar datas). Ver
`system/product-pipeline/README.md` para a estratégia de portfólio completa
e `products/br-series-fetcher/README.md` para o texto de listagem.

Ainda falta para publicar: `npm install` do SDK oficial `apify` dentro do
diretório do produto, e `apify push` — ambos exigem a conta Apify do
usuário, que está em criação.

## Usuário rejeitou br-series-fetcher: "não tenho CNPJ" + "desempenho fraco"
Esclarecimento: nem Apify Store nem Gumroad exigem CNPJ (pagam pessoa física,
carnê-leão) — o CNPJ só aparecia em candidatos já descartados antes
(correspondente bancário Pix, revenda WhatsApp BSP). Mas o ponto real do
usuário era desempenho: a categoria "produto/ferramenta self-serve" tem
retorno baixo/incerto por natureza (confirmado no lote 3), e ele está certo
em recusar isso como aposta principal. br-series-fetcher fica arquivado
(código funcional, sem CNPJ necessário, pode voltar como uma aposta pequena
de portfólio depois, não como prioridade).

## Lote 4 (crédito/renda fixa automatizável sem CNPJ) — completo, achado
## mais importante da missão até agora
12 mecanismos, ~263k tokens. Ver [[registry_round4_partial]] e
`research/round4_raw_partial.json`. **Depois de 111 mecanismos em 17
famílias (4 rodadas), NENHUM candidato supera o piso de ~14% a.a. (Pix
remunerada/Selic) por margem que sobreviva a ajuste honesto de risco, com
US$200, sem CNPJ, sem trabalho humano recorrente:**
- Crédito P2P regulado (SCD/SEP): sem FGC, diversificação impossível com
  este capital (só 1-2 tomadores financiáveis), líquido ajustado por risco
  ≈ 13-15% a.a. — empata com o piso, não supera.
- LCI/LCA, debêntures incentivadas, FI-Infra: líquido tipicamente ABAIXO do
  piso de 14%.
- Fiagro: supera nominalmente (12,7-19,6%) mas é prêmio de risco de crédito
  agro documentado, não vantagem livre.
- CDB de banco médio com FGC (candidato mais forte): no uso realista
  (liquidez diária, resgates frequentes) fica ABAIXO do piso (~11,85%
  líquido); só supera por 0,18 p.p. se travar capital por 2+ anos — o que
  contradiz liquidez diária e automação de rebalanceamento. Risco de cauda
  real e recente: BC liquidou o Banco Master em 18/11/2025 (pagava CDB
  acima da média); mesmo com FGC, 4-6 semanas de capital congelado, e
  incerteza sobre cobertura de entidades ligadas ao banco quebrado.

**Isso não é falha de busca — é a "realidade obrigatória" da missão
(nenhum método legítimo garante US$200 subirem rápido) confirmada
numericamente 4 vezes seguidas.** Momento de reportar ao usuário com
honestidade total, não lançar mais um lote esperando resposta diferente.

## Próxima ação
Apresentar este veredito consolidado ao usuário de forma direta (não mais
uma pergunta de múltipla escolha genérica) e propor: (a) aceitar o piso
(~14-16% a.a., CDB/Pix com FGC, 100% automatizável em aporte, zero risco de
CNPJ) como o "sistema real rodando sozinho" — modesto mas honesto e
verificável; (b) reconsiderar CNPJ especificamente via MEI (gratuito,
~10 min, sem contador obrigatório, diferente de Ltda/SLU) para reabrir
candidatos do lote 2 com melhor retorno mas que exigem formalização; (c)
aceitar algum grau mínimo de aprovação pontual (não venda manual, só
cliques de aprovação) para desbloquear os candidatos de melhor retorno do
lote 2 (agência PME, agente WhatsApp). Não decidir sozinho — é escolha de
risco/prioridade do usuário.

## Custos consumidos
- US$ 0,00 em dinheiro real (nenhum gasto)
- Créditos trader-dev: 0 de 1000 usados
- Uso de sessão: lote 1 bateu no limite (reset 5:20pm America/Sao_Paulo,
  23/08/2026), ~265k tokens de subagente (6/26 agentes completos). Lote 2
  rodou sem bater no limite, ~387k tokens de subagente (4/4 completos).

## Resultados
Ver [[registry_round1_partial]] e [[registry_round2_partial]].
