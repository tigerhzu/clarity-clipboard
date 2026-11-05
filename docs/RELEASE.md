# Windows Release 指南

**v1.0.14** 的兩個 Windows x64 安裝器與 SHA-256 校驗清單可從 [GitHub Release](https://github.com/tigerhzu/clarity-clipboard/releases/tag/v1.0.14) 下載。倉庫保存對應的原始碼、圖示與建置腳本。

## 使用者下載

在 [Releases](https://github.com/tigerhzu/clarity-clipboard/releases/latest) 優先下載 `Clarity-Setup.exe`。它包含正式 NSIS 安裝包，使用目前 Windows 使用者的安裝位置，安裝完成後開啟程式。

如需標準安裝精靈，下載 `Clarity-Clipboard-1.0.14-x64-setup.exe`。它與快速安裝器內嵌的 NSIS 檔案具有相同的 SHA-256。

| 檔案 | 用途 |
| --- | --- |
| `Clarity-Setup.exe` | 推薦的一鍵快速安裝器 |
| `Clarity-Clipboard-1.0.14-x64-setup.exe` | 標準 NSIS 安裝精靈 |
| `SHA256SUMS.txt` | 核對下載檔案完整性 |
| `Source code (zip/tar.gz)` | GitHub 根據 tag 自動產生的原始碼封存 |

WebView2 缺少時安裝程式會下載執行環境，因此首次安裝可能需要網路。沒有憑證簽章的安裝器可能顯示未知發行者；檔案雜湊確認完整性，不代表程式有數位簽章。

## 維護者建置流程

1. 確認 `package.json`、`Cargo.toml`、`tauri.conf.json` 的版本相同，鎖定檔與原始碼已準備好。
2. 執行 [開發指南](DEVELOPMENT.md) 的型別、Rust、Playwright 驗證。
3. 執行正式 Tauri 建置，再產生快速安裝器。

```powershell
pnpm tauri build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-quick-installer.ps1 -SkipAppBuild
```

預期產物：

```text
src-tauri/target/release/
├── clarity-clipboard.exe
└── bundle/nsis/
    ├── 剪貼後台_1.0.14_x64-setup.exe
    └── Clarity-Setup.exe
```

發行至 GitHub Release 時，標準安裝器改用英文下載檔名 `Clarity-Clipboard-1.0.14-x64-setup.exe`，檔案內容不變；本機建置產物仍保留上列中文檔名。

一般使用者應下載安裝器，避免直接散發應用程式執行檔而遺漏安裝生命週期。快速安裝器使用 Windows .NET Framework C# 編譯器，將 NSIS 作為 assembly resource 內嵌；產生時會自動執行 `--verify-payload`。

## 檔案檢查

檢查版本、雜湊與簽章，不執行安裝：

```powershell
$bundle = 'src-tauri/target/release/bundle/nsis'
Get-Item (Join-Path $bundle 'Clarity-Setup.exe') | Select-Object Name, Length, VersionInfo
Get-FileHash (Join-Path $bundle 'Clarity-Setup.exe') -Algorithm SHA256
Get-AuthenticodeSignature (Join-Path $bundle 'Clarity-Setup.exe')
& (Join-Path $bundle 'Clarity-Setup.exe') --verify-payload
```

`--verify-payload` 僅檢查是否有足夠大小的內嵌資源，不安裝程式，也不是完整安裝測試。發行時仍應記錄 Windows 原生操作與實機安裝驗證是否執行。

### 1.0.14 建置驗證紀錄 · 2026-10-14

- Windows 目標 TypeScript／Vite 建置通過；Hermes 設定於兩種視窗、三種文字比例，以及複製／資訊錯誤重試通過，既有 16 項互動回歸通過。
- 43 項 Rust release 測試全部通過，包括 MCP 讀寫、圖片、參數驗證、憑證驗證、停用與重啟。
- 隔離識別碼的原生 MCP stdio 實測通過：工具探索、狀態、離線恢復、三種目的地的新增／搜尋／讀取／編輯／刪除、圖片讀寫、錯誤參數、重啟探索及停用拒絕。
- 用正式識別碼重新建置 Windows x64／NSIS，再產生 1.0.14.0 快速安裝器。確認正式執行檔沒有測試識別碼，內嵌 NSIS SHA-256 與標準安裝器一致，`--verify-payload` 回傳 0。
- 本機交付於 `.release/1.0.14/`，含兩種安裝器、`SHA256SUMS.txt` 與使用說明。未執行實機安裝／升級，也未上傳 GitHub Release。
- 使用可攜式 Microsoft MSVC／Windows SDK 補齊本機建置工具，工具不包含在使用者安裝包中。驗證只使用獨立資料庫與合成資料。

### 1.0.13 建置驗證紀錄 · 2026-10-05

- TypeScript／Vite、Windows x64／NSIS 正式建置及快速安裝器完成。
- 完整 UI smoke 通過；欄寬與時間選單於 1180、900、2560 像素寬度，各 100／120／150% 文字大小通過，涵蓋拖曳、重載保存、取消、還原、鍵盤操作、日期完整顯示及視窗縮放。
- 日曆於 1180 × 760、900 × 600，各 100／120／150% 文字大小通過；確認窄視窗分隔線不阻擋日期點擊，並驗證分類、鍵盤、空月份、錯誤重試及即時刷新。
- 快速安裝器版本為 1.0.13.0，標準安裝包為 1.0.13；內嵌 NSIS 的 SHA-256 與標準安裝包一致。
- 本機交付位於 `.release/1.0.13/`，附兩種安裝器與 `SHA256SUMS.txt`。驗證使用合成資料，未執行實機安裝／升級，也未上傳 GitHub Release。

### 1.0.12 建置驗證紀錄 · 2026-10-04

- TypeScript／Vite、Rust 格式檢查、37 項 Rust 測試通過，包含日期與分類交集、完整月份統計、日期邊界、跨午夜去重、八執行緒同時啟動與啟動前喚醒。
- 完整 UI smoke 通過；日曆於 1180 × 760、900 × 600，各 100／120／150% 文字大小通過，涵蓋日期、分類、鍵盤跨月、空月份、錯誤重試及刪除後即時刷新。
- Windows 原生隔離身分驗證通過：三次重複啟動自動退出並喚回原視窗；程序終止後可重開；八次冷啟動只保留一個程序。測試程序均已結束。WebView 快取清理曾遇檔案鎖；後續刪除暫存資料夾遭自動安全審查阻擋，保留於 `%LOCALAPPDATA%\com.tigerhzu.clarityclipboard.single-instance-test`，不影響正式資料。
- Windows x64／NSIS 正式建置及快速安裝器完成，交付於 `.release/1.0.12/`。未執行安裝／升級，也未上傳 GitHub Release。

### 1.0.11 建置驗證紀錄 · 2026-09-30

- TypeScript／Vite、Rust 格式／cargo check、33 項 Rust 測試全部通過。
- 收藏資料夾 Playwright 測試於 1180 × 760、900 × 600 通過：上下拖曳、插入提示、選取保持、鍵盤排序、重載保存、取消、失敗重試、內容拖入收藏及長清單自動捲動。
- 完整介面 smoke 測試通過；Windows 目標正式前端另通過互動回歸與兩種尺寸的編輯器測試。
- Tauri Windows x64／NSIS 與快速安裝器建置通過，版本分別為 1.0.11、1.0.11.0；內嵌 NSIS SHA-256 與原安裝包一致。
- 本機交付位於 `.release/1.0.11/`，附兩種安裝器與 `SHA256SUMS.txt`。

驗證使用隔離的合成資料；未執行實機安裝／升級，也未操作使用者真實剪貼簿資料。

### 1.0.9 建置驗證紀錄 · 2026-09-08

| 檢查 | 結果 |
| --- | --- |
| TypeScript + Vite production build | 通過 |
| Rust format / cargo check | 通過 |
| Rust 單元測試 | 30 / 30 通過 |
| Playwright 完整介面驗證 | 33 / 33 通過、26 張視覺輸出、0 個未捕捉瀏覽器錯誤 |
| Windows 目標前端補充驗證 | 標準文字大小的 1180 × 760、900 × 600 兩個情境通過 |
| Tauri Windows x64 / NSIS 正式建置 | 通過 |
| 快速安裝器 | 內嵌檢查通過，內嵌資源 SHA-256 與 NSIS 檔案一致 |
| 版本資訊 | NSIS 為 1.0.9；快速安裝器為 1.0.9.0 |
| 數位簽章 | 兩個安裝器均未簽章 |

此次驗證使用隔離的合成介面資料，未執行安裝、升級或操作使用者的真實剪貼簿資料。首次開啟 Vite 開發頁時曾超過測試載入時限，改以正式靜態建置預覽後完整測試通過。Rust 建置另有 MSVC 產生程式庫的資訊型 linker warning，編譯與測試皆正常完成。

## GitHub 發佈內容

以完成驗證的 commit 建立與程式版本一致的 tag，例如 `v1.0.14`。Release 說明應包含此版本功能、下載檔名、支援平台、安裝／升級方式、測試結果與目前限制。上傳兩個安裝器及對應 SHA-256 清單；原始碼由相同 tag 產生。

不得包含 `%APPDATA%` 的真實資料、SQLite 檔案、使用者圖片、憑證、`.env` 或包含私人內容的截圖。README 用的示意圖和 Logo 放在 `docs/assets/`，桌面圖示在 `src-tauri/icons/`，均以版本控制保存。

## 升級與資料延續

安裝器維持目前使用者模式，禁止降版。`com.tigerhzu.clarityclipboard` 識別碼維持不變，讓既有版本沿用資料目錄。快速安裝器先發送正常退出事件並等待程式關閉，再呼叫 NSIS 更新。

早期版本若沒有退出事件或等待後仍未結束，快速安裝器會在比對目前使用者的預期安裝路徑後關閉該程序，以完成更新。

備份時先在通知區完整結束 Clarity，再複製整個資料目錄。升級會使用程式中的 schema migration；備份不應只取正在寫入中的單一 `clipboard.db`。

返回 [首頁](../README.md) · [更新紀錄](CHANGELOG.md)
