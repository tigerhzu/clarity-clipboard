param(
    [string]$StartDate = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd'),
    [string]$EndDate = $StartDate,
    [string]$OutputDirectory = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Clarity Exports'),
    [ValidateSet('history', 'folder', 'personal', 'all')][string]$Storage = 'history',
    [string]$Tag = '',
    # Legacy parameter is accepted for compatibility; layout always includes the date overview.
    [ValidateSet('type', 'date')][string]$GroupBy = 'type',
    [string]$Executable = (Join-Path $env:LOCALAPPDATA '剪貼後台\clarity-clipboard.exe')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "找不到程式：$Executable" }
$exportArguments = @('--export-excel', '--start', $StartDate, '--end', $EndDate, '--output', $OutputDirectory, '--storage', $Storage)
if ($Tag) { $exportArguments += @('--tag', $Tag) }
# Pipeline waits for the GUI-subsystem executable; no UI or AI process is created.
$previousEncoding = [Console]::OutputEncoding
try {
    # The Rust tool writes UTF-8 JSON, including Chinese output paths.
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    & $Executable @exportArguments | Out-String | Write-Output
    $exportExitCode = $LASTEXITCODE
}
finally { [Console]::OutputEncoding = $previousEncoding }
if ($exportExitCode -ne 0) { exit $exportExitCode }
