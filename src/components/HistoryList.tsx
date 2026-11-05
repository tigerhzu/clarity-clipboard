import { Fragment, useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Clipboard, Pin, RefreshCw, SearchX } from "lucide-react";
import { ContentTypeIcon, contentTypeLabels } from "./ContentTypeIcon";
import { parseImageMetadata } from "../lib/clipboard-api";
import { ClipboardImage } from "./ClipboardImage";
import { clearItemDragPayload, readItemDragPayload, writeItemDragPayload, type ItemDragPayload } from "../lib/drag";
import type { DisplayItem, ItemStorage } from "../types/clipboard";
import "./navigation.css";

interface HistoryListProps {
  items: DisplayItem[];
  totalCount: number;
  selectedId: string | null;
  loading: boolean;
  searching: boolean;
  loadingMore: boolean;
  pending: boolean;
  error: string | null;
  query: string;
  hasCriteria: boolean;
  activeFilterLabel: string;
  panelKicker?: string;
  headerAction?: ReactNode;
  toolbar?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  viewKind?: ItemStorage;
  reorderable?: boolean;
  onSelect: (id: string) => void;
  onCopy?: (id: string) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onReorder?: (sourceId: string, targetId: string, after?: boolean) => void;
  onStartPointerDrag?: (payload: ItemDragPayload, event: ReactPointerEvent<HTMLElement>) => void;
  pointerDraggingId?: string | null;
  pointerReorderTargetId?: string | null;
  pointerReorderAfter?: boolean;
}

const relativeFormatter = new Intl.RelativeTimeFormat("zh-TW", { numeric: "auto" });
const absoluteFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function relativeTime(timestamp: number, now: number): string {
  const delta = timestamp - now;
  const minutes = Math.round(delta / 60_000);
  if (Math.abs(minutes) < 60) return relativeFormatter.format(minutes, "minute");
  const hours = Math.round(delta / 3_600_000);
  if (Math.abs(hours) < 24) return relativeFormatter.format(hours, "hour");
  const days = Math.round(delta / 86_400_000);
  if (Math.abs(days) < 7) return relativeFormatter.format(days, "day");
  return new Intl.DateTimeFormat("zh-TW", { month: "short", day: "numeric" }).format(timestamp);
}

function summary(item: DisplayItem): string {
  if (item.contentType === "IMAGE") {
    const metadata = parseImageMetadata(item);
    return item.customName || (metadata ? `圖片 ${metadata.width} × ${metadata.height}` : "剪貼簿圖片");
  }
  return item.customName || item.content?.trim().replace(/\s+/g, " ") || "無法預覽的內容";
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(timestamp: number, now: number): string {
  if (dayKey(timestamp) === dayKey(now)) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(timestamp) === dayKey(yesterday.getTime())) return "昨天";
  return new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric" }).format(timestamp);
}

