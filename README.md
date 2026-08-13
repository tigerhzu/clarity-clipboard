# Clarity Clipboard

Windows 本機優先的 Clipboard Workspace。目前核心功能完成至 Phase 4，並已進入 Phase 5 UI / UX Polish：支援文字與圖片歷史、搜尋、來源程式、釘選、保留期限與隱私排除設定。

## 技術選型

- **Tauri 2 / Rust**：Windows 原生剪貼簿事件、之後的前景程式辨識、全域快捷鍵、Tray 與 Auto Start 都留在原生層。
- **React / TypeScript / Vite**：UI 只負責呈現與操作狀態，不直接碰剪貼簿或資料庫。
- **SQLite / rusqlite**：完全本機、單檔、低維運成本；WAL 模式讓背景寫入與 UI 讀取可以並行。
- **clipboard-win**：直接使用 `AddClipboardFormatListener` 的 Windows 事件通知，不以高頻輪詢耗用資源。

## 架構

```text
Windows Clipboard
       │ WM_CLIPBOARDUPDATE
       ▼
core/clipboard_monitor ────── core/source_detector
       │ text / bitmap               │ foreground app / process / window title
       ▼
core/classifier ────────────── URL / Email / IP / Path / Code / JSON / Command
       │
       ▼
services/clipboard_service ── SHA-256 / consecutive dedupe / classify / privacy
       │
       ├── services/image_service ── PNG / thumbnail / local files
       ├── services/settings_service ── retention / excluded apps
       └── services/cleanup_service ── expiry / pinned protection
       │
       ▼
database/repository ───────── SQLite (WAL + FTS5)
       │                             │
       └──── clipboard://changed ────┤
                                     ▼
                          services/search_service
                                     │ partial match / recent rank / filters
                                     ▼
                          Tauri command boundary
                                     │
                                     ▼
                          React history + preview
```

原生層每個責任各自獨立：

- `src-tauri/src/core`：作業系統事件與外部輸入。
- `src-tauri/src/services`：流程、雜湊、去重與未來隱私規則。
- `src-tauri/src/database`：migration、model、repository。
- `src-tauri/src/commands`：UI 可呼叫的窄介面。
- `src/components`：三欄畫面的可組合 UI。
- `src/lib`：前端與 Tauri 的橋接。

Classifier 與 Search Service 都是獨立 module，不在 React component 中實作；未來可在不重寫 UI 的情況下加入 fuzzy 或 semantic search。

## 已完成

- Windows 剪貼簿事件監聽（非輪詢）
- 純文字讀取與空內容忽略
- SHA-256 content hash
- 5 秒內連續相同內容只保留一筆，並更新為最新時間
- SQLite schema、migration、WAL、索引
- 最新優先的歷史清單
- 新內容事件通知與畫面自動更新
- 三欄暗色介面、空狀態、完整文字 preview
- 資料目錄與 `images` 預留目錄
- 規則式 `TEXT / URL / EMAIL / IP / FILE_PATH / NETWORK_PATH / CODE / JSON / COMMAND` 分類
- 既有 Phase 1 文字資料啟動時自動重新分類
- SQLite FTS5 全文索引、任意部分匹配後備與 exact/recent ranking
- 內容分類與日期 Sidebar 篩選
- 120ms debounce 的即時搜尋、零結果狀態與 `Ctrl + F`
- URL domain、JSON 格式化、Code/Command syntax highlight 與結構化 Path/IP/Email preview
- Windows 前景程式、process 與視窗標題來源辨識
- Pin / Unpin、Copy、Delete 操作與畫面即時同步
- 應用程式內部 Copy 事件抑制，避免複製舊項目時再新增重複紀錄
- `↑` / `↓` 選取、`Enter` 複製、`Ctrl + P` 釘選、`Delete` 刪除
- Windows Bitmap 剪貼簿擷取、PNG 本機儲存與圖片雜湊去重
- 歷史列表圖片縮圖、右側原圖預覽與圖片重新複製
- 圖片檔案與 SQLite 紀錄同步刪除，資料庫不保存圖片 binary
- 7／30／90 天或永久保留設定，Pinned 項目永遠保留
- 排除程式設定與常見密碼、Token、私鑰、信用卡內容過濾
- Logitech 桌面工具風格的純黑介面、亮藍焦點與細線分區
- 全域頂部導覽、精簡分類側欄與卡片式歷史項目
- 最大化與 1180 × 760 預設視窗的響應式排列

## 安裝（Windows x64）

1. 到 [Releases](../../releases) 下載最新的 `Clarity Clipboard_*_x64-setup.exe`。
2. 執行安裝檔，依指示完成安裝。
3. 開啟 **Clarity Clipboard**；往後複製文字或圖片時，內容會只保存在這台電腦。

Windows 11 已內建 WebView2。若 Windows Defender 顯示「未知發行者」，這是因為目前安裝檔尚未進行商業程式碼簽署；請只從此 GitHub Release 下載。

## 開發環境

Tauri 在 Windows 需要 Node.js、Rust、WebView2，以及 Visual Studio Build Tools 的 **Desktop development with C++** 工作負載。Windows 11 已內建 WebView2。

```powershell
pnpm install
pnpm tauri dev
```

只驗證前端：

```powershell
pnpm build
```

驗證 Rust：

```powershell
cd src-tauri
cargo fmt --check
cargo test
```

## 本機資料

正式執行時，SQLite 與預留圖片目錄建立在 Tauri 的應用程式資料目錄：

```text
%APPDATA%/com.tigerhzu.clarityclipboard/
    clipboard.db
    settings.json
    images/
        thumbnails/
```

資料不會傳送到任何雲端服務。

## 下一階段

Phase 5 可加入 UI Polish、動畫、System Tray、開機啟動與 Installer；現有 Windows 原生層、Service 與 UI command boundary 可直接延伸。
