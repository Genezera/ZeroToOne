// Fecha a lacuna #6 da revisão externa de 03/09/2026 (relayed pelo
// usuário): "delta hunting" -- o placar de risco em novelty-risk.mjs já
// sabe premiar codeAgeDays baixo, mas nada calculava esse número de
// verdade. Antes disso, "código introduzido há 6 anos" (o caso real do
// Kiwi.com) só virava sinal quando alguém investigava manualmente via
// `gh api .../commits/<sha>` -- exatamente o que fiz à mão pra achar
// f1a1d76 (31/03/2020). Isto automatiza esse passo.
//
// HONESTO sobre o que mede: a API de commits com `path=` devolve o commit
// mais recente que TOCOU o arquivo -- não necessariamente a linha
// específica do bug, e não a introdução original se o arquivo foi editado
// depois por um motivo não relacionado. É um proxy rápido e barato (1
// chamada de API), não substitui investigação de blame real quando o
// achado já vale a pena aprofundar (ver NOTES.md do caso Kiwi.com pra um
// exemplo de investigação de commit introdutor feita à mão). Por isso
// nunca é chamado em massa durante descoberta (394+ candidatos brutos
// tornariam isso caro e lento) -- é uma ferramenta pra quando um achado
// específico já está sendo investigado.

import { githubFetch } from './github-auth.mjs';

export function daysSince(dateString, now = Date.now()) {
  // Bug real pego pelo próprio teste deste arquivo: `new Date(null)` NÃO
  // é Invalid Date em JS -- null vira 0 (ToNumber(null)===0), ou seja,
  // epoch (01/01/1970). Sem esta guarda explícita, um valor ausente
  // (exatamente o que fetchFileLastCommit devolve quando não acha data)
  // silenciosamente virava "56 anos atrás" em vez de null.
  if (dateString === null || dateString === undefined) return null;
  const ts = new Date(dateString).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((now - ts) / 86400000));
}

/** GET /repos/{owner}/{repo}/commits?path=<path>&per_page=1 -- o commit
 * mais recente que tocou este arquivo específico (não é o commit
 * introdutor do bug, é o mais recente a mexer no arquivo; ver comentário
 * do módulo). `ref` opcional restringe a um branch/tag/sha específico. */
export async function fetchFileLastCommit(owner, repo, path, { ref } = {}) {
  const query = new URLSearchParams({ path, per_page: '1' });
  if (ref) query.set('sha', ref);
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?${query.toString()}`;
  const res = await githubFetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} buscando histórico de commits de ${owner}/${repo}:${path}`);
  }
  const commits = await res.json();
  if (!Array.isArray(commits) || commits.length === 0) {
    return null; // arquivo sem commit encontrado (path errado, ou arquivo novo demais pra ainda não ter sido indexado -- não lança, quem chama decide o que fazer com null)
  }
  const commit = commits[0];
  const date = commit.commit?.committer?.date || commit.commit?.author?.date || null;
  return {
    sha: commit.sha,
    date,
    message: commit.commit?.message || null,
    daysSince: date ? daysSince(date) : null,
  };
}

/** Sinal pronto pra alimentar novelty-risk.mjs::assessNoveltyRisk
 * diretamente ({codeAgeDays: ...}). `null` (arquivo não encontrado ou
 * erro) é passado adiante como está -- assessNoveltyRisk já ignora
 * codeAgeDays não-finito, nunca finge saber a idade quando não sabe. */
export async function codeAgeSignal(owner, repo, path, opts = {}) {
  const lastCommit = await fetchFileLastCommit(owner, repo, path, opts);
  return {
    codeAgeDays: lastCommit?.daysSince ?? null,
    lastCommitSha: lastCommit?.sha ?? null,
    lastCommitDate: lastCommit?.date ?? null,
    limitation: 'commit mais recente a TOCAR o arquivo, não necessariamente a introdução da linha específica do achado -- use investigação de blame manual pra precisão antes de citar isso num relatório',
  };
}
