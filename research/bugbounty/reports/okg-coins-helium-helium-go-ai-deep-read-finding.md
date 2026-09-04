# ⚠️ RASCUNHO — REVISÃO EDITORIAL + HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de leitura de código-fonte público e execução local de PoC (nunca contra a infraestrutura real da OKX). **Não foi enviado a nenhuma plataforma.** Antes de copiar/colar e enviar, confira:

- [ ] Escopo reconfirmado na página real do programa (`check-scope` real: `github.com/okx/go-wallet-sdk`, `SOURCE_CODE`, `eligibleForBounty:true`, `eligibleForSubmission:true`, `maxSeverity:critical`)
- [ ] Categoria bate com o que o programa declara elegível
- [ ] Evidência/PoC conferida linha por linha (não é paráfrase/alucinação)
- [ ] Checagem de duplicata está atualizada (feita 2026-09-04; ver seção própria)
- [ ] Confirmar com a OKX (ou assumir explicitamente a limitação) se `Sign`/`NewAddress` são chamadas por algum serviço de backend com input de múltiplos usuários no mesmo processo — muda a severidade prática de "self-DoS" para "DoS cross-user"
- [ ] Revisão humana do relatório e validação técnica independente concluídas

---

## Título
`Sign()`/`NewAddress()` em `okx/go-wallet-sdk` (Helium) panicam (DoS) com chave privada malformada por falta de validação de comprimento

## Programa / Plataforma
`OKG` via `HackerOne` — https://hackerone.com/okg

## Categoria / Severidade declarada
CWE-248 (Uncaught Exception) / CWE-20 (Improper Input Validation) levando a Denial of Service. `maxSeverity` do ativo é `critical` no scope snapshot local; severidade real deste achado é DoS de robustez, não perda de fundos direta (ver Impacto).

## Ativo afetado
- Repositório: `okx/go-wallet-sdk`
- Arquivo: `coins/helium/helium.go`
- Funções: `Sign(private string, ...)` e `NewAddress(private string)` — ambas funções públicas de topo do SDK para Helium
- Commit no momento da análise: `12fec6b0616347265efcc23bfc240c155da710eb`
- Confiança da evidência de deploy: **low** — são as próprias funções públicas exportadas de tratamento de chave privada Helium do SDK (não código morto/interno), mas sem confirmação direta de qual produto/serviço OKX específico as chama nem com que tipo de input.

## Resumo
`Sign` e `NewAddress` recebem `private` (string hex da chave privada, tipicamente entrada do usuário ao importar uma carteira) e chamam `keypair.NewKeypairFromHex(1, private)`, que decodifica o hex sem checar o comprimento resultante antes de atribuí-lo à chave privada interna. `NewAddress` → `CreateAddressable()` e `Sign` → `Keypair.Sign` chamam então `ed25519.NewKeyFromSeed(...)` diretamente sobre esse valor não validado. A stdlib Go documenta que `NewKeyFromSeed` **panica** (não retorna erro) se o comprimento do seed for diferente de 32 bytes — qualquer chave privada hex de comprimento incorreto derruba o processo nas duas funções.

## Cadeia de chamada confirmada
- `coins/helium/helium.go::Sign` (linha ~9) e `::NewAddress` (linha ~32) — ambas chamam `keypair.NewKeypairFromHex(1, private)` (`coins/helium/keypair/keypair.go:37`), que faz `hex.DecodeString(privHex)` sem checar o comprimento resultante antes de atribuir a `kp.privateKey`.
- `NewAddress` → `CreateAddressable()` (`keypair.go:63`) chama `ed25519.NewKeyFromSeed(kp.privateKey)` diretamente.
- `Sign` → `Keypair.Sign` (`keypair.go:106`) idem.
- `crypto/ed25519.NewKeyFromSeed` (stdlib Go): panica se `len(seed) != 32` — comportamento documentado, não um bug da stdlib.
- Mesma classe de bug dos dois achados-irmãos já confirmados neste mesmo repositório/programa (`coins/solana/base/keys.go::PrivateKeyFromBase58` e `coins/elrond/elrond.go::Transfer`).
- **Nota lateral, fora do escopo deste achado** (documentada por transparência, não investigada em profundidade): `keypair.NewAddressable` (`address.go:23`) tem um padrão semelhante (`base58.Decode` sem checar erro, `slice` sem checar comprimento mínimo) no parâmetro `from`/`to` de `Sign` — candidato a uma rodada futura, não incluído aqui. Também verificado, **sem achado**: `coins/waves/crypto/crypto.go::GenerateSecretKey` tem o mesmo padrão de slice sem checar comprimento, mas o único chamador interno do SDK sempre alimenta um digest SHA-256 de 32 bytes fixo — sem seed controlado por atacante alcançando a função diretamente via API pública, não caracteriza achado explorável dentro deste SDK.

## Pré-requisitos
Nenhum privilégio especial — qualquer string hex que não decodifique para exatamente 32 bytes. Toda a validação foi feita com clone público do repositório e execução local (`go test`), sem tocar rede, conta ou infraestrutura real.

## Passo a passo de reprodução
1. Clonar `okx/go-wallet-sdk` no commit acima.
2. Chamar `helium.NewAddress("deadbeef")` (4 bytes após hex-decode) — bem menos que os 32 bytes esperados.
3. Observar o panic: `ed25519: bad seed length: 4`.
4. Separadamente, chamar `helium.Sign("ab", <base58 válido>, ...)` (1 byte após hex-decode).
5. Observar o panic: `ed25519: bad seed length: 1`.

## Resultado atual vs. esperado
- **Atual:** nenhuma validação de comprimento entre o hex-decode da chave privada e `ed25519.NewKeyFromSeed`, nas duas funções.
- **Esperado:** validar `len(privateKeyBytes) == 32` logo após o decode em `NewKeypairFromHex`, devolvendo erro tratável em vez de deixar o panic propagar.

