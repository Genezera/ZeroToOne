[CmdletBinding()]
param([switch]$RunOnce)

$ErrorActionPreference = 'Stop'

$scannerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scannerDir '..\..')).Path
$nodeExe = (Get-Command node.exe).Source
foreach ($required in @($nodeExe)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Arquivo obrigatório ausente: $required" }
}

# Materializa a visão local e prepara o estado sem disparar scan/discovery.
# Não existe "primeiro ciclo agendado": qualquer ciclo local exige -RunOnce.
& $nodeExe (Join-Path $scannerDir 'migrate-to-v2.mjs') '--hydrate'
if ($LASTEXITCODE -ne 0) { throw 'Falha reconstruindo o banco operacional a partir do estado compartilhado' }
& $nodeExe (Join-Path $scannerDir 'service-runner.mjs') '--initialize'
if ($LASTEXITCODE -ne 0) { throw 'Falha inicializando runtime state' }

# Perfil atual: GitHub Actions é o runtime primário. Nenhuma tarefa local
# pode iniciar por logon, boot, relógio, catch-up ou wake. Este instalador
# legado agora apenas prepara o banco e garante que tarefas antigas estejam
# desabilitadas. Execução local é sempre uma decisão explícita.
$taskNames = @(
  'ZeroToOne_BugBountyService', 'ZeroToOne_BugBountyWatchdog',
  'ZeroToOne_BugBountyScanner', 'ZeroToOne_TargetDiscovery',
  'ZeroToOne_DailyFloor', 'ZeroToOne_MarketMakerShadow'
)
foreach ($taskName in $taskNames) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
  }
}

if ($RunOnce) {
  & $nodeExe (Join-Path $scannerDir 'service-runner.mjs')
  if ($LASTEXITCODE -ne 0) { throw "Ciclo manual falhou com código $LASTEXITCODE" }
}

[PSCustomObject]@{
  PrimaryRuntime = 'github_actions'
  LocalMode = 'manual_only'
  AutomaticTasksEnabled = 0
  RanOneCycle = [bool]$RunOnce
}
