# 剪貼後台 · Clarity Clipboard

複製過的指令、連結和圖片，都能在 Windows 上按 `Alt + Z` 找回。可以用關鍵字搜尋，也可以從日曆選一天，查看那天複製了什麼。

**[下載 Windows x64 安裝器](https://github.com/tigerhzu/clarity-clipboard/releases/latest/download/Clarity-Setup.exe)** · [版本說明與 SHA-256](https://github.com/tigerhzu/clarity-clipboard/releases/latest) · [更新紀錄](docs/CHANGELOG.md)

![剪貼後台的三欄工作區。左側選擇收藏或分類，中間搜尋歷史，右側閱讀選取的工作筆記。](docs/assets/app-preview.png)

<sub>剪貼後台 v1.0.14，使用示範資料。點選中間的項目即可預覽，雙擊可再次複製。</sub>

## 三個工作區

| 工作區 | 用法 |
| --- | --- |
| **最近複製** | 搜尋內容或來源程式，也能按日期和類型縮小範圍。重要項目可以釘選。 |
| **收藏資料夾** | 把一段指令或一張圖片拖進資料夾，留下一份獨立快照。原本的歷史到期後，收藏仍可使用。 |
| **常用片段** | 把例行回覆或操作步驟寫成可編輯的片段，下次直接複製。三個工作區都能用 `Ctrl + N` 新增文字或圖片。 |

## 開始使用

1. 執行 `Clarity-Setup.exe` 安裝或更新。安裝目標為目前的 Windows 使用者。缺少 WebView2 時，安裝程式會連網補齊；安裝器未簽署，下載頁提供 SHA-256 供核對。
2. 複製一段文字，按 `Alt + Z` 叫出工作區，輸入關鍵字，按 `Enter` 再次複製選取項目。
3. 到「設定 → 隱私」排除不想記錄的應用程式，到「儲存」選擇保留歷史的天數。關閉視窗後，程式會繼續在通知區執行。

<details>
<summary>鍵盤操作</summary>

| 按鍵 | 操作 |
| --- | --- |
| `Alt + Z` | 顯示或隱藏工作區，可在設定修改 |
| `Ctrl + K` 或 `Ctrl + F` | 聚焦搜尋 |
| `↑` / `↓`、`Enter` | 選取歷史項目、複製內容 |
| `Ctrl + P`、`Delete` | 切換釘選、開啟刪除確認 |
| `Ctrl + N`、`Ctrl + ,` | 新增內容、開啟設定 |

</details>

## 資料保存在你的電腦

歷史與收藏存於本機 SQLite，圖片另存為 PNG。備份時，先從通知區結束程式，再複製整個 `%APPDATA%\com.tigerhzu.clarityclipboard` 資料夾。資料庫與圖片未加密，請留意備份的存放位置。

敏感內容過濾預設開啟，能辨識部分私鑰、密碼與卡號。圖片和手動新增的片段仍可能含有敏感資料。**Hermes 串接預設關閉**；啟用後，本機代理可以依指示讀寫項目，取用的內容可能傳至 Hermes 設定的模型服務。[Hermes 設定與權限](docs/HERMES.md)

## 開發與文件

桌面端使用 Tauri、Rust 與 SQLite FTS5，介面使用 React 和 TypeScript。開發環境、建置及測試指令收錄在[開發指南](docs/DEVELOPMENT.md)。

[系統架構](docs/ARCHITECTURE.md) · [介面設計](DESIGN.md) · [Windows 發行指南](docs/RELEASE.md) · [相關工具](docs/TOOLKIT.md) · [回報問題](https://github.com/tigerhzu/clarity-clipboard/issues) · [MIT 授權](LICENSE)
