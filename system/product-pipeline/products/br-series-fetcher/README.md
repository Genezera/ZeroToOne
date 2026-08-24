# BR Series Fetcher — texto de listagem (Apify Store)

**O que faz**: busca séries temporais oficiais do Banco Central do Brasil
(Selic, CDI, câmbio, IPCA, e qualquer outro código do catálogo SGS) e
devolve dados limpos e normalizados — sem lidar com o formato de data
brasileiro, vírgula decimal, ou o limite de volume por consulta que o BCB
passou a aplicar em séries históricas longas desde março/2025 (este actor
fatia automaticamente o intervalo pedido em blocos e concatena o resultado).

**Fonte dos dados**: API pública oficial do Banco Central
(dadosabertos.bcb.gov.br / api.bcb.gov.br), publicada como dado aberto de
governo. Não é scraping, não depende de um agregador comunitário terceiro —
checamos isso deliberadamente antes de construir (ver nota abaixo).

**Por que alguém pagaria por isto, existindo uma API gratuita por trás?**
Porque a API crua exige lidar com fatiamento manual de datas para séries
longas, formato de data BR, valores como string com vírgula, e não tem
metadados amigáveis por código. Isso é o mesmo motivo pelo qual centenas de
"wrappers" de APIs gratuitas já vendem no Apify Store/RapidAPI: conveniência,
integração pronta com pipelines existentes (dataset do Apify, agendamento,
exportação), e confiabilidade (retry automático com validação de formato de
resposta, não só status HTTP — implementado depois de pegar uma falha
transitória real da API do BCB durante o desenvolvimento).

**Honestidade sobre o mercado**: a pesquisa que embasou este produto (ver
`research/registry_round3_partial.md` no repositório) encontrou que a
maioria dos listings novos de wrapper de API sem divulgação externa recebe
tráfego perto de zero — isto é um "bilhete de loteria" de baixo custo dentro
de uma estratégia de portfólio, não uma aposta isolada com expectativa alta.

**Nota sobre a escolha da fonte**: a primeira versão deste produto ia
agregar a BrasilAPI (CEP, CNPJ e outros). Abortamos essa direção porque a
BrasilAPI proíbe explicitamente "requisições em loop"/scraping automatizado
nos seus termos — incompatível com um actor de consulta em lote. Migramos
para os dados abertos oficiais do BCB, que não têm essa restrição
documentada.

**Preço sugerido**: pay-per-event (ex.: US$0,001–0,005 por linha de dado
retornada), seguindo o padrão comum de actors de dados no Apify Store.

**Status**: código testado (6/6 testes, incluindo 4 testes de integração
contra a API real do BCB, ver `test/lib.test.mjs`). Ainda NÃO publicado —
falta `npm install` do SDK do Apify e `apify push` com a conta do usuário.
