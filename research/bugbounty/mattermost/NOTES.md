# Mattermost Public Bug Bounty Engagement (Bugcrowd) — notas de pesquisa

## Rodada 2026-09-03 (push automático via GitHub webhook, sessão cloud)

Primeira rodada tocando este programa. Mesma lacuna documentada em
`slack/NOTES.md`: `Mattermost Public Bug Bounty Engagement` foi promovido
automaticamente pro scanner ativo pelo pipeline de descoberta
(`targets-auto-promoted-log.json`) sem revisão de RoE da Bugcrowd quanto a
proibição de pesquisa assistida por IA — percebido só depois de já ter
lido/triado os achados abaixo. Registrado em `program-policy.json`
(`"roeReviewNeeded": true`) como advertência pro usuário revisar a RoE real
do engagement `mattermost-mbb-public` antes de qualquer pesquisa futura
aqui.

`list-pending` trouxe 5 achados em `mattermost/mattermost-plugin-jira`
(clonado raso localmente, leitura de código público):

- 3x `semgrep_use_of_md5` (`server/utils/kvstore/hashed_key.go:76`,
  `server/kv.go:95,101`): MD5 usado só como hash não-criptográfico pra
  derivar chave de KV store (namespacing/lookup key) — nunca senha, token,
  assinatura ou verificação de integridade. Código upstream já anota
  `// #nosec G501`/`G401`, reconhecendo e suprimindo deliberadamente o aviso
  do gosec. Falso positivo — CWE-328 só importa quando o hash protege algo.
- 2x `semgrep_var_in_script_tag` (`assets/templates/ac/user_connected.html:62`,
  `user_confirm.html:59`): `{{ .ArgJiraJWT }}` renderizado dentro de
  `<script>` (`document.getElementById(...)`) — rastreado até
  `server/user_cloud.go`, `ArgJiraJWT` vem de uma constante hardcoded
  (`argJiraJWT = "jwt"`), nunca de input de usuário/request. Sem fonte
  controlável por atacante alcançando o sink, não há XSS real.

Todos os 5 refutados como falso positivo com reasoning individual salvo em
cada finding.

**Pendência pro usuário**: confirmar a RoE do engagement
`mattermost-mbb-public` no Bugcrowd antes de qualquer rodada futura de
pesquisa aqui (ver `program-policy.json`).

## Rodada 2026-09-04 (push automático via GitHub webhook, sessão cloud)

`program-policy.json` checado como passo zero (regra do CLAUDE.md):
programa segue `roeReviewed:true`/`aiResearchBanned:false`, liberado.

`list-pending` trouxe 3 achados `known_vulnerable_dependency` em
`mattermost/mattermost-plugin-zoom/webapp/package-lock.json`
(`yaml@1.10.2` GHSA-48c2-rrv3-qjmp, `ajv@6.12.6` e `ajv@8.17.1`
GHSA-2g4f-4pwh-qvx6) — todos com GHSA extraível no reasoning e sem
verificação de alcançabilidade real ainda feita. Rodei
`cli.mjs auto-triage-known-cve`, que fecha automaticamente este padrão
como `known_duplicate` (não `false_positive`: o CVE é real, só não é
achado novo — já é divulgação pública rastreável, exatamente o critério
de `state-machine.mjs::known_duplicate`). Os 3 fecharam limpo, sem
erro. Nenhuma leitura de arquivo do repositório-alvo foi necessária
para isso (a decisão depende só do GHSA já publicado, não do código).

Leitura profunda proativa desta rodada ficou em `nuxt/nuxt` (programa
Vercel Open Source) — ver NOTES.md de Vercel Open Source. Nenhum achado
novo neste programa.
