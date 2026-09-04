# ⚠️ RASCUNHO — REVISÃO EDITORIAL + HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de leitura de código-fonte público e execução local de PoC (nunca contra a infraestrutura real da OKX). **Não foi enviado a nenhuma plataforma.** Antes de copiar/colar e enviar, confira:

- [ ] Escopo reconfirmado na página real do programa (`check-scope` real: `github.com/okx/go-wallet-sdk`, `SOURCE_CODE`, `eligibleForBounty:true`, `eligibleForSubmission:true`, `maxSeverity:critical`)
- [ ] Categoria bate com o que o programa declara elegível
- [ ] Evidência/PoC conferida linha por linha (não é paráfrase/alucinação)
- [ ] Checagem de duplicata está atualizada (feita 2026-09-04; ver seção própria)
- [ ] Confirmar com a OKX (ou assumir explicitamente a limitação) se `Transfer()` é chamada por algum serviço de backend com input de múltiplos usuários no mesmo processo — muda a severidade prática de "self-DoS" para "DoS cross-user"
- [ ] Revisão humana do relatório e validação técnica independente concluídas

---

## Título
`Transfer()` em `okx/go-wallet-sdk` (Elrond/MultiversX) descarta erro de decode e ignora tamanho de seed, causando panic (DoS) com chave privada malformada

## Programa / Plataforma
`OKG` via `HackerOne` — https://hackerone.com/okg

## Categoria / Severidade declarada
CWE-248 (Uncaught Exception) / CWE-252 (Unchecked Return Value) levando a Denial of Service. `maxSeverity` do ativo é `critical` no scope snapshot local; severidade real deste achado é DoS de robustez, não perda de fundos direta (ver Impacto).

## Ativo afetado
- Repositório: `okx/go-wallet-sdk`
- Arquivo: `coins/elrond/elrond.go`
- Função: `Transfer(args ArgCreateTransaction, privateKeyHex string) (string, error)`
- Commit no momento da análise: `12fec6b0616347265efcc23bfc240c155da710eb`
- Confiança da evidência de deploy: **low** — é a própria função pública exportada de transferência do SDK para Elrond (não código morto/interno), mas sem confirmação direta de qual produto/serviço OKX específico a chama nem com que tipo de input.

## Resumo
`Transfer()` decodifica a chave privada hexadecimal e descarta o erro de decode (`pk, _ := hex.DecodeString(...)`), depois chama `ed25519.NewKeyFromSeed(pk)` sem checar se o resultado tem exatamente 32 bytes — ao contrário de `AddressFromSeed`, no mesmo arquivo, que faz a mesma operação e valida corretamente. Como `NewKeyFromSeed` da stdlib Go **panica** (não retorna erro) para qualquer seed de tamanho diferente de 32 bytes, qualquer chave hex malformada ou de comprimento incorreto derruba o processo, apesar da assinatura da função prometer um `error` tratável.

## Cadeia de chamada confirmada
- `coins/elrond/elrond.go::Transfer`: `pk, _ := hex.DecodeString(privateKeyHex); privateKey := ed25519.NewKeyFromSeed(pk)`. Duas omissões empilhadas: (1) erro do `hex.DecodeString` descartado; (2) nenhuma checagem de `len(pk) == 32` antes de `NewKeyFromSeed`.
- Comparação dentro do mesmo arquivo: `AddressFromSeed` faz a mesma sequência (`hex.DecodeString` + `NewKeyFromSeed`) mas valida explicitamente `len(seedBytes) != 32`, devolvendo erro tratável — `Transfer` não tem checagem equivalente.
- Inconsistência de API que agrava o problema: `NewAddress(privateKey string)`, poucas linhas acima no mesmo arquivo, documenta explicitamente aceitar uma chave de **64 bytes** (`errors.New("length of private key must 64 bytes")` — o formato keypair completo). `Transfer(..., privateKeyHex string)` usa o mesmo nome semântico de parâmetro ("chave privada em hex") mas na verdade espera um **seed de 32 bytes** (o formato de `AddressFromSeed`). Um consumidor que já tenha uma chave no formato aceito por `NewAddress` e reutilize a mesma string em `Transfer()` — leitura razoável, já que ambas as funções do mesmo pacote usam a mesma nomenclatura — aciona o panic garantido.
- O próprio README do pacote documenta `signedTx, err := Transfer(args, pk); if err != nil {...}` como se erro fosse o caminho de falha esperado — não é; é panic.

