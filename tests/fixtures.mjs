/** Synthetic, browser-only fixtures. Never opens the native clipboard or application data. */
export function createFixture({ empty = false, textScale = 120, extraRows = 0, badMetadata = false, missingImage = false } = {}) {
  const now = Date.now();
  const item = (id, contentType, content, minutes, overrides = {}) => ({
    id, contentType, content, contentHash: `synthetic-${id}`, sourceApp: "Visual Studio Code",
    sourceProcess: "Code.exe", sourceWindow: "workspace — Visual Studio Code", createdAt: now - minutes * 60000,
    updatedAt: now - minutes * 60000, isPinned: false, customName: null, filePath: null,
    metadata: null, tags: null, ...overrides,
  });
  const history = [
    item("note-release", "TEXT", "發版前，留一點時間給細節。\n\n確認安裝流程、檢查快捷鍵，再把今天值得留下的內容整理好。", 2,
      { customName: "今天的工作筆記", sourceApp: "Notion", sourceProcess: "Notion.exe", sourceWindow: "產品筆記 · Notion", isPinned: true }),
    item("command-git", "COMMAND", "git log --oneline --graph --decorate -12", 8, { sourceApp: "Windows Terminal", sourceProcess: "WindowsTerminal.exe", sourceWindow: "PowerShell — 專案工具" }),
    item("url-guide", "URL", "https://example.com/design/clipboard-workspace", 14, { sourceApp: "Microsoft Edge", sourceProcess: "msedge.exe", sourceWindow: "Design resources — Microsoft Edge" }),
    item("image-board", "IMAGE", null, 21, { customName: "週末的靈感板", sourceApp: "小畫家", sourceProcess: "mspaint.exe", sourceWindow: "靈感板.png — 小畫家", filePath: "synthetic/image-board.png", metadata: JSON.stringify({ width: 960, height: 640, byteSize: 82304, thumbnailPath: "synthetic/thumb-image-board.png" }) }),
    item("json-config", "JSON", '{\n  "project": "Clipboard",\n  "theme": "quiet",\n  "features": ["search", "save", "reuse"],\n  "localOnly": true\n}', 36),
    item("email-team", "EMAIL", "studio@example.com", 55, { sourceApp: "Outlook", sourceProcess: "OUTLOOK.EXE", sourceWindow: "專案討論 — Outlook" }),
    item("path-assets", "FILE_PATH", "C:\\Projects\\Clipboard\\design\\references", 90, { sourceApp: "檔案總管", sourceProcess: "explorer.exe" }),
    item("ip-server", "IP", "192.0.2.42", 145),
    item("code-format", "CODE", "export function formatTitle(value: string) {\n  return value.trim().replace(/\\s+/g, ' ');\n}", 310),
    item("long-text", "TEXT", "長篇工作紀錄\n" + Array.from({ length: 650 }, (_, i) => `第 ${i + 1} 項：讓每一次複製，都能輕鬆找到下一個用途。保留原始換行與內容，搜尋與預覽應保持流暢。`).join("\n"), 1450, { sourceApp: "記事本", sourceProcess: "notepad.exe", sourceWindow: "長篇工作紀錄 — 記事本" }),
    item("network-share", "NETWORK_PATH", "\\\\studio-server\\shared\\resources", 3000),
  ];
  if (badMetadata) history.find((row) => row.id === "image-board").metadata = JSON.stringify({ width: "not-a-number", height: -1 });
  if (missingImage) history.find((row) => row.id === "image-board").filePath = null;
  for (let i = 0; i < extraRows; i++) history.push(item(`extra-${i}`, "TEXT", `分頁測試項目 ${i + 1}`, 4000 + i));
  const folders = [{ id: "folder-work", name: "工作收藏", createdAt: now - 86400000, updatedAt: now, sortOrder: 0, itemCount: 1 },
    { id: "folder-ideas", name: "靈感與參考", createdAt: now - 86400000, updatedAt: now, sortOrder: 1, itemCount: 0 }];
  const folderItems = [{ ...item("saved-guide", "URL", "https://example.com/reference", 2400, { customName: "專案參考網站" }), folderId: "folder-work", sourceItemId: null, sortOrder: 0 }];
  const personal = [{ ...item("personal-reply", "TEXT", "收到，謝謝提供資料。\n我會確認內容，再與您回覆後續安排。", 1800, { customName: "常用回覆", sourceApp: null, sourceProcess: null, sourceWindow: null }), title: "常用回覆", sourceItemId: null, sortOrder: 0 },
    { ...item("personal-command", "COMMAND", "git status --short", 1801, { customName: "查看工作進度", sourceApp: null, sourceProcess: null, sourceWindow: null }), title: "查看工作進度", sourceItemId: null, sortOrder: 1 }];
  return { history: empty ? [] : history, folders: empty ? [] : folders, folderItems: empty ? [] : folderItems,
    personal: empty ? [] : personal, settings: { retentionDays: 30, excludedApps: ["1Password.exe", "Bitwarden.exe", "KeePass.exe", "KeePassXC.exe", "mstsc.exe"], sensitiveFilterEnabled: true, textScale, hotkey: "Alt+Z", hermesEnabled: false },
    hermesInfo: { available: true, error: null, prompt: "請幫我串接這台電腦的剪貼後台。使用 clarity-clipboard.exe --mcp，保留現有 Hermes 設定，呼叫 clarity_status 驗證。" },
    copies: [], calls: [], failCommands: [], nextId: 1 };
}

