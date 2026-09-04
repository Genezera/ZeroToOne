# ⚠️ RASCUNHO — REVISÃO EDITORIAL + HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de leitura de código-fonte público e execução local de PoC (nunca contra a infraestrutura real da OKX). **Não foi enviado a nenhuma plataforma.** Antes de copiar/colar e enviar, confira:

- [ ] Escopo reconfirmado na página real do programa (`check-scope` real: `github.com/okx/go-wallet-sdk`, `SOURCE_CODE`, `eligibleForBounty:true`, `eligibleForSubmission:true`, `maxSeverity:critical`)
- [ ] Categoria bate com o que o programa declara elegível
- [ ] Evidência/PoC conferida linha por linha (não é paráfrase/alucinação)
- [ ] Checagem de duplicata está atualizada (feita 2026-09-04; ver seção própria)
- [ ] Confirmar com a OKX (ou assumir explicitamente a limitação) se esta função é chamada por algum serviço de backend com input de múltiplos usuários no mesmo processo — muda a severidade prática de "self-DoS" para "DoS cross-user"
- [ ] Revisão humana do relatório e validação técnica independente concluídas

---

## Título
Ausência de validação em `PrivateKeyFromBase58` causa panic (DoS) com chave privada malformada em `okx/go-wallet-sdk` (Solana)

## Programa / Plataforma
`OKG` via `HackerOne` — https://hackerone.com/okg

## Categoria / Severidade declarada
CWE-248 (Uncaught Exception) / CWE-20 (Improper Input Validation) levando a Denial of Service. `maxSeverity` do ativo é `critical` no scope snapshot local, mas a severidade real deste achado específico é limitada por ser DoS de robustez, não perda de fundos direta (ver seção Impacto).

## Ativo afetado
- Repositório: `okx/go-wallet-sdk`
- Arquivo: `coins/solana/base/keys.go`
- Função: `PrivateKeyFromBase58`
- Commit no momento da análise: `12fec6b0616347265efcc23bfc240c155da710eb`
- Confiança da evidência de deploy: **low** — é a própria função pública exportada de tratamento de chave privada Solana do SDK (não código morto/interno), mas sem confirmação direta de qual produto/serviço OKX específico a chama nem com que tipo de input.

## Resumo
`PrivateKeyFromBase58` decodifica uma chave privada Solana em base58 sem checar erro nem tamanho do resultado, ao contrário de `PublicKeyFromBase58` no mesmo arquivo (que valida corretamente) e do próprio código upstream de onde este arquivo foi vendorizado. Qualquer chave privada com um único caractere fora do alfabeto base58 (erro de digitação comum) ou de comprimento incorreto é aceita silenciosamente sem erro; o primeiro uso subsequente documentado no README do pacote (`PublicKey()`) então panica com `slice bounds out of range`, encerrando o processo em vez de devolver um erro tratável.

## Cadeia de chamada confirmada
- `coins/solana/base/keys.go::PrivateKeyFromBase58` — `res := base58.Decode(privkey); return res, nil`. Usa `crypto/base58/base58.go::Decode()` (implementação vendorizada btcsuite), que retorna `[]byte("")` silenciosamente (nunca erro) ao encontrar qualquer byte fora do alfabeto base58.
- Comparação dentro do mesmo arquivo: `PublicKeyFromBase58` valida explicitamente `len(val) != PublicKeyLength` e devolve erro — `PrivateKeyFromBase58` não tem equivalente. Essa assimetria é o primeiro sinal de omissão, não design.
- Comparação com upstream credenciado (`github.com/gagliardetto/solana-go`, citado no cabeçalho de copyright do arquivo e no README do pacote em "Credits"): a versão atual do upstream propaga o erro do decode e chama `ValidatePrivateKey`, que rejeita tamanho != 64 bytes **e** verifica consistência seed/pubkey (`derived := NewKeyFromSeed(b[:32]); bytes.Equal(derived, b)`) mais `IsOnCurve`. Este fork removeu as três camadas de validação sem substituir por nada.
- `coins/solana/README.md`, seções "Transfer"/"Transfer Token": ensinam exatamente o padrão vulnerável — `fromPrivate, _ := base.PrivateKeyFromBase58("...")` (erro descartado) seguido de `fromPrivate.PublicKey()`.
- `PrivateKey.PublicKey()` (mesmo arquivo, ~linha 78): `p := ed25519.PrivateKey(k); pub := p.Public().(ed25519.PublicKey)`. `ed25519.PrivateKey.Public()` da stdlib Go faz `copy(publicKey, priv[32:])` sem checar `len(priv)` — se `priv` tiver menos de 32 bytes (inclusive vazio, o caso mais comum de erro de digitação), o slice `priv[32:]` panica com `slice bounds out of range`.
- Busca por chamadores internos (`grep -rl` no repo inteiro): nenhum além do próprio `MustPrivateKeyFromBase58` (que também não trata o erro, já que ele nunca vem preenchido). A única "documentação" de uso real é o README, que ensina exatamente o padrão inseguro.