## Pré-requisitos
Nenhum privilégio especial — qualquer string hex que não decodifique para exatamente 32 bytes. Toda a validação foi feita com clone público do repositório e execução local (`go test`), sem tocar rede, conta ou infraestrutura real.

## Passo a passo de reprodução
1. Clonar `okx/go-wallet-sdk` no commit acima.
2. Chamar `elrond.Transfer(args, privateKeyHex)` com uma string hex válida mas de comprimento diferente de 64 caracteres (32 bytes) — por exemplo, uma chave de 63 bytes (formato aceito por `NewAddress`, mas incompatível aqui) ou hex malformado que decodifica para 0 bytes.
3. Observar que o processo panica com `ed25519: bad seed length: N`, em vez de devolver o `(string, error)` prometido pela assinatura.

## Resultado atual vs. esperado
- **Atual:** `Transfer()` descarta o erro de decode e não valida o comprimento do seed antes de `NewKeyFromSeed` — qualquer entrada malformada panica.
- **Esperado:** validar `len(pk) != 32` e devolver erro tratável, exatamente como `AddressFromSeed`, no mesmo arquivo, já faz.

## Evidência
```go
// coins/elrond/elrond.go -- Transfer (sem validação)
func Transfer(args ArgCreateTransaction, privateKeyHex string) (string, error) {
	pk, _ := hex.DecodeString(privateKeyHex)
	privateKey := ed25519.NewKeyFromSeed(pk) // panica se len(pk) != 32
	...
}

// mesmo arquivo -- AddressFromSeed (com validação, para comparação)
func AddressFromSeed(seedHex string) (string, error) {
	seedBytes, err := hex.DecodeString(seedHex)
	if err != nil {
		return "", err
	}
	if len(seedBytes) != 32 {
		return "", errors.New("...")
	}
	...
}
```

## Prova de conceito executável
Teste Go real, executado localmente contra o clone público (`go test`), sem tocar rede/conta real:

```
=== RUN   TestReproTransferPanicsOnWrongLengthKey
    zzrepro_test.go:19: PANIC RECOVERED: ed25519: bad seed length: 63
--- PASS: TestReproTransferPanicsOnWrongLengthKey (0.00s)
=== RUN   TestReproTransferSilentlyDiscardsDecodeError
    zzrepro_test.go:44: panic on malformed hex input: ed25519: bad seed length: 0
--- PASS: TestReproTransferSilentlyDiscardsDecodeError (0.00s)
PASS
ok  	github.com/okx/go-wallet-sdk/coins/elrond	0.005s
```

Teste ficou apenas no clone local efêmero desta sessão (`coins/elrond/zzrepro_test.go`), nunca commitado ou enviado a lugar nenhum — reproduzível por qualquer pessoa com Go instalado e o clone público do repositório.

## Impacto
- Validade técnica: **confirmed**
- Entrada controlada pelo atacante: **sim** (a própria chave malformada/mal-interpretada de quem chama — não um atacante forjando a chave de outra pessoa)
- Atacante: qualquer parte que forneça uma chave hex malformada ou no formato errado — um usuário confundindo o formato de 64 bytes (`NewAddress`) com o de 32 bytes (`Transfer`), ou, com impacto maior, um serviço de backend processando chaves de múltiplos usuários
- Vítima: o processo/serviço que chama `Transfer()` — se rodar num backend compartilhado sem `recover()` por request, um único input malformado de um usuário pode derrubar o processamento de outros usuários no mesmo lote
- Fronteira de segurança: validação de comprimento antes de `ed25519.NewKeyFromSeed`, que documentadamente panica fora do tamanho esperado
- Resultado observado: panic real e reproduzível, não simulado
- C/I/A: **nenhum/nenhum/alto**
- Escopo do impacto: além do próprio usuário que forneceu a chave malformada — potencialmente outros usuários processados no mesmo processo/backend
- Gate de impacto: **PASS** — impacto reportável confirmado; isto não satisfaz o gate separado de novidade

