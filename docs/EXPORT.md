# 本機彩色 Excel 匯出與自動化

在「設定 → 匯出」指定開始日期、結束日期、工作區與匯出位置，按「匯出彩色 Excel」。預設輸出至 Windows 文件資料夾下的 `Clarity Exports`。可選擇最近複製、全部收藏資料夾、常用片段或全部工作區；tag 留空代表全部。

匯出後直接在 Excel 第一頁「日期總覽」的 A3「日期」下拉選單勾選日期，即可顯示當天所有類型的內容與圖片；清除篩選可查看全部。其他分類分頁維持原本完整內容，不受日期總覽篩選影響。日期依 Windows 本機時區判定，不需要在匯出時選分組。

## 檔案與分類

每次建立 `clarity-開始日期-結束日期-唯一識別碼` 資料夾，含：

- `clipboard.xlsx`：**主要閱讀檔案**。第一頁「日期總覽」包含所有項目；後續圖片、文字、網址、程式碼、JSON、指令、Email、IP、檔案路徑、網路路徑各有獨立分類頁，僅建立有資料的分類。每筆項目在總覽及對應分類各出現一次；圖片資料保存在檔案內。
- `clipboard.csv`：UTF-8 BOM、CRLF，Excel 可開啟。欄位包含 tag、所有 tags、工作區、收藏資料夾名稱、ID、日期、類型、標題、完整文字、來源程式、圖片相對路徑及圖片狀態。
- `images/`：原始 PNG；XLSX 內已嵌入圖片，可單獨搬移並顯示。完整原圖另保留，方便放大查看。
- `texts/`：長文超過 600 字或 12 行時另存完整 UTF-8 文字；工作表顯示摘要及相對路徑，CSV 仍保留全文。超出 Excel 欄位長度限制的其他欄位也會另存，並列出警告。
- `manifest.json`：篩選參數、日期邊界、項目／列／圖片數量及缺圖警告。

工作表使用奶油白／淺米色交錯底色、淡米色標題及深棕灰文字；顏色僅用於分類標籤與分頁標籤。日期總覽僅顯示日期欄的篩選下拉；篩選範圍涵蓋整筆資料，其他欄位的按鈕隱藏。分類頁沒有篩選下拉。保留文字換行，所有分頁皆不凍結標題列或欄位。圖片按比例縮放到約 420×220 像素區域，實際圖檔保存在 XLSX 內；不依賴網路圖片公式。CSV 是純文字格式，本身沒有色彩、分頁或內嵌圖片，請開啟 `clipboard.xlsx` 閱讀。

既有 tags 支援 JSON 字串陣列，或逗號、分號、`|` 分隔字串。沒有 tag 時使用既有 `contentType`：`TEXT`、`IMAGE`、`URL`、`CODE`、`JSON`、`COMMAND`、`EMAIL`、`IP`、`FILE_PATH`、`NETWORK_PATH`。這是固定規則，不是 AI 語意分類。tag 篩選採區分大小寫的完整比對；前後空白會移除。

CSV 依 tag、日期、工作區、ID 排序；有多個 tag 的項目會在每個分類各出現一列，原圖只複製一次，因此列數可能大於項目數。CSV 文字不截斷；Excel 自身的儲存格長度限制仍可能影響顯示。以 `= + - @` 等公式起始符開頭的值會加上單引號，避免 Excel 執行剪貼內容。

日期依 Windows 本機時區與資料庫 `created_at` 篩選，包含開始與結束當天；結束邊界為次日午夜，不以固定 24 小時計算。資料夾／常用片段使用收藏項目建立日期。只包含目前仍保留的資料，不會恢復已清除的歷史。匯出直接讀取完整資料庫快照，不受畫面搜尋、目前頁面或 250 筆上限影響。

## 直接呼叫工具：零 AI、零 tokens

