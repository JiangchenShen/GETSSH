<#
.SYNOPSIS
  Runs the Windows half of .github/workflows/security-sandbox.yml on a real Windows PC (real TPM,
  DPAPI and AppContainer) and prints a pass/fail summary. From the repository root, in a normal
  (non-administrator) PowerShell:

      powershell -ExecutionPolicy Bypass -File scripts\windows-verify.ps1 -InstallUserTools

.PARAMETER InstallUserTools
  Installs rustup (stable, with clippy) and pnpm 11.2.2 for the current user when missing.

.PARAMETER IncludeTpmNegativeTests
  Also runs the keystore test that hands the real TPM a deliberately corrupted ciphertext. Off by
  default: modified material goes to security hardware only with the owner's consent.

.PARAMETER Only
  Runs only the steps whose names match one of these wildcards, e.g. -Only 'cargo*','keystore*'.

.NOTES
  Needs Git, Node.js 24, Python 3 and the Visual Studio 2022 C++ Build Tools with the
  Spectre-mitigated libraries, installed machine-wide: electron-builder rebuilds node-pty and
  better-sqlite3-multiple-ciphers with node-gyp. The tests use temporary directories; the
  packaged-app step also gets temporary profile variables (run it from an account without GETSSH
  data to be certain). Never prompts for Windows Hello.
  DPAPI needs a full logon: over a key-based SSH session the preflight fails, so run this through
  a scheduled task or an interactive session.
#>
[CmdletBinding()]
param(
    [switch]$InstallUserTools,
    [switch]$IncludeTpmNegativeTests,
    [string[]]$Only = @('*')
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version 3
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Client = Join-Path $Repo 'apps\getssh-client'
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:APPDATA\npm;$env:PATH"
$env:RUST_TARGET = 'x86_64-pc-windows-msvc'
# 8 GB machines run out of memory with one rustc per logical core.
if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '4' }
# node-gyp must not pick the Microsoft Store "python.exe" placeholder.
if (-not $env:PYTHON) {
    $python = Get-ChildItem -Path (Join-Path $env:ProgramFiles 'Python3*\python.exe') -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1
    if ($python) { $env:PYTHON = $python.FullName; $env:npm_config_python = $python.FullName }
}

# Runs a command line through cmd so stderr arrives as text, and returns its exit code.
function Invoke-Native([string]$CommandLine, [string]$Directory = $Repo) {
    Push-Location $Directory
    try {
        & cmd.exe /d /c "chcp 65001>nul & $CommandLine 2>&1" | Out-Host
        return $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

function Get-FileFromWeb([string]$Url, [string]$Path) {
    (New-Object Net.WebClient).DownloadFile($Url, $Path)
}

# ----------------------------- per-user tools -----------------------------
if ($InstallUserTools) {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Host '== Installing rustup (static.rust-lang.org)'
        $url = 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe'
        $exe = Join-Path $env:TEMP 'rustup-init.exe'
        Get-FileFromWeb $url $exe
        $expected = ((New-Object Net.WebClient).DownloadString("$url.sha256") -split '\s+')[0]
        if ((Get-FileHash $exe -Algorithm SHA256).Hash -ne $expected.ToUpperInvariant()) { throw 'rustup-init.exe checksum mismatch' }
        & $exe -y --profile minimal --default-toolchain stable -c clippy | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "rustup-init failed ($LASTEXITCODE)" }
        Remove-Item $exe -Force
    }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Host '== Installing pnpm 11.2.2'
        if ((Invoke-Native 'npm install -g pnpm@11.2.2') -ne 0) { throw 'pnpm install failed' }
    }
    Invoke-Native 'git config --global core.longpaths true' | Out-Null
}

# ----------------------------- steps -----------------------------
$keystoreSkip = if ($IncludeTpmNegativeTests) { '' } else { ' -- --skip made_up_tpm_key_names_are_lost_keys' }

