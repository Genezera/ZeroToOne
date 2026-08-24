---
name: registry_round4_partial
status: completo — 3/3 agentes, 12 mecanismos, foco em crédito/renda fixa
  automatizável sem CNPJ, comparado numericamente contra o piso de ~14% a.a.
  Dados brutos em research/round4_raw_partial.json.
---

# Lote 4 — Crédito P2P regulado, renda fixa isenta, CDB/LCI de banco médio

Nenhum CNPJ exigido em nenhum dos 12 mecanismos (correção de um mal-entendido:
o CNPJ só era necessário em candidatos já descartados antes, não nesta
família). Mas o achado central é duro:

## Crédito P2P regulado (SCD/SEP — INCO, Oppens, Ulend, Biva, Nexoos)
Retorno bruto anunciado de 20-27% a.a. soa atrativo, mas:
- Com R$1.030 (~US$200) só dá para financiar **1-2 tomadores** — o oposto
  de diversificação, que é o que torna P2P defensável como estratégia
  (recomendação de mercado: 10-20+ tomadores, exigiria R$5.000-10.000+).
- **Sem cobertura do FGC** — a própria plataforma (Oppens) descreve como
  "alto risco... podendo resultar em perda parcial ou total do capital".
- Ajustando pelo cenário-base de inadimplência setorial (~3%, fonte: a
  própria plataforma, não confirmada de forma independente), o retorno
  líquido estimado fica em **13-15% a.a. — em cima ou marginalmente acima
  do piso de 14%**, ou seja, o prêmio de risco líquido para assumir risco de
  crédito não segurado é de 0 a 1 ponto percentual. Em cenário de estresse
  setorial (taxas de inadimplência documentadas de 28-50% em outras
  plataformas do mesmo tipo), a matemática vira claramente negativa.
- Ticket mínimo de plataformas voltadas a PME (Ulend, ~R$2.000) já é maior
  que todo o capital disponível — inviável de cara.
- **Achado operacional que pode desqualificar por si só**: não há
  confirmação de reinvestimento automático das amortizações mensais — pode
  exigir seleção manual recorrente de novo tomador a cada mês, o que
  violaria a exigência de "zero trabalho humano".

## Renda fixa isenta (LCI/LCA, CRI/CRA, debêntures incentivadas, fundos)
- LCI/LCA de banco médio (91-95% do CDI, isenta de IR): líquido ≈
  12,6-13,2% a.a. — **abaixo do piso de 14%**, mesmo sem imposto.
- Debêntures incentivadas, FI-Infra (BCDI11): yields distribuídos recentes
  também ficaram **abaixo do piso** na prática, apesar de metas nominais
  mais altas.
- Fiagro (recebíveis do agronegócio): único que supera nominalmente o piso
  com folga (12,7-19,6% a.a.), mas o próprio mercado descreve como tendo
  "risco de crédito bem mais elevado e suscetível a calotes" — não é
  almoço grátis, é prêmio de risco de crédito agro.

## CDB/LCI de banco médio com FGC (o candidato mais forte da rodada)
CDB a 100-120% do CDI, liquidez diária, garantia FGC até R$250 mil (bem
acima dos R$1.030 em jogo). Matemática honesta, calculada explicitamente:
- No cenário realista de uso de liquidez diária (resgates frequentes,
  IR a 22,5%): líquido ≈ **11,85% a.a. — abaixo do piso**.
- Só segurando 2+ anos (IR a 15%) no teto de mercado atual (120% CDI):
  líquido ≈ **14,18% a.a. — apenas 0,18 ponto percentual acima do piso**,
  e isso abrindo mão da liquidez diária, o que contradiz a própria proposta
  do produto e a ideia de rebalanceamento automatizado por script.
- **Risco de cauda real e documentado, não é "risco zero"**: o Banco
  Central liquidou extrajudicialmente o Banco Master em 18/11/2025 (banco
  que pagava CDB acima da média). Mesmo dentro da cobertura do FGC, há
  4-6 semanas de capital congelado sem render nada até o pagamento, e
  incerteza documentada sobre cobertura de CDBs de entidades ligadas ao
  banco quebrado — valores fora do teto entraram em processo de
  recuperação que pode levar 10-15 anos.
- Automação parcial, não total: não há confirmação de API de varejo pública
  para escolher/comprar o CDB de melhor taxa programaticamente — a escolha
  do emissor específico tende a ser manual (só o aporte recorrente é
  automatizável).

## Conclusão desta rodada (a mais importante da missão até agora)

Depois de **111 mecanismos em 17 famílias**, nenhum candidato encontrado
supera o piso de ~14% a.a. (conta Pix remunerada / Selic) por uma margem
que sobreviva a um ajuste honesto de risco, com capital de US$200, sem
CNPJ, e sem trabalho humano recorrente. Os que superam nominalmente
carregam risco de crédito/iliquidez real e nada desprezível (P2P sem FGC,
Fiagro). Os que têm proteção equivalente (CDB/LCI com FGC) empatam ou
perdem para o piso na prática, e mesmo a "vitória" de 0,18 p.p. exige abrir
mão de liquidez e viola parcialmente a automação total.

Isso não é uma falha de busca — é o resultado esperado pela própria regra
da missão ("nenhum método legítimo garante US$200 subirem rápido") aplicado
com rigor numérico repetido em 4 rodadas independentes.