## Pré-requisitos
Nenhum privilégio especial — qualquer string candidata a chave privada base58 malformada (um caractere inválido ou comprimento incorreto). Toda a validação foi feita com clone público do repositório e execução local (`go test`), sem tocar rede, conta ou infraestrutura real.

## Passo a passo de reprodução
1. Clonar `okx/go-wallet-sdk` no commit acima.
2. Chamar `base.PrivateKeyFromBase58("O0Il")` (contém caracteres explicitamente excluídos do alfabeto base58) ou `base.PrivateKeyFromBase58(" ")` (espaço, artefato comum de copy/paste).
3. Observar que a função devolve `(key=[], err=nil)` — nenhum erro, apesar da entrada ser inválida.
4. Chamar `.PublicKey()` no resultado, exatamente como o README do pacote instrui.
5. O processo panica: `runtime error: slice bounds out of range [32:0]`.

## Resultado atual vs. esperado
- **Atual:** entrada base58 inválida ou de comprimento incorreto é aceita silenciosamente (`err == nil`); o panic só ocorre depois, no primeiro uso do resultado.
- **Esperado:** `PrivateKeyFromBase58` deveria propagar o erro real do decode e validar `len(resultado) == 64` antes de retornar, devolvendo um erro tratável — exatamente o padrão que `PublicKeyFromBase58`, no mesmo arquivo, já implementa.

## Evidência
```go
// coins/solana/base/keys.go -- PrivateKeyFromBase58 (sem validação)
func PrivateKeyFromBase58(privkey string) (PrivateKey, error) {
	res := base58.Decode(privkey)
	return res, nil
}

// mesmo arquivo -- PublicKeyFromBase58 (com validação, para comparação)
func PublicKeyFromBase58(v string) (PublicKey, error) {
	val := base58.Decode(v)
	if len(val) != PublicKeyLength {
		return PublicKey{}, errors.New("...")
	}
	...
}
```
```go
// crypto/base58/base58.go -- Decode() nunca retorna erro, silencia caractere inválido
if tmp == 255 {
    return []byte("")
}
```

## Prova de conceito executável
Teste Go real, executado localmente contra o clone público (`go test`), sem tocar rede/conta real:

```
=== RUN   TestReproPrivateKeyFromBase58Panic
PrivateKeyFromBase58(malformed) -> key= (len=0) err=<nil>
PANIC RECOVERED: runtime error: slice bounds out of range [32:0]
--- PASS: TestReproPrivateKeyFromBase58Panic (0.00s)
=== RUN   TestReproPrivateKeyFromBase58EmptyNoError
PrivateKeyFromBase58(" ") -> key= (len=0) err=<nil>
--- PASS: TestReproPrivateKeyFromBase58EmptyNoError (0.00s)
PASS
ok  	github.com/okx/go-wallet-sdk/coins/solana/base	0.002s
```

Teste ficou apenas no clone local efêmero desta sessão (`coins/solana/base/zzrepro_test.go`), nunca commitado ou enviado a lugar nenhum — reproduzível por qualquer pessoa com Go instalado e o clone público do repositório.

**Vetor adicional não verificado (documentado por transparência, não testado):** base58 sintaticamente válido mas de comprimento errado (ex. 32 bytes de seed em vez dos 64 do keypair completo) também seria aceito sem checagem de consistência seed/pubkey que o upstream tem — produziria endereço/assinatura que não correspondem a nenhuma chave real, sem qualquer erro. Não testado por já haver reprodução clara do caso mais simples (panic).

