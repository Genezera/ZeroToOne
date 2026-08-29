# ZeroToOne — análise de lacunas (Fase 0, auditoria v2)

Base: auditoria externa recebida em `ZeroToOne_Auditoria_e_Prompt_Mestre.md`
(usuário, 29/08/2026) + verificação direta contra o repositório real feita
nesta sessão (ver `current-state.md` para os comandos e números). Cada
item abaixo diz explicitamente se foi **verificado agora** (evidência
própria, file:line) ou se é **herdado da auditoria externa sem
verificação direta minha** (framework aceito, mas não re-testado).

## Afirmações do relatório anterior que não se sustentam — verificadas agora

| Afirmação do PDF | Realidade verificada | Evidência |
|---|---|---|
| "Totalmente automatizado" | Falso — curadoria de alvo, revisão de relatório e todo envio são manuais por regra de plataforma, não por escolha de design | `README.md` seção "O que ainda é 100% manual"; nenhuma automação de submissão existe no código |
| "Aprende sozinho" | É recálculo de estatística histórica sobre o próprio veredito interno do sistema, não aprendizado com resultado externo | `verdict-stats.mjs` só lê `queue.jsonl`; não existe nenhum import de resultado real de plataforma (triaged/duplicate/paid) em lugar nenhum do código |
| "Confirmado" (3 itens) | Nenhum dos 3 tem scope snapshot oficial nem vínculo com release/deploy verificado; 1 dos 3 (Solidity, movimentação de fundo real) não tem PoC apesar do sistema ter capacidade de gerar uma | Ver `current-state.md`, seção "Os 3 itens" — leitura direta dos 3 reasoning + do rascunho de relatório do Circle BBP |
| "Ledger à prova de adulteração" | Tamper-evident, não tamper-proof — reescrever o arquivo inteiro e recalcular a cadeia do zero não é detectável sem checkpoint externo | Leitura de `system/ledger/ledger.mjs` linha a linha (`appendEntry`/`verifyChain`) |
| "Zero caixa-preta" | O agente de nuvem decide veredito com um LLM; o prompt real não pede nem registra hash do prompt, versão de modelo fixada, ou evidência determinística separada da alegação do modelo | Prompt real capturado via `RemoteTrigger get` — reasoning é texto livre gerado pelo modelo, sem estrutura obrigatória de evidência determinística |
| "Escopo é sagrado" | A fonte de escopo é sempre o dataset comunitário `arkadiyt/bounty-targets-data`, nunca um snapshot da página oficial do programa | `research/bugbounty/circle-bbp/NOTES.md:20` cita `hackerone_data.json` explicitamente como fonte |

## Precisão real do sistema — recalculada, não copiada

- Confirmados entre revisados: `3/34 = 8,82%`.
- Falso-positivo entre revisados: `31/34 = 91,18%`.
- `ssrf_risk`: **13 revisões, 13 falso-positivo, 0% precisão** — regra
  candidata a quarentena imediata (ver P1 abaixo). Recalculado agora,
  direto de `queue.jsonl`, mesmo valor que a auditoria externa reportou.

## Tabela de lacunas (framework da auditoria externa, com nota de verificação)