**Ceticismo sobre severidade/alcance:** mesma classe dos achados-irmãos deste repositório (DoS/robustez, não perda de fundos direta — é o próprio input malformado/mal-formatado do chamador que derruba o processo). Pior que o achado-irmão de Solana num aspecto específico: ali `PublicKeyFromBase58`, no arquivo vizinho, ao menos validava tamanho; aqui `Transfer()` não tem nenhuma camada de validação, apesar de `AddressFromSeed`, no MESMO arquivo, já implementar exatamente a checagem que falta. Busca por chamadores internos (`grep -rn 'elrond.Transfer('` em todo o repo, fora de teste): zero resultados — a única "documentação" de uso real é o README do pacote, que usa consistentemente o formato de 32 bytes do próprio exemplo de `AddressFromSeed` (então o README isoladamente não ensina o padrão de 64 bytes que dispara o bug; o vetor real é um consumidor externo que reutilize uma chave de 64 bytes de outro lugar do mesmo SDK). Não confirmo uso real server-side — só o código-fonte público.

## Correção sugerida
```go
func Transfer(args ArgCreateTransaction, privateKeyHex string) (string, error) {
	pk, err := hex.DecodeString(privateKeyHex)
	if err != nil {
		return "", err
	}
	if len(pk) != 32 {
		return "", errors.New("invalid private key length, expected 32-byte seed")
	}
	privateKey := ed25519.NewKeyFromSeed(pk)
	...
}
```
Espelhar exatamente a validação que `AddressFromSeed`, no mesmo arquivo, já implementa. Considerar também renomear o parâmetro ou documentar explicitamente que `Transfer` espera um seed de 32 bytes, distinto do formato de 64 bytes aceito por `NewAddress`, para eliminar a ambiguidade de API que agrava o risco de uso incorreto.

## Divulgação obrigatória de uso de IA

Este trabalho utilizou ferramentas assistidas por IA para descoberta, tooling, análise e preparação do rascunho. Antes do envio, o pesquisador revisou independentemente o código, executou a PoC e confirmou pessoalmente cada alegação técnica e de impacto.

---

## Checagem de duplicata
- Data: 2026-09-04
- Fontes: `github_issues` (busca por "panic" OR "bad seed length" OR "private key" em `okx/go-wallet-sdk`: 5 resultados, todos sobre bugs completamente diferentes — decode de transação Solana, derivation path, assinatura Schnorr Bitcoin — nenhum relacionado), `github_advisories` (nenhum publicado neste repositório), `web_search` ("okx go-wallet-sdk panic bad seed length ed25519 private key vulnerability" — nenhum hit específico a este SDK; único achado de contexto foi [vegaprotocol/vega#768](https://github.com/vegaprotocol/vega/issues/768), o mesmo padrão geral de bug num projeto totalmente diferente)
- Correspondência pública encontrada: **não**
- Classificação registrada: **longstanding_exposure** — commit real `e122a38d828cc1eb8a201dcdcf2b64c4c55e039f` ("add coins on elrond", 2023-11-03), **1036 dias** confirmados via git; isto é evidência de idade, não de novidade
- Gate anti-duplicate: **BLOCK** — não é regressão recente; longa exposição aumenta a chance de report privado anterior. Não enviar com a evidência atual.

---
*Rascunho revisado manualmente em 2026-09-04 a partir do achado `OKG::okx/go-wallet-sdk/coins/elrond/elrond.go::Transfer::ai_deep_read_finding`. Raciocínio bruto completo da investigação em `ledger/ledger.research.jsonl` e no campo `reasoning` do achado no banco.*
