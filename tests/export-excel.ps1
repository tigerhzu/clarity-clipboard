param([Parameter(Mandatory = $true)][string]$WorkbookPath)
# Synthetic workbook only. A private, hidden Excel instance opens it read-only.
# No screenshots, clipboard access, macros or saved changes.
$ErrorActionPreference = 'Stop'
$excel = $null
$book = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AutomationSecurity = 3
    $book = $excel.Workbooks.Open([IO.Path]::GetFullPath($WorkbookPath), 0, $true)
    $sheet = $book.Worksheets.Item(1)
    if ($sheet.Name -ne '日期總覽') { throw 'The first sheet must be the date overview.' }
    if (-not $sheet.AutoFilterMode) { throw 'Date filter is missing.' }
    $range = $sheet.AutoFilter.Range
    if ($range.Columns.Count -ne 11) { throw 'The filter must cover the complete record.' }
    $last = $range.Row + $range.Rows.Count - 1
    $rows = @(for ($row = 4; $row -le $last; $row++) {
        [PSCustomObject]@{ Row = $row; Date = [string]$sheet.Cells.Item($row, 1).Value2; Type = [string]$sheet.Cells.Item($row, 2).Value2 }
    })
    $dates = @($rows.Date | Sort-Object -Unique)
    if ($dates.Count -lt 2 -or $sheet.Shapes.Count -lt 1) { throw 'Use the two-day synthetic workbook with an image.' }
    $picture = $sheet.Shapes.Item(1)
    $pictureRow = $picture.TopLeftCell.Row
    $pictureDate = ($rows | Where-Object Row -eq $pictureRow).Date
    $originalHeight = $picture.Height
    foreach ($date in $dates) {
        $range.AutoFilter(1, $date) | Out-Null
        foreach ($record in $rows) {
            if ([bool]$sheet.Rows.Item($record.Row).Hidden -ne ($record.Date -ne $date)) { throw "Wrong row visibility for $date." }
        }
        if ($date -ne $pictureDate -and $picture.Height -gt 1) { throw 'The image must collapse with its filtered-out row.' }
        if ($date -eq $pictureDate -and $picture.Height -lt ($originalHeight - 1)) { throw 'The matching image must remain visible.' }
    }
    $sheet.ShowAllData()
    foreach ($record in $rows) { if ($sheet.Rows.Item($record.Row).Hidden) { throw 'Clearing the date filter must restore all rows.' } }
    if ($picture.Height -lt ($originalHeight - 1)) { throw 'Clearing the filter must restore the image.' }
    for ($index = 2; $index -le $book.Worksheets.Count; $index++) {
        $category = $book.Worksheets.Item($index)
        if ($category.AutoFilterMode) { throw 'Category sheets must not have filter dropdowns.' }
        foreach ($row in $category.UsedRange.Rows) { if ($row.Hidden) { throw 'Category sheets must be unaffected.' } }
    }
    foreach ($page in $book.Worksheets) {
        $page.Activate()
        if ($excel.ActiveWindow.FreezePanes) { throw 'No worksheet may freeze rows or columns.' }
    }
    Write-Output 'PASS Excel opened; no frozen panes; date selection, mixed-type rows, image hiding/restoration and independent category sheets.'
}
finally {
    if ($book) { $book.Close($false) }
    if ($excel) { $excel.Quit() }
    if ($book) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) }
    if ($excel) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
}