| Etapa | O que existe hoje | Lacuna | Verificação |
|---|---|---|---|
| Seleção de programa | `discover-targets.mjs` compara contra dataset comunitário | Sem valor esperado calculado, sem página oficial como fonte canônica | **Verificado** (código lido, `discover-targets.mjs` só consulta `hackerone_data.json`/`bugcrowd_data.json`) |
| Preservação de escopo | `NOTES.md` por programa, escrito à mão | Sem snapshot versionado, sem hash, sem expiração, sem gate automático por ação | **Verificado** (grep confirma fonte comunitária, nenhum arquivo tipo `scope-snapshot.json` existe no repo) |
| Mapeamento de ativo | Repositório GitHub = ativo | Sem prova `repo → release/tag → deploy real (endereço/bytecode/versão publicada)` | **Verificado** (nenhum dos 3 achados "confirmado" cita endereço de contrato, chain ID ou hash de bytecode) |
| Reconhecimento externo | Ausente | Sem descoberta de endpoint/API em runtime | **Verificado** (nenhum módulo de rede ativa existe; todo scanner é leitura de código estático via API pública) |
| Análise estática | Regex por linguagem + AST intraprocedural só em JS/TS | Sem call graph interprocedural, sem modelo de framework, cobertura rasa fora de JS/TS | **Verificado** (leitura de `heuristics-*.mjs`; só `heuristics-js-ast.mjs` usa parser real, as outras 5 linguagens são regex) |
| Dependências | `dep-scanner.mjs` via OSV.dev, versão exata | CVE presente ≠ alcançável; sem SBOM, sem VEX | **Verificado** (código de `dep-scanner.mjs` só confirma presença de versão vulnerável no manifesto, não uso real da função vulnerável) |
| Testes dinâmicos | Foundry só para 4 tipos de heurística Solidity | Sem runtime para web/API/backend/mobile; nem todo achado Solidity elegível recebe PoC (caso real: item 2 do `current-state.md`) | **Verificado** (prompt do agente de nuvem lido na íntegra; escopo de PoC restrito aos 4 tipos nativos) |
| Lógica de negócio | Ausente | Sem modelo de usuário/sessão/autorização/estado | **Verificado** (nenhum módulo do sistema cria conta de teste, sessão ou estado de workflow) |
| Duplicata | Ausente | Sem cruzamento contra issues/advisories/relatórios públicos antes de gerar rascunho | **Verificado** (nenhuma consulta desse tipo aparece em nenhum módulo nem no prompt do agente de nuvem) |
| Segurança operacional | Agente de nuvem com Bash irrestrito, instala Foundry via `curl \| bash` quando ausente | Sem sandbox declarado, sem allowlist de rede, sem classificação de ação, sem limite de recurso | **Verificado** (`allowed_tools` e texto do prompt capturados via `RemoteTrigger get`, citados em `threat-model.md`) |
| Persistência/concorrência | `queue.jsonl` + `ledger.*.jsonl` reescritos via Git, por 2 automações independentes (scanner local diário + agente de nuvem por push) | Sem lock, sem idempotency key; conflito de merge no ledger já aconteceu de verdade nesta sessão | **Verificado por incidente real**: mais cedo nesta mesma sessão foi necessário resolver manualmente um merge conflict no `ledger/ledger.research.jsonl` causado exatamente por essa concorrência (replay semântico da cadeia de hash, commit `a351d7a`) |

## Itens da auditoria externa **não verificados diretamente** (herdados do documento, plausíveis mas não re-testados)

- Comparação quantitativa completa com metodologia de hunter profissional
  (linha "Etapa do trabalho" da seção 3 do documento original) — aceito
  como framework útil, não recalculado item a item.
- Estimativas de esforço/tempo de cada fase do plano de implementação.
- Lista de ferramentas de terceiro recomendadas (CodeQL, Semgrep, Slither,
  OSV-Scanner) — nomes e capacidades gerais são de conhecimento público,
  mas a adequação de licença/uso específico contra os repositórios-alvo
  reais não foi verificada nesta rodada.

## Conclusão da Fase 0

Todos os pontos centrais da auditoria externa que eram verificáveis a
partir do repositório real foram confirmados de forma independente —
inclusive um deles (concorrência de escrita entre scanner local e agente
de nuvem sobre o mesmo Git) por incidente real já ocorrido nesta sessão,
não apenas por leitura de código. O diagnóstico é preciso: o sistema é
uma boa base de triagem estática com um revisor cético por IA, mas o
estado `confirmado` hoje não implica escopo verificado, vínculo com
deploy real, nem evidência executável consistente — exatamente a lacuna
que motiva a Fase 1 (Scope Registry, máquina de estados, sandbox) descrita
em `IMPLEMENTATION_STATE.md`.
