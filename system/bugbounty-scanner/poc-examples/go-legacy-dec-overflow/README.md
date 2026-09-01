# Exemplo de referência — PoC Go real (não é um achado novo)

Isso NÃO é uma vulnerabilidade encontrada por esta missão — é um exemplo
de trabalho, real e executável, de como escrever e rodar uma PoC pra
achado Go, pro mesmo padrão que `README.md` (seção "Prova de conceito
executável — Go") descreve em prosa. Usa uma vulnerabilidade já
pública, já corrigida e já retratada pelo próprio autor do pacote
(`cosmossdk.io/math` v1.1.2, GHSA-7225-m954-23v7/ASA-2024-010) —
escolhida justamente por ser segura de demonstrar sem risco de
divulgar algo novo.

## Rodar

```
cd system/bugbounty-scanner/poc-examples/go-legacy-dec-overflow
go test -v ./...
```

Saída real esperada:
```
=== RUN   TestLegacyDecMulOverflowPanics
    poc_test.go:25: PoC result: Mul panicked as expected: Int overflow
--- PASS: TestLegacyDecMulOverflowPanics (0.00s)
PASS
```

`go.mod` pina a versão exata retratada (`v1.1.2`) — `go get` já avisa
sozinho: `retracted by module author: Bit length differences between
Int and Dec`, confirmação independente e direta do mecanismo, vinda do
próprio autor do pacote, não só da minha leitura de diff.

## Lição real capturada aqui (não escondida)

Tentei originalmente também escrever um teste de controle contra a
versão corrigida (`v1.4.0`) pra mostrar "a mesma operação não panica
mais depois do fix" — **o valor que escolhi (10^40) panica nas DUAS
versões**, porque é grande o bastante pra violar tanto o limite antigo
(mal calculado) quanto o novo limite correto (`±2^256×10^18`, via
`IsInValidRange()`). O fix não foi "nunca mais panicar" — foi trocar um
cálculo de limite por bit-length inconsistente por uma checagem de
faixa de valor consistente, mantendo o panic pra valor genuinamente
fora da faixa. Um valor "só grande o bastante pra estourar o limite
antigo" não prova por si só qual CVE específico foi corrigido — pra
isso seria preciso um valor dentro da janela estreita de discrepância
entre os dois cálculos, não só "gigante". Registrado aqui como
armadilha real pra quem for escrever a próxima PoC deste tipo: PoC
grande demais prova "há um limite", não "este é o limite certo".
