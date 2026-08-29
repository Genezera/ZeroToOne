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

## Usuário pediu trading rápido/frequente ("centavos, minutos, segundos",
## win rate alto, sempre no verde) + autorização para trabalhar sozinho
Recusei explicitamente implementar "se ficar no vermelho, se esforçar mais
para voltar ao verde" — é martingale/perseguir prejuízo, proibido desde o
início da missão pelo próprio usuário. Cliente confirmou estar liberado a
decidir e agir sozinho ("vou tomar um banho"). Sem trade real/dinheiro real
sem aprovação — mantido.

## Experimento 1 — RODADO DE VERDADE, veredito REJEITADO (3ª confirmação
## independente da mesma conclusão)
Usei a plataforma trader-dev (já autenticada, dados reais Bybit BTC
perpétuo) para testar ao vivo exatamente o que foi pedido. Ver
[[exp01_scalp_vs_trend_bybit_btc]] e ledger `research` (5 entradas,
hash-chain íntegro, `system/ledger/ledger.research.jsonl`).

- **Scalp EMA9/21+RSI+ATR 15m** (a estratégia pedida: rápida, frequente):
  -38,5% em 4 meses, -67,3% em 12 meses. Win rate ~25-26%. 529-1605 trades.
  Comissão real sozinha consumiu 33-67% do capital. Rejeitada nas duas
  janelas — não é falta de sorte, é estrutural (alta frequência × sem edge
  suficiente × comissão real).
- **SMA50/200 4h** (comparação, lenta): +93,8% em 36 meses parece ótimo, MAS
  dividido em treino (2023-08 a 2025-02: +84,8%) e teste out-of-sample
  (2025-02 a 2026-08: **-15,2%**) — inverte de sinal. Mesma armadilha que o
  Snowball já documentou (100% consistente → 15% fora da amostra). Mesmo no
  período bom, drawdown de 47% (long no vermelho, não "sempre verde").

**Isso é a 3ª confirmação independente da mesma conclusão** (AurumOS: 9,8M
sinais, 0 aprovados; pesquisa desta sessão: 111 mecanismos, 17 famílias,
nada bate o piso de 14%; agora: backtest ao vivo, 5 testes reais, scalp
rejeitado nas 2 janelas, tendência lenta só "funciona" com curve-fit). Não
existe, com ferramentas e capital de US$200 hoje, uma estratégia de trading
rápido/frequente com lucro líquido consistente para varejo.

## Varredura ampla (11 moedas) — CONFIRMAÇÃO FINAL, 17 backtests reais no total
Usuário pediu para não focar só em BTC / achar "a oportunidade que ninguém
explorou". Recusei a moldura de "moeda secreta vai bombar" (é aposta, não
estratégia — mesmo padrão que AurumOS já refutou). Testei honestamente:
mesma estratégia de reversão à média em 11 moedas líquidas diferentes
(BTC, ETH, SOL, XRP, BNB, ADA, LINK, AVAX, LTC, DOGE, PEPE), mesma janela.
**11 de 11 negativas, faixa estreita -56% a -76%.** Consistência = evidência
de causa estrutural (custo de transação × frequência de trade), não azar
de ativo específico. Ver [[exp01_scalp_vs_trend_bybit_btc]] (atualizado) e
ledger `research` (17 entradas de backtest agora).

**17 backtests reais rodados nesta sessão, mais AurumOS (9,8M sinais) e 111
mecanismos de pesquisa de mesa — toda evidência aponta na mesma direção
para trading rápido/frequente de varejo: sem vantagem líquida.**

## Sistema de market making em SHADOW — CONSTRUÍDO, TESTADO, RODANDO
Usuário aprovou construir a última avenida de "ganho frequente" não
testada: market making de verdade (spread capture, não direção de preço).
Ver `system/market-maker/README.md`.

- `inventory.mjs`, `quoting-engine.mjs`, `fill-simulator.mjs`: lógica pura,
  16/16 testes passando. Trava de risco embutida (nunca cota do lado que
  aumenta posição no limite; sem parâmetro de PnL/histórico — estruturalmente
  impossível virar martingale, garantia testada).
