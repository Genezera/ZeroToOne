# Regras em quarentena

Gerado automaticamente por `quarantine.mjs` a cada rodada do scanner. Não editar à mão.

4 candidato(s) suprimido(s) nesta rodada por regra quarentenada.

| Tipo | Linguagem | Revisados | Falso-positivo | Taxa FP |
|---|---|---|---|---|
| eval_usage | js | 11 | 11 | 100% |
| known_vulnerable_dependency | go | 119 | 119 | 100% |
| known_vulnerable_dependency | js | 223 | 223 | 100% |
| redos_risk | js | 6 | 6 | 100% |
| semgrep_math_random_used | go | 22 | 22 | 100% |
| semgrep_use_of_unsafe_block | go | 231 | 231 | 100% |
| ssrf_risk | js | 13 | 13 | 100% |

**Como tirar uma regra da quarentena:** reescreva a heurística de verdade em `heuristics-*.mjs` (o objetivo é resolver a causa do falso-positivo, não só esperar passar) e adicione a chave `"tipo::linguagem"` em `research/bugbounty/quarantine-overrides.json` (array de strings). Isso libera a regra pra voltar a gerar candidato — se ela continuar ruim, a estatística vai refletir isso nas próximas revisões e ela pode voltar a ser quarentenada.
