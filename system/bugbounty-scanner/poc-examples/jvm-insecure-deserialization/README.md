# Exemplo de referência — PoC JVM real (não é um achado novo)

Isso NÃO é uma vulnerabilidade encontrada por esta missão — é um
exemplo de trabalho, real e executável, do padrão `insecure_deserialization`
que `heuristics-jvm.mjs` (`findInsecureDeserialization`) sinaliza:
`ObjectInputStream` sobre bytes não confiáveis, sem
`ObjectInputFilter`/allowlist de classe (CWE-502).

`Probe`/`readObject()` é um estágio-de-prova, não um gadget de RCE de
verdade — só seta uma flag observável, suficiente pra provar o núcleo
real do bug (o desserializador instancia e RODA código de uma classe
que o ATACANTE escolheu, não a vítima). Nunca invoca
`Runtime.exec`/`ProcessBuilder`/qualquer sink perigoso de verdade —
mesmo princípio de menor impacto já usado nas PoCs Solidity/Go desta
missão: provar o mínimo necessário, nunca o dano máximo possível.

## Rodar (sem Gradle/Maven — plain `javac`/`java`, zero dependência)

```
cd system/bugbounty-scanner/poc-examples/jvm-insecure-deserialization
javac *.java
java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 PocMain
```

Saída real esperada:
```
Probe.readObject() rodou -- desserializador instanciou uma classe escolhida pelo atacante.
PASS: VulnerableDeserializer.deserialize() instanciou e rodou uma classe escolhida pelo atacante a partir de bytes não confiáveis.
```
(código de saída 0)

## Achado real de projeto encontrado ao rodar isso (não escondido)

Esta pasta não tem `kotlinc`/Gradle/Maven instalados neste ambiente —
usei Java puro (`javac`/`java`) em vez de reproduzir o build system
completo de um projeto Kotlin real (`wire-schema`/`hermit`, os alvos
Kotlin reais desta missão, ambos em Block Open Source — programa
banido pra pesquisa assistida por IA, por isso este exemplo usa um
alvo sintético, não um repositório real do programa). Pra achado real
num projeto Gradle/Maven, o comando de verdade é o próprio runner do
projeto (`./gradlew test --tests "..."` ou `mvn test
-Dtest=...`), não `javac` direto — este exemplo prova o mecanismo da
JVM em si (desserialização nativa é insegura por design), não
substitui rodar dentro do build system real quando houver um achado
Kotlin de verdade pra investigar.
