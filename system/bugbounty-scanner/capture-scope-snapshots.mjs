import { createHash } from 'node:crypto';
import { buildScopeSnapshot, saveSnapshot } from './scope-registry.mjs';
import { TARGETS } from './targets.mjs';

const H1_DATA_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/hackerone_data.json';
const BC_DATA_URL = 'https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/bugcrowd_data.json';

// Prazo/categoria/PoC/safe-harbor confirmados manualmente contra a
// página oficial (Immunefi é server-rendered — fetch simples já traz o
// conteúdo real, sem precisar de navegador). Ver
// docs/zerotoone-v2/current-state.md para a citação completa capturada
// em 30/08/2026.
const IMMUNEFI_STACKINGDAO_POLICY = {
  categoriesEligible: [
    'Smart Contracts — Critical (até $100.000; 10% dos fundos diretamente afetados, mínimo $20.000)',
    'Smart Contracts — High (até $20.000; $1.000–$20.000 por roubo/congelamento de yield não reclamado)',
  ],
  categoriesExcluded: [
    'Vulnerabilidade já reportada em auditoria anterior e ainda não corrigida',
  ],
  prohibitedTechniques: [
    'Qualquer teste em mainnet ou código já implantado em testnet público',
    'Teste contra oráculo de preço ou contrato de terceiro',
    'Phishing / engenharia social',
    'Ataque de negação de serviço',
    'Divulgação pública de vulnerabilidade não corrigida',
  ],
  pocRequirements: 'Proof of concept é sempre exigida, para toda severidade ("Proof of concept is always required for all severities").',
  rateLimits: null,
  disclosurePolicy: 'Categoria 3 — divulgação responsável requer aprovação prévia do programa.',
  communitySourceNote: 'Página oficial Immunefi é server-rendered; fetch direto (sem navegador) confirma o conteúdo. Testnet/mock explicitamente fora de "Primacy of Impact".',
};

// arkadiyt/bounty-targets-data é um repositório de terceiro, alheio ao
// escopo do GITHUB_TOKEN desta sessão (que só tem acesso a
// genezera/zerotoone) -- enviar Authorization: Bearer com um token
// instalado/escopado a OUTRO repositório faz raw.githubusercontent.com
// devolver 404 em vez de servir o arquivo público anonimamente (achado
// real nesta rodada: a chamada quebrava só quando GITHUB_TOKEN estava
// presente no ambiente). Fetch deliberadamente anônimo aqui -- é um
// arquivo raw público, sem necessidade de autenticação nenhuma.
async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ZeroToOne-bugbounty-scanner' } });
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  return res.json();
}

function toAssetList(inScope) {
  return (inScope || []).map((t) => ({
    assetIdentifier: t.asset_identifier || t.target || t.uri || t.name,
    assetType: t.asset_type || t.type || 'OTHER',
    eligibleForBounty: t.eligible_for_bounty ?? null,
    eligibleForSubmission: t.eligible_for_submission ?? null,
    maxSeverity: t.max_severity ?? null,
    instruction: t.instruction ?? null,
  }));
}

/**
 * Constrói (sem gravar em disco) os 4 snapshots reais do sistema, a
 * partir do dataset comunitário ao vivo + prosa de política confirmada
 * manualmente para o programa Immunefi (o único cuja página oficial é
 * fetchável sem navegador autenticado — StackingDAO). Para os 3
 * programas HackerOne/Bugcrowd, a prosa fica null/low-confidence até
 * captura assistida por humano — ver communitySourceNote de cada um.
 */
