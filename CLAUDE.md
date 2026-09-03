# Antes de qualquer coisa: verificação de política de programa

**Isto vale pra QUALQUER sessão Claude neste repositório — local ou na
nuvem, rotina agendada ou pedido manual do usuário.** Foi escrito depois
de pelo menos 6 incidentes reais e documentados (ver
`research/bugbounty/block-open-source/NOTES.md`, seções "incidente" de
31/08, 01/09 x3 e 03/09/2026) em que uma sessão clonou e leu código de
`Block Open Source` (Bugcrowd) — programa com **proibição explícita de
ferramentas de IA na pesquisa** (RoE: "Do not use ChatGPT, Claude,
DeepSeek, Google Gemini or any AI tools during your research", risco
declarado de "point reduction or program expulsion") — antes de
consultar a política. Todos os incidentes foram "contidos" (nenhum
achado chegou a ser criado), mas a violação em si já aconteceu no
momento da leitura, independente do que saiu dela depois. A causa raiz
nunca foi corrigida porque vivia só em prosa num NOTES.md que uma sessão
só lê *depois* de já ter escolhido o alvo — não antes.

## A regra, sem exceção

**Antes de clonar, ler, abrir ou analisar QUALQUER arquivo de QUALQUER
repositório deste projeto — seja por um item da fila (`list-pending`),
seja por iniciativa própria de "leitura profunda proativa" — carregue e
confira `research/bugbounty/program-policy.json` primeiro.** Não é
suficiente checar o `NOTES.md` do programa específico que você já
escolheu — a checagem tem que acontecer **antes** de escolher o alvo,
não depois.

Comando rápido (não precisa abrir o arquivo inteiro à mão):
```bash
node system/bugbounty-scanner/cli.mjs check-program "<nome exato do programa>"
```
Devolve `{"blocked": true, "reason": "..."}` ou `{"blocked": false}`.
Programas atualmente bloqueados (conferir o arquivo real, esta lista
pode mudar): `Block Open Source` (`aiResearchBanned`, proibição de IA
do próprio programa) e `Circle BBP` (`blocked`, escolha do usuário).

Se o programa estiver bloqueado: **não clone, não leia, não abra
nenhum arquivo do repositório** — nem "só pra decidir prioridade", nem
"só um grep de nome de arquivo". O contato em si é a violação, não o
que você faz com o conteúdo depois. Pule o programa inteiro e siga para
o próximo candidato/programa liberado.

Isto vale igualmente para escolher um repositório por conta própria
(sem vir de `list-pending`) — a mesma checagem, no mesmo momento, antes
de qualquer `git clone`/leitura, não só antes de criar um achado.

## Por que isto está aqui e não só no NOTES.md

`state-machine.mjs` já bloqueia mecanicamente a transição
`scope_verified->human_ready` para programa bloqueado — mas isso só
impede um achado JÁ CRIADO de avançar, não impede a leitura que gerou
esse achado (ou que não gerou achado nenhum, mas ainda assim violou o
RoE). Não existe hoje nenhuma barreira mecânica no nível de "escolher o
que ler" — a única defesa possível nesse ponto é a própria sessão
consultar a política antes de agir. Por isso este arquivo existe: é
carregado automaticamente no início de toda sessão Claude Code neste
repositório (local ou nuvem), diferente de um NOTES.md que só é lido se
alguém decidir abri-lo.

---

*Restante da orientação do projeto (arquitetura, comandos, estado
atual) vive em `system/bugbounty-scanner/README.md` e
`docs/zerotoone-v2/`.*
