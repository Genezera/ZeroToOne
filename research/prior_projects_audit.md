---
name: prior_projects_audit
descrição: Auditoria cética de AurumOS e Snowball, feita por subagentes, antes de
iniciar a pesquisa nova. Não reescrever — apenas anexar achados novos se os
projetos originais forem revisitados.
data_auditoria: 2026-08-23
---

# Auditoria — AurumOS (`C:\Users\Renan\Desktop\AurumOS`)

**Mecanismo perseguido:** orquestrador em Rust com 9 fontes de sinal paralelas
(arbitragem cross-exchange de cripto, "market making" por spread capture,
exaustão de pump, whale-watch, caça de liquidação, reação a filings SEC, radar
de novas listagens, calendário macro, e ações via Alpaca) alimentando um motor
central de risco/sizing por Kelly. Depois do fim do histórico commitado, há
trabalho não commitado (`docs/relatorios/ESTADO_ATUAL_E_PORQUE_18-08-2026.md`)
mostrando um pivô para **funding-rate carry** (spot+perp na Bybit) como única
estratégia "ativa", porque as famílias de previsão de preço tinham acabado de
ser estatisticamente refutadas.

**Dinheiro real:** ZERO. Confirmado repetidamente (README.md:27, relatório
"Retorno ao Norte" linha 21: "Capital real em risco: Zero"). Toda execução é
contra a Bybit Demo Trading (saldo fictício, mas livro/matching de produção
real — logs de fills, taxas e bugs são reais e não simulados).

**Resultado mais relevante (achado negativo honesto):** um torneio estatístico
rigoroso (correção FDR/Benjamini-Hochberg, walk-forward out-of-sample,
shrinkage empírico-Bayesiano) testou **9.835.461 sinais reais, 51.639 células
estatisticamente elegíveis, e aprovou ZERO** — refutando explicitamente toda a
família de sinais de microestrutura/preço testada. Um modelo de ML subsequente
achou uma correlação real porém minúscula fora da amostra (0,235 treino vs.
0,233 teste) que nunca superou custos de transação em nenhum limiar testado.

**Realidade de execução:** fill rate de ordens passivas (maker) medido em ~3%;
ordens a mercado perdem dinheiro para taxas taker (medido: -US$14,9 a -US$29,5
em ~2.000 fills reais fechados). O claim de "91,1% win rate / ~US$3.770 de
PnL" do paper trading é desmentido pelos próprios documentos do projeto como
não fisicamente reproduzível.

**Estado final:** sem commit de "concluído". Git para em 2026-08-13, mas há ~5
dias de trabalho não commitado (até 18/08) incluindo o achado mais importante
(refutação de 9,8M sinais) e o pivô para funding-carry, que está **bloqueado**
(não integrado ao motor central de ranking). Leitura: sessão interrompida no
meio do trabalho, não um veredito concluído.

**Reaproveitável:** rigor estatístico (FDR, walk-forward, shrinkage) em
`demo_v2/markouts.rs` / `candidate_probe.rs` / `pilot_tournament.rs`, e o motor
de risco (`risk.rs`) — disciplina incomum para um projeto solo. Reaproveitar
com cautela: estado git não commitado prejudica auditabilidade.

**Red flags:** nenhuma prática proibida encontrada. O projeto autorrefuta
resultados em vez de inflá-los — bom sinal de integridade, mesmo que o
resultado final seja "nenhuma vantagem encontrada" na família testada.

---

# Auditoria — Snowball (`C:\Users\Renan\Projetos\Snowball`)

**Mecanismo perseguido:** convergiu para **arbitragem de funding rate
delta-neutra entre exchanges** (long perpétuo numa exchange, short na outra,
capturando o diferencial de funding com exposição de preço cancelada por
construção) + uma perna spot-perp (cash-and-carry) de funding absoluto numa
única exchange. Fases anteriores testaram momentum direcional e pairs trading
cointegrados — ambos mantidos como experimentos "paper" secundários, mas
`docs/O-QUE-FALHOU.md` e CONTINUIDADE.md §10 documentam que previsão
direcional não entrega lucro semanal de forma confiável. Escopo reduzido de 6
exchanges (binance, bybit, okx, gate, bitget, bingx) para 2 (bybit+bitget).