安裝後使用 PowerShell 呼叫（管線會等待 Windows GUI 執行檔結束，取得 JSON 摘要）：

```powershell
$clarityExe = Join-Path $env:LOCALAPPDATA '剪貼後台\clarity-clipboard.exe'
& $clarityExe --export-excel --start 2026-11-01 --end 2026-11-16 --output 'C:\Reports' --storage all | Out-String
if ($LASTEXITCODE -ne 0) { throw '匯出失敗' }
```

不需要分組參數，所有匯出皆為「日期總覽＋類型分類」。可加上 `--tag IMAGE`。`--start`、`--end`、`--output` 必填；`--storage` 預設 `history`，支援 `history|folder|personal|all`。輸出路徑必須是絕對路徑。標準輸出為 JSON，錯誤寫入 stderr 並回傳 exit code 1，成功為 0。圖片遺失仍會成功匯出其他內容，摘要的 `warnings` 與 CSV 的 `image_status=missing` 會列出問題。

JSON 摘要含 `xlsxPath`、`sheetCount`、`embeddedImageCount`、`csvPath` 及 `warnings`；manifest 另記錄 `layout=dateOverviewAndTypes`。舊 `--export-csv` 和 `clarity_export_csv` 名稱繼續支援，現在也會同時產生 XLSX。

此模式在單一執行個體檢查之前執行，不開視窗、不監聽剪貼簿、不啟動 Hermes、不執行資料遷移或歷史清除。主程式正在背景執行或已關閉皆可；必須先使用新版主程式至少一次建立資料庫。每次執行建立新資料夾，無資料時 XLSX 在「日期總覽」顯示沒有資料的說明，CSV 仍產生欄位標題。以最後寫入的 `manifest.json` 中 `status=complete` 作為完成標記，不依賴 Windows／同步資料夾的重新命名。若中途失敗，會回傳非零結束碼並保留檔案；沒有完整 manifest 的資料夾屬於未完成報表，請重新匯出。

## Windows 工作排程器

倉庫的 `scripts/export-clipboard.ps1` 封裝上述命令，未指定日期時每天匯出「昨天」。可以複製到固定位置，讓 Windows 工作排程器執行：

```text
程式：powershell.exe
引數：-NoProfile -File "C:\ClarityTools\export-clipboard.ps1" -OutputDirectory "C:\Reports" -Storage all
```

請將腳本放在引數中的實際位置，設定所需時間，使用擁有剪貼簿資料的同一個 Windows 帳號執行。自訂安裝位置可加入 `-Executable "完整執行檔路徑"`；指定日期可加入 `-StartDate 2026-11-01 -EndDate 2026-11-16`；可加入 `-Tag IMAGE`。舊 `-GroupBy`／`--group-by` 參數僅保留相容，不再每天建立分頁。腳本不連網、不呼叫 AI，也不擷取螢幕。本次功能不會自行建立排程或設定執行時間。

## MCP

已啟用 Hermes 的程式也提供 `clarity_export_excel`：

```json
{"startDate":"2026-11-01","endDate":"2026-11-16","outputDirectory":"C:\\Reports","storage":"all","tag":""}
```

工具只回傳路徑、數量與警告，不把匯出全文送回模型。若要整個自動化流程完全沒有模型 tokens，直接使用命令列或排程腳本。由 AI 選擇呼叫 MCP 工具的對話本身仍可能計算 tokens。

## 登入自動啟動

正式版本首次啟動會依設定建立目前使用者的 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\ClarityClipboard`，內容為加引號的執行檔路徑及 `--background`。登入後只顯示通知區圖示；`Alt+Z` 可叫出工作區。設定 → 一般可以停用；解除安裝移除該登錄值。開發／測試識別碼不會註冊。

若 Windows 工作管理員的「啟動應用程式」已另外停用 Clarity，或公司原則封鎖登入啟動，需在 Windows 允許啟動；程式不覆寫 Windows 的停用狀態。
