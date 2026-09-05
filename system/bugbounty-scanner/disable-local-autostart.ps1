[CmdletBinding()]
param(
  [switch]$DisableDockerDesktop,
  [switch]$RemoveTaskDefinitions
)

$ErrorActionPreference = 'Stop'

$roots = @('E:\ZeroToOne', 'E:\ZeroToOne-automation')
$disabled = @()
$removed = @()
foreach ($task in Get-ScheduledTask) {
  $isProjectTask = $task.TaskName -like 'ZeroToOne_*'
  if (-not $isProjectTask) {
    $actionText = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -join ' '
    $isProjectTask = $roots | Where-Object { $actionText -like "*$_*" } | Select-Object -First 1
  }
  if ($isProjectTask) {
    Disable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Out-Null
    $disabled += "$($task.TaskPath)$($task.TaskName)"
    if ($RemoveTaskDefinitions) {
      Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false
      $removed += "$($task.TaskPath)$($task.TaskName)"
    }
  }
}

$dockerRunRemoved = $false
$dockerAutoStart = $null
if ($DisableDockerDesktop) {
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if (Get-ItemProperty -LiteralPath $runKey -Name 'Docker Desktop' -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -LiteralPath $runKey -Name 'Docker Desktop'
    $dockerRunRemoved = $true
  }
  $settingsPath = Join-Path $env:APPDATA 'Docker\settings-store.json'
  if (Test-Path -LiteralPath $settingsPath) {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $settings.AutoStart = $false
    $settings | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $settingsPath -Encoding utf8
    $dockerAutoStart = [bool]$settings.AutoStart
  }
  $dockerService = Get-Service -Name 'com.docker.service' -ErrorAction SilentlyContinue
  if ($dockerService -and $dockerService.StartType -ne 'Manual') {
    Set-Service -Name 'com.docker.service' -StartupType Manual
  }
}

[PSCustomObject]@{
  DisabledTasks = $disabled
  RemovedTaskDefinitions = $removed
  DockerRunEntryRemoved = $dockerRunRemoved
  DockerAutoStart = $dockerAutoStart
  LocalAutomaticStart = $false
}
