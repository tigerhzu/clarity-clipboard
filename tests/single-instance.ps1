# Build the isolated executable first:
# pnpm tauri build --debug --no-bundle --config tests/single-instance.config.json
# Does not capture screenshots, install the app, or open production application data.
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$executable = Join-Path $projectRoot 'src-tauri\target\debug\clarity-clipboard.exe'
$testIdentifier = 'com.tigerhzu.clarityclipboard.single-instance-test'
$testData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) $testIdentifier
$testCache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) $testIdentifier
if ((Test-Path -LiteralPath $testData) -or (Test-Path -LiteralPath $testCache)) {
    throw 'Isolated test directory already exists; inspect it before running this test.'
}
# Require the test identifier embedded by the dedicated Tauri config.
$binaryText = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($executable))
if (-not $binaryText.Contains($testIdentifier)) { throw 'Build with tests/single-instance.config.json first.' }
$binaryText = $null
$started = @()
try {
    New-Item -ItemType Directory -Path $testData | Out-Null
    # Exclude currently running applications so the test does not retain their clips.
    $settings = @{ retentionDays = 7; textScale = 100; hotkey = 'Ctrl+Alt+Shift+F12'; sensitiveFilterEnabled = $true;
        excludedApps = @((Get-Process | Select-Object -ExpandProperty ProcessName -Unique | ForEach-Object { $_ + '.exe' })) }
    [IO.File]::WriteAllText((Join-Path $testData 'settings.json'), ($settings | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    $first = Start-Process -FilePath $executable -PassThru -WindowStyle Hidden
    $started += $first
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath (Join-Path $testData 'clipboard.db'))) {
        if ($first.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'First test instance failed to initialize.' }
        Start-Sleep -Milliseconds 100
    }
    foreach ($attempt in 1..3) {
        $duplicate = Start-Process -FilePath $executable -PassThru -WindowStyle Hidden
        $started += $duplicate
        if (-not $duplicate.WaitForExit(10000)) { throw "Duplicate launch $attempt remained running." }
        if ($duplicate.ExitCode -ne 0) { throw "Duplicate launch $attempt exited with $($duplicate.ExitCode)." }
        $first.Refresh()
        if ($first.HasExited) { throw 'Original instance exited unexpectedly.' }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $first.Refresh()
        if ($first.MainWindowHandle -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($first.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Repeated launch did not reveal the original window.' }
    $matching = @(Get-Process clarity-clipboard | Where-Object { $_.Path -eq $executable })
    if ($matching.Count -ne 1) { throw "Expected one test instance, found $($matching.Count)." }
    Stop-Process -Id $first.Id -Force
    $first.WaitForExit()
    $restart = Start-Process -FilePath $executable -PassThru -WindowStyle Hidden
    $started += $restart
    if ($restart.WaitForExit(4000)) { throw 'Restart after termination did not remain running.' }
    Stop-Process -Id $restart.Id -Force
    $restart.WaitForExit()
    $coldStarts = @(1..8 | ForEach-Object { Start-Process -FilePath $executable -PassThru -WindowStyle Hidden })
    $started += $coldStarts
    Start-Sleep -Seconds 4
    $survivors = @($coldStarts | Where-Object { -not $_.HasExited })
    if ($survivors.Count -ne 1) { throw "Cold startup left $($survivors.Count) instances instead of one." }
    Write-Output 'PASS: three duplicate launches exited, original window revealed, restart succeeded, eight cold launches left exactly one instance.'
} finally {
    foreach ($process in $started) {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $process.WaitForExit() }
    }
    # Give WebView children time to release their cache after their host exits.
    foreach ($entry in @(@{ Root = [Environment]::GetFolderPath('ApplicationData'); Path = $testData }, @{ Root = [Environment]::GetFolderPath('LocalApplicationData'); Path = $testCache })) {
        $resolvedTarget = [IO.Path]::GetFullPath($entry.Path)
        $expectedTarget = [IO.Path]::GetFullPath((Join-Path $entry.Root $testIdentifier))
        if ($resolvedTarget -ne $expectedTarget -or [IO.Path]::GetFileName($resolvedTarget) -ne $testIdentifier) { throw 'Unexpected cleanup path.' }
        for ($attempt = 0; $attempt -lt 40 -and (Test-Path -LiteralPath $resolvedTarget); $attempt++) {
            try { Remove-Item -LiteralPath $resolvedTarget -Recurse -Force; break }
            catch { if ($attempt -eq 39) { throw }; Start-Sleep -Milliseconds 250 }
        }
    }
}