- `shadow-runner.mjs`: conecta no WebSocket PÚBLICO da Bybit (sem conta,
  sem chave de API, sem dinheiro real), verificado manualmente com dados
  reais de BTC fluindo corretamente. Registra cada fill simulado e
  snapshots periódicos no ledger `shadow` (`ledger/ledger.shadow.jsonl`).
  Reconecta sozinho com backoff. Kill switch simulado no mesmo limite de
  RISK_LIMITS.md (-US$10).
- **Rodando em background agora** (task b0ndm5sgk, spread 3bps, snapshot a
  cada 2min, símbolo BTCUSDT), coletando evidência real continuamente.
- **Limitação honesta que precisa ser lembrada sempre**: fill simulado
  assume prioridade de fila favorável — resultado positivo aqui é evidência
  fraca, não prova. Precisa validar contra fills reais em demo/testnet
  antes de qualquer dinheiro real, e amostra estatística suficiente
  (Snowball exigia >=25 episódios) antes de qualquer veredito.

## Sistema de composição diária (daily-floor) — CONSTRUÍDO, TESTADO, AUTOMATIZADO DE VERDADE
Ver `system/daily-floor/README.md`. 18/18 testes (16 puros + 2 de
integração real contra a API do BCB). Primeira rodada real: US$200,00 →
US$200,0841 em 1 dia (Mercado Pago 105% CDI, CDI real de hoje 0,05166%/dia).
**Automatizado via Windows Task Scheduler** (tarefa `ZeroToOne_DailyFloor`,
todo dia às 9h05) — diferente do market-maker (que depende de um processo
em background continuar vivo e já foi derrubado 2x por reinício de
sessão), isto roda no nível do sistema operacional e sobrevive a qualquer
reinício. Verificado rodando de ponta a ponta via `Start-ScheduledTask`
(LastTaskResult=0).

## Estado consolidado — AMBOS OS SISTEMAS AGORA RODAM COMO PROCESSOS DO
## WINDOWS, INDEPENDENTES DA SESSÃO DO CLAUDE (2026-08-26)
1. **daily-floor**: positivo, verificado, tarefa agendada diária (9h05).
   Modesto (~US$0,08-0,10/dia sobre US$200).
2. **market-maker shadow**: tarefa agendada com gatilho repetitivo a cada
   5min + `MultipleInstances=IgnoreNew` (auto-relança se cair, ignora se já
   estiver rodando) — migrado depois de cair 2x como processo solto em
   background da sessão. PID confirmado rodando de forma independente
   (verificado via `tasklist`). Dados reais acumulando; amostra ainda
   pequena demais para qualquer veredito.

**Nota técnica**: `Register-ScheduledTask` com gatilho `AtStartup` ou
`AtLogOn` deu "Acesso negado" (exige elevação que não tenho e não vou
pedir). Gatilho de repetição por horário (`-Once -RepetitionInterval`)
funciona sem elevação e cumpre o mesmo papel de "sempre religar".

## Regra nova (2026-08-26): liquidez total, sempre
Usuário confirmou requisito permanente: precisa poder parar tudo e ter o
capital inteiro disponível a qualquer momento. Adicionado a
RISK_LIMITS.md/risk_limits.json (`requireInstantLiquidity`,
`maxLockupDays: 0`) e **aplicado de verdade no código**: `risk-gate.mjs`
agora exige `lockupDays` explícito em toda chamada de dinheiro real e
bloqueia qualquer valor > 0 — nunca assume liquidez por padrão. 11/11
testes do risk-gate passando (2 novos cobrindo a regra).

Efeito retroativo: desqualifica o achado "CDB de banco médio supera o piso
segurando 2+ anos" do lote 4 (retorno melhor, mas trava capital — não
serve mais). O `daily-floor` (contas remuneradas D+0/D+1) já atendia essa
regra por construção, confirmado no README. Market-maker: sacar de
exchange cripto para conta real NÃO é instantâneo — fricção documentada,
a medir antes de qualquer dinheiro real ali.

## Terceiro sistema automatizado: pipeline de bug bounty (2026-08-26)
Usuário pediu automação completa do bug bounty, minimizando custo — só
"pensar" (IA de verdade) quando houver um candidato genuíno, ficar em
standby o resto do tempo. Construído em dois estágios, ver
`system/bugbounty-scanner/README.md`:

