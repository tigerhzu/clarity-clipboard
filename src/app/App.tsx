import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database, History, Image, Pin, Settings } from "lucide-react";
import { HistoryList } from "../components/HistoryList";
import { PreviewPane } from "../components/PreviewPane";
import { Sidebar } from "../components/Sidebar";
import { SettingsDialog } from "../components/SettingsDialog";
import {
  copyClipboardItem,
  deleteClipboardItem,
  listClipboardItems,
  onClipboardChanged,
  toggleClipboardPin,
} from "../lib/clipboard-api";
import type { ClipboardFilter, ClipboardItem } from "../types/clipboard";

const filterLabels: Record<ClipboardFilter, string> = {
  ALL: "剪貼簿歷史",
  PINNED: "已釘選",
  TEXT: "文字",
  LINKS: "連結",
  IMAGES: "圖片",
  CODE: "程式碼與命令",
  PATHS: "路徑",
  EMAIL: "Email",
  IP: "IP 位址",
  TODAY: "今天",
  YESTERDAY: "昨天",
  THIS_WEEK: "本週",
  OLDER: "更早",
};

export function App() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [allCount, setAllCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<ClipboardFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setSearching(true);
    try {
      const nextItems = await listClipboardItems({ query: debouncedQuery, filter });
      if (requestId !== requestSequence.current) return;
      setItems(nextItems);
      if (filter === "ALL" && !debouncedQuery) setAllCount(nextItems.length);
      setSelectedId((current) => {
        if (current && nextItems.some((item) => item.id === current)) return current;
        return nextItems[0]?.id ?? null;
      });
      setError(null);
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      console.error(cause);
      setError("無法讀取本機剪貼簿資料庫。請重新啟動應用程式。");
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setSearching(false);
      }
    }
  }, [debouncedQuery, filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void refresh();
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void onClipboardChanged(() => void refresh()).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [refresh]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const runItemAction = useCallback(async (
    id: string,
    action: "copy" | "pin" | "delete",
  ) => {
    if (actionId) return;
    setActionId(`${action}:${id}`);
    try {
      if (action === "copy") {
        await copyClipboardItem(id);
        setNotice("已複製到剪貼簿");
      } else if (action === "pin") {
        const updated = await toggleClipboardPin(id);
        setNotice(updated.isPinned ? "已釘選" : "已取消釘選");
        await refresh();
      } else {
        await deleteClipboardItem(id);
        setNotice("已刪除剪貼簿項目");
        await refresh();
      }
    } catch (cause) {
      console.error(cause);
      setNotice("操作失敗，請再試一次");
    } finally {
      setActionId(null);
    }
  }, [actionId, refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", openSettings);
    return () => window.removeEventListener("keydown", openSettings);
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInteractive = target?.matches("input, textarea, button, [contenteditable='true']");
      if (settingsOpen || isInteractive || items.length === 0) return;

      const currentIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = Math.min(items.length - 1, Math.max(0, currentIndex + offset));
        setSelectedId(items[nextIndex].id);
      } else if (event.key === "Enter" && selectedId) {
        event.preventDefault();
        void runItemAction(selectedId, "copy");
      } else if (event.key === "Delete" && selectedId) {
        event.preventDefault();
        void runItemAction(selectedId, "delete");
      } else if (event.ctrlKey && event.key.toLowerCase() === "p" && selectedId) {
        event.preventDefault();
        void runItemAction(selectedId, "pin");
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [items, runItemAction, selectedId, settingsOpen]);

  return (
    <main className="app-frame">
      <header className="topbar">
        <div className="topbar-brand" aria-label="Clarity Clipboard">
          <span className="topbar-mark">C</span>
          <div><strong>Clarity</strong><small>Clipboard</small></div>
        </div>
        <nav className="topbar-nav" aria-label="主要導覽">
          <button type="button" className={filter === "ALL" ? "active" : ""} onClick={() => setFilter("ALL")}>
            <History size={15} /><span>歷史</span>
          </button>
          <button type="button" className={filter === "PINNED" ? "active" : ""} onClick={() => setFilter("PINNED")}>
            <Pin size={15} /><span>已釘選</span>
          </button>
          <button type="button" className={filter === "IMAGES" ? "active" : ""} onClick={() => setFilter("IMAGES")}>
            <Image size={15} /><span>圖片</span>
          </button>
        </nav>
        <div className="topbar-tools">
          <span className="local-status"><Database size={14} /><i />本機資料</span>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="開啟設定">
            <Settings size={18} />
          </button>
        </div>
      </header>
      <div className="workspace">
        <Sidebar
          itemCount={allCount}
          activeFilter={filter}
          onFilterChange={setFilter}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <HistoryList
          items={items}
          selectedId={selectedId}
          loading={loading}
          searching={searching}
          error={error}
          query={query}
          hasCriteria={Boolean(query.trim()) || filter !== "ALL"}
          activeFilterLabel={filterLabels[filter]}
          onSelect={setSelectedId}
          onQueryChange={setQuery}
        />
        <PreviewPane
          item={selectedItem}
          busy={Boolean(actionId)}
          onCopy={(id) => void runItemAction(id, "copy")}
          onTogglePin={(id) => void runItemAction(id, "pin")}
          onDelete={(id) => void runItemAction(id, "delete")}
        />
      </div>
      {notice && <div className="action-toast" role="status">{notice}</div>}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setNotice("設定已儲存");
            void refresh();
          }}
        />
      )}
    </main>
  );
}
