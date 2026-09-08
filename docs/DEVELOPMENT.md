# 開發與驗證

Clarity 的正式目標為 Windows x64。前端可以在瀏覽器呈現，但剪貼簿監聽、通知區、全域快捷鍵與資料保存需要 Tauri 桌面環境。

## 環境準備

- Node.js 22.12+ 或與 Vite 7 相容的 Node.js。
- pnpm；此版本 `package.json` 指定 `pnpm@11.16.0`。
- Rust stable MSVC 工具鏈與 Cargo。
- Visual Studio Build Tools 的「使用 C++ 的桌面開發」與 Windows SDK。
- Microsoft Edge WebView2 Runtime。
- 快速安裝器另需 Windows .NET Framework 4.x 的 `csc.exe`；腳本會搜尋 Framework64／Framework 路徑。

依已提交的 `pnpm-lock.yaml` 及 `src-tauri/Cargo.lock` 安裝，避免開發與發行時任意更新依賴。

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

只開前端開發伺服器使用 `pnpm dev`，固定連接埠為 `1420`。沒有 Tauri 時，真實資料命令不可使用；下述介面測試會自行提供隔離的命令替身。

## 專案導覽

```text
src/
├── app/                 # App 狀態與主樣式
├── components/          # 搜尋、歷史、預覽、收藏、設定、導覽
├── lib/                 # Tauri API、拖曳資料、快捷鍵
└── types/               # TypeScript 資料模型
src-tauri/
├── src/core/            # Windows 邊界、分類
├── src/services/        # 產品邏輯
├── src/database/        # SQLite schema 與 repository
├── src/commands/        # invoke 命令
├── capabilities/        # Tauri 權限
└── tauri.conf.json      # 產品、視窗、發行設定
installer/               # C# 快速安裝器
scripts/                 # 安裝器打包腳本
tests/                   # Playwright 假資料及介面測試
docs/                    # 架構、開發、發行與品牌資產
```

`DESIGN.md` 記錄產品視覺與互動規格。修改 API 時，需一併調整 Rust command、TypeScript 封裝／型別與相關假資料。

## 型別、格式與 Rust 測試

```powershell
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`pnpm build` 先執行 TypeScript 檢查，再以 Vite 產生 `dist/`。目前沒有獨立 ESLint 或 JavaScript lint 指令；Rust 格式檢查由 rustfmt 負責。Rust 單元測試涵蓋分類、去重、敏感過濾、設定遷移、搜尋、資料保存與圖片／收藏快照。

## Playwright 介面驗證

測試使用 `tests/fixtures.mjs` 中的假資料與 Tauri 命令替身，瀏覽器在隔離 context 中執行，不讀取使用者剪貼簿資料庫。先在一個終端開啟前端：

```powershell
pnpm dev --host 127.0.0.1
```

在另一個終端，若尚未有 Playwright，可安裝於專案外的工具目錄：

```powershell
$qaTools = Join-Path $env:TEMP 'clarity-playwright-tools'
npm install --prefix $qaTools playwright
node (Join-Path $qaTools 'node_modules/playwright/cli.js') install chromium
$env:PLAYWRIGHT_MODULE = Join-Path $qaTools 'node_modules/playwright'
node tests/ui-smoke.mjs
```

腳本也會嘗試使用環境既有的 Playwright 或 Codex bundled runtime。可選環境變數：

| 變數 | 用途 |
| --- | --- |
| `UI_SMOKE_URL` | 前端網址，預設 `http://127.0.0.1:1420` |
| `UI_SMOKE_OUTPUT` | 報告與截圖資料夾，預設系統暫存目錄下 `clipboard-ui-smoke` |
| `PLAYWRIGHT_MODULE` | Playwright 套件目錄 |
| `PLAYWRIGHT_EXECUTABLE` | 已安裝的 Chromium 相容瀏覽器執行檔 |

`--functional-only` 只跑互動案例，`--visual-only` 只跑視覺情境。完整驗證包含搜尋、複製、釘選、分類、時間、資料夾、個人片段、非同步回應、設定保存與介面邊界。瀏覽器截圖由 Playwright `page.screenshot` 產生，檢查視窗溢出；不使用 PowerShell 桌面擷取。

介面測試無法替代安裝後的 Windows 原生互動驗證。正式桌面驗證應額外確認剪貼事件、通知區、快捷鍵與 WebView2；測試資料應使用合成內容。

## 正式建置

一次建立桌面 NSIS 與快速安裝器：

```powershell
pnpm package:quick
```

或拆成兩步，避免已完成桌面建置時重複編譯：

```powershell
pnpm tauri build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-quick-installer.ps1 -SkipAppBuild
```

`-SkipAppBuild` 只應在該版本的 NSIS 已重新產生後使用。產物與發行流程見 [RELEASE.md](RELEASE.md)。

## 資料與版本維護

- 真實資料位於 `%APPDATA%\com.tigerhzu.clarityclipboard`，不可加入 Git、測試 fixture 或 Release。
- 需資料備份時，先從通知區完整結束程式，再複製整個資料目錄；SQLite 可能有 `-wal`／`-shm` 輔助檔。
- Schema 修改應新增 migration，保留既有資料與收藏快照的升級路徑。
- 發行版本應同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 及 Cargo 鎖定資訊；不要只修改 README 徽章。
- 不任意變更 `identifier`，否則應用程式會改用另一個資料目錄。

返回 [首頁](../README.md) · [架構](ARCHITECTURE.md)
