// Orquestrador da descoberta de alvo — roda numa tarefa agendada PRÓPRIA,
// semanal, separada do scan diário, pra isolar o orçamento de 60 req/hora
// da API anônima do GitHub (a listagem de metadado de dezenas de
// candidatos não cabe dividido com a tarefa diária).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { runTargetDiscovery } from './discover-targets.mjs';
import { promoteTargets, renderAutoPromotedModule, DEFAULT_MAX_PROMOTIONS_PER_RUN, DEFAULT_MAX_TOTAL_PROMOTED } from './promote-targets.mjs';
import { loadProgramPolicy } from './program-policy.mjs';
import { JS_TARGETS } from './targets-js.mjs';
import { GO_TARGETS, _PAUSED_GO_TARGETS_MANUAL } from './targets-go.mjs';
import { JVM_TARGETS, _PAUSED_JVM_TARGETS_MANUAL } from './targets-jvm.mjs';
import { SWIFT_TARGETS, _PAUSED_SWIFT_TARGETS_MANUAL } from './targets-swift.mjs';
import { SOLIDITY_TARGETS } from './targets-solidity.mjs';
import { AUTO_PROMOTED_TARGETS } from './targets-auto-promoted.mjs';
import { getProgram } from './h1-api.mjs';
import { appendEntry } from '../ledger/ledger.mjs';
import { sendTelegramMessage } from './telegram.mjs';

// TARGETS (Clarity/StackingDAO, targets.mjs) fica de fora de propósito:
// usa `deployer` (endereço on-chain), não `owner`/`repo` do GitHub —
// diffAgainstKnownTargets não teria o que comparar, incluir seria
// inofensivo mas inútil. SOLIDITY_TARGETS, por outro lado, É
// owner/repo e faltava aqui até 31/08/2026 -- bug real: os repos
// Solidity já rastreados (evm-cctp-contracts etc.) apareciam como
// "candidato novo" toda semana, gastando orçamento de metadado à toa.
//
// _PAUSED_*_MANUAL (Block Open Source, pausado) entram só na checagem de
// "já conhecido" -- mesmo motivo do SOLIDITY_TARGETS acima, não porque
// vão ser escaneados (não vão).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const DISCOVERED_PATH = path.join(BUGBOUNTY_DIR, 'discovered-targets.json');
const SEEN_METADATA_PATH = path.join(BUGBOUNTY_DIR, 'discovery-metadata-seen.json');
const AUTO_PROMOTED_MODULE_PATH = path.join(__dirname, 'targets-auto-promoted.mjs');
const PROMOTION_LOG_PATH = path.join(BUGBOUNTY_DIR, 'targets-auto-promoted-log.json');

