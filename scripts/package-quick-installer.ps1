param(
    [switch]$SkipAppBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tauriConfigPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
$bundleDirectory = Join-Path $projectRoot 'src-tauri\target\release\bundle\nsis'
$quickInstallerSource = Join-Path $projectRoot 'installer\QuickInstaller.cs'
$iconPath = Join-Path $projectRoot 'src-tauri\icons\icon.ico'
$outputPath = Join-Path $bundleDirectory 'Clarity-Setup.exe'
$assemblyInfoPath = Join-Path ([IO.Path]::GetTempPath()) ("ClarityInstaller.AssemblyInfo.{0}.cs" -f $PID)

if (-not $SkipAppBuild) {
    Push-Location $projectRoot
    try {
        & pnpm tauri build
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

$config = Get-Content -LiteralPath $tauriConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$config.version
$setupPattern = "*_${version}_x64-setup.exe"
$payload = Get-ChildItem -LiteralPath $bundleDirectory -Filter $setupPattern -File |
    Where-Object { $_.Name -ne 'Clarity-Setup.exe' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $payload) {
    throw "No Tauri NSIS installer matching '$setupPattern' was found. Build the app first."
}

$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) {
    throw 'The Windows .NET Framework C# compiler was not found.'
}

$versionParts = @($version.Split('.'))
while ($versionParts.Count -lt 4) {
    $versionParts += '0'
}
$assemblyVersion = ($versionParts | Select-Object -First 4) -join '.'
$assemblyInfo = @"
using System.Reflection;

[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
"@
[IO.File]::WriteAllText($assemblyInfoPath, $assemblyInfo, (New-Object Text.UTF8Encoding($true)))

New-Item -ItemType Directory -Path $bundleDirectory -Force | Out-Null
if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Force
}

$compilerArguments = @(
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:anycpu',
    '/codepage:65001',
    "/win32icon:$iconPath",
    "/resource:$($payload.FullName),Clarity.Setup.Payload",
    "/out:$outputPath",
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    $quickInstallerSource,
    $assemblyInfoPath
)

try {
    & $compiler $compilerArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Quick installer compilation failed with exit code $LASTEXITCODE."
    }
}
finally {
    if (Test-Path -LiteralPath $assemblyInfoPath) {
        Remove-Item -LiteralPath $assemblyInfoPath -Force
    }
}

& $outputPath --verify-payload
if ($LASTEXITCODE -ne 0) {
    throw 'The generated quick installer failed its embedded payload check.'
}

$result = Get-Item -LiteralPath $outputPath
Write-Host "Quick installer ready: $($result.FullName)"
Write-Host "Size: $([Math]::Round($result.Length / 1MB, 2)) MB"
