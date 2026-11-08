param([switch]$PhoneAccess)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $projectRoot 'dist\index.html'))) {
  throw 'Build the app first with npm run build.'
}
$taskName = 'IMEI Lens Laptop Scanner'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$argument = 'server/index.mjs'
if ($PhoneAccess) {
  $principal = [System.Security.Principal.WindowsPrincipal]::new([System.Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as administrator to enable private Wi-Fi phone access.'
  }
  $privateNetworks = @(Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Private')
  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $privateNetworks.InterfaceIndex -contains $_.InterfaceIndex -and $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)'
  } | Select-Object -ExpandProperty IPAddress)
  if (-not $addresses.Count) { throw 'Set your trusted Wi-Fi network to Private in Windows settings, then run this again.' }
  $rule = Get-NetFirewallRule -DisplayName 'IMEI Lens private Wi-Fi' -ErrorAction SilentlyContinue
  if (-not $rule) {
    New-NetFirewallRule -DisplayName 'IMEI Lens private Wi-Fi' -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private -RemoteAddress LocalSubnet | Out-Null
  }
  $argument += ' --lan'
}
$action = New-ScheduledTaskAction -Execute $node -Argument $argument -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs IMEI Lens background photo scans while the browser is closed.' -Force | Out-Null
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed $taskName. Open http://127.0.0.1:8787/ and use the access code in server-data/access-code.txt."
if ($PhoneAccess) { $addresses | ForEach-Object { Write-Output "Phone address on this private Wi-Fi: http://$($_):8787/" } }
