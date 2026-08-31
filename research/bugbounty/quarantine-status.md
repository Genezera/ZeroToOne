# Regras em quarentena

Gerado automaticamente por `quarantine.mjs` a cada rodada do scanner. Não editar à mão.

55 candidato(s) suprimido(s) nesta rodada por regra quarentenada.

| Tipo | Linguagem | Revisados | Falso-positivo | Taxa FP |
|---|---|---|---|---|
| ssrf_risk | js | 13 | 13 | 100% |

**Como tirar uma regra da quarentena:** reescreva a heurística de verdade em `heuristics-*.mjs` (o objetivo é resolver a causa do falso-positivo, não só esperar passar) e adicione a chave `"tipo::linguagem"` em `research/bugbounty/quarantine-overrides.json` (array de strings). Isso libera a regra pra voltar a gerar candidato — se ela continuar ruim, a estatística vai refletir isso nas próximas revisões e ela pode voltar a ser quarentenada.
