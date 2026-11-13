# Runs the IMEI Lens emulator tests against the ISOLATED test app only: Maestro flows (e2e\flows\NN-*.yaml) and hybrid scenarios (e2e\scenarios\NN-*.mjs).
#   powershell -ExecutionPolicy Bypass -File e2e\scripts\run-e2e.ps1 [-Flows 00-smoke,03-crop-archive-undo] [-Device emulator-5554] [-IncludeKnownFailing]
# Output: e2e\reports\<timestamp>\REPORT.md (+ JUnit XML, screenshots, logcat per test). Reports are git-ignored; IMEIs in them are synthetic or masked.
param(
  [string[]]$Flows = @(),
  [string]$Device = "emulator-5554",
  [switch]$IncludeKnownFailing
)
$ErrorActionPreference = "Continue"
$Flows = @($Flows | ForEach-Object { $_ -split "," } | Where-Object { $_ })
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\env.ps1"
$App = $script:E2E_APP; $RealApp = $script:E2E_REAL_APP
$flowDir = Join-Path $root "e2e\flows"
$scenDir = Join-Path $root "e2e\scenarios"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$report = Join-Path $root "e2e\reports\$stamp"; New-Item -ItemType Directory -Force $report | Out-Null

function Fail($m) { Write-Host "ABORT: $m" -ForegroundColor Red; exit 2 }

# ---- safety guards ---------------------------------------------------------------------------------------------------------------
if ($App -eq $RealApp) { Fail "the target app id equals the real app id" }
foreach ($f in Get-ChildItem $flowDir -Recurse -Filter *.yaml) {
  $text = Get-Content $f.FullName -Raw
  foreach ($line in (Select-String -Path $f.FullName -Pattern '^\s*appId\s*:')) {
    $id = ($line.Line -replace '^\s*appId\s*:\s*', '').Trim().Trim('"')
    if ($id -ne $App) { Fail "$($f.Name) targets '$id'. Only '$App' is allowed." }
  }
  if ($text -match 'clearState' -and $text -notmatch 'appId\s*:\s*com\.imeilens\.scanner\.phonetest') { Fail "$($f.Name) clears state without the test appId" }
}
foreach ($f in Get-ChildItem $scenDir -File -ErrorAction SilentlyContinue) {
  $text = Get-Content $f.FullName -Raw
  if ($text -match "com\.imeilens\.scanner(?!\.phonetest)['""\s]") { Fail "$($f.Name) mentions the real app id" }
}
$devices = (adb devices) -join "`n"
if ($devices -notmatch [regex]::Escape($Device) + "\s+device") { Fail "device $Device is not connected" }
$packages = (adb -s $Device shell pm list packages) -join "`n"
if ($packages -notmatch "package:$([regex]::Escape($App))\r?\n") { Fail "$App is not installed. Install the phone-test APK first (adb install ...phonetest.apk)." }

