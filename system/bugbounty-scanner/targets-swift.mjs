// Repositórios Swift/ObjC do programa Block Open Source (Bugcrowd). Ver
// research/bugbounty/block-open-source/NOTES.md para o porquê da escolha.
// Escopo restrito a Sources/ — exclui apps de demonstração/exemplo e
// testes, que não é código que roda no app de quem instala o SDK.

export const SWIFT_TARGETS = [
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'afterpay',
    repo: 'sdk-ios',
    branch: 'master',
    maxBountyUsd: 5000,
    pathPrefixes: ['Sources/'],
  },
  {
    program: 'Block Open Source',
    platform: 'Bugcrowd',
    owner: 'cashapp',
    repo: 'cash-app-pay-ios-sdk',
    branch: 'main',
    maxBountyUsd: 5000,
    pathPrefixes: ['Sources/'],
  },
];
