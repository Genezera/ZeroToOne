---
name: registry_round3_partial
status: completo — 4/4 agentes, 20 mecanismos, famílias com distribuição
  self-serve/marketplace. Dados brutos em research/round3_raw_partial.json.
---

# Lote 3 — Computação ociosa, revenda de APIs, produtos digitais, afiliados orgânicos

Estes mecanismos resolvem o problema encontrado no lote anterior (não
precisam de venda relacional — o comprador chega sozinho via marketplace/
matching/busca), mas revelam um problema novo e simétrico: **quase todos são
lentos, modestos ou com dado de retorno insuficiente para confiar.**

## Computação ociosa (5 mecanismos) — mais atrito que o esperado
- **Vast.ai (hospedagem de GPU)**: o mais bem documentado. Receita bruta
  estimada de US$25-130/mês por GPU de entrada/meio, MAS a análise honesta
  cruzou isso com tarifa de energia residencial brasileira (bem mais cara
  que a média dos EUA) — para GPUs de entrada rodando 24/7, o custo de
  eletricidade pode consumir a maior parte ou superar a receita bruta.
  Exige também ≥1 Gbps de upload, que a maioria dos planos residenciais
  brasileiros não oferece. Zero venda/atendimento (a plataforma cuida disso),
  mas monitoramento de hardware é trabalho humano recorrente residual real.
- **Salad, io.net/Akash, Render Network**: sem dado numérico líquido
  confiável e independente para 2026 — io.net acabou de reformular seu
  modelo econômico (junho/2026), tratar como não testado; Render Network tem
  demanda mais nichada e irregular.
- **Storage node (Storj/Filecoin)**: a própria pesquisa rotula como "não
  recomendado neste momento" — achado de risco de contraparte relevante o
  suficiente para tornar a avaliação de trabalho/retorno secundária.

## Revenda de APIs/ferramentas (5 mecanismos) — capital baixo, retorno incerto
RapidAPI Hub, Zyla API Hub, Apify Store, AWS/Azure/GCP Marketplace, servidor
MCP monetizado. Capital mínimo baixo (US$15-150). Achado mais concreto: **em
categorias saturadas (clima, IP lookup, câmbio), um listing novo sem
divulgação recebe tráfego orgânico próximo de zero** — faixa honesta
US$0-50/mês para a maioria, com minoria alcançando algumas centenas/mês em
nichos pouco disputados. Para servidores MCP, achado direto: **menos de 5%
dos servidores MCP publicados geram qualquer receita**. Zero venda/
atendimento recorrente de fato (a plataforma faz billing e distribuição), mas
retorno esperado é próximo de zero para a maioria dos publicadores solo.

## Produtos digitais em marketplace (5 mecanismos) — lento, mas real
Adobe Stock/Shutterstock, Etsy (downloads digitais), Canva Creators, Envato
Market (AudioJungle/GraphicRiver), Gumroad (autoavaliado "candidato mais
fraco da família" por depender do Discover interno, que tem alcance
limitado). Dados de terceiros (não oficiais, tratar como teto otimista):
Etsy — mês 1 tipicamente US$0-50, mês 6 US$200-500 *para lojas ativas*, mas
65% dos vendedores da Etsy faturam menos de US$100/**ano**; Adobe Stock —
~US$0,25-0,45 por imagem/mês, 6-12 meses até acumular US$1.000. Zero venda
direta, mas volume/portfólio maior ajuda muito, e portfólio maior por si só é
trabalho (ainda que não seja "venda").

## Afiliados com tráfego orgânico (5 mecanismos) — o mais lento de todos
Site de nicho com pSEO+IA, agregador de cupons, comparador de SaaS B2B,
canal "faceless" com afiliados, comparador de produtos financeiros via CPA.
Achado mais duro: **receita relevante realisticamente só depois de 9-18
meses** de operação/manutenção de conteúdo contínua (SEO tem lag inerente),
e nichos com CPC alto (sinal de competição) como comparadores financeiros já
são dominados por players estabelecidos (Serasa, Creditas, Cuponomia,
Méliuz, Pelando) — um novo entrante 100% automatizado tem alta probabilidade
de nunca rankear de forma relevante.

## Tensão estrutural encontrada (o achado mais importante deste lote)

Existe uma troca real entre os dois requisitos do usuário:
- **Mecanismos com boa evidência de retorno decente** (lote 2: agência PME,
  SaaS, gigs) exigem venda relacional humana ou aquisição paga arriscada.
- **Mecanismos genuinamente zero-trabalho-humano** (este lote 3) tendem a
  ser: comprimidos por competição/comoditização (APIs, GPU hosting já com
  preço achatado), MUITO lentos para gerar receita relevante (afiliados
  orgânicos, produtos digitais dependem de SEO/volume ao longo de meses), ou
  com dado de retorno insuficiente para confiar (a maioria "não verificado",
  "não há número líquido independente").

Nenhum mecanismo encontrado até agora é simultaneamente: zero-trabalho,
rápido, e com retorno líquido bem evidenciado. Isso não é uma falha da
pesquisa — é consistente com a "realidade obrigatória" da missão (nenhum
método legítimo garante US$200 subirem rápido). A pergunta real agora é:
dado esse trade-off genuíno, qual combinação o usuário prefere?
