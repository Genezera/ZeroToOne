// Gerado automaticamente por promote-targets.mjs (via discovery-runner.mjs)
// -- NÃO editar à mão, a próxima rodada de promoção sobrescreve este
// arquivo inteiro. Curadoria manual continua em targets-<linguagem>.mjs,
// nunca aqui. Cada entrada carrega score+reasons documentando por que foi
// promovida (mesmo princípio de evidence-grade.mjs/quarantine.mjs: nunca
// inventar confiança sem justificar de onde ela vem).
//
// Ver research/bugbounty/targets-auto-promoted-log.json para o histórico
// completo de toda rodada, incluindo o que foi CONSIDERADO e recusado
// (linguagem não suportada, repo grande demais, programa bloqueado) --
// nunca um corte silencioso.

export const AUTO_PROMOTED_TARGETS = [
  {
    "program": "Kubernetes",
    "platform": "HackerOne",
    "owner": "kubernetes",
    "repo": "apimachinery",
    "branch": "master",
    "maxBountyUsd": null,
    "pathPrefixes": [],
    "language": "go",
    "score": 20,
    "reasons": [
      "901 estrelas no GitHub — indício de uso real, não projeto de brinquedo",
      "atividade recente (push nos últimos 90 dias) — código em manutenção ativa"
    ],
    "promotedAt": "2026-08-31T18:44:50.517Z"
  },
  {
    "program": "OKG",
    "platform": "HackerOne",
    "owner": "okx",
    "repo": "go-wallet-sdk",
    "branch": "main",
    "maxBountyUsd": null,
    "pathPrefixes": [],
    "language": "go",
    "score": 10,
    "reasons": [
      "574 estrelas no GitHub — indício de uso real, não projeto de brinquedo"
    ],
    "promotedAt": "2026-08-31T18:44:50.517Z"
  },
  {
    "program": "Exodus",
    "platform": "HackerOne",
    "owner": "ExodusOSS",
    "repo": "crypto",
    "branch": "master",
    "maxBountyUsd": null,
    "pathPrefixes": [],
    "language": "js",
    "score": 0,
    "reasons": [],
    "promotedAt": "2026-08-31T18:44:50.517Z"
  },
  {
    "program": "Exodus",
    "platform": "HackerOne",
    "owner": "ExodusOSS",
    "repo": "hydra",
    "branch": "master",
    "maxBountyUsd": null,
    "pathPrefixes": [],
    "language": "js",
    "score": 0,
    "reasons": [],
    "promotedAt": "2026-08-31T18:44:50.517Z"
  }
];
