// Junta tudo que já existe pra um achado `human_ready` (ou além) numa
// pasta única, pronta pra abrir e enviar -- pedido direto do usuário
// (02/09/2026): "a IA decide sozinha... e só deixa pronto tudo em uma
// pasta para eu enviar". Não tenta decidir SOZINHA o que preencher em
// cada campo do formulário de cada programa (isso já provou precisar de
// julgamento real por programa -- ex.: Kubernetes usa CVSS 3.0 não 4.0,
// tem campos "Kubernetes Version"/"Component Version" que nenhum outro
// programa tem, Vercel exige severidade em vez de "sem severidade" às
// vezes -- ver research/bugbounty/reports/*.md pra precedente real de
// quanto isso varia). Em vez disso, junta os artefatos que JÁ foram
// produzidos (relatório + screenshots) e deixa um checklist honesto do
// que falta revisar manualmente -- nunca finge que o pacote está
// 100% pronto pra clicar "enviar" sem revisão nenhuma.
//
// NUNCA copia o zip de PoC automaticamente: não existe hoje nenhuma
// coluna/campo rastreando o caminho do zip de cada achado (verificado
// em db.mjs -- só `reports` tem path rastreado, não PoC archives), e
// adivinhar um caminho por convenção arriscaria copiar o arquivo errado
// silenciosamente. O checklist gerado aponta isso explicitamente em vez
// de fingir que cobriu algo que não cobriu.

import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUGBOUNTY_DIR = path.join(REPO_ROOT, 'research', 'bugbounty');
const DEFAULT_READY_DIR = path.join(BUGBOUNTY_DIR, 'ready-to-submit');
const DEFAULT_SCREENSHOTS_BASE = path.join(BUGBOUNTY_DIR, 'reports', 'screenshots');

// Estados a partir dos quais faz sentido empacotar -- antes de
// `human_ready` o relatório pode nem existir ainda ou estar incompleto;
// depois de `submitted` ainda é útil (reenvio a outro programa, revisão
// de um triager pedindo mais detalhe), nunca um erro empacotar de novo.
const PACKAGEABLE_STATES = new Set(['human_ready', 'submitted', 'triaged', 'duplicate', 'informative', 'paid', 'resolved', 'rejected']);

export function isPackageableState(state) {
  return PACKAGEABLE_STATES.has(state);
}

/** Nome de pasta seguro pro sistema de arquivos a partir do basename do
 * relatório (sem extensão) -- mesmo "slug" já usado pra nomear a pasta
 * de screenshots de cada achado (convenção existente, não nova). Pura. */
export function slugFromReportPath(reportPath) {
  return path.basename(reportPath, path.extname(reportPath));
}

/** null se não existir pasta de screenshot pra este achado (comum --
 * nem todo achado tem screenshot, ex. achado só de leitura de código
 * sem PoC dinâmica) -- nunca lança. Só toca disco pra checar existência. */
export function findScreenshotsDir(reportPath, screenshotsBase = DEFAULT_SCREENSHOTS_BASE) {
  const dir = path.join(screenshotsBase, slugFromReportPath(reportPath));
  return existsSync(dir) ? dir : null;
}

/** Conteúdo do README.md da pasta -- pura, recebe tudo que precisa como
 * argumento (finding + caminho do relatório + lista de screenshots
 * já copiados + se existe pasta de screenshot), nunca faz I/O sozinha.
 * Checklist é deliberadamente honesto sobre o que este script NÃO fez
 * (não inventa confiança, mesmo princípio de evidence-grade.mjs). */