function loadSeenMap() {
  if (!existsSync(SEEN_METADATA_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SEEN_METADATA_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export async function runDiscovery() {
  if (!existsSync(BUGBOUNTY_DIR)) mkdirSync(BUGBOUNTY_DIR, { recursive: true });

  const seenMap = loadSeenMap();
  const result = await runTargetDiscovery(
    [JS_TARGETS, GO_TARGETS, JVM_TARGETS, SWIFT_TARGETS, SOLIDITY_TARGETS, _PAUSED_GO_TARGETS_MANUAL, _PAUSED_JVM_TARGETS_MANUAL, _PAUSED_SWIFT_TARGETS_MANUAL],
    seenMap,
    getProgram
  );

  const checkedAt = new Date().toISOString();
  for (const key of result.checkedKeys) {
    seenMap[key] = checkedAt;
  }
  writeFileSync(SEEN_METADATA_PATH, JSON.stringify(seenMap, null, 2), 'utf8');

  writeFileSync(
    DISCOVERED_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalCandidatesInDatasets: result.totalCandidatesInDatasets,
        newCandidatesFound: result.newCandidatesFound,
        truncatedCount: result.truncatedCount,
        neverSeenRemaining: result.neverSeenRemaining,
        programsWithAgeFound: result.programsWithAgeFound,
        programAgeSkippedReason: result.programAgeSkippedReason,
        note:
          result.truncatedCount > 0
            ? `AVISO: ${result.truncatedCount} candidato(s) novo(s) não tiveram metadado buscado nesta rodada (orçamento de API) — priorizados por rotação (quem nunca foi checado vem primeiro, programa mais novo primeiro dentro desses, ver discovery-metadata-seen.json); ${result.neverSeenRemaining} desses ainda nunca foram checados nenhuma vez, aparecem primeiro na próxima rodada.`
            : 'Todo candidato novo encontrado teve metadado buscado nesta rodada.',
        discovered: result.discovered,
      },
      null,
      2
    ),
    'utf8'
  );

  // Promoção automática -- reusa result.discovered (já enriquecido com
  // linguagem/estrelas/payout/idade acima), nenhuma chamada de rede nova.
  // existingPromotedKeys vem do módulo JÁ importado no topo do arquivo
  // (estado de ANTES desta rodada) -- nunca promove o mesmo repo 2x.
  const existingPromotedKeys = new Set(AUTO_PROMOTED_TARGETS.map((t) => `${t.owner.toLowerCase()}/${t.repo.toLowerCase()}`));
  const programPolicy = loadProgramPolicy();
  const promotionResult = promoteTargets(result.discovered, {
    programPolicy,
    existingPromotedKeys,
    maxPromotionsPerRun: DEFAULT_MAX_PROMOTIONS_PER_RUN,
    maxTotalPromoted: DEFAULT_MAX_TOTAL_PROMOTED,
    currentTotalPromoted: AUTO_PROMOTED_TARGETS.length,
  });
  const mergedAutoPromoted = [...AUTO_PROMOTED_TARGETS, ...promotionResult.promoted];
  if (promotionResult.promoted.length > 0) {
    writeFileSync(AUTO_PROMOTED_MODULE_PATH, renderAutoPromotedModule(mergedAutoPromoted), 'utf8');
  }
  writeFileSync(
    PROMOTION_LOG_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalActiveAutoPromoted: mergedAutoPromoted.length,
        promotedThisRound: promotionResult.promoted,
        skippedThisRound: promotionResult.skipped,
        note: 'skippedThisRound cobre TODO candidato considerado e recusado nesta rodada (linguagem não suportada, repo grande demais, programa bloqueado, erro de metadado, já promovido antes, ou elegível mas sem vaga nesta rodada) -- nunca um corte silencioso.',
      },
      null,
      2
    ),
    'utf8'
  );

  appendEntry('research', {
    type: 'bugbounty_discovery',
    totalCandidatesInDatasets: result.totalCandidatesInDatasets,
    newCandidatesFound: result.newCandidatesFound,
    truncatedCount: result.truncatedCount,
    neverSeenRemaining: result.neverSeenRemaining,
    metadataErrors: result.metadataErrors,
    programsWithAgeFound: result.programsWithAgeFound,
    programAgeErrors: result.programAgeErrors,
    programAgeSkippedReason: result.programAgeSkippedReason,
    promotedThisRound: promotionResult.promoted.length,
    totalActiveAutoPromoted: mergedAutoPromoted.length,
  });

  log(`Descoberta completa: ${result.totalCandidatesInDatasets} candidato(s) com bounty em HackerOne+Bugcrowd, ${result.newCandidatesFound} novo(s) (não rastreado ainda), ${result.discovered.length} com metadado buscado nesta rodada${result.truncatedCount > 0 ? ` (${result.truncatedCount} ficou pra próxima rodada, ${result.neverSeenRemaining} deles nunca foram checados)` : ''}.`);
  if (result.programAgeSkippedReason) {
    log(`AVISO: idade de programa (sinal de concorrência) não pôde ser buscada nesta rodada: ${result.programAgeSkippedReason}`);
  } else {
    log(`Idade de programa buscada com sucesso pra ${result.programsWithAgeFound} programa(s) HackerOne distinto(s) — usada pra priorizar candidato de programa mais novo primeiro.`);
  }
  log(`Promoção automática: ${promotionResult.promoted.length} alvo(s) novo(s) promovido(s) pra varredura ativa (${mergedAutoPromoted.length} no total agora), ${promotionResult.skipped.blockedProgram.length} recusado(s) por política de programa, ${promotionResult.skipped.unsupportedLanguage.length} por linguagem não suportada, ${promotionResult.skipped.tooLarge.length} por repo grande demais (revisão manual sugerida), ${promotionResult.skipped.deferredToNextRun.length} elegível(is) mas sem vaga nesta rodada.`);
  if (promotionResult.skipped.tooLarge.length > 0) {
    log(`Repos grandes demais pra promoção automática (curadoria de pathPrefix manual recomendada, ver ${PROMOTION_LOG_PATH}): ${promotionResult.skipped.tooLarge.map((r) => `${r.owner}/${r.repo}`).join(', ')}`);
  }

  try {
    execSync('git add -A', { cwd: REPO_ROOT });
    const status = execSync('git status --porcelain', { cwd: REPO_ROOT }).toString().trim();
    if (status) {
      const promotionNote = promotionResult.promoted.length > 0 ? `, ${promotionResult.promoted.length} promovido(s) automaticamente pra varredura ativa` : '';
      execSync(`git commit -m "Descoberta: ${result.newCandidatesFound} candidato(s) novo(s) de alvo${promotionNote}"`, { cwd: REPO_ROOT });
      execSync('git push', { cwd: REPO_ROOT });
      log('Sincronizado com o GitHub.');
    }
  } catch (err) {
    log(`AVISO: falha ao sincronizar com o GitHub: ${err.message}`);
  }

  try {
    const newestProgram = result.discovered
      .filter((d) => d.newestProgramStartedAt)
      .sort((a, b) => new Date(b.newestProgramStartedAt) - new Date(a.newestProgramStartedAt))[0];
    await sendTelegramMessage(
      [
        '🗓️ <b>ZeroToOne — descoberta semanal</b>',
        `${result.totalCandidatesInDatasets} candidato(s) com bounty em HackerOne+Bugcrowd, ${result.newCandidatesFound} ainda não rastreado(s).`,
        `${result.discovered.length} receberam metadado nesta rodada${result.truncatedCount > 0 ? ` (${result.truncatedCount} ficaram pra semana que vem)` : ''}.`,
        newestProgram ? `Programa mais novo visto: ${newestProgram.programs?.[0]?.program || '?'} (${newestProgram.owner}/${newestProgram.repo}).` : null,
        promotionResult.promoted.length > 0
          ? `🚀 <b>${promotionResult.promoted.length} alvo(s) novo(s) promovido(s)</b> pra varredura ativa: ${promotionResult.promoted.map((p) => `${p.owner}/${p.repo} (${p.program})`).join(', ')}. Total agora: ${mergedAutoPromoted.length}.`
          : `Nenhum alvo novo promovido nesta rodada (${mergedAutoPromoted.length} ativo(s) no total).`,
        promotionResult.skipped.tooLarge.length > 0 ? `${promotionResult.skipped.tooLarge.length} repo(s) grande(s) demais pra promoção automática — revisão manual sugerida.` : null,
      ].filter(Boolean).join('\n')
    );
  } catch (err) {
    log(`Aviso: resumo semanal do Telegram falhou (não afeta a descoberta): ${err.message}`);
  }

  return result;
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  runDiscovery().catch((err) => {
    console.error('Erro fatal no discovery-runner:', err);
    process.exit(1);
  });
}
