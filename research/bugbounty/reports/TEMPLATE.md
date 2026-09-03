<!--
TEMPLATE de rascunho de relatório de bug bounty — todo relatório novo
gerado pelo agente de nuvem deve seguir exatamente esta estrutura,
salvo em research/bugbounty/reports/<program-slug>-<finding-id-curto>.md

REGRAS ANTES DE GERAR (o agente de nuvem confere isso, não pula):
1. O achado precisa mapear pra uma categoria que o PRÓPRIO PROGRAMA declara
   como elegível (ver NOTES.md do programa em research/bugbounty/<program>/
   — StackingDAO, por exemplo, só paga roubo de fundos, congelamento,
   mintagem não autorizada ou insolvência; metadado/cosmético NUNCA é
   elegível). Se não mapear, NÃO gera relatório — atualiza o veredito em
   queue.jsonl como "confirmado, não elegível" e para por aí.
2. O achado precisa ter cadeia de chamada CONFIRMADA (não só "o código
   parece suspeito isolado") — se a vulnerabilidade depende de outro
   arquivo/função pra ser explorável de verdade, esse arquivo precisa ter
   sido lido e citado como evidência. Achado de dependência vulnerável
   (known_vulnerable_dependency) precisa confirmar ALCANÇABILIDADE — o
   código vulnerável da dependência precisa ser de fato chamado pelo
   projeto, não só estar presente no grafo de dependências.
3. Para achado Solidity (reentrancy_risk, unchecked_call_return,
   tx_origin_auth_risk, delegatecall_risk): sempre que a leitura de código
   não refutar de cara, escreva e RODE uma prova de conceito executável de
   verdade (Foundry, fork local — ver seção "Prova de conceito executável"
   abaixo) antes de decidir o veredito. Princípio de menor impacto: a PoC
   prova o mínimo necessário, nunca precisa demonstrar drenagem completa.
   NUNCA rede real, NUNCA conta/chave privada com fundo real — só contas
   geradas localmente (`makeAddr`/`vm.deal`), financiadas apenas dentro do
   fork.
   Para achado Go: escreva e RODE um `_test.go` real contra o pacote
   clonado (`go test -run Teste -v`). Para achado JVM/Kotlin: classe
   "estágio-de-prova" (nunca gadget de RCE de verdade) rodada via
   `javac`/`java` ou, se houver projeto Gradle/Maven real, o runner
   dele. Para achado JS/TS: `node --test` (mesma ferramenta que já roda
   a suíte deste projeto). Ver `system/bugbounty-scanner/README.md` e
   os exemplos reais em `system/bugbounty-scanner/poc-examples/` pra
   cada uma. Se mesmo assim não der pra rodar PoC de verdade pro tipo
   de achado (ex.: config pura, sem lógica pra exercitar), registre
   `record-validation --result=not_applicable` explicitamente — nunca
   simule/invente saída.
4. Nunca é rascunho final — todo relatório carrega o aviso de revisão
   humana obrigatória no topo, sempre.
-->

# ⚠️ RASCUNHO — REVISÃO HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de análise de código-fonte
público (e, quando aplicável, prova de conceito executada localmente
contra um fork — nunca contra o sistema real). **Não foi enviado a
nenhuma plataforma.** Antes de copiar/colar e enviar, confira:

- [ ] Escopo confirmado — o ativo afetado está no escopo do programa AGORA
      (escopo pode mudar; reconfirme na página do programa antes de enviar)
- [ ] Categoria confirmada — bate com uma categoria que o programa
      declara como elegível para recompensa (não é metadado/cosmético)
- [ ] Evidência conferida — os trechos de código e a saída da prova de
      conceito (quando houver) realmente existem/rodaram como descrito
      (não foi paráfrase/alucinação)
- [ ] Anterioridade pública checada e registrada — issues/PRs, advisories e
      Hacktivity/busca web, com pelo menos duas formulações e timestamp
- [ ] Risco de duplicata aceito conscientemente — busca pública limpa significa
      `private_unknown`, nunca prova que não existe report privado anterior
- [ ] Impacto estruturado confirmado — atacante, vítima, fronteira de
      segurança, resultado observável e C/I/A sustentados pela PoC
      a este programa

---

## Título
`{{título curto e específico — ex.: "Bypass de autorização em X permite Y"}}`

## Programa / Plataforma
`{{programa}}` via `{{plataforma}}` — {{URL do programa}}

## Categoria / Severidade declarada
`{{categoria exata como o programa a nomeia}}` — confirmada contra
`research/bugbounty/{{program-slug}}/NOTES.md`, seção de categorias
elegíveis.

## Ativo afetado
- Repositório: `{{owner/repo}}`
- Arquivo: `{{caminho/do/arquivo}}`
- Linha(s): `{{linha(s)}}`
- Commit/branch no momento da análise: `{{branch}}` (verificar SHA atual
  antes de enviar — o código pode ter mudado desde a varredura)

## Resumo
{{2-4 frases: o que é o problema, por que importa, para quem}}

## Cadeia de chamada confirmada
{{Lista dos arquivos lidos pra confirmar que isso é explorável de
verdade — não só o arquivo onde o padrão foi encontrado. Ex.:
"arquivo A (linha X) chama função em arquivo B (linha Y), que não valida
Z antes de [ação sensível]." Se for achado de dependência: confirmar que
o código vulnerável é de fato invocado pelo fluxo do programa, citando a
função exportada vulnerável E o ponto de chamada real no projeto.}}

## Pré-requisitos
{{O mínimo necessário pra reproduzir — ex.: "2 contas de teste próprias,
sem privilégio especial" ou, pra contrato, "fork local, sem conta/fundo
real, endereço gerado localmente (Foundry makeAddr)". Nunca dado ou conta
de usuário real.}}

## Passo a passo de reprodução
1. {{passo}}
2. {{passo}}
3. {{passo}}

## Resultado atual vs. esperado
- **Atual:** {{o que o código realmente faz hoje}}
- **Esperado:** {{o que deveria acontecer se estivesse correto}}

## Evidência
```
{{trecho de código real, citado com caminho:linha}}
```

{{Se aplicável: saída de comando, resultado de trace, referência externa
(ex.: ID da vulnerabilidade em GHSA/CVE/OSV para achado de dependência).}}

## Prova de conceito executável
{{SÓ preencher esta seção se um teste de verdade foi escrito e rodado.
Solidity: Foundry contra um FORK LOCAL (nunca rede real, nunca
conta/chave privada com fundo real). Go: `_test.go` real via
`go test`. JVM/Kotlin: `javac`/`java` ou o runner real do projeto
(Gradle/Maven). JS/TS: `node --test`. Ver
`system/bugbounty-scanner/README.md` e `poc-examples/` pra exemplo real
de cada uma. Inclua:
- O código do teste completo ou trecho relevante
- O comando exato rodado, ex.: `forge test --fork-url <RPC público>
  --match-test test_X -vvv`, `go test -run TestX -v ./pkg/...`, `java
  PocMain`, ou `node --test caminho/do/teste.test.mjs`
- A saída REAL do comando (PASS/FAIL + trace relevante) — cole o
  resultado literal, nunca parafraseado
Se a PoC FALHOU (ex.: um modifier/checagem bloqueou o ataque que a
leitura de código sugeria), isso é evidência forte de falso-positivo —
documente aqui mesmo assim, é informação real e valiosa, não descarte.
Se o tipo de achado genuinamente não tem lógica pra exercitar (ex.:
config pura), registre `not_applicable` explicitamente em vez de pular
a seção em silêncio.}}

## Impacto
{{O que um atacante ganha de verdade — concreto, não genérico, baseado no
que a prova de conceito (quando existir) realmente demonstrou, não
especulação. Se for achado de dependência, citar o CVSS/severidade do
advisório original.}}

## Correção sugerida
{{Mudança concreta e mínima que resolveria — não genérico tipo "validar
input".}}

---
*Gerado automaticamente em {{timestamp}} a partir do achado `{{id}}` na
fila (`research/bugbounty/queue.jsonl`). Ver histórico completo do
veredito em `ledger/ledger.research.jsonl`.*
