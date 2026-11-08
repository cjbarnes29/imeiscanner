$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $projectRoot 'dist\index.html'))) {
  throw 'Build the app first with npm run build.'
}
$taskName = 'IMEI Lens Laptop Scanner'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $node -Argument 'server/index.mjs' -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs IMEI Lens background photo scans while the browser is closed.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed $taskName. Open http://127.0.0.1:8787/ and use the access code in server-data/access-code.txt."