1. **Scanner local** (grátis, Windows Task Scheduler, diário 7h15) — busca
   código real, roda heurísticas de texto, só grava na fila o que for
   novo. Testado: acha exatamente o achado real de hoje (`set-token-uri`),
   não gera ruído nos contratos já confirmados seguros.
2. **Agente de nuvem** (custo real, só quando há trabalho) — routine
   `trig_01QQeYvKRi9qJD4QkzkbqsSe`
   (https://claude.ai/code/routines/trig_01QQeYvKRi9qJD4QkzkbqsSe),
   disparada por **webhook de push no GitHub** (evento real, não só
   relógio) + cron diário de segurança (11h15 UTC). Primeiro passo do
   agente: checar se há pendente; se não, encerra na hora (custo mínimo).

**Infraestrutura nova que isso exigiu**: repositório GitHub privado criado
(`https://github.com/Genezera/ZeroToOne`, via `gh` CLI já autenticado como
Genezera) — histórico local inteiro enviado. Usuário conectou GitHub App
do Claude em https://claude.ai/customize/connectors (dois passos
necessários: autorização OAuth E instalação do GitHub App com acesso ao
repo — só a instalação dá acesso real, a autorização OAuth sozinha não).

Disparei uma rodada de teste manual (`RemoteTrigger action:"run"`,
session_id `cse_014E5i7hcrecDdH3u8gEp14E`) para validar o pipeline
completo contra os 3 itens pendentes reais na fila — confirmado fazendo
investigação real (lendo NOTES.md, código, buscando contratos
relacionados via API do Hiro para verificar a cadeia de chamada, não só
respondendo de forma superficial). **Webhook confirmado funcionando de
verdade**: o push seguinte (checkpoint/README) disparou uma SEGUNDA
sessão automaticamente (`cse_01DgJnXaBJvca4T6sxqa8HNc`), sem qualquer
ação manual — evento real, não só o cron de segurança.

## Rodada de teste do agente de nuvem — CONCLUÍDA
As 3 sessões disparadas (1 manual + 2 por webhook real de push) revisaram
os 3 candidatos pendentes com rigor genuíno (uma delas até achou e leu um
laudo de auditoria profissional de terceiros via WebSearch quando a API
principal foi bloqueada pela política de rede da nuvem). Resultado: 2
falsos positivos (garantia da própria linguagem Clarity: `stx-transfer?`
só move fundos de `tx-sender`, nível de consenso, não precisa de checagem
extra), 1 real mas não-pagável (mesmo achado de `set-token-uri` já
documentado). Nenhum relatório rascunhado. Conflito de git entre as 3
sessões concorrentes foi resolvido corretamente por elas mesmas (diff
contra base comum, merge seguro). Pipeline validado de ponta a ponta.

## Decisão: verificação de identidade do Immunefi PAUSADA (2026-08-26)
Tentamos verificar a conta (pré-requisito pra submeter relatórios) via
Human Passport (grátis, mas baseado em pontos — precisa de 25). Carteira
Exodus conectada com sucesso (endereço EVM verificado). Stamps grátis
coletados: Discord 2,8 + LinkedIn 1,5 + Google 0,5 + Steam 2,8 = **7,6 de
25 pontos** — GitHub falhou (atividade insuficiente, só 1 dia de commit,
precisa de 30). O resto das opções gratuitas se esgotou; as que sobram
exigem documento oficial, biometria, ou taxa em ETH (que nem temos, só
BNB/BSC). A alternativa "Skin in the game" (pagar pra pular a pontuação)
custa **US$100 em USDC — metade do capital da missão inteira e 10x o
limite máximo por experimento (US$10) do RISK_LIMITS.md**.

**Decisão**: NÃO gastar isso agora, sem nenhum bug confirmado pra
submeter. Pausar a verificação de identidade. O pipeline automático
(scanner local + agente de nuvem) continua rodando de graça, sozinho, sem
depender disso. Revisitar a verificação SÓ quando/se o pipeline confirmar
um bug real e pagável — nesse momento a conta de custo-benefício muda
completamente (US$100 pra destravar um bounty de milhares faz sentido;
US$100 especulativo sem nada pra submeter, não).

