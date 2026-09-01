// Orquestrador da descoberta de alvo — roda numa tarefa agendada PRÓPRIA,
// semanal, separada do scan diário, pra isolar o orçamento de 60 req/hora
// da API anônima do GitHub (a listagem de metadado de dezenas de
// candidatos não cabe dividido com a tarefa diária).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
import { pullLatest, commitAndPush } from './git-sync.mjs';
import { runSlitherAgainstTarget, toQueueFindings as slitherToQueueFindings } from './slither-runner.mjs';
import { runOsvScannerAgainstTarget, toQueueFindings as osvToQueueFindings } from './osv-scanner-runner.mjs';
import { openDb, upsertFinding, closeDb } from './db.mjs';

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
const DB_PATH = path.join(BUGBOUNTY_DIR, 'zerotoone.db');

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
  pullLatest(REPO_ROOT, log);
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
  log(`Promoção automática: ${promotionResult.promoted.length} alvo(s) novo(s) promovido(s) pra varredura ativa (${mergedAutoPromoted.length} no total agora), ${promotionResult.skipped.blockedProgram.length} recusado(s) por política de programa, ${promotionResult.skipped.unsupportedLanguage.length} por linguagem não suportada, ${promotionResult.skipped.tooLarge.length} por repo grande demais (revisão manual sugerida), ${promotionResult.skipped.insufficientSignal.length} sem nenhum sinal positivo (score 0), ${promotionResult.skipped.deferredToNextRun.length} elegível(is) mas sem vaga nesta rodada.`);
  if (promotionResult.skipped.tooLarge.length > 0) {
    log(`Repos grandes demais pra promoção automática (curadoria de pathPrefix manual recomendada, ver ${PROMOTION_LOG_PATH}): ${promotionResult.skipped.tooLarge.map((r) => `${r.owner}/${r.repo}`).join(', ')}`);
  }

  // Slither (github.com/crytic/slither, Trail of Bits) contra os alvos
  // Solidity curados -- gratuito, 100% local (pip install slither-analyzer,
  // já presente neste ambiente), ~100 detectores reais contra o projeto
  // COMPILADO, não regex em texto. Roda na cadência SEMANAL (não na
  // diária) de propósito: clonar+instalar dependência+compilar é bem
  // mais lento que a heurística de texto (segundos a minutos por repo,
  // não milissegundos), e é aqui que o orçamento mais lento já vive
  // (descoberta de alvo). Cada alvo tem seu próprio try/catch -- um
  // repositório com fricção real (submódulo SSH, árvore funda demais
  // pro limite de caminho do Windows, package.json quebrado) nunca
  // derruba a análise dos outros. Ver slither-runner.mjs pro detalhe
  // completo da fricção real já encontrada e contornada.
  let slitherNewFindings = 0;
  let slitherReposOk = 0;
  let slitherReposFailed = 0;
  {
    const db = openDb(DB_PATH);
    try {
      for (const target of SOLIDITY_TARGETS) {
        try {
          const result = runSlitherAgainstTarget(target, { log });
          if (!result.ok) {
            slitherReposFailed++;
            log(`AVISO: Slither não rodou em ${target.owner}/${target.repo}: ${result.reason}`);
            continue;
          }
          slitherReposOk++;
          const findings = slitherToQueueFindings(target, result.findings);
          let newHere = 0;
          for (const f of findings) {
            // upsertFinding SEMPRE sobrescreve state (ON CONFLICT DO
            // UPDATE SET state=excluded.state) -- chamar de novo pra um
            // id já resolvido (false_positive/human_ready/o que for)
            // resetaria o achado pra candidate toda semana, apagando
            // investigação real já feita. Só insere quando é
            // GENUINAMENTE novo -- achado já existente nunca é tocado
            // aqui, mesmo padrão de segurança que o "seen" cache do
            // scanner de heurística já usa.
            const existing = db.prepare('SELECT id FROM findings WHERE id = ?').get(f.id);
            if (existing) continue;
            newHere++;
            slitherNewFindings++;
            upsertFinding(db, f);
          }
          log(`Slither: ${target.owner}/${target.repo} -- ${result.rawResultCount} achado(s) bruto(s), ${findings.length} em Medium+ impacto, ${newHere} realmente novo(s) desta vez.`);
        } catch (err) {
          slitherReposFailed++;
          log(`AVISO: Slither falhou de forma inesperada em ${target.owner}/${target.repo}: ${err.message.split('\n')[0]}`);
        }
      }
    } finally {
      closeDb(db);
    }
  }
  log(`Slither: ${slitherReposOk} repositório(s) analisado(s) com sucesso, ${slitherReposFailed} com falha, ${slitherNewFindings} achado(s) novo(s) (Medium+ impacto) na fila.`);

  // OSV-Scanner (Google, gratuito, `go install`) contra os alvos
  // JS/Go/JVM -- mesmo escopo de dep-scanner.mjs (que continua existindo,
  // os dois se complementam), nunca contra Solidity: testado ao vivo
  // que um clone com submódulo inicializado (necessário pro Slither)
  // expõe centenas de "vulnerabilidade" em dependência de dev/teste de
  // submódulo vendorizado de terceiro, nunca alcançável pelo contrato
  // em si. Ver osv-scanner-runner.mjs pro detalhe completo. Cache
  // próprio (nunca reaproveita o clone do Slither, que TEM submódulo).
  let osvNewFindings = 0;
  let osvReposOk = 0;
  let osvReposFailed = 0;
  {
    const db = openDb(DB_PATH);
    try {
      for (const target of [...JS_TARGETS, ...GO_TARGETS, ...JVM_TARGETS]) {
        try {
          const result = runOsvScannerAgainstTarget(target, { log });
          if (!result.ok) {
            osvReposFailed++;
            log(`AVISO: OSV-Scanner não rodou em ${target.owner}/${target.repo}: ${result.reason}`);
            continue;
          }
          osvReposOk++;
          const findings = osvToQueueFindings(target, result.findings);
          let newHere = 0;
          for (const f of findings) {
            // Mesmo cuidado do bloco do Slither acima: upsertFinding
            // sempre sobrescreve state -- só insere quando o id é
            // genuinamente novo, nunca toca achado que já existe
            // (dep-scanner.mjs já triou boa parte destes mesmos
            // pacotes em rodadas anteriores; re-rodar isso toda semana
            // não pode reabrir o que já foi resolvido).
            const existing = db.prepare('SELECT id FROM findings WHERE id = ?').get(f.id);
            if (existing) continue;
            newHere++;
            osvNewFindings++;
            upsertFinding(db, f);
          }
          log(`OSV-Scanner: ${target.owner}/${target.repo} -- ${result.rawPackageCount} pacote(s) verificado(s), ${findings.length} vulnerabilidade(s) de severidade 7.0+, ${newHere} realmente novo(s) desta vez.`);
        } catch (err) {
          osvReposFailed++;
          log(`AVISO: OSV-Scanner falhou de forma inesperada em ${target.owner}/${target.repo}: ${err.message.split('\n')[0]}`);
        }
      }
    } finally {
      closeDb(db);
    }
  }
  log(`OSV-Scanner: ${osvReposOk} repositório(s) analisado(s) com sucesso, ${osvReposFailed} com falha, ${osvNewFindings} achado(s) novo(s) (severidade 7.0+) na fila.`);

  {
    const promotionNote = promotionResult.promoted.length > 0 ? `, ${promotionResult.promoted.length} promovido(s) automaticamente pra varredura ativa` : '';
    const slitherNote = slitherNewFindings > 0 ? `, ${slitherNewFindings} achado(s) novo(s) do Slither` : '';
    const osvNote = osvNewFindings > 0 ? `, ${osvNewFindings} achado(s) novo(s) do OSV-Scanner` : '';
    const syncResult = commitAndPush(REPO_ROOT, `Descoberta: ${result.newCandidatesFound} candidato(s) novo(s) de alvo${promotionNote}${slitherNote}${osvNote}`, log);
    if (syncResult.ok) {
      if (syncResult.committed) log(`Sincronizado com o GitHub${syncResult.recovered ? ' (depois de recuperar de uma divergência)' : ''}.`);
    } else {
      log(`AVISO: falha ao sincronizar com o GitHub: ${syncResult.reason}`);
    }
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
        `🔬 Slither: ${slitherReposOk}/${SOLIDITY_TARGETS.length} repositório(s) Solidity analisado(s)${slitherReposFailed > 0 ? ` (${slitherReposFailed} com fricção de ambiente, ver log)` : ''}, ${slitherNewFindings} achado(s) novo(s) de impacto Medium+.`,
        `📦 OSV-Scanner: ${osvReposOk}/${JS_TARGETS.length + GO_TARGETS.length + JVM_TARGETS.length} repositório(s) JS/Go/JVM analisado(s)${osvReposFailed > 0 ? ` (${osvReposFailed} com falha, ver log)` : ''}, ${osvNewFindings} dependência(s) vulnerável(is) nova(s) de severidade 7.0+.`,
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
