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