## Próxima ação
1. Deixar os três sistemas acumulando sozinhos — nenhuma ação pendente
   agora, nem minha nem do usuário.
2. Se o bug bounty confirmar algo pagável: revisitar a verificação de
   identidade do Immunefi (Human Passport com mais Stamps, ou pagar os
   US$100 — pedir aprovação explícita antes de qualquer gasto real,
   mesmo que o achado pareça justificar).
3. Verificar periodicamente `ledger/ledger.shadow.jsonl`,
   `ledger/ledger.paper.jsonl`, `logs/daily-floor.log`,
   `logs/market-maker-shadow.log`, `logs/bugbounty-scanner.log`, e a
   página da routine para o histórico do agente de nuvem.

## Custos consumidos
- US$ 0,00 em dinheiro real (nenhum gasto)
- Créditos trader-dev: 0 de 1000 usados
- Uso de sessão: lote 1 bateu no limite (reset 5:20pm America/Sao_Paulo,
  23/08/2026), ~265k tokens de subagente (6/26 agentes completos). Lote 2
  rodou sem bater no limite, ~387k tokens de subagente (4/4 completos).

## Resultados
Ver [[registry_round1_partial]] e [[registry_round2_partial]].

## PIVÔ TOTAL: projeto muda para 100% bug bounty (2026-08-28)
Decisão explícita do usuário: abandonar os sistemas de crescimento de
capital (`daily-floor`, `market-maker`) — ambos arquivados (código mantido
como histórico, tarefas agendadas desativadas, ver notas de arquivamento
em cada README). Todo esforço futuro vai para o pipeline de bug bounty,
que vira um "centro de operações" totalmente automatizado.

Requisitos confirmados: (1) aprendizado = retroalimentação de veredito
(registrada/revisável, não caixa-preta) + base de conhecimento de CVEs
reais + IA que rastreia cadeia de chamada entre arquivos, não só arquivo
isolado; (2) descoberta automática de alvo novo (não mais só curadoria
manual); (3) só análise estática + revisão por IA, **sem teste
dinâmico/execução de código** (risco de violar regra de programa); (4)
respeito rigoroso ao escopo/categoria elegível que cada empresa declara;
(5) relatórios gerados pela IA precisam ficar completos o bastante pro
usuário só copiar/colar/enviar (envio em si é manual — IA não pode
submeter, regra da plataforma).

Plano completo (6 lotes) em `C:\Users\Renan\.claude\plans\snuggly-mixing-sketch.md`
(arquivo local, fora do repo git). Lote 1 (arquivar) e Lote 2 (id/language
estáveis, `verdict-stats.mjs`, painel `STATUS.md`, ledger de veredito,
reativar tarefa agendada) aprovados e em execução nesta sessão. Lotes 3-6
(dependência/CVE via OSV.dev, agente de nuvem com cadeia de chamada +
template de relatório, descoberta de alvo, digest de notícias/CVE) cada um
volta pra alinhamento próprio antes de construir, mesmo padrão já usado
pra Vercel e Block Open Source.

