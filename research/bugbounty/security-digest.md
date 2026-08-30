# Digest de segurança — pacotes observados

Gerado automaticamente por `cve-digest.mjs` na rodada semanal de descoberta (2026-08-30T13:00:15.588Z). Não editar à mão.

Cruza contra os Security Advisories do GitHub (GHSA), filtrado só pelos
pacotes que o `dep-scanner.mjs` já achou vulnerável pelo menos uma vez —
não é um feed geral de CVE (isso seria majoritariamente ruído). Cada linha
aqui é candidato a **decisão manual** (ou de revisão por IA numa rodada
futura) sobre criar heurística nova — este arquivo nunca escreve detecção
sozinho.

## github.com/cloudflare/circl

| Advisory | Severidade | Resumo | Publicado |
|---|---|---|---|
| [GHSA-q9hv-hpm4-hj6x](https://github.com/advisories/GHSA-q9hv-hpm4-hj6x) | low | CIRCL has an incorrect calculation in secp384r1 CombinedMult | 2026-02-25 |
| [GHSA-522r-9946-fw43](https://github.com/advisories/GHSA-522r-9946-fw43) | low | Duplicate Advisory: CIRCL-Fourq: Missing and wrong validation can lead to incorrect results | 2025-08-06 |
| [GHSA-2x5j-vhc8-9cwm](https://github.com/advisories/GHSA-2x5j-vhc8-9cwm) | low | CIRCL-Fourq: Missing and wrong validation can lead to incorrect results | 2025-06-10 |
| [GHSA-9763-4f94-gfch](https://github.com/advisories/GHSA-9763-4f94-gfch) | high | CIRCL's Kyber: timing side-channel (kyberslash2) | 2024-01-08 |
| [GHSA-2q89-485c-9j2x](https://github.com/advisories/GHSA-2q89-485c-9j2x) | medium | Improper random reading in CIRCL | 2023-05-11 |

## golang.org/x/crypto

| Advisory | Severidade | Resumo | Publicado |
|---|---|---|---|
| [GHSA-x527-x647-q7gg](https://github.com/advisories/GHSA-x527-x647-q7gg) | critical | golang.org/x/crypto: Invoking VerifiedPublicKeyCallback permissions skip enforcement | 2026-06-25 |
| [GHSA-5cgq-3rg8-m6cv](https://github.com/advisories/GHSA-5cgq-3rg8-m6cv) | critical | golang.org/x/crypto vulnerable to auth bypass via unenforced @revoked status | 2026-06-25 |
| [GHSA-rm3j-f69w-wqmq](https://github.com/advisories/GHSA-rm3j-f69w-wqmq) | critical | golang.org/x/crypto vulnerable to infinite loop on large channel writes | 2026-06-25 |
| [GHSA-89gr-r52h-f8rx](https://github.com/advisories/GHSA-89gr-r52h-f8rx) | critical | golang.org/x/crypto: FIDO/U2F security key physical presence check can be bypassed | 2026-06-25 |
| [GHSA-w879-237q-wc7r](https://github.com/advisories/GHSA-w879-237q-wc7r) | high | golang.org/x/crypto: Invoking pathological RSA/DSA parameters may cause DoS | 2026-06-25 |
| [GHSA-vgwf-h737-ff37](https://github.com/advisories/GHSA-vgwf-h737-ff37) | critical | golang.org/x/crypto: Invoking client can cause server deadlock on unexpected responses | 2026-06-25 |
| [GHSA-qpw4-5x99-6vjp](https://github.com/advisories/GHSA-qpw4-5x99-6vjp) | medium | golang.org/x/crypto: Invoking memory leak when rejecting channels can lead to DoS | 2026-06-25 |
| [GHSA-78mq-xcr3-xm33](https://github.com/advisories/GHSA-78mq-xcr3-xm33) | medium | golang.org/x/crypto is vulnerable to invoking server panic during CheckHostKey/Authenticate flow | 2026-06-25 |
| [GHSA-45gg-vh54-h5m9](https://github.com/advisories/GHSA-45gg-vh54-h5m9) | medium | golang.org/x/crypto vulnerable to invoking bypass of certificate restrictions | 2026-06-25 |
| [GHSA-q4h4-gmj2-qvw2](https://github.com/advisories/GHSA-q4h4-gmj2-qvw2) | high | golang.org/x/crypto: Invoking byte arithmetic causes underflow and panic | 2026-06-25 |

## org.jetbrains.kotlin:kotlin-gradle-plugin

| Advisory | Severidade | Resumo | Publicado |
|---|---|---|---|
| [GHSA-r937-wjx7-w2jp](https://github.com/advisories/GHSA-r937-wjx7-w2jp) | medium | JetBrains Kotlin: Unsafe Deserialization in Kotlin Build Cache Enables Code Execution | 2026-06-26 |