$steps = @(
    @{ Name = 'preflight';            Run = {
        foreach ($tool in 'node', 'pnpm', 'cargo', 'rustc', 'git') {
            $cmd = Get-Command $tool -ErrorAction SilentlyContinue
            if (-not $cmd) { Write-Host "missing: $tool"; return 1 }
            Write-Host ("{0,-6} {1}" -f $tool, ((& $tool --version) | Select-Object -First 1))
        }
        $major = [int](((& node --version) -replace '^v', '') -split '\.')[0]
        if ($major -ne 24) { Write-Host "Node $major found; GETSSH builds with Node 24"; return 1 }
        if (-not $env:PYTHON) { Write-Host 'missing: Python 3 (node-gyp rebuilds node-pty and bsmc for Electron)'; return 1 }
        Write-Host "python $env:PYTHON"
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        $vc = if (Test-Path $vswhere) { & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre -property installationPath } else { $null }
        if (-not $vc) { Write-Host 'missing: MSVC C++ tools with the Spectre-mitigated libraries'; return 1 }
        Add-Type -AssemblyName System.Security
        $sealed = [Security.Cryptography.ProtectedData]::Protect([byte[]](1, 2, 3), $null, 'CurrentUser')
        $open = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, 'CurrentUser')
        if (($open -join ',') -ne '1,2,3') { Write-Host 'DPAPI round trip failed'; return 1 }
        Write-Host "DPAPI ok; user $(whoami); interactive=$([Environment]::UserInteractive)"
        return 0
    } }
    @{ Name = 'install';              Run = { Invoke-Native 'pnpm install --frozen-lockfile' } }
    @{ Name = 'build-native';         Run = { Invoke-Native 'node scripts/build-native.js' } }
    @{ Name = 'build-tools';          Run = { Invoke-Native 'cargo build --release -p ocean-sentinel --no-default-features --bins' } }
    @{ Name = 'cargo-sandbox';        Run = { Invoke-Native 'cargo test -p ocean-sentinel --no-default-features --bin getssh-sandbox' } }
    @{ Name = 'vite-build';           Run = { Invoke-Native 'pnpm exec vite build' $Client } }
    @{ Name = 'tsc';                  Run = { Invoke-Native 'pnpm exec tsc -b tsconfig.json --force --pretty false' $Client } }
    @{ Name = 'plugin-sandbox';       Run = { Invoke-Native 'npm run test:plugin-sandbox' $Client } }
    @{ Name = 'mcp-sandbox';          Run = { Invoke-Native 'npm run test:mcp-sandbox' $Client } }
    @{ Name = 'plugin-isolation';     Run = { Invoke-Native 'npm run test:plugin-isolation' $Client } }
    @{ Name = 'sentinel';             Run = { Invoke-Native 'npm run test:sentinel' $Client } }
    @{ Name = 'plugin-network';       Run = { Invoke-Native 'npm run test:plugin-network' $Client } }
    @{ Name = 'local-memory';         Run = { Invoke-Native 'npm run test:local-memory' $Client } }
    @{ Name = 'security-vitest';      Run = { Invoke-Native 'pnpm exec vitest run electron/main/security --environment node' $Client } }
    @{ Name = 'keystore-cargo';       Run = { Invoke-Native "cargo test -p getssh-keystore$keystoreSkip" } }
    @{ Name = 'cargo-other';          Run = { Invoke-Native 'cargo test -p getssh-store -p getssh-vault -p getssh-unarchive -p ocean-sentinel -p getssh-kv -p audit-stream -p tidal-engine' } }
    @{ Name = 'keystore-e2e';         Run = { Invoke-Native 'npm run test:keystore-e2e' $Client } }
    @{ Name = 'store-conformance';    Run = {
        $env:GETSSH_STORE_CONFORMANCE = '1'
        try { Invoke-Native 'node rust-core/getssh-store/store.conformance.mjs' } finally { Remove-Item Env:GETSSH_STORE_CONFORMANCE }
    } }
    @{ Name = 'package';              Run = { Invoke-Native 'pnpm exec electron-builder --publish never --dir --win --x64' $Client } }
    @{ Name = 'packaged-startup';     Run = {
        # The real app binary runs here: point the profile variables at a throwaway folder. Electron
        # may still resolve some known folders through the shell, hence the account advice above.
        $tempHome = Join-Path $env:TEMP ("getssh-verify-home-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path (Join-Path $tempHome 'AppData\Roaming'), (Join-Path $tempHome 'AppData\Local') | Out-Null
        $saved = @{ USERPROFILE = $env:USERPROFILE; HOME = $env:HOME; APPDATA = $env:APPDATA; LOCALAPPDATA = $env:LOCALAPPDATA }
        try {
            $env:USERPROFILE = $tempHome; $env:HOME = $tempHome
            $env:APPDATA = Join-Path $tempHome 'AppData\Roaming'; $env:LOCALAPPDATA = Join-Path $tempHome 'AppData\Local'
            Invoke-Native 'npm run test:packaged-startup' $Client
        } finally {
            foreach ($key in @($saved.Keys)) {
                if ($null -eq $saved[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue } else { Set-Item "Env:$key" $saved[$key] }
            }
            Remove-Item $tempHome -Recurse -Force -ErrorAction SilentlyContinue
        }
    } }
    @{ Name = 'packaged-contents';    Run = {
        $unpacked = Join-Path $Repo 'dist\win-unpacked\resources\app.asar.unpacked\node_modules\better-sqlite3-multiple-ciphers\prebuilds'
        $found = @(Get-ChildItem $unpacked -Filter '*.node' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
        Write-Host "bsmc prebuilds in the package: $($found -join ', ')"
        if (-not ($found -contains 'win32-x64.node') -or ($found | Where-Object { $_ -notlike 'win32-*' })) { return 1 }
        return 0
    } }
)

# Steps whose failure makes the rest meaningless.
$fatal = @('preflight', 'install', 'build-native', 'build-tools')

$results = New-Object System.Collections.Generic.List[object]
$selected = @($steps | Where-Object { $name = $_.Name; @($Only | Where-Object { $name -like $_ }).Count -gt 0 })
$index = 0
foreach ($step in $selected) {
    $index++
    Write-Host ''
    Write-Host ("=== [{0}/{1}] {2}" -f $index, $selected.Count, $step.Name)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $code = 1
    try {
        $output = @(& $step.Run)
        $code = if ($output.Count) { [int]$output[-1] } else { 0 }
    } catch {
        Write-Host "error: $_"
        $code = 1
    }
    $watch.Stop()
    $status = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
    $results.Add([pscustomobject]@{ Step = $step.Name; Status = $status; Exit = $code; Minutes = [math]::Round($watch.Elapsed.TotalMinutes, 1) })
    Write-Host ("--- {0} {1} (exit {2}, {3:N1} min)" -f $status, $step.Name, $code, $watch.Elapsed.TotalMinutes)
    if ($code -ne 0 -and $fatal -contains $step.Name) {
        Write-Host 'Stopping: later steps depend on this one.'
        break
    }
}

Write-Host ''
Write-Host '=== Summary'
$results | Format-Table -AutoSize | Out-Host
$failed = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
Write-Host ("{0} passed, {1} failed, {2} not run" -f ($results.Count - $failed), $failed, ($selected.Count - $results.Count))
exit $failed