## Evidência
```go
// coins/helium/helium.go -- Sign e NewAddress chamam NewKeypairFromHex sem validação a jusante
func NewAddress(private string) (string, error) {
    kp, err := keypair.NewKeypairFromHex(1, private)
    ...
    return kp.CreateAddressable() // -> ed25519.NewKeyFromSeed(kp.privateKey) sem checagem de tamanho
}

// coins/helium/keypair/keypair.go -- NewKeypairFromHex (sem checar comprimento do decode)
func NewKeypairFromHex(keyType int, privHex string) (*Keypair, error) {
    privateKey, err := hex.DecodeString(privHex)
    if err != nil {
        return nil, err
    }
    return &Keypair{privateKey: privateKey, ...}, nil // len(privateKey) nunca checado aqui
}
```

## Prova de conceito executável
Teste Go real, executado localmente contra o clone público (`go test`), sem tocar rede/conta real:

```
=== RUN   TestNewAddress_PanicsOnShortPrivateKey
    panic_poc_test.go:15: confirmed panic (as predicted): ed25519: bad seed length: 4
--- PASS: TestNewAddress_PanicsOnShortPrivateKey (0.00s)
=== RUN   TestSign_PanicsOnShortPrivateKey
    panic_poc_test.go:28: confirmed panic (as predicted): ed25519: bad seed length: 1
--- PASS: TestSign_PanicsOnShortPrivateKey (0.00s)
PASS
ok  	github.com/okx/go-wallet-sdk/coins/helium	0.004s
```

Teste ficou apenas no clone local efêmero desta sessão (`coins/helium/panic_poc_test.go`), nunca commitado ou enviado a lugar nenhum — reproduzível por qualquer pessoa com Go instalado e o clone público do repositório.

## Impacto
- Validade técnica: **confirmed**
- Entrada controlada pelo atacante: **sim** (a própria chave malformada de quem chama — não um atacante forjando a chave de outra pessoa)
- Atacante: qualquer parte que forneça uma chave privada hex de comprimento incorreto — um usuário digitando errado ao importar uma carteira, ou, com impacto maior, um serviço de backend que aceite chaves de múltiplos usuários e chame estas funções por request
- Vítima: o processo/serviço que chama `Sign`/`NewAddress` — se rodar num backend compartilhado sem `recover()` por request, um único input malformado de um usuário pode derrubar o processamento de outros usuários no mesmo lote
- Fronteira de segurança: validação de comprimento entre o decode da chave e `ed25519.NewKeyFromSeed`, que documentadamente panica fora do tamanho esperado
- Resultado observado: panic real e reproduzível nas duas funções, não simulado
- C/I/A: **nenhum/nenhum/alto**
- Escopo do impacto: além do próprio usuário que forneceu a chave malformada — potencialmente outros usuários processados no mesmo processo/backend
- Gate atual: **PASS** — impacto reportável confirmado

**Ceticismo sobre severidade/alcance:** mesma classe dos dois achados-irmãos deste repositório (DoS/robustez, não perda de fundos direta). Não confirmo uso real server-side das duas funções — só o código-fonte público; a explorabilidade prática exata depende de como consumidores externos (potencialmente a própria OKX) integram o pacote.

## Correção sugerida
```go
func NewKeypairFromHex(keyType int, privHex string) (*Keypair, error) {
    privateKey, err := hex.DecodeString(privHex)
    if err != nil {
        return nil, err
    }
    if len(privateKey) != ed25519.SeedSize { // 32
        return nil, errors.New("invalid private key length")
    }
    return &Keypair{privateKey: privateKey, ...}, nil
}
```
Validar o comprimento uma única vez em `NewKeypairFromHex` corrige `Sign` e `NewAddress` ao mesmo tempo, já que ambas passam por este construtor comum.

---

## Checagem de duplicata
- Data: 2026-09-04
- Fontes: `github_issues` (busca por "panic" OR "bad seed length" OR "private key" em `okx/go-wallet-sdk`: 5 resultados, todos sobre bugs completamente diferentes — decode de transação Solana, derivation path, assinatura Schnorr Bitcoin — nenhum relacionado), `github_advisories` (nenhum publicado neste repositório), `web_search` ("okx go-wallet-sdk panic bad seed length ed25519 private key vulnerability" — nenhum hit específico a este SDK; único achado de contexto foi [vegaprotocol/vega#768](https://github.com/vegaprotocol/vega/issues/768), o mesmo padrão geral de bug num projeto totalmente diferente)
- Correspondência pública encontrada: **não**
- Classificação de novidade: **longstanding_exposure** — commit real `5cd6c132d6382bfbcaa53af013efeacfd88d30f5` ("add coin helium and unit test", 2023-11-07), **1032 dias** de exposição pública contínua confirmados via `verify-longstanding-exposure` (clone real, `git show`/`merge-base --is-ancestor`), ainda ancestral de `origin/HEAD`

> Mesmo achado-irmão de `kubernetes/publishing-bot` desta sessão: o bug é design/omissão original de mais de 2 anos, não regressão recente. Usado aqui o segundo caminho de prova do pipeline (exposição pública de longa data verificada, ver `novelty-risk.mjs::MIN_LONGSTANDING_EXPOSURE_DAYS`).

---
*Rascunho revisado manualmente em 2026-09-04 a partir do achado `OKG::okx/go-wallet-sdk/coins/helium/helium.go::Sign+NewAddress::ai_deep_read_finding`. Raciocínio bruto completo da investigação em `ledger/ledger.research.jsonl` e no campo `reasoning` do achado no banco.*