/** Passed directly to Playwright addInitScript; deliberately has no external dependencies. */
export function installTauriFixture({ fixture, persist = true, historyError = false, onboarding = false }) {
  const storageKey = "clipboard-ui-test-state-v1";
  let saved = null;
  try { saved = persist ? JSON.parse(sessionStorage.getItem(storageKey) || "null") : null; } catch { /* fresh fixture */ }
  const state = saved || fixture;
  if (historyError) state.failCommands = ["list_clipboard_items", "count_clipboard_items"];
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const write = () => { if (persist) sessionStorage.setItem(storageKey, JSON.stringify(state)); };
  const callbacks = new Map();
  const listeners = new Map();
  let callbackId = 1;
  let eventId = 1;
  const find = (store, id) => {
    const item = store.find((entry) => entry.id === id);
    if (!item) throw new Error(`Synthetic record not found: ${id}`);
    return item;
  };
  const sortHistory = ({ query = "", filter = "ALL", offset = 0, limit = 250, startMs, endMs } = {}) => {
    const q = query.trim().toLowerCase();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const week = new Date(today); week.setDate(week.getDate() - (week.getDay() + 6) % 7);
    const typeGroups = { TEXT: ["TEXT"], LINKS: ["URL"], IMAGES: ["IMAGE"], CODE: ["CODE", "JSON", "COMMAND"], PATHS: ["FILE_PATH", "NETWORK_PATH"], EMAIL: ["EMAIL"], IP: ["IP"] };
    const filtered = state.history.filter((row) => {
      if (startMs != null && row.createdAt < startMs || endMs != null && row.createdAt >= endMs) return false;
      if (q && ![row.content, row.sourceApp, row.contentType, row.tags].filter(Boolean).join("\n").toLowerCase().includes(q)) return false;
      if (filter === "PINNED") return row.isPinned;
      if (typeGroups[filter]) return typeGroups[filter].includes(row.contentType);
      if (filter === "TODAY") return row.createdAt >= +today;
      if (filter === "YESTERDAY") return row.createdAt >= +today - 86400000 && row.createdAt < +today;
      if (filter === "THIS_WEEK") return row.createdAt >= +week;
      if (filter === "OLDER") return row.createdAt < +week;
      return true;
    });
    const score = (row) => !q ? 0 : row.content?.toLowerCase() === q ? 650 : row.content?.toLowerCase().startsWith(q) ? 520 : row.content?.toLowerCase().includes(q) ? 430 : 200;
    filtered.sort((a, b) => score(b) - score(a) || Number(b.isPinned) - Number(a.isPinned) || b.createdAt - a.createdAt);
    return { total: filtered.length, items: filtered.slice(offset, offset + limit) };
  };
  const emit = (event = "clipboard://changed", payload = { kind: "inserted" }) => {
    for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
  };
  const recount = () => state.folders.forEach((folder) => { folder.itemCount = state.folderItems.filter((item) => item.folderId === folder.id).length; });
  const reorder = (store, ids) => {
    if (ids.length !== store.length || new Set(ids).size !== ids.length || ids.some((id) => !store.some((row) => row.id === id))) throw new Error("invalid collection item order");
    return ids.map((id, sortOrder) => ({ ...find(store, id), sortOrder }));
  };
  const newId = (prefix) => `${prefix}-test-${state.nextId++}`;
  const image = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="#e9e5dc"/><rect x="62" y="60" width="836" height="520" rx="16" fill="#f8f5ef"/><circle cx="640" cy="294" r="146" fill="#91aaa1"/><rect x="177" y="170" width="244" height="292" rx="122" fill="#b97153"/><path d="M451 456L621 161L791 456Z" fill="#263e3a"/><text x="100" y="540" font-family="Arial" font-size="20" letter-spacing="5" fill="#3b4c47">ROOM FOR IDEAS / 2026</text></svg>');
  window.__CLIPBOARD_TEST__ = { state, emit, persist: write, fail: (commands) => { state.failCommands = commands; write(); } };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback, once = false) { const id = callbackId++; callbacks.set(id, once ? (...args) => { callbacks.delete(id); callback?.(...args); } : callback); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc() { return image; },
    async invoke(command, args = {}) {
      state.calls.push({ command, args: clone(args), at: Date.now() });
      if (state.failCommands.includes(command)) throw new Error(`Synthetic failure: ${command}`);
      if (state.delayCommands?.[command]) {
        await new Promise((resolve) => setTimeout(resolve, state.delayCommands[command]));
        state.completedDelays = (state.completedDelays || 0) + 1;
      }
      let result;
      switch (command) {
        case "save_manual_item": {
          const input = args.input;
          const store = input.storage === "history" ? state.history : input.storage === "folder" ? state.folderItems : state.personal;
          result = input.id ? find(store, input.id) : { id: newId(input.storage), createdAt: Date.now(), sourceApp: null, sourceProcess: null, sourceWindow: null, sourceItemId: null, isPinned: Boolean(input.pinned), sortOrder: store.length, folderId: input.folderId, filePath: null, metadata: null };
          Object.assign(result, { title: input.title, customName: input.title, content: input.content, contentType: input.contentType, updatedAt: Date.now() });
          if (input.imageBase64) { result.filePath = newId("image") + ".png"; result.metadata = JSON.stringify({ width: 20, height: 12, byteSize: 100, thumbnailPath: result.filePath }); }
          if (input.contentType !== "IMAGE") { result.filePath = null; result.metadata = null; }
          if (!input.id) store.push(result);
          recount(); break;
        }
        case "list_clipboard_items": return clone(sortHistory(args).items);
        case "count_clipboard_items": return sortHistory(args).total;
        case "list_clipboard_days": {
          const days = new Map();
          for (const item of state.history) {
            if (item.createdAt < args.startMs || item.createdAt >= args.endMs) continue;
            const date = new Date(item.createdAt);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            days.set(key, (days.get(key) || 0) + 1);
          }
          return [...days].map(([date, count]) => ({ date, count }));
        }
        case "list_folders": recount(); return clone(state.folders);
        case "reorder_folders": state.folders = reorder(state.folders, args.folderIds); recount(); result = state.folders; break;
        case "list_folder_items": return clone(state.folderItems.filter((row) => row.folderId === args.folderId).sort((a, b) => a.sortOrder - b.sortOrder));
        case "list_personal_items": return clone(state.personal.sort((a, b) => a.sortOrder - b.sortOrder));
        case "get_clipboard_settings": return clone(state.settings);
        case "get_hermes_integration": return clone(state.hermesInfo);
        case "copy_hermes_prompt": state.copies.push({ storage: "prompt", content: state.hermesInfo.prompt }); result = null; break;
        case "update_clipboard_settings": state.settings = clone(args.settings); result = state.settings; break;
        case "get_clipboard_image": case "get_folder_item_image": case "get_personal_item_image": return image;
        case "copy_clipboard_item": result = find(state.history, args.id); state.copies.push({ storage: "history", id: args.id, content: result.content }); break;
        case "copy_folder_item": result = find(state.folderItems, args.id); state.copies.push({ storage: "folder", id: args.id, content: result.content }); break;
        case "copy_personal_item": result = find(state.personal, args.id); state.copies.push({ storage: "personal", id: args.id, content: result.content }); break;
        case "toggle_clipboard_pin": result = find(state.history, args.id); result.isPinned = !result.isPinned; break;
        case "delete_clipboard_item": state.history = state.history.filter((row) => row.id !== args.id); result = true; break;
        case "create_folder": result = { id: newId("folder"), name: args.name, createdAt: Date.now(), updatedAt: Date.now(), sortOrder: state.folders.length, itemCount: 0 }; state.folders.push(result); break;
        case "rename_folder": result = find(state.folders, args.id); result.name = args.name; break;
        case "delete_folder": state.folders = state.folders.filter((row) => row.id !== args.id); state.folderItems = state.folderItems.filter((row) => row.folderId !== args.id); result = true; break;
        case "add_clipboard_item_to_folder": {
          result = state.folderItems.find((row) => row.folderId === args.folderId && row.sourceItemId === args.sourceItemId);
          if (!result) { result = { ...clone(find(state.history, args.sourceItemId)), id: newId("saved"), sourceItemId: args.sourceItemId, folderId: args.folderId, sortOrder: state.folderItems.filter((row) => row.folderId === args.folderId).length }; state.folderItems.push(result); }
          recount(); break;
        }
        case "remove_folder_item": state.folderItems = state.folderItems.filter((row) => row.id !== args.id); recount(); result = true; break;
        case "update_folder_item": result = find(state.folderItems, args.id); Object.assign(result, { customName: args.title, content: args.content, contentType: args.contentType }); break;
        case "reorder_folder_items": result = reorder(state.folderItems.filter((row) => row.folderId === args.folderId), args.itemIds); state.folderItems = [...state.folderItems.filter((row) => row.folderId !== args.folderId), ...result]; break;
        case "create_personal_item": result = { ...clone(fixture.history[0] || {}), id: newId("personal"), title: args.title, customName: args.title, content: args.content, contentType: args.contentType, createdAt: Date.now(), updatedAt: Date.now(), isPinned: false, sourceApp: null, sourceProcess: null, sourceWindow: null, sourceItemId: null, filePath: null, metadata: null, sortOrder: state.personal.length }; state.personal.push(result); break;
        case "add_clipboard_item_to_personal": {
          result = state.personal.find((row) => row.sourceItemId === args.sourceItemId);
          if (!result) { const source = find(state.history, args.sourceItemId); const title = source.customName || source.content?.split("\n")[0] || "保存的圖片"; result = { ...clone(source), id: newId("personal"), title, customName: title, sourceItemId: source.id, sortOrder: state.personal.length }; state.personal.push(result); } break;
        }
        case "update_personal_item": result = find(state.personal, args.id); Object.assign(result, { title: args.title, customName: args.title, content: args.content, contentType: args.contentType }); break;
        case "delete_personal_item": state.personal = state.personal.filter((row) => row.id !== args.id); result = true; break;
        case "reorder_personal_items": result = reorder(state.personal, args.itemIds); state.personal = result; break;
        case "plugin:event|listen": { const id = eventId++; listeners.set(id, args); return id; }
        case "plugin:event|unlisten": listeners.delete(args.eventId); return null;
        case "plugin:event|emit": case "plugin:event|emit_to": emit(args.event, args.payload); return null;
        case "plugin:global-shortcut|register": case "plugin:global-shortcut|unregister": return null;
        default: throw new Error(`Unmocked Tauri command: ${command}`);
      }
      write();
      return clone(result);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { listeners.delete(id); } };
  window.isTauri = true;
  if (!onboarding) {
    for (const version of ["v1", "v2", "v3", "v4"]) localStorage.setItem(`clarity-clipboard:onboarding-completed:${version}`, "true");
  }
}