export async function captureAllSnapshots({ fetchJsonFn = fetchJson } = {}) {
  const [h1Raw, bcRaw] = await Promise.all([fetchJsonFn(H1_DATA_URL), fetchJsonFn(BC_DATA_URL)]);

  const circle = h1Raw.find((p) => p.handle === 'circle-bbp');
  const vercel = h1Raw.find((p) => p.handle === 'vercel-open-source');
  const okg = h1Raw.find((p) => p.handle === 'okg');
  const kubernetes = h1Raw.find((p) => p.handle === 'kubernetes');
  const kiwicom = h1Raw.find((p) => p.handle === 'kiwicom');
  const slack = h1Raw.find((p) => p.handle === 'slack');
  const block = bcRaw.find((p) => (p.name || '').toLowerCase().includes('block open source'));
  const auth0 = bcRaw.find((p) => (p.name || '').toLowerCase().includes('auth0'));
  const mattermost = bcRaw.find((p) => (p.name || '').toLowerCase().includes('mattermost'));
  const stackingDaoRaw = h1Raw.find((p) => p.handle === 'stackingdao' || (p.name || '').toLowerCase() === 'stackingdao');

  const capturedAt = new Date().toISOString();
  const snapshots = [];

  if (circle) {
    snapshots.push(buildScopeSnapshot({
      program: 'Circle BBP',
      platform: 'HackerOne',
      officialUrl: 'https://hackerone.com/circle-bbp',
      sourceType: 'community_dataset_structured',
      sourceDetail: 'arkadiyt/bounty-targets-data, hackerone_data.json, handle circle-bbp',
      rawSourceContent: circle,
      assets: toAssetList(circle.targets && circle.targets.in_scope),
      confidence: 'medium',
      capturedAt,
      communitySourceNote: 'Página oficial HackerOne é SPA renderizada por JS/exige sessão autenticada — WebFetch e WebSearch confirmaram (30/08/2026) que não é possível capturar a prosa de política sem navegador logado. Flags de elegibilidade por ativo (eligible_for_bounty/eligible_for_submission) vêm do espelho estruturado do dataset comunitário, que reflete a API pública que a própria página HackerOne usa.',
    }));
  }
  if (vercel) {
    snapshots.push(buildScopeSnapshot({
      program: 'Vercel Open Source',
      platform: 'HackerOne',
      officialUrl: 'https://hackerone.com/vercel-open-source',
      sourceType: 'community_dataset_structured',
      sourceDetail: 'arkadiyt/bounty-targets-data, hackerone_data.json, handle vercel-open-source',
      rawSourceContent: vercel,
      assets: toAssetList(vercel.targets && vercel.targets.in_scope),
      confidence: 'medium',
      capturedAt,
      communitySourceNote: 'Mesma limitação do Circle BBP: página oficial não fetchável sem sessão autenticada. Estrutura de tier (Tier 1/2/3 OSS) confirmada pelos próprios rótulos do dataset.',
    }));
  }
  if (okg) {
    snapshots.push(buildScopeSnapshot({
      program: 'OKG',
      platform: 'HackerOne',
      officialUrl: 'https://hackerone.com/okg',
      sourceType: 'community_dataset_structured',
      sourceDetail: 'arkadiyt/bounty-targets-data, hackerone_data.json, handle okg',
      rawSourceContent: okg,
      assets: toAssetList(okg.targets && okg.targets.in_scope),
      confidence: 'medium',
      capturedAt,
      communitySourceNote: 'Programa auto-descoberto pelo pipeline de promoção (não um dos 4 alvos originais desta missão) — mesma limitação dos demais HackerOne: página oficial não fetchável sem sessão autenticada. Snapshot criado especificamente para desbloquear check-scope do achado cosmossdk.io/math (okx/go-wallet-sdk), que estava capado em corroborated_static por falta deste arquivo.',
    }));
  }
  if (kubernetes) {
    // 12 alvos Go já rastreados em targets-go.mjs (auto-promovidos) nunca
    // tiveram snapshot formal capturado -- achado real, 02/09/2026,
    // exatamente quando um achado precisou de check-scope pra avançar.
    // Confirmado ao vivo contra o dataset bruto antes deste bloco existir:
    // `kubernetes/cluster-bootstrap` tem eligible_for_bounty=true,
    // eligible_for_submission=true, max_severity="critical".
    snapshots.push(buildScopeSnapshot({
      program: 'Kubernetes',
      platform: 'HackerOne',
      officialUrl: 'https://hackerone.com/kubernetes',
      sourceType: 'community_dataset_structured',
      sourceDetail: 'arkadiyt/bounty-targets-data, hackerone_data.json, handle kubernetes',
      rawSourceContent: kubernetes,
      assets: toAssetList(kubernetes.targets && kubernetes.targets.in_scope),
      confidence: 'medium',
      capturedAt,
      communitySourceNote: 'Mesma limitação de Circle BBP/Vercel: página oficial HackerOne é SPA que exige sessão autenticada, WebFetch e a aba Browser (sem login) confirmaram isso de novo ao vivo nesta sessão. Flags de elegibilidade por ativo vêm do espelho estruturado do dataset comunitário, que reflete a API pública que a própria página usa.',
    }));
  }
  if (kiwicom) {
    // Kiwi.com promovido automaticamente pelo pipeline de descoberta
    // (02/09/2026, rodada de rotação maior pedida pelo usuário) -- mesma
    // situação de Kubernetes/OKG antes deste arquivo cobri-los: alvos já
    // ativos na varredura sem nenhum snapshot formal, bloqueando check-scope
    // exatamente quando um achado real (js-iam-middleware, argumento
    // posicional trocado em isUserAuthorized -> getUser) precisou avançar.
    snapshots.push(buildScopeSnapshot({
      program: 'Kiwi.com',
      platform: 'HackerOne',
      officialUrl: 'https://hackerone.com/kiwicom',
      sourceType: 'community_dataset_structured',
      sourceDetail: 'arkadiyt/bounty-targets-data, hackerone_data.json, handle kiwicom',
      rawSourceContent: kiwicom,
      assets: toAssetList(kiwicom.targets && kiwicom.targets.in_scope),
      confidence: 'medium',
      capturedAt,
      communitySourceNote: 'Mesma limitação dos demais programas HackerOne desta missão: página oficial é SPA que exige sessão autenticada. Flags de elegibilidade por ativo vêm do espelho estruturado do dataset comunitário, que reflete a API pública que a própria página usa.',
    }));
  }
  if (slack) {
    // Programa liberado por RoE em program-policy.json (roeReviewed
    // 2026-09-03, leitura real da página oficial do programa Slack no
    // HackerOne). Achado corroborated_static em slackhq/nebula (TOCTOU de
    // replay window, connection_state.go) ficou preso em `verify_scope`
    // por falta deste snapshot -- criado especificamente para desbloqueá-lo.
    // Confirmado ao vivo contra o dataset bruto: o ativo
    // "https://github.com/slackhq/nebula" (asset_type SOURCE_CODE) tem
    // eligible_for_bounty=true, eligible_for_submission=true,
    // max_severity="critical".
    snapshots.push(buildScopeSnapshot({
      program: 'Slack',
      platform: 'HackerOne',
      officialUrl: 'https://hackerone.com/slack',
      sourceType: 'community_dataset_structured',
      sourceDetail: 'arkadiyt/bounty-targets-data, hackerone_data.json, handle slack',
      rawSourceContent: slack,
      assets: toAssetList(slack.targets && slack.targets.in_scope),
      confidence: 'medium',
      capturedAt,
      communitySourceNote: 'Mesma limitação dos demais programas HackerOne desta missão: página oficial é SPA que exige sessão autenticada para a prosa completa de política (já lida manualmente e registrada em program-policy.json em 03/09/2026). Flags de elegibilidade por ativo vêm do espelho estruturado do dataset comunitário, que reflete a API pública que a própria página usa.',
    }));
  }
  if (block) {
    snapshots.push(buildScopeSnapshot({
      program: 'Block Open Source',
      platform: 'Bugcrowd',
      officialUrl: 'https://bugcrowd.com/engagements/blockopensource',
      sourceType: 'community_dataset_structured',
      sourceDetail: 'arkadiyt/bounty-targets-data, bugcrowd_data.json, name "Block Open Source"',
      rawSourceContent: block,
      assets: toAssetList(block.targets && block.targets.in_scope).map((a) => ({ ...a, eligibleForBounty: null, eligibleForSubmission: null })),
      confidence: 'low',
      capturedAt,
      communitySourceNote: 'Bugcrowd não expõe eligible_for_bounty/eligible_for_submission por ativo no dataset (só a lista de alvo) — diferente do HackerOne. Página oficial também não fetchável sem sessão. Confiança mais baixa: sabemos QUE o repo está listado como alvo, não a elegibilidade de recompensa por severidade.',
    }));
  }
  if (auth0) {
    // Primeiro alvo JVM real desde a pausa do Block Open Source
    // (31/08/2026) -- JVM_TARGETS estava vazio (README/IMPLEMENTATION_STATE.md,
    // 02/09/2026). Achado por heurística de nome de repo (android/kotlin/
    // java/spring/gradle) contra o dataset inteiro (195 candidatos), não
    // pela rotação semanal normal (que só processa um lote capado por
    // vez e ainda não tinha chegado nele). `auth0/auth0-java` confirmado
    // como alvo real "Auth0 Java SDK (auth0-java)" nos 25 ativos em
    // escopo do programa — não é candidato hipotético.
    snapshots.push(buildScopeSnapshot({
      program: 'Auth0 by Okta',
      platform: 'Bugcrowd',
      officialUrl: 'https://bugcrowd.com/engagements/auth0-okta',
      sourceType: 'community_dataset_structured',
      sourceDetail: 'arkadiyt/bounty-targets-data, bugcrowd_data.json, name "Auth0 by Okta"',
      rawSourceContent: auth0,
      assets: toAssetList(auth0.targets && auth0.targets.in_scope).map((a) => ({ ...a, eligibleForBounty: null, eligibleForSubmission: null })),
      confidence: 'low',
      capturedAt,
      communitySourceNote: 'Mesma limitação do Block Open Source: Bugcrowd não expõe eligible_for_bounty/eligible_for_submission por ativo no dataset público, só a lista de alvo. Sabemos QUE auth0/auth0-java está listado (confirmado ao vivo: "Auth0 Java SDK (auth0-java)", um dos 25 ativos em escopo), não a elegibilidade de recompensa por severidade -- precisa confirmação manual na página oficial antes de qualquer submissão real.',
    }));
  }
  if (mattermost) {
    // Programa auto-descoberto (não um dos 4 alvos originais desta missão),
    // liberado por RoE em program-policy.json (roeReviewed 2026-09-03,
    // leitura real da página oficial do engagement Bugcrowd). 3 achados
    // `corroborated_static` ficaram presos por falta deste snapshot --
    // criado especificamente para desbloquear check-scope deles.
    snapshots.push(buildScopeSnapshot({
      program: 'Mattermost Public Bug Bounty Engagement ',
      platform: 'Bugcrowd',
      officialUrl: 'https://bugcrowd.com/engagements/mattermost-mbb-public',
      sourceType: 'community_dataset_structured',
      sourceDetail: 'arkadiyt/bounty-targets-data, bugcrowd_data.json, name "Mattermost Public Bug Bounty Engagement "',
      rawSourceContent: mattermost,
      assets: toAssetList(mattermost.targets && mattermost.targets.in_scope).map((a) => ({ ...a, eligibleForBounty: null, eligibleForSubmission: null })),
      confidence: 'low',
      capturedAt,
      communitySourceNote: 'Mesma limitação de Block Open Source/Auth0: Bugcrowd não expõe eligible_for_bounty/eligible_for_submission por ativo no dataset público, só a lista de alvo. Repositórios dos 3 achados pendentes (mattermost-plugin-confluence, mattermost-plugin-msteams-meetings, mattermost-plugin-zoom) confirmados como alvos reais em escopo ("Mattermost Confluence Plugin", "Mattermost Plugin for Microsoft Teams Meetings", "Mattermost Zoom Plugin") -- elegibilidade de recompensa por severidade precisa confirmação manual na página oficial antes de qualquer submissão real.',
    }));
  }
  if (stackingDaoRaw || true) {
    // StackingDAO é Immunefi, não HackerOne — o dataset hackerone_data.json
    // não cobre Immunefi. Política/categoria confirmada por fetch direto da
    // página oficial (server-rendered). A lista de CONTRATO continua
    // curada à mão em targets.mjs (só ali sabemos por que cada endereço
    // específico foi escolhido) — mas o scope snapshot PRECISA espelhar
    // esses mesmos contratos como `assets`, senão `scopeGate` nunca acha
    // nada pra combinar e recusa QUALQUER achado do programa por padrão
    // (bug real, achado pelo agente de nuvem em 30/08/2026 tentando usar
    // check-scope de verdade — nunca fabricar um "allowed=true" sem
    // ativo real por trás, mas também nunca deixar o ativo real de fora
    // do snapshot que o gate de fato consulta).
    const stackingDaoProgram = TARGETS.find((t) => t.program === 'StackingDAO');
    const stackingDaoAssets = (stackingDaoProgram ? stackingDaoProgram.contracts : []).map((name) => ({
      assetIdentifier: name,
      assetType: 'SMART_CONTRACT',
      eligibleForBounty: true,
      eligibleForSubmission: true,
      maxSeverity: 'critical',
      instruction: `Deployer real: ${stackingDaoProgram ? stackingDaoProgram.deployer : ''}.${name} — curado em targets.mjs.`,
    }));
    snapshots.push(buildScopeSnapshot({
      program: 'StackingDAO',
      platform: 'Immunefi',
      officialUrl: 'https://immunefi.com/bug-bounty/stackingdao/information/',
      sourceType: 'official_page_fetch',
      sourceDetail: 'Fetch direto de immunefi.com/bug-bounty/stackingdao/information/ (SSR, sem necessidade de navegador) + contratos curados em targets.mjs',
      rawSourceContent: JSON.stringify({ ...IMMUNEFI_STACKINGDAO_POLICY, assets: stackingDaoAssets }),
      assets: stackingDaoAssets,
      ...IMMUNEFI_STACKINGDAO_POLICY,
      confidence: 'high',
      capturedAt,
    }));
  }

  return snapshots;
}

export async function captureAndSaveAllSnapshots(opts = {}) {
  const snapshots = await captureAllSnapshots(opts);
  const written = snapshots.map((s) => ({ program: s.program, file: saveSnapshot(s) }));
  return written;
}

const isMain = process.argv[1] && import.meta.url.endsWith('capture-scope-snapshots.mjs') && process.argv[1].endsWith('capture-scope-snapshots.mjs');
if (isMain) {
  captureAndSaveAllSnapshots()
    .then((written) => {
      for (const w of written) console.log(`Snapshot gravado: ${w.program} -> ${w.file}`);
    })
    .catch((err) => {
      console.error('Falha ao capturar scope snapshots:', err);
      process.exitCode = 1;
    });
}