export function HistoryList({
  items,
  totalCount,
  selectedId,
  loading,
  searching,
  loadingMore,
  pending,
  error,
  query,
  hasCriteria,
  activeFilterLabel,
  panelKicker = "你的剪貼簿",
  headerAction,
  toolbar,
  emptyTitle,
  emptyDescription,
  emptyAction,
  viewKind = "history",
  reorderable = false,
  onSelect,
  onCopy,
  onRetry,
  onLoadMore,
  onReorder,
  onStartPointerDrag,
  pointerDraggingId = null,
  pointerReorderTargetId = null,
  pointerReorderAfter = false,
}: HistoryListProps) {
  const [now, setNow] = useState(() => Date.now());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingKind, setDraggingKind] = useState<ItemStorage | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverAfter, setDragOverAfter] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const shouldMoveFocus = (document.activeElement as HTMLElement | null)
      ?.matches("[data-history-row='true']");
    const row = document.querySelector<HTMLElement>(`[data-clipboard-id="${selectedId}"]`);
    row?.scrollIntoView({ block: "nearest" });
    if (shouldMoveFocus) row?.focus({ preventScroll: true });
  }, [items, selectedId]);

  useEffect(() => {
    if (draggingId && !items.some((item) => item.id === draggingId)) {
      setDraggingId(null);
      setDraggingKind(null);
      setDragOverId(null);
      setDragOverAfter(false);
    }
  }, [draggingId, items]);

  const hasResults = items.length > 0;
  const noResultTitle = emptyTitle || (query ? "找不到這段內容" : hasCriteria ? "這裡還沒有內容" : "從下一次複製開始");
  const noResultDescription = emptyDescription || (
    query
      ? "換個關鍵字，或調整篩選範圍再找找。"
      : hasCriteria ? "符合條件的內容會自動出現在這裡。" : "複製文字、連結或圖片，剪貼會替你記住。"
  );

  return (
    <section className="history-panel" id="workspace-history" aria-labelledby="history-title">
      <header className="history-header">
        <div>
          <span className="panel-kicker">{panelKicker}</span>
          <h1 id="history-title">{activeFilterLabel}</h1>
        </div>
        <div className="history-header-tools">
          <span className="result-count" aria-live="polite">
            {searching || pending ? "正在更新…" : `${totalCount.toLocaleString("zh-TW")} 筆`}
          </span>
          {headerAction}
        </div>
      </header>
      {toolbar && <div className="history-toolbar">{toolbar}</div>}

      <div
        className="history-scroll"
        id="history-list"
        role="listbox"
        aria-label={activeFilterLabel}
        aria-busy={loading || searching || pending}
        data-pending={pending || undefined}
      >
        {loading && (
          <div className="center-state" role="status">
            <div className="spinner" />
            <p>正在讀取內容…</p>
          </div>
        )}

        {!loading && error && (
          <div className="center-state error-state" role="alert">
            <div className="state-icon"><Clipboard size={25} /></div>
            <h2>無法載入內容</h2>
            <p>{error}</p>
            <button type="button" className="state-action" onClick={onRetry}>
              <RefreshCw size={14} />重新載入
            </button>
          </div>
        )}

        {!loading && !error && !hasResults && hasCriteria && (
          <div className="center-state empty-state">
            <div className="state-icon"><SearchX size={25} /></div>
            <h2>{noResultTitle}</h2>
            <p>{noResultDescription}</p>
            {query && <span title={query}>搜尋「{query}」</span>}
          </div>
        )}

        {!loading && !error && !hasResults && !hasCriteria && (
          <div className="center-state empty-state">
            <div className="state-icon"><Clipboard size={25} /></div>
            <h2>{noResultTitle}</h2>
            <p>{noResultDescription}</p>
            {emptyAction}
          </div>
        )}

        {!loading && !error && items.map((item, index) => (
          <Fragment key={item.id}>
          {viewKind === "history" && (index === 0 || dayKey(items[index - 1].createdAt) !== dayKey(item.createdAt)) && (
            <div className="history-day-divider" role="presentation" aria-hidden="true">
              <span>{dayLabel(item.createdAt, now)}</span><i />
            </div>
          )}
          <button
            type="button"
            role="option"
            aria-selected={selectedId === item.id}
            aria-posinset={index + 1}
            aria-setsize={totalCount}
            aria-grabbed={draggingId === item.id || pointerDraggingId === item.id || undefined}
            className={`history-row${item.isPinned ? " pinned" : ""}${selectedId === item.id ? " selected" : ""}${draggingId === item.id || pointerDraggingId === item.id ? " dragging" : ""}${dragOverId === item.id || pointerReorderTargetId === item.id ? " drag-over" : ""}${(dragOverId === item.id ? dragOverAfter : pointerReorderTargetId === item.id ? pointerReorderAfter : false) ? " drag-over-after" : ""}`}
            id={`clipboard-item-${item.id}`}
            data-history-row="true"
            data-clipboard-id={item.id}
            data-clipboard-reorder-target={reorderable ? item.id : undefined}
            tabIndex={selectedId === item.id || (!selectedId && index === 0) ? 0 : -1}
            disabled={pending}
            draggable={reorderable && !pending && !onStartPointerDrag}
            data-pointer-drag-source={(!pending && onStartPointerDrag && (viewKind === "history" || reorderable)) ? "true" : undefined}
            onClick={() => onSelect(item.id)}
            onDoubleClick={() => {
              if (!pending && !draggingId && !pointerDraggingId) onCopy?.(item.id);
            }}
            onPointerDown={(event) => {
              if (!pending && (viewKind === "history" || reorderable)) {
                onStartPointerDrag?.({ id: item.id, kind: item.storage }, event);
              }
            }}
            onDragStart={(event) => {
              if (viewKind === "history") return;
              writeItemDragPayload(event, { id: item.id, kind: item.storage });
              setDraggingId(item.id);
              setDraggingKind(item.storage);
            }}
            onDragOver={(event) => {
              if (!reorderable || !draggingId || draggingId === item.id || draggingKind !== viewKind) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverId(item.id);
              setDragOverAfter(event.clientY >= event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2);
            }}
            onDragLeave={() => {
              if (dragOverId === item.id) {
                setDragOverId(null);
                setDragOverAfter(false);
              }
            }}
            onDrop={(event) => {
              const payload = readItemDragPayload(event.dataTransfer);
              if (
                !reorderable
                || !payload
                || payload.kind !== viewKind
                || payload.id === item.id
              ) return;
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              onReorder?.(payload.id, item.id, event.clientY >= bounds.top + bounds.height / 2);
              clearItemDragPayload();
              setDraggingId(null);
              setDraggingKind(null);
              setDragOverId(null);
              setDragOverAfter(false);
            }}
            onDragEnd={() => {
              clearItemDragPayload();
              setDraggingId(null);
              setDraggingKind(null);
              setDragOverId(null);
              setDragOverAfter(false);
            }}
          >
            {item.contentType === "IMAGE" ? (
              <span className="item-thumbnail">
                <ClipboardImage
                  id={item.id}
                  thumbnail
                  storage={item.storage}
                  sourcePath={parseImageMetadata(item)?.thumbnailPath}
                  alt=""
                />
              </span>
            ) : (
              <span className={`item-icon type-${item.contentType.toLowerCase()}`} aria-hidden="true">
                <ContentTypeIcon type={item.contentType} />
              </span>
            )}
            <span className="item-copy">
              <strong title={summary(item)}>{summary(item)}</strong>
              <span className="item-meta">
                <span>{contentTypeLabels[item.contentType]}</span>
                {item.sourceApp && <><i aria-hidden="true" /><span className="item-source" title={item.sourceApp}>{item.sourceApp}</span></>}
                <i aria-hidden="true" />
                <time dateTime={new Date(item.createdAt).toISOString()} title={absoluteFormatter.format(item.createdAt)}>
                  {relativeTime(item.createdAt, now)}
                </time>
              </span>
            </span>
            {item.isPinned && (
              <span className="row-pin" aria-label="已釘選" title="已釘選">
                <Pin size={12} fill="currentColor" />
              </span>
            )}
          </button>
          </Fragment>
        ))}
        {!loading && !error && !pending && viewKind === "history" && items.length < totalCount && (
          <button
            type="button"
            className="history-load-more"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "正在載入…" : `載入更多（剩餘 ${(totalCount - items.length).toLocaleString("zh-TW")} 筆）`}
          </button>
        )}
      </div>

      <footer className="history-footer" aria-hidden="true">
        {viewKind === "history" ? (
          <>
            <span><kbd>↑↓</kbd> 選取</span>
            <span><kbd>Enter</kbd> 複製</span>
            <span><kbd>拖曳</kbd> 收藏</span>
          </>
        ) : (
          <>
            <span><kbd>↑↓</kbd> 選取</span>
            <span><kbd>Enter</kbd> 複製</span>
            <span><kbd>拖曳</kbd> 排序</span>
          </>
        )}
      </footer>
    </section>
  );
}
