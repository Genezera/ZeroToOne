$ErrorActionPreference = 'Stop'

$scannerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scannerDir '..\..')).Path
$nodeExe = (Get-Command node.exe).Source
$wscriptExe = Join-Path $env:WINDIR 'System32\wscript.exe'
$serviceVbs = Join-Path $scannerDir 'run-service-hidden.vbs'
$watchdogVbs = Join-Path $scannerDir 'run-watchdog-hidden.vbs'

foreach ($required in @($nodeExe, $wscriptExe, $serviceVbs, $watchdogVbs)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Arquivo obrigatório ausente: $required" }
}

# Inicializa datas de referência sem disparar scan/discovery pesado durante
# a instalação. O primeiro ciclo agendado só faz heartbeat; os jobs vencem
# nos seus intervalos normais a partir daqui.
& $nodeExe (Join-Path $scannerDir 'migrate-to-v2.mjs') '--hydrate'
if ($LASTEXITCODE -ne 0) { throw 'Falha reconstruindo o banco operacional a partir do estado compartilhado' }
& $nodeExe (Join-Path $scannerDir 'service-runner.mjs') '--initialize'
if ($LASTEXITCODE -ne 0) { throw 'Falha inicializando runtime state' }

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$serviceAction = New-ScheduledTaskAction -Execute $wscriptExe -Argument ('"{0}"' -f $serviceVbs) -WorkingDirectory $repoRoot
$watchdogAction = New-ScheduledTaskAction -Execute $wscriptExe -Argument ('"{0}"' -f $watchdogVbs) -WorkingDirectory $repoRoot
$serviceTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 5)
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) -RepetitionInterval (New-TimeSpan -Minutes 10)
$serviceLogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$watchdogLogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity

$common = @{
  AllowStartIfOnBatteries = $true
  DontStopIfGoingOnBatteries = $true
  StartWhenAvailable = $true
  WakeToRun = $true
  RestartCount = 3
  RestartInterval = (New-TimeSpan -Minutes 5)
  MultipleInstances = 'IgnoreNew'
}
$serviceSettings = New-ScheduledTaskSettingsSet @common -ExecutionTimeLimit (New-TimeSpan -Hours 4)
$watchdogSettings = New-ScheduledTaskSettingsSet @common -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName 'ZeroToOne_BugBountyService' -Action $serviceAction -Trigger @($serviceTrigger, $serviceLogonTrigger) -Principal $principal -Settings $serviceSettings -Description 'Coordenador resiliente ZeroToOne: heartbeat 5min, sync H1 1h, scan 6h, discovery 24h.' -Force | Out-Null
Register-ScheduledTask -TaskName 'ZeroToOne_BugBountyWatchdog' -Action $watchdogAction -Trigger @($watchdogTrigger, $watchdogLogonTrigger) -Principal $principal -Settings $watchdogSettings -Description 'Watchdog independente do coordenador ZeroToOne, a cada 10 minutos.' -Force | Out-Null

# As tarefas antigas executavam os mesmos jobs fora do lease/coordenador.
# Desabilitar evita concorrência dupla; elas continuam registradas e podem
# ser reativadas manualmente, portanto esta mudança é reversível.
foreach ($legacy in @('ZeroToOne_BugBountyScanner', 'ZeroToOne_TargetDiscovery')) {
  if (Get-ScheduledTask -TaskName $legacy -ErrorAction SilentlyContinue) {
    Disable-ScheduledTask -TaskName $legacy | Out-Null
  }
}

Start-ScheduledTask -TaskName 'ZeroToOne_BugBountyService'
Start-ScheduledTask -TaskName 'ZeroToOne_BugBountyWatchdog'

Get-ScheduledTask -TaskName 'ZeroToOne_BugBountyService', 'ZeroToOne_BugBountyWatchdog' |
  ForEach-Object {
    $info = $_ | Get-ScheduledTaskInfo
    [PSCustomObject]@{
      TaskName = $_.TaskName
      State = $_.State
      LastRunTime = $info.LastRunTime
      LastTaskResult = $info.LastTaskResult
      NextRunTime = $info.NextRunTime
    }
  }
