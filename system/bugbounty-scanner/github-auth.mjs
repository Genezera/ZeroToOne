// Header compartilhado pra toda chamada à API do GitHub (api.github.com E
// raw.githubusercontent.com) neste projeto. Anônimo (sem GITHUB_TOKEN) cai
// no limite de 60 req/hora por IP -- confirmado ao vivo em 31/08/2026 que
// isso esgota de verdade num dia de uso normal (rodada de scan + descoberta
// + pesquisa manual de duplicata no mesmo dia já bateu 0/60). Um token
// pessoal, mesmo sem NENHUMA permissão/scope marcada (só precisa ler
// repositório público, que é anônimo por natureza), sobe isso pra 5.000/hora
// -- 83x. Mesmo padrão de credencial de todo o projeto (HACKERONE_API_TOKEN,
// TELEGRAM_BOT_TOKEN): só variável de ambiente do usuário, nunca escrito em
// arquivo.
//
// Sem GITHUB_TOKEN configurado, tudo continua funcionando exatamente como
// antes (anônimo, 60/hora) -- isso é estritamente aditivo, nunca um requisito
// novo.

export function githubHeaders(extra = {}) {
  const headers = { 'User-Agent': 'ZeroToOne-bugbounty-scanner', ...extra };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Descoberto ao vivo em 07/09/2026 (sessão cloud): GITHUB_TOKEN aqui não é
// o "token pessoal com acesso público amplo" do comentário acima -- é
// escopado só a genezera/zerotoone (fine-grained ou injetado pelo proxy
// da sessão). Toda leitura deste projeto é de repositório de TERCEIRO
// (nunca do próprio genezera/zerotoone), então enviar esse Authorization
// pra api.github.com/raw.githubusercontent.com faz o GitHub devolver 404
// em vez de servir o conteúdo público anonimamente -- confirmado com
// curl direto: 404 com o header, 200 sem ele, mesma URL. Mesma causa raiz
// já corrigida pontualmente em capture-scope-snapshots.mjs (fetchJson
// local, ad-hoc, sempre anônimo) -- esta função generaliza a correção
// pros outros 6 pontos de rede do projeto que usam githubHeaders()
// (fetch-repo.mjs, discover-targets.mjs, code-age.mjs, cve-digest.mjs,
// change-monitor.mjs, list-deep-read-candidates.mjs), sem perder o ganho
// de rate-limit de 60->5000/hora nos ambientes (locais) onde o token
// tem de fato acesso público amplo: tenta autenticado primeiro, só
// refaz a chamada sem Authorization se dor 404 -- um 404 de verdade
// (recurso que não existe) continua 404 na segunda tentativa, então
// nenhum erro real fica mascarado.
export async function githubFetch(url, { fetchImpl = fetch, headers: extraHeaders, ...options } = {}) {
  const headers = githubHeaders(extraHeaders);
  const res = await fetchImpl(url, { ...options, headers });
  if (res.status === 404 && headers.Authorization) {
    const anonHeaders = { ...headers };
    delete anonHeaders.Authorization;
    return fetchImpl(url, { ...options, headers: anonHeaders });
  }
  return res;
}
