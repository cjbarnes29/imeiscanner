# Runs the IMEI Lens emulator tests against the ISOLATED test app only: Maestro flows (e2e\flows\NN-*.yaml) and hybrid scenarios (e2e\scenarios\NN-*.mjs).
#   powershell -ExecutionPolicy Bypass -File e2e\scripts\run-e2e.ps1 [-Flows 00-smoke,03-crop-archive-undo] [-Device emulator-5554] [-IncludeKnownFailing]
# Output: e2e\reports\<timestamp>\REPORT.md (+ JUnit XML, screenshots, logcat per test). Reports are git-ignored; IMEIs in them are synthetic or masked.
#   Real phone: add -RealPhone. Then the runner never clears any other app's data, skips tests that delete or read shared files
#   (Download exports: the phone may hold the owner's real exports), removes only the folders it created itself, and checks before and after
#   that the owner's files in Download, Documents and Pictures are unchanged (names, sizes and dates only; contents are never read).
param(
  [string[]]$Flows = @(),
  [string]$Device = "emulator-5554",
  [switch]$IncludeKnownFailing,
  [switch]$RealPhone
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
$isEmulator = ((adb -s $Device shell getprop ro.kernel.qemu) -join "").Trim() -eq "1" -or $Device -like "emulator-*"
if (-not $isEmulator -and -not $RealPhone) { Fail "$Device is a real phone. Run with -RealPhone (safe mode for a person's phone)." }
if ($isEmulator -and $RealPhone) { Write-Host "Note: -RealPhone on an emulator (safe mode used anyway)." }
$safe = $RealPhone.IsPresent
if ($safe) { $env:E2E_REAL_PHONE = "1" } else { Remove-Item Env:E2E_REAL_PHONE -ErrorAction SilentlyContinue }
# Tests that delete or read files in shared folders the owner also uses (Download: imei-scanner-export* may be real exports).
$sharedFileTests = @("06-export-csv", "07-export-interrupted", "11-export-lost-staging")
# The owner's files: listing only (name, size, date), compared before and after. Our own folders and temporary files are left out.
$ownFolders = 'e2e-fixtures|E2E-fx|e2e-ui\.xml'
# A 15-digit run in a file name is masked (first 8 + last 4) before it is written to the report.
function OwnerFiles { (adb -s $Device shell "find /sdcard/Download /sdcard/Documents /sdcard/Pictures /sdcard/DCIM -type f -print0 2>/dev/null | xargs -0 stat -c '%n|%s|%Y' 2>/dev/null | sort") | Where-Object { $_ -and $_ -notmatch $ownFolders } | ForEach-Object { $_ -replace '(?<!\d)(\d{8})\d{3}(\d{4})(?!\d)', '$1***$2' } }
$packages = (adb -s $Device shell pm list packages) -join "`n"
if ($packages -notmatch "package:$([regex]::Escape($App))\r?\n") { Fail "$App is not installed. Install the phone-test APK first (adb install ...phonetest.apk)." }

# ---- fixtures (synthetic) --------------------------------------------------------------------------------------------------------
$fix = Join-Path $root "e2e\fixtures\out"
if (-not (Test-Path "$fix\truth.json")) { node (Join-Path $root "e2e\fixtures\make-fixtures.mjs") | Out-Null }
$remote = "/sdcard/Pictures/e2e-fixtures"
if ($safe) {
  # Our folders must be ours: refuse when they already exist without our marker (never delete something the owner made).
  foreach ($dir in @($remote, "/sdcard/Documents/E2E-fx")) {
    $state = ((adb -s $Device shell "if [ -e $dir ]; then if [ -e $dir/.imei-lens-e2e ] || [ -z `"`$(ls -A $dir)`" ]; then echo ours; else echo foreign; fi; else echo none; fi") -join "").Trim()
    if ($state -eq "foreign") { Fail "$dir exists on the phone and was not made by these tests. Not touching it." }
  }
  $before = OwnerFiles
  $before | Out-File (Join-Path $report "owner-files-before.txt") -Encoding utf8
}
adb -s $Device shell "rm -rf $remote; mkdir -p $remote; touch $remote/.imei-lens-e2e" | Out-Null
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
  # Seen on a real phone (POCO X7 Pro, 2026-11-14): the picker search did not narrow to the test photos and "Select all" selected 64 of the
  # owner's photos (the count guard stopped it). Until photos can be given to the app without the system picker, those tests do not run on phones.
  if ($safe -and ((Get-Content $flow.FullName -Raw) -match 'scanAll|pick-photos|scan-all|start-scan-then-home|scan-real|pickFolder')) { $rows += [pscustomobject]@{ Flow = $name; Result = "BLOCKED (real phone: system picker)"; Seconds = 0; Crashes = 0; Notes = "picker selection is not safe on a person's phone" }; continue }
  if ($safe -and $sharedFileTests -contains $name) { $rows += [pscustomobject]@{ Flow = $name; Result = "SKIPPED (real phone: shared Download files)"; Seconds = 0; Crashes = 0; Notes = "manual checks E1/E2 cover it" }; continue }
  # The emulator can disappear (seen: a crash of its desktop window). adb would then wait forever: stop with a clear result instead.
  $online = (adb devices) -join "`n"
  if ($online -notmatch [regex]::Escape($Device) + "\s+device") {
    Write-Host "ABORT: $Device is no longer connected (emulator closed or crashed); remaining tests not run." -ForegroundColor Red
    $rows += [pscustomobject]@{ Flow = $name; Result = "NOT RUN (device gone)"; Seconds = 0; Crashes = 0; Notes = "emulator disconnected before this test" }
    break
  }
  Write-Host "== $name" -ForegroundColor Cyan
  # Emulator only: resets the system folder picker between tests. Never on a person's phone (it would clear their picker history).
  if (-not $safe) { adb -s $Device shell pm clear com.google.android.documentsui | Out-Null }
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
  # Bounded: "adb logcat -d" waits forever when the device has gone away (that hung a whole batch once).
  $lc = Start-Process adb -ArgumentList "-s", $Device, "logcat", "-d" -RedirectStandardOutput "$out\logcat.txt" -NoNewWindow -PassThru
  if (-not $lc.WaitForExit(60000)) { try { $lc.Kill() } catch { }; Add-Content "$out\logcat.txt" "(logcat timed out after 60 s: the device may be gone)" }
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

$ownerNote = ""
if ($safe) {
  # Remove only what this run created, then prove the owner's files did not change.
  adb -s $Device shell "rm -rf $remote; rm -f /sdcard/e2e-ui.xml; if [ -e /sdcard/Documents/E2E-fx/.imei-lens-e2e ] || [ -z `"`$(ls -A /sdcard/Documents/E2E-fx 2>/dev/null)`" ]; then rm -rf /sdcard/Documents/E2E-fx; fi" | Out-Null
  adb -s $Device shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://$remote" | Out-Null
  $after = OwnerFiles
  $after | Out-File (Join-Path $report "owner-files-after.txt") -Encoding utf8
  $diff = Compare-Object @($before) @($after)
  if ($diff) { $ownerNote = "OWNER FILES CHANGED: $(@($diff).Count) listing lines differ (see owner-files-before/after.txt)"; $rows += [pscustomobject]@{ Flow = "owner-files-unchanged"; Result = "FAIL"; Seconds = 0; Crashes = 0; Notes = $ownerNote } }
  else { $ownerNote = "Owner files in Download, Documents, Pictures and DCIM: unchanged ($(@($before).Count) listing lines)."; $rows += [pscustomobject]@{ Flow = "owner-files-unchanged"; Result = "PASS"; Seconds = 0; Crashes = 0; Notes = "$(@($before).Count) files: identical names, sizes and dates before and after" } }
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