export function buildReadmeContent(finding, reportFileName, screenshotFileNames = []) {
  const lines = [
    `# Ready to submit: ${finding.program}`,
    '',
    `- **Finding ID**: \`${finding.id}\``,
    `- **Program / Platform**: ${finding.program} (${finding.platform || '?'})`,
    `- **Asset**: ${finding.asset || finding.file || '?'}`,
    `- **Pipeline state**: \`${finding.state}\``,
    finding.evidenceGrade ? `- **Evidence grade**: ${finding.evidenceGrade}` : null,
    '',
    `## Files in this folder`,
    `- \`${reportFileName}\` — the full report.`,
    screenshotFileNames.length > 0
      ? screenshotFileNames.map((f) => `- \`${f}\` — screenshot.`).join('\n')
      : '- (no screenshots folder found for this finding — check whether this finding needs one before submitting.)',
    '',
    `## Before you submit — checklist`,
    `- [ ] Read the report once more, end to end.`,
    `- [ ] Check whether a PoC archive (.zip) exists for this finding — this folder was NOT populated with one automatically (no tracked path for it yet). Search this session's earlier messages or \`E:\\dev-toolchains\\poc-repos\\\` for a matching folder/zip.`,
    `- [ ] Confirm the exact form fields with Claude if this program's submission form hasn't been mapped out yet (asset name, weakness/CWE, severity approach, and any program-specific template fields — these vary a lot between programs, always worth a final check).`,
    `- [ ] After submitting, tell Claude the report number so the outcome gets recorded in the pipeline (\`record-platform-outcome\` + \`transition ... submitted\`).`,
    '',
  ];
  return lines.filter((l) => l !== null).join('\n') + '\n';
}

/**
 * Empacota UM achado. `finding` é o objeto já lido do banco (getFinding),
 * `report` é `{path, createdAt}` de `latestReport(db, finding.id)`.
 * Copia (nunca move -- os originais continuam no lugar de sempre) o
 * relatório e, se existir, cada arquivo da pasta de screenshots. Retorna
 * `{ok:false, reason}` sem tocar disco se alguma pré-condição básica
 * faltar (nunca lança por um achado individual, mesmo padrão de
 * promote-targets.mjs/slither-runner.mjs: um achado ruim não derruba
 * o resto de um processamento em lote).
 */
export function packageFinding(finding, report, opts = {}) {
  const { readyDir = DEFAULT_READY_DIR, screenshotsBase = DEFAULT_SCREENSHOTS_BASE, repoRoot = REPO_ROOT } = opts;

  if (!finding) return { ok: false, reason: 'finding ausente' };
  if (!isPackageableState(finding.state)) {
    return { ok: false, reason: `estado "${finding.state}" ainda não tem relatório pronto pra empacotar (precisa chegar em human_ready primeiro)` };
  }
  if (!report || !report.path) {
    return { ok: false, reason: 'nenhum relatório registrado pra este achado (record-report nunca rodou)' };
  }

  const absReportPath = path.isAbsolute(report.path) ? report.path : path.join(repoRoot, report.path);
  if (!existsSync(absReportPath)) {
    return { ok: false, reason: `relatório registrado em "${report.path}" mas o arquivo não existe mais nesse caminho` };
  }

  const slug = slugFromReportPath(report.path);
  const destDir = path.join(readyDir, slug);
  mkdirSync(destDir, { recursive: true });

  const reportFileName = path.basename(absReportPath);
  copyFileSync(absReportPath, path.join(destDir, reportFileName));

  const screenshotsDir = findScreenshotsDir(report.path, screenshotsBase);
  const screenshotFileNames = [];
  if (screenshotsDir) {
    for (const entry of readdirSync(screenshotsDir)) {
      const src = path.join(screenshotsDir, entry);
      if (!statSync(src).isFile()) continue;
      copyFileSync(src, path.join(destDir, entry));
      screenshotFileNames.push(entry);
    }
  }

  const readmeContent = buildReadmeContent(finding, reportFileName, screenshotFileNames);
  writeFileSync(path.join(destDir, 'README.md'), readmeContent, 'utf8');

  return {
    ok: true,
    destDir,
    reportFileName,
    screenshotCount: screenshotFileNames.length,
  };
}