# ---- fixtures (synthetic) --------------------------------------------------------------------------------------------------------
$fix = Join-Path $root "e2e\fixtures\out"
if (-not (Test-Path "$fix\truth.json")) { node (Join-Path $root "e2e\fixtures\make-fixtures.mjs") | Out-Null }
$remote = "/sdcard/Pictures/e2e-fixtures"
adb -s $Device shell "rm -rf $remote; mkdir -p $remote" | Out-Null
Get-ChildItem $fix -Filter *.jpg | ForEach-Object { cmd /c "adb -s $Device push `"$($_.FullName)`" $remote/$($_.Name) >nul 2>&1" }
adb -s $Device shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://$remote" | Out-Null

# ---- which tests ---------------------------------------------------------------------------------------------------------------
$all = @(Get-ChildItem $flowDir -File | Where-Object { $_.Name -match '^[0-9][0-9]-.*\.yaml$' }) + @(Get-ChildItem $scenDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[0-9][0-9]-.*\.mjs$' })
$all = $all | Sort-Object Name
if ($Flows.Count) { $all = $all | Where-Object { $Flows -contains $_.BaseName } }
$knownFailing = @()
if (Test-Path "$flowDir\known-failing.txt") { $knownFailing = Get-Content "$flowDir\known-failing.txt" | Where-Object { $_ -match '\S' -and $_ -notmatch '^#' } | ForEach-Object { ($_ -split '\s+')[0] } }

$rows = @(); $crashes = 0
foreach ($flow in $all) {
  $name = $flow.BaseName
  $xfail = $knownFailing -contains $name
  if ($xfail -and -not $IncludeKnownFailing) { $rows += [pscustomobject]@{ Flow = $name; Result = "SKIPPED (known failing)"; Seconds = 0; Crashes = 0; Notes = "" }; continue }
  Write-Host "== $name" -ForegroundColor Cyan
  adb -s $Device shell pm clear com.google.android.documentsui | Out-Null
  adb -s $Device shell am force-stop $App | Out-Null
  adb -s $Device logcat -c
  $out = Join-Path $report $name; New-Item -ItemType Directory -Force $out | Out-Null
  $t0 = Get-Date
  if ($flow.Extension -eq ".mjs") {
    $log = & node $flow.FullName $Device $App 2>&1; $code = $LASTEXITCODE
  } else {
    $log = & cmd /c "maestro --udid $Device test --format junit --output `"$out\junit.xml`" --test-output-dir `"$out`" `"$($flow.FullName)`" 2>&1"; $code = $LASTEXITCODE
  }
  $log | Out-File "$out\run.log" -Encoding utf8
  $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds)
  adb -s $Device logcat -d | Out-File "$out\logcat.txt" -Encoding utf8
  $crash = @(Select-String -Path "$out\logcat.txt" -Pattern 'FATAL EXCEPTION|ANR in|OutOfMemoryError').Count
  $crashes += $crash
  $notes = ""
  if ($flow.Extension -eq ".mjs") {
    $notes = ((($log | Where-Object { $_ -match '^FAIL|checks passed' }) | Select-Object -Last 3) -join " | ")
    if (-not $notes -and $code -ne 0) { $notes = (($log | Select-Object -Last 2) -join " | ") }
  }
  $verify = Join-Path $root "e2e\scripts\verify-$name.mjs"
  if (Test-Path $verify) {
    $v = & node $verify $Device $App 2>&1; $vcode = $LASTEXITCODE
    $v | Out-File "$out\verify.txt" -Encoding utf8
    if ($vcode -ne 0) { $code = 1; $notes = (($v | Where-Object { $_ -match '^FAIL' } | Select-Object -First 3) -join " | ") }
    else { $notes = (($v | Select-Object -Last 1) -join "") }
  }
  if ($crash -gt 0 -and $code -eq 0) { $code = 1; $notes += " crash in logcat" }
  $result = if ($code -eq 0) { "PASS" } else { "FAIL" }
  if ($xfail) { $result = if ($code -eq 0) { "XPASS (known failing test passed)" } else { "XFAIL (known failing)" } }
  $rows += [pscustomobject]@{ Flow = $name; Result = $result; Seconds = $secs; Crashes = $crash; Notes = $notes }
  Write-Host "   $result in ${secs}s" -ForegroundColor $(if ($result -like "PASS*" -or $result -like "XFAIL*") { "Green" } else { "Red" })
}

# ---- report ---------------------------------------------------------------------------------------------------------------------
$mv = (& cmd /c 'maestro --version 2>&1') | Select-Object -Last 1
$md = @("# Emulator test report $stamp", "", "Device: $Device. App: $App (isolated test app). Maestro $mv.", "",
  "| Test | Result | Seconds | Crashes | Notes |", "|---|---|---|---|---|")
foreach ($r in $rows) { $md += "| $($r.Flow) | $($r.Result) | $($r.Seconds) | $($r.Crashes) | $($r.Notes) |" }
$md += ""; $md += "Passed: $(@($rows | Where-Object { $_.Result -like 'PASS*' }).Count) / $($rows.Count). Crashes in logcat: $crashes."
$md | Out-File (Join-Path $report "REPORT.md") -Encoding utf8
$md | ForEach-Object { Write-Host $_ }
if (@($rows | Where-Object { $_.Result -eq 'FAIL' }).Count -gt 0) { exit 1 } else { exit 0 }
