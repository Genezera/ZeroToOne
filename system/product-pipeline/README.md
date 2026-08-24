# product-pipeline/ — fábrica de candidatos a produto/ferramenta

Estratégia de portfólio: a pesquisa (lote 3) mostrou que a taxa de sucesso
por listagem individual em marketplaces self-serve é baixa (ex.: <5% dos
servidores MCP geram qualquer receita), então a alavanca real é quantidade
de tentativas de boa qualidade, não uma aposta única perfeita. Este
diretório é onde cada tentativa é gerada, testada contra dados/serviços
reais, e documentada honestamente antes de publicar.

## Regra de qualidade (não é "gerar volume de qualquer jeito")
Todo candidato antes de ir para `products/` precisa:
1. Ter fonte de lucro concreta e verificada (não "parece que alguém pagaria").
2. Checar termos de uso da fonte de dados/plataforma ANTES de construir — o
   primeiro candidato (BrasilAPI) foi abortado nesta etapa por proibir
   consultas em lote, ver `products/br-series-fetcher/README.md`.
3. Ter testes automatizados reais (sem mocks) rodando contra a
   API/serviço real, não dados inventados.
4. Ter uma descrição de listagem honesta, incluindo as limitações
   conhecidas — nunca prometer retorno.

## Candidatos

| Produto | Plataforma alvo | Status | Notas |
|---|---|---|---|
| `br-series-fetcher` | Apify Store | Código testado (6/6), aguardando conta Apify do usuário para publicar | Séries SGS/BCB (Selic, CDI, câmbio, IPCA), fonte oficial de dado aberto |

## Próximos candidatos a gerar (não iniciados)
- Produto para Gumroad (categoria "produtos digitais", sem dependência de
  API de terceiros — conteúdo 100% originado, menor risco de ToS).
- Mais 1-2 actors Apify Store em fontes de dados abertos oficiais
  diferentes (ex.: IBGE, dados.gov.br), reaproveitando o padrão de
  fatiamento/retry/validação já validado em `br-series-fetcher/lib.mjs`.
