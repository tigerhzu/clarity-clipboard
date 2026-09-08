# Windows Release 指南

此版本為 **1.0.9**，發行目標為 **Windows x64**。倉庫保存原始碼、圖示與建置腳本；可安裝執行檔放在 GitHub Release 資產中。

## 使用者下載

在 [Releases](https://github.com/tigerhzu/clarity-clipboard/releases/latest) 優先下載 `Clarity-Setup.exe`。它包含正式 NSIS 安裝包，使用目前 Windows 使用者的安裝位置，安裝完成後開啟程式。

如需標準安裝精靈，可選 `剪貼後台_1.0.9_x64-setup.exe`。它與快速安裝器內嵌的內容來自同一次 Tauri 建置。

| 檔案 | 用途 |
| --- | --- |
| `Clarity-Setup.exe` | 推薦的一鍵快速安裝器 |
| `剪貼後台_1.0.9_x64-setup.exe` | 標準 NSIS 安裝精靈 |
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
    ├── 剪貼後台_1.0.9_x64-setup.exe
    └── Clarity-Setup.exe
```

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

以完成驗證的 commit 建立 `v1.0.9` tag。Release 說明應包含此版本功能、下載檔名、支援平台、安裝／升級方式、測試結果與目前限制。上傳兩個安裝器及對應 SHA-256 清單；原始碼由相同 tag 產生。

不得包含 `%APPDATA%` 的真實資料、SQLite 檔案、使用者圖片、憑證、`.env` 或包含私人內容的截圖。README 用的示意圖和 Logo 放在 `docs/assets/`，桌面圖示在 `src-tauri/icons/`，均以版本控制保存。

## 升級與資料延續

安裝器維持目前使用者模式，禁止降版。`com.tigerhzu.clarityclipboard` 識別碼維持不變，讓既有版本沿用資料目錄。快速安裝器先發送正常退出事件並等待程式關閉，再呼叫 NSIS 更新。

早期版本若沒有退出事件或等待後仍未結束，快速安裝器會在比對目前使用者的預期安裝路徑後關閉該程序，以完成更新。

備份時先在通知區完整結束 Clarity，再複製整個資料目錄。升級會使用程式中的 schema migration；備份不應只取正在寫入中的單一 `clipboard.db`。

返回 [首頁](../README.md) · [更新紀錄](CHANGELOG.md)
