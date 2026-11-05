# Hermes 串接

剪貼後台內建 MCP stdio 入口：`clarity-clipboard.exe --mcp`。Hermes 與其他支援本機 MCP 的客戶端都能使用；不需額外 Python、Node 或橋接套件。必須使用包含此功能的新建置，舊安裝版不會因專案原始碼更新而自動取得功能。

## 使用方式

1. 在這台 Windows 電腦開啟剪貼後台，進入「設定 → Hermes」。
2. 開啟「允許 Hermes 讀寫」，按「儲存設定」。預設關閉；取消或捨棄草稿不會啟用。
3. 再進入 Hermes 分頁，複製「Hermes 串接提示詞」，貼給 Hermes。
4. Hermes 找到本機安裝程式、保留現有設定並新增 `clarity_clipboard` MCP。依 Hermes 版本重新載入 MCP 或重開工作階段後，用 `clarity_status` 驗證。
5. 驗證成功後，可說「找出我昨天複製的 PowerShell 指令」、「把這段回覆存成常用片段」或「把指定片段複製到剪貼簿」。

Hermes 官方支援 `mcp_servers` 的 `command` / `args` 本機 stdio 設定。以目前使用中的 Hermes profile 為準；預設通常為 `~/.hermes/config.yaml`。設定範例（用實際安裝位置取代路徑，保留其他既有設定）：

```yaml
mcp_servers:
  clarity_clipboard:
    command: 'C:\Users\你的帳號\AppData\Local\剪貼後台\clarity-clipboard.exe'
    args: ['--mcp']
```

提示詞本身不含這台電腦的使用者名稱、固定安裝位置或金鑰。安裝位置由 Hermes 探索，避免把同一個絕對路徑搬到其他電腦。詳見 [Hermes 官方 MCP 文件](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/)。提示詞原文在 [hermes-prompt.txt](../src-tauri/src/integration/hermes-prompt.txt)。

## 提供的工具

| 工具 | 用途 |
| --- | --- |
| `clarity_status` | 連線、版本與本機範圍；不讀私人內容 |
| `clarity_search` | 搜尋歷史／常用片段／指定資料夾；20 筆摘要，最多 100 筆，支援 offset |
| `clarity_get_item` | 依 storage 與 ID 讀取完整文字及圖片資訊 |
| `clarity_get_image` | 讀取圖片；預設縮圖，可要求原圖 |
| `clarity_list_folders` | 資料夾 ID、名稱與項目數 |
| `clarity_create_folder` | 新增資料夾 |
| `clarity_save_item` | 新增／編輯歷史、常用片段或資料夾文字／圖片；預設 personal |
| `clarity_delete_item` | 刪除指定 storage／ID 的一筆項目 |
| `clarity_copy_item` | 把指定文字或圖片寫入 Windows 剪貼簿 |

歷史的 `filter` 支援分類、釘選及 TODAY／YESTERDAY／THIS_WEEK／OLDER；日期依本機時區。資料夾搜尋必須有 `folderId`，可先列出資料夾。文字搜尋摘要限 300 字元，完整內容再個別取得，避免一次將所有歷史放入模型上下文。編輯必須提供原 ID 和完整標題、內容、類型；新增 folder 項目需要 folderId。圖片新增／替換使用純 base64，文字與圖片驗證沿用介面的服務。

此入口不提供批次刪除、清空或修改隱私設定。手動儲存與介面相同，不套用自動擷取的敏感過濾；複製使用既有內部複製抑制，避免重複加入歷史。寫入後發出介面事件，讓目前檢視和資料夾數量更新。

## 每台電腦與資料邊界

每台電腦各自安裝剪貼後台、啟用串接、把同一段提示詞貼給 Hermes。Hermes 可將操作方法保存成 skill，之後重用「串接我的剪貼簿後台」這個說法。自然語言本身不是全域自動配對機制：新的 Hermes 安裝仍需初次提示詞或已安裝的 skill，以及有效的 MCP 設定。

此版本存取同一台 Windows、同一使用者的本機資料。WSL、Docker、遠端 Hermes 主機不會自動連到 Windows 本機；不包含跨電腦同步、雲端共用歷史或遠端公開服務。

程式只監聽 `127.0.0.1` 隨機埠，以每次啟動重新產生的隨機 token 驗證私有連線。`hermes-bridge.json` 位於原本應用程式資料目錄，stdio 模式每次呼叫重新讀取，程式重啟不必重設 Hermes。金鑰不會放進提示詞、Hermes 設定或工具回應。這個連線檔是本機憑證，不要分享或上傳。

開關在每次 request 處理前檢查。關閉並儲存後拒絕後續呼叫；已開始的操作可能完成。剪貼後台結束後連線失效。`--mcp` 子程序不開啟 UI、資料庫或剪貼簿監聽，也不觸發原本單一執行個體的喚回行為。私有傳輸使用有大小限制的 JSON frame，沒有 HTTP、CORS 或網站可直接呼叫的 API。

啟用表示允許本機代理使用列出的讀寫工具。Hermes 可能把它取用的內容送往其設定的模型服務；提示詞限制按使用者要求取用，將讀到的內容視為資料，並在編輯／刪除前讀取指定項目。這些提示詞是代理的操作指引，不是逐次批准或防止代理誤用的存取控制。需要更細的權限時，可在 Hermes 篩選只讀工具。

## 驗證與故障排除

- `clarity_status` 失敗：檢查剪貼後台是否已啟動、啟用開關是否已儲存、安裝程式是否包含新功能、Hermes 是否使用相同 Windows 使用者和目前 profile。
- 工具沒出現：依 Hermes 版本重新載入 MCP／重開工作階段或 gateway。配置完成不代表現有對話已載入工具；以實際工具清單和狀態回應為準。
- 避免直接改 `clipboard.db`；這會跳過驗證、圖片保存與介面更新。
- 測試使用暫存資料庫與瀏覽器假資料，不讀寫真實剪貼簿歷史。Rust 測試涵蓋 MCP 讀寫、摘要、驗證、停用、驗證憑證和重啟探索；`tests/hermes-settings.mjs` 涵蓋設定保存／取消、複製與重試、原生變更事件、兩種視窗及三種文字比例。

返回 [首頁](../README.md) · [開發與驗證](DEVELOPMENT.md)