## Impacto
- Validade técnica: **confirmed**
- Entrada controlada pelo atacante: **sim** (a própria chave malformada de quem chama a função — não é um atacante forjando a chave de outra pessoa)
- Atacante: qualquer parte que forneça uma string de chave privada Solana malformada — um usuário digitando errado ao importar uma carteira, ou, com impacto maior, um serviço de backend que aceite chaves de múltiplos usuários e chame esta função por request
- Vítima: o processo/serviço que chama a função — se rodar num backend compartilhado processando múltiplos usuários no mesmo processo/goroutine sem `recover()` por request, um único input malformado de um usuário pode derrubar o processamento de outros usuários no mesmo lote
- Fronteira de segurança: validação de entrada antes de expor o resultado a operações que assumem comprimento fixo (`ed25519.PrivateKey.Public()`)
- Resultado observado: panic real e reproduzível, não simulado
- C/I/A: **nenhum/nenhum/alto** — é um bug de robustez/disponibilidade, não de confidencialidade ou integridade de fundos
- Escopo do impacto: além do próprio usuário que forneceu a chave malformada — potencialmente outros usuários processados no mesmo processo/backend
- Gate de impacto: **PASS** — impacto reportável confirmado; isto não satisfaz o gate separado de novidade

**Ceticismo sobre severidade/alcance:** isto não é perda de fundos direta. O impacto real é robustez/disponibilidade: (a) qualquer app/serviço que siga o README ao pé da letra crasheia com input de usuário minimamente malformado em vez de devolver erro tratável; (b) se usado server-side processando chaves de múltiplos usuários no mesmo processo, pode ser DoS cross-user real, não só self-harm. Não encontrei uso deste helper dentro do próprio SDK (só exportado como API pública do subpacote `base`) — a explorabilidade real depende de como consumidores externos (potencialmente a própria OKX) usam o pacote, a mesma limitação epistêmica documentada nos dois achados-irmãos deste mesmo repositório.

## Correção sugerida
```go
func PrivateKeyFromBase58(privkey string) (PrivateKey, error) {
	res := base58.Decode(privkey)
	if len(res) != 64 { // ou o comprimento correto esperado
		return nil, errors.New("invalid private key length")
	}
	return res, nil
}
```
Espelhar a validação que `PublicKeyFromBase58`, no mesmo arquivo, já faz. Como defesa adicional, considerar propagar erro real de `base58.Decode` (ou trocar pela implementação `FastBase58DecodingAlphabet`, já presente no mesmo pacote, que detecta caractere inválido) em vez de retornar `[]byte("")` silenciosamente.

## Divulgação obrigatória de uso de IA

Este trabalho utilizou ferramentas assistidas por IA para descoberta, tooling, análise e preparação do rascunho. Antes do envio, o pesquisador revisou independentemente o código, executou a PoC e confirmou pessoalmente cada alegação técnica e de impacto.

---

## Checagem de duplicata
- Data: 2026-09-04
- Fontes: `github_issues` (busca por "panic" OR "bad seed length" OR "private key" em `okx/go-wallet-sdk`: 5 resultados, todos sobre bugs completamente diferentes — decode de transação Solana, derivation path, assinatura Schnorr Bitcoin — nenhum relacionado a este achado), `github_advisories` (nenhum publicado neste repositório), `web_search` ("okx go-wallet-sdk panic bad seed length ed25519 private key vulnerability" — nenhum hit específico a este SDK; achado de contexto: o mesmo padrão geral "ed25519 bad seed length panic" já apareceu em [vegaprotocol/vega#768](https://github.com/vegaprotocol/vega/issues/768), projeto totalmente diferente — confirma que é uma classe de bug conhecida em geral, não que este achado específico já foi reportado)
- Correspondência pública encontrada: **não**
- Classificação registrada: **longstanding_exposure** — commit real `021275dbe7bff1ae0e7897446b10313953b1144e` (criação do arquivo, 2023-07-20), **1142 dias** confirmados via git; isto é evidência de idade, não de novidade
- Gate anti-duplicate: **BLOCK** — não é regressão recente; longa exposição aumenta a chance de report privado anterior. Não enviar com a evidência atual.

---
*Rascunho revisado manualmente em 2026-09-04 a partir do achado `OKG::okx/go-wallet-sdk/coins/solana/base/keys.go::PrivateKeyFromBase58::ai_deep_read_finding`. Raciocínio bruto completo da investigação em `ledger/ledger.research.jsonl` e no campo `reasoning` do achado no banco.*
