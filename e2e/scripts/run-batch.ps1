# Runs the emulator suite N times in the background-safe way: always leaves a marker, never hangs.
#   powershell -File e2e\scripts\run-batch.ps1 -Name flaky4 -Runs 3 [-Flows 07-export-interrupted] [-RunTimeoutMin 40]
# Markers in e2e\reports: <Name>-done.txt (all runs finished, even with test failures) or <Name>-failed.txt (the batch itself broke or a run
# exceeded its timeout). A run that exceeds -RunTimeoutMin is stopped (that run's process tree only) and the batch is marked failed.
# Wait for it with:  node e2e\scripts\wait-for.mjs e2e\reports\<Name>-done.txt --pid <this script's pid> --timeout-min 90
param([string]$Name = "batch", [int]$Runs = 1, [string[]]$Flows = @(), [int]$RunTimeoutMin = 40)
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$rep = Join-Path $root "e2e\reports"; New-Item -ItemType Directory -Force $rep | Out-Null
Remove-Item "$rep\$Name-done.txt", "$rep\$Name-failed.txt" -ErrorAction SilentlyContinue
"started pid $PID $(Get-Date -Format o)" | Out-File "$rep\$Name-started.txt"
try {
  foreach ($i in 1..$Runs) {
    $argList = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "run-e2e.ps1"))
    if ($Flows.Count) { $argList += @("-Flows", ($Flows -join ",")) }
    $p = Start-Process powershell -ArgumentList $argList -PassThru -WindowStyle Hidden -RedirectStandardOutput "$rep\$Name-run-$i.txt" -RedirectStandardError "$rep\$Name-run-$i.err"
    if (-not $p.WaitForExit($RunTimeoutMin * 60000)) {
      # kill only this run's own process tree
      & taskkill /PID $p.Id /T /F | Out-Null
      throw "run $i exceeded $RunTimeoutMin min and was stopped"
    }
  }
  "done $(Get-Date -Format o)" | Out-File "$rep\$Name-done.txt"
} catch {
  "$($_.Exception.Message)" | Out-File "$rep\$Name-failed.txt"
  exit 1
}