**Dinheiro real:** ZERO, com evidência forte contra qualquer execução real —
"Nenhuma ordem foi enviada a nenhuma exchange, em nenhum momento deste
projeto" (repetido em 4 documentos). `.env.example` só tem campos de Telegram,
nenhuma chave de exchange. Grep por `apiKey`/`secret` no código-fonte: zero
resultados — ccxt conectado só a endpoints públicos de mercado.

**Status mais recente e autoritativo (CONTINUIDADE.md, 08/08/2026):** a
matemática do funding-arb é sólida (o notional se cancela; só taxas/spread/
duração decidem viabilidade), mas o "portão" para produção está majoritamente
fechado porque nenhum spread monitorado entre pares de exchanges atualmente
dura tempo suficiente para pagar seu próprio custo — descrito pelo próprio
projeto como "o portão funcionando, não uma falha". O auditor ao vivo retorna
`EVIDENCIA_INSUFICIENTE` para momentum e pairs (menos de 25 trades fechados) —
recusa deliberada de declarar vantagem sem dados suficientes.

**Perda documentada em paper trading:** 9 horas de operação, -US$2,30 (dólares
de papel), rastreada a 2 bugs reais (detecção de par "piscando" lendo gaps de
dados como inversões de spread; ausência de gate de payback — 0 de 8 posições
abertas foram lucrativas). Ambos os bugs foram corrigidos, segundo os docs.

**Validação fora da amostra:** mista mas rotulada com honestidade. Um sinal
"100% consistente" em backtest colapsou para 15% quando testado em 20 ações
não vistas — auto-identificado como falso positivo clássico pelo próprio
projeto, não escondido. `ts-momentum` teve p=0,008 mas só 9-13% de chance de
bater a meta e 15-45% de chance de perder capital.

**Custos reais:** nenhum documentado (nenhuma ordem real, nenhuma assinatura
paga encontrada).

**Reaproveitável:** motor de funding-arb (`src/funding/`,
`scripts/progression/forward-lab.cjs`), ledger de reconciliação com tolerância
zero, infraestrutura de scanner/vigilância, dashboard, supervisão de processo.
Aspiracional (não construído): todo o ROADMAP-MAXIMIZACAO.md fases 2-5
(scaling, produção, projeção de 10 anos a US$67k) — plano, não execução.

**Red flag a observar:** configs de paper usam alavancagem 5x
(`package.json`, `--alavancagem 5`). A missão atual exige **sem alavancagem**
— qualquer reaproveitamento do motor de funding-arb precisa remover isso.
Fora isso, nenhuma prática da lista proibida encontrada; o projeto
autocorrigiu dois episódios de over-claim (5381% e "100% consistente") via a
própria disciplina de holdout.

---

# Síntese para a missão atual

1. **Convergência independente é o sinal mais forte destes dois projetos**:
   ambos, isoladamente, refutaram sinais direcionais/microestrutura em cripto
   com rigor estatístico real, e ambos convergiram para **funding-rate/basis
   arbitrage delta-neutra** como a hipótese remanescente mais defensável — mas
   **nenhum dos dois validou essa hipótese com dinheiro real ou mesmo shadow
   suficiente**. Ambos pararam no mesmo ponto: "matemática ok, mas o spread
   atual observado não paga os custos com folga suficiente, e a amostra ainda
   é pequena."
2. **Não repetir**: pesquisa de sinais direcionais de cripto via
   microestrutura/momentum/padrões técnicos com ferramentas de varejo — já
   testado exaustivamente (9,8M sinais) e refutado. Não é uma boa aposta para
   uma nova rodada, a menos que surja uma fonte de dado ou ferramenta
   genuinamente nova.
3. **Reabrir com ceticismo**: funding-rate/basis arbitrage cross-exchange —
   vale re-testar com dados de HOJE (taxas, funding rates, liquidez atuais),
   já que essas condições mudam com o tempo, mas exigir amostra suficiente
   (>=25-50 episódios) antes de qualquer veredito, e nunca usar alavancagem.
4. **Reaproveitar código com auditoria, não confiança cega**: motor de risco
   do AurumOS e motor de funding-arb + ledger do Snowball são candidatos a
   reaproveitamento, mas precisam ser lidos linha a linha antes de confiar,
   por causa do estado git não commitado (AurumOS) e da alavancagem 5x nos
   configs (Snowball).
5. Nenhum dos dois projetos gastou dinheiro real ou violou as regras
   proibidas — good faith consistente, útil como base de confiança para
   reaproveitar sua disciplina metodológica (FDR, walk-forward,
   reconciliação, EVIDENCIA_INSUFICIENTE como veredito legítimo).
