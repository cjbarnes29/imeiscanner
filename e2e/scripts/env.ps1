# Dot-source this in PowerShell:  . .\e2e\scripts\env.ps1
# Sets the environment for the CURRENT SESSION ONLY (nothing is written to the system or user environment).
# Override locations with MAESTRO_HOME, JAVA_HOME, ANDROID_HOME before dot-sourcing.
if (-not $env:MAESTRO_HOME) { $env:MAESTRO_HOME = "$HOME\tools\maestro-2.12.1\maestro" }
if (-not $env:JAVA_HOME)    { $env:JAVA_HOME    = (Get-ChildItem "$HOME\.jdks" -Directory -Filter "temurin-*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1).FullName }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }
$env:MAESTRO_CLI_NO_ANALYTICS = "1"
$env:MAESTRO_CLI_NO_UPDATE_CHECK = "1"
$env:Path = "$env:MAESTRO_HOME\bin;$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
# The ONLY app these tests may touch. Scripts refuse anything else.
$script:E2E_APP = "com.imeilens.scanner.phonetest"
$script:E2E_REAL_APP = "com.imeilens.scanner"