**Achado operacional durante o pivô**: a tarefa `ZeroToOne_BugBountyScanner`
estava desativada (efeito colateral de uma rodada anterior de "pare tudo
agora" sem ressalva) — reativada como parte do Lote 2, já que é
pré-requisito óbvio pro "centro de operações" funcionar sozinho.

## Painel visual + Lote 3 concluídos (2026-08-28)
Usuário pediu explicitamente um painel visual "completamente
personalizado, com efeitos, animações incríveis, profissional" mostrando o
sistema em tempo real, além de continuar até tudo funcional. Construído:

- **`generate-dashboard.mjs`**: painel HTML autocontido (`research/
  bugbounty/dashboard.html`), regenerado a cada rodada — tema "Centro de
  Sinais" (estação de sinal/radar, paleta e tipografia específicas,
  validadas contra os critérios de acessibilidade do skill de dataviz, não
  o clichê "hacker verde-neon"). Publicado como Artifact
  (https://claude.ai/code/artifact/f16d79bf-96b6-48f2-9f0b-59dc9ddb7d71) —
  documentado com honestidade que é um INSTANTÂNEO daquele momento, não
  dado ao vivo (repo é privado, página pública não pode ler sem expor
  credencial). O arquivo local sim reflete sempre a última rodada.
- **Lote 3 (dependência/CVE via OSV.dev)**: `dep-scanner.mjs`. Confirmado
  ao vivo contra a API real: npm/Go/Maven suportados, **CocoaPods/SwiftPM
  NÃO** (erro "invalid ecosystem") — Swift fica fora deste módulo por
  limitação real da fonte, não escolha. Achado real e verdadeiro
  confirmado: `cashapp/hermit` (Block Open Source) usa
  `github.com/cloudflare/circl@v1.3.8` e `golang.org/x/crypto@v0.54.0`,
  ambos com vulnerabilidade publicada (GHSA-2x5j-vhc8-9cwm, GO-2026-5932).
  Dois bugs reais pegos e corrigidos durante a validação: (1) reusar
  `pathPrefixes` da varredura de código perdia quase todo manifesto real
  (manifesto fica na raiz do módulo, fora da pasta restrita escolhida pra
  heurística) — corrigido, varredura de dependência agora ignora
  `pathPrefixes`; (2) `wire-gradle-plugin/src/test/projects/*/build.gradle`
  gerava falso-positivo (fixture de teste de compatibilidade de plugin,
  não dependência real) — corrigido com exclusão de diretório de teste,
  coberto por teste novo.
- 72 testes passando no total. Rate limit anônimo do GitHub (60/hora)
  esgotado pelos meus próprios testes repetidos em sequência nesta sessão
  — não é bug, reseta sozinho, cadência real (1x/dia) nunca chega perto
  disso.

Faltam: Lote 4 (agente de nuvem — cadeia de chamada + conformidade de
escopo + template de relatório pronto-pra-copiar), Lote 5 (descoberta
automática de alvo), Lote 6 (digest de notícias/CVE, menor prioridade).

## Painel reconstruído + Lotes 4, 5, 6 concluídos — TODOS OS LOTES DO
## PIVÔ CONCLUÍDOS (2026-08-28)
Usuário rejeitou o painel de página única ("não é centro de sinais, eu
quero completamente algo completamente detalhado") e pediu pra seguir por
todos os lotes restantes sem pausar pra reportar, só ao final. Executado:

**Painel reconstruído como site multi-página** (`generate-dashboard.mjs`):
5 páginas ligadas em `research/bugbounty/dashboard/` — Visão geral, Alvos
(card por repositório com escopo/teto), Fila completa (TODO achado, com
filtro por status/programa/linguagem e o raciocínio integral de cada
revisão, sem truncar), Atividade ao vivo (histórico cronológico completo
do ledger — toda rodada de scan, todo veredito, toda descoberta, todo
digest, desde o início da sessão), Estatística. Mantém o tema "Centro de
Sinais" (paleta/tipografia já validadas), só muito mais profundo.

**Lote 4**: `research/bugbounty/reports/TEMPLATE.md` criado (checklist de
revisão humana, categoria mapeada ao que o programa paga de verdade,
cadeia de chamada, evidência, passo a passo). Prompt do agente de nuvem
atualizado via `RemoteTrigger` — generalizado além de Clarity/Immunefi
(cobre os 3 programas/5 linguagens), exige confirmação de alcançabilidade
pra achado de dependência (não só presença no manifesto — usa o caso real
do circl/hermit desta sessão como exemplo no próprio prompt), registra
`filesRead` como trilha de auditoria, usa o template novo.

**Lote 5**: `discover-targets.mjs`/`discovery-runner.mjs`. Rodada real:
194 alvos com recompensa real no dataset inteiro (HackerOne+Bugcrowd), 186
ainda não rastreados — inclui exatamente os outros 16 repos do Vercel que
eu tinha escolhido manualmente não rastrear. Só sugere
(`discovered-targets.json`), nunca escreve em `targets-*.mjs` sozinho.
Tarefa agendada própria `ZeroToOne_TargetDiscovery`, semanal (domingo
10h), isolada da diária pra não estourar limite de taxa do GitHub.

**Lote 6**: `cve-digest.mjs`/`digest-runner.mjs`, roda na mesma tarefa
semanal. Cruza GitHub Security Advisories só contra pacote que o
dep-scanner já achou vulnerável (não feed geral). Rodada real: achou 10
advisories reais pra `golang.org/x/crypto`, vários **críticos** (bypass de
autenticação SSH) que o OSV.dev sozinho não tinha capturado — sinal
genuinamente complementar. Nunca escreve heurística nova sozinho, só gera
`security-digest.md` pra decisão manual.

91 testes passando no total. Todos os 6 lotes do plano de pivô
(`C:\Users\Renan\.claude\plans\snuggly-mixing-sketch.md`) estão concluídos
e validados com dado real — não é código nunca testado, cada módulo rodou
de verdade contra os 3 programas reais pelo menos uma vez nesta sessão.

## "Melhor caminho": mais classes de bug, leitura profunda por IA, AST de
## verdade (2026-08-28/29)
Usuário pediu explicitamente pra buscar o caminho mais avançado possível
— "melhor detecção... isso tem que ser um caçador de bugbounty COMPLETO",
autorizando mudar linguagem/instalar dependência nova se justificasse.
Corrigi framing sobre "0-day" antes de construir: 0-day = vulnerabilidade
real ainda não divulgada (o sistema já pode achar isso, e achou coisas
reais nesta sessão), não "categoria de bug nunca antes imaginada" (isso é
pesquisa de ponta, não prometi). Não mudei a linguagem de implementação
(Node) — não é o gargalo real (rate limit de API e custo de IA são),
trocar seria retrabalho caro sem ganho. Três coisas construídas de
verdade:

1. **Mais classes de bug conhecidas por linguagem** — 7 heurísticas novas:
   JS/TS (`prototype_pollution_risk`, `ssrf_risk`, `path_traversal_risk`),
   Go (`sql_injection_risk`, `path_traversal_risk`), JVM
   (`sql_injection_risk`, `insecure_deserialization`). Validado contra
   código real: achou 15 candidatos novos reais em `vercel/flags` (13
   `ssrf_risk` em adaptadores de terceiro, 2 `prototype_pollution_risk`).
2. **Leitura profunda proativa por IA** (prompt do agente de nuvem
   atualizado via RemoteTrigger) — além de revisar a fila, o agente agora
   lê até 3 arquivos por rodada com nome sensível (auth/session/crypto/
   token/...) que ainda não leu (registrado em
   `research/bugbounty/deep-read-log.json`), procurando falha de lógica
   que NENHUMA heurística de texto pegaria — isso é o que de fato pode
   achar 0-day de verdade, porque usa julgamento, não padrão.
3. **Análise de fluxo de dado por AST real** (`heuristics-js-ast.mjs`) —
   primeira dependência npm real do projeto (`web-tree-sitter` + gramáticas
   `tree-sitter-javascript`/`typescript`/`tsx`, todas WASM prebuild, sem
   compilador C++ necessário). Rastreia se dado de fonte externa conhecida
   (`req.query`/`body`/`params`, `process.argv`) REALMENTE flui até um
   sink perigoso dentro da mesma função — evidência muito mais forte que
   heurística de texto. Limitação documentada: intraprocedural, não seguir
   ramificação complexa — deixado explícito, não escondido. 16 testes
   novos, incluindo confirmação de que a gramática TS/TSX de verdade é
   usada (não só tolerada pela gramática JS).

115+ testes passando (166 contando o projeto inteiro, incluindo sistemas
arquivados). `npm test` corrigido pra rodar tudo (`system/**/test/`), não
só `system/test/`.

## Estado consolidado do centro de operações (2026-08-28, fim de sessão)
4 tarefas agendadas do Windows, janela oculta (VBS wrapper), sobrevivem a
reinício: `ZeroToOne_BugBountyScanner` (diária 9h — scanner + retro-
alimentação + dependência/CVE + painel), `ZeroToOne_TargetDiscovery`
(semanal, domingo 10h — descoberta de alvo + digest de segurança).
`ZeroToOne_DailyFloor`/`ZeroToOne_MarketMakerShadow` seguem arquivados/
desativados (pivô pra 100% bug bounty). Nada pendente de ação — o sistema
roda sozinho a partir daqui.
