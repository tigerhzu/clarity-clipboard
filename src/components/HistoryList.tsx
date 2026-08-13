import { useEffect, useRef } from "react";
import { Clipboard, Pin, Search, X } from "lucide-react";
import { ContentTypeIcon, contentTypeLabels } from "./ContentTypeIcon";
import { parseImageMetadata } from "../lib/clipboard-api";
import { ClipboardImage } from "./ClipboardImage";
import type { ClipboardItem } from "../types/clipboard";

interface HistoryListProps {
  items: ClipboardItem[];
  selectedId: string | null;
  loading: boolean;
  searching: boolean;
  error: string | null;
  query: string;
  hasCriteria: boolean;
  activeFilterLabel: string;
  onSelect: (id: string) => void;
  onQueryChange: (query: string) => void;
}

const relativeFormatter = new Intl.RelativeTimeFormat("zh-TW", { numeric: "auto" });

function relativeTime(timestamp: number): string {
  const delta = timestamp - Date.now();
  const minutes = Math.round(delta / 60_000);
  if (Math.abs(minutes) < 60) return relativeFormatter.format(minutes, "minute");
  const hours = Math.round(delta / 3_600_000);
  if (Math.abs(hours) < 24) return relativeFormatter.format(hours, "hour");
  const days = Math.round(delta / 86_400_000);
  if (Math.abs(days) < 7) return relativeFormatter.format(days, "day");
  return new Intl.DateTimeFormat("zh-TW", { month: "short", day: "numeric" }).format(timestamp);
}

function summary(item: ClipboardItem): string {
  if (item.contentType === "IMAGE") {
    const metadata = parseImageMetadata(item);
    return item.customName || (metadata ? `截圖 ${metadata.width} × ${metadata.height}` : "剪貼簿圖片");
  }
  return item.customName || item.content?.trim() || "無法預覽的內容";
}

export function HistoryList({
  items,
  selectedId,
  loading,
  searching,
  error,
  query,
  hasCriteria,
  activeFilterLabel,
  onSelect,
  onQueryChange,
}: HistoryListProps) {
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchInput.current) {
        onQueryChange("");
        searchInput.current?.blur();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [onQueryChange]);

  useEffect(() => {
    if (!selectedId) return;
    document.querySelector<HTMLElement>(`[data-clipboard-id="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <section className="history-panel">
      <header className="history-header">
        <div className="history-heading-row">
          <div className="history-title">
            <div>
              <span className="eyebrow">CLARITY WORKSPACE</span>
              <h1>{activeFilterLabel}</h1>
              <p>快速搜尋並重新使用曾經複製過的內容。</p>
            </div>
            {searching && <span className="searching-dot" aria-label="搜尋中" />}
          </div>
          <label className="search-shell">
            <Search size={17} />
            <input
              ref={searchInput}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜尋剪貼簿"
              spellCheck={false}
              aria-label="搜尋剪貼簿"
            />
            {query ? (
              <button type="button" className="clear-search" onClick={() => onQueryChange("")} aria-label="清除搜尋">
                <X size={14} />
              </button>
            ) : <kbd>Ctrl F</kbd>}
          </label>
        </div>
      </header>

      <div className="history-scroll">
        {loading && (
          <div className="center-state"><div className="spinner" /><p>正在讀取歷史…</p></div>
        )}
        {!loading && error && (
          <div className="center-state error-state"><Clipboard size={30} /><p>{error}</p></div>
        )}
        {!loading && !error && items.length === 0 && hasCriteria && (
          <div className="center-state empty-state search-empty">
            <div className="empty-icon"><Search size={25} /></div>
            <h2>找不到符合的內容</h2>
            <p>試著縮短關鍵字，或切換到「全部」查看完整剪貼簿歷史。</p>
            {query && <span>搜尋「{query}」</span>}
          </div>
        )}
        {!loading && !error && items.length === 0 && !hasCriteria && (
          <div className="center-state empty-state">
            <div className="empty-icon"><Clipboard size={25} /></div>
            <h2>從下一次複製開始</h2>
            <p>複製一段文字後，它會立刻出現在這裡。所有內容只保存在這台電腦。</p>
            <span>試著按下 <kbd>Ctrl C</kbd></span>
          </div>
        )}
        {!loading && !error && items.map((item) => {
          return <button
            type="button"
            className={`history-row${selectedId === item.id ? " selected" : ""}`}
            key={item.id}
            data-clipboard-id={item.id}
            onClick={() => onSelect(item.id)}
          >
            {item.contentType === "IMAGE" ? (
              <span className="item-thumbnail"><ClipboardImage id={item.id} thumbnail alt="" /></span>
            ) : (
              <span className={`item-icon type-${item.contentType.toLowerCase()}`}>
                <ContentTypeIcon type={item.contentType} />
              </span>
            )}
            <span className="item-copy">
              <strong>{summary(item)}</strong>
              <span>{contentTypeLabels[item.contentType]}</span>
              <small>{item.sourceApp || "未知來源"} · {relativeTime(item.createdAt)}</small>
            </span>
            {item.isPinned && <Pin className="row-pin" size={12} fill="currentColor" aria-label="已釘選" />}
          </button>;
        })}
      </div>
      <footer className="history-footer">
        <span>{items.length} 筆項目</span>
        <span>資料僅儲存在本機</span>
      </footer>
    </section>
  );
}
