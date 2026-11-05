import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Clipboard,
  Copy,
  ArrowDownToLine,
  ChevronDown,
  Folder,
  FolderMinus,
  FolderPlus,
  GripVertical,
  Globe2,
  ImageOff,
  LoaderCircle,
  Pencil,
  Pin,
  PinOff,
  Bookmark,
  Trash2,
  X,
} from "lucide-react";
import type { ClipboardContentType, DisplayItem, ItemStorage, Folder as FolderModel } from "../types/clipboard";
import { CodePreview } from "./CodePreview";
import { ContentTypeIcon, contentTypeLabels } from "./ContentTypeIcon";
import { parseImageMetadata } from "../lib/clipboard-api";
import { ClipboardImage } from "./ClipboardImage";
import type { ItemDragPayload } from "../lib/drag";

interface PreviewPaneProps {
  item: DisplayItem | null;
  pending: boolean;
  busy: boolean;
  deleteArmed: boolean;
  mode?: ItemStorage;
  collectionLabel?: string;
  folders?: FolderModel[];
  onSave?: (target: "personal" | { folderId: string }, id: string) => void;
  onCreateFolder?: () => void;
  onCopy: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRemove?: (id: string) => void;
  onEdit?: (id: string) => void;
  onStartPointerDrag?: (payload: ItemDragPayload, event: ReactPointerEvent<HTMLElement>) => void;
}

const MAX_PREVIEW_CHARACTERS = 80_000;
const MAX_PREVIEW_LINES = 500;

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function displayContent(item: DisplayItem): string {
  const content = item.content || "";
  if (item.contentType === "JSON" && content.length <= 200_000) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  return content;
}

function limitedContent(content: string, expanded: boolean) {
  if (expanded) return { content, truncated: false };
  let preview = content.slice(0, MAX_PREVIEW_CHARACTERS);
  let truncated = preview.length < content.length;
  const lines = preview.split("\n");
  if (lines.length > MAX_PREVIEW_LINES) {
    preview = lines.slice(0, MAX_PREVIEW_LINES).join("\n");
    truncated = true;
  }
  return { content: preview, truncated };
}

function urlDomain(content: string): string | null {
  try {
    return new URL(content).hostname;
  } catch {
    return null;
  }
}

function PreviewContent({
  item,
  expanded,
  imageExpanded,
  onExpand,
  onToggleImage,
}: {
  item: DisplayItem;
  expanded: boolean;
  imageExpanded: boolean;
  onExpand: () => void;
  onToggleImage: () => void;
}) {
  if (item.contentType === "IMAGE") {
    const metadata = parseImageMetadata(item);
    return item.filePath ? (
      <>
        <figure className="image-preview">
          <button
            type="button"
            className="image-preview-trigger"
            onClick={onToggleImage}
            aria-pressed={imageExpanded}
            aria-label={imageExpanded ? "縮小圖片預覽" : "放大圖片預覽"}
          >
            <ClipboardImage
              id={item.id}
              storage={item.storage}
              sourcePath={item.filePath ?? undefined}
              alt={item.customName || "剪貼簿圖片"}
            />
            <span className="image-zoom-hint" aria-hidden="true">點擊放大</span>
          </button>
          {metadata && <figcaption>{metadata.width} × {metadata.height}</figcaption>}
        </figure>
        {imageExpanded && (
          <div
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="放大圖片預覽"
            onClick={onToggleImage}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") { event.preventDefault(); onToggleImage(); return; }
              if (event.key !== "Tab") return;
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled)",
              ));
              if (focusable.length === 0) return;
              const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
              const nextIndex = event.shiftKey
                ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                : (currentIndex + 1) % focusable.length;
              event.preventDefault();
              focusable[nextIndex].focus();
            }}
          >
            <button
              type="button"
              className="image-lightbox-close"
              autoFocus
              onClick={(event) => {
                event.stopPropagation();
                onToggleImage();
              }}
              aria-label="關閉放大預覽"
              title="關閉（Esc）"
            >
              <X size={18} />
            </button>
            <button
              type="button"
              className="image-lightbox-image"
              onClick={(event) => {
                event.stopPropagation();
                onToggleImage();
              }}
              aria-label="縮小圖片預覽"
            >
              <ClipboardImage
                id={item.id}
                storage={item.storage}
                sourcePath={item.filePath ?? undefined}
                alt={item.customName || "剪貼簿圖片"}
              />
            </button>
            <span className="image-lightbox-hint">點擊圖片縮小 · Esc 關閉</span>
          </div>
        )}
      </>
    ) : (
      <div className="image-missing"><ImageOff size={28} /><span>圖片檔案不存在</span></div>
    );
  }

  const content = displayContent(item);
  const preview = limitedContent(content, expanded);
  let body;

  if (["CODE", "JSON", "COMMAND"].includes(item.contentType)) {
    body = <CodePreview content={preview.content} />;
  } else if (item.contentType === "URL") {
    const domain = urlDomain(content);
    body = (
      <div className="structured-preview url-preview">
        <div className="structured-icon"><Globe2 size={23} /></div>
        {domain && <span className="structured-label">{domain}</span>}
        <p>{preview.content}</p>
      </div>
    );
  } else if (["EMAIL", "IP", "FILE_PATH", "NETWORK_PATH"].includes(item.contentType)) {
    body = (
      <div className="structured-preview value-preview">
        <span className="structured-label">{contentTypeLabels[item.contentType]}</span>
        <p>{preview.content}</p>
      </div>
    );
  } else {
    body = <pre className="text-preview">{preview.content}</pre>;
  }

  return (
    <div className="preview-content-stack">
      {body}
      {preview.truncated && (
        <div className="preview-truncated" role="note">
          <span>為了保持流暢，已先顯示部分內容。</span>
          <button type="button" onClick={onExpand}>顯示完整內容</button>
        </div>
      )}
    </div>
  );
}

function previewTitle(type: ClipboardContentType): string {
  switch (type) {
    case "URL": return "網址資訊";
    case "JSON": return "JSON 文件";
    case "COMMAND": return "命令列";
    case "CODE": return "程式碼";
    case "FILE_PATH": return "檔案路徑";
    case "NETWORK_PATH": return "網路路徑";
    case "IMAGE": return "圖片預覽";
    default: return contentTypeLabels[type];
  }
}

export function PreviewPane({
  item,
  pending,
  busy,
  deleteArmed,
  mode = "history",
  collectionLabel,
  folders = [],
  onSave,
  onCreateFolder,
  onCopy,
  onTogglePin,
  onDelete,
  onRemove,
  onEdit,
  onStartPointerDrag,
}: PreviewPaneProps) {
  const [expanded, setExpanded] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const saveMenu = useRef<HTMLDivElement>(null);
  const saveTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setExpanded(false);
    setImageExpanded(false);
    setSaveOpen(false);
  }, [item?.id]);

  useEffect(() => {
    if (!saveOpen) return;
    saveMenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: PointerEvent) => {
      if (!saveMenu.current?.contains(event.target as Node) && !saveTrigger.current?.contains(event.target as Node)) setSaveOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [saveOpen]);

  const toggleImage = () => {
    if (imageExpanded) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".image-preview-trigger")?.focus());
    setImageExpanded((current) => !current);
  };

  useEffect(() => {
    if (!imageExpanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setImageExpanded(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageExpanded]);

  const characterCount = useMemo(
    () => Array.from(item?.content || "").length,
    [item?.content],
  );

  if (!item) {
    return (
      <aside className="preview-panel preview-empty" aria-label="內容預覽">
        <span className="empty-eyebrow">A LITTLE SPACE FOR YOUR IDEAS</span>
        <div className={`preview-empty-art${pending ? " pending" : ""}`}>
          <div className="empty-paper back" /><div className="empty-paper front">{pending ? <LoaderCircle size={27} /> : <Clipboard size={31} />}<i /><i /><i /></div>
        </div>
        <h2>{pending ? "正在找回你的內容" : "複製過的，都能再派上用場"}</h2>
        <p>{pending ? "搜尋完成後，完整內容會顯示在這裡。" : "選一筆剪貼紀錄，在這裡閱讀、收藏，再次使用。"}</p>
        <div className="empty-key-hints"><span><kbd>Ctrl K</kbd> 搜尋</span><span><kbd>Enter</kbd> 複製</span></div>
      </aside>
    );
  }

  const imageMetadata = parseImageMetadata(item);
  const title = item.customName || (item.contentType === "TEXT" ? item.content?.trim().split("\n")[0].slice(0, 72) : null) || previewTitle(item.contentType);

  const canDragToCollection = mode === "history" && !pending && !busy;

  return (
    <aside
      className="preview-panel"
      aria-labelledby="preview-title"
      draggable={false}
    >
      <header className="preview-header">
        <span className="preview-eyebrow">內容預覽</span>
        <div className="preview-header-actions">
          {mode === "history" ? <button className={`icon-button${item.isPinned ? " is-pinned" : ""}`} type="button" disabled={busy} onClick={() => onTogglePin?.(item.id)} aria-label={item.isPinned ? "取消釘選" : "釘選內容"} title={item.isPinned ? "取消釘選（Ctrl P）" : "釘選，保留此紀錄（Ctrl P）"}>{item.isPinned ? <PinOff size={16} /> : <Pin size={16} />}</button> : null}
          {<button className="icon-button" type="button" disabled={busy} onClick={() => onEdit?.(item.id)} aria-label="編輯內容" title="編輯內容"><Pencil size={16} /></button>}
          <button className={`icon-button delete-action${deleteArmed ? " armed" : ""}`} type="button" disabled={busy} onClick={() => mode === "folder" ? onRemove?.(item.id) : onDelete?.(item.id)} aria-label={deleteArmed ? "再次按下以確認刪除" : mode === "folder" ? "從資料夾移除項目" : "刪除內容"} title={deleteArmed ? "再次按下以確認刪除" : "刪除（按兩次確認）"}>{mode === "folder" ? <FolderMinus size={16} /> : <Trash2 size={16} />}{deleteArmed && <span>確認刪除</span>}</button>
        </div>
      </header>

      <div className={`preview-body${item.contentType === "IMAGE" ? " image-preview-body" : ""}`}>
        <div className={`preview-document-heading${item.contentType === "IMAGE" ? " is-image" : ""}`}>
          <span className="type-label"><ContentTypeIcon type={item.contentType} size={13} />{contentTypeLabels[item.contentType]}</span>
          {item.isPinned && mode === "history" && <span className="pinned-label"><Pin size={11} />已釘選</span>}
          <h2 id="preview-title" title={title}>{title}</h2>
          <div className="document-byline"><span>{item.sourceApp || (mode === "personal" ? "手動建立" : "來源未提供")}</span><i />{dateFormatter.format(item.createdAt)}</div>
        </div>
        <PreviewContent
          item={item}
          expanded={expanded}
          imageExpanded={imageExpanded}
          onExpand={() => setExpanded(true)}
          onToggleImage={toggleImage}
        />

      <details className="metadata-details" open><summary>詳細資訊<ChevronDown size={14} /></summary><dl className="metadata-list">
        <div><dt>複製時間</dt><dd>{dateFormatter.format(item.createdAt)}</dd></div>
        <div><dt>來源程式</dt><dd title={item.sourceApp || "尚未辨識"}>{item.sourceApp || "尚未辨識"}</dd></div>
        {item.sourceProcess && <div><dt>執行程式</dt><dd title={item.sourceProcess}>{item.sourceProcess}</dd></div>}
        {item.sourceWindow && <div><dt>視窗標題</dt><dd title={item.sourceWindow}>{item.sourceWindow}</dd></div>}
        {collectionLabel && <div><dt>保存位置</dt><dd title={collectionLabel}>{collectionLabel}</dd></div>}
        {imageMetadata ? (
          <>
            <div><dt>圖片尺寸</dt><dd>{imageMetadata.width} × {imageMetadata.height}</dd></div>
            <div><dt>檔案大小</dt><dd>{formatBytes(imageMetadata.byteSize)}</dd></div>
          </>
        ) : item.contentType === "IMAGE" ? <div><dt>圖片尺寸</dt><dd>未提供</dd></div> : (
          <div><dt>字元數</dt><dd>{characterCount.toLocaleString("zh-TW")}</dd></div>
        )}
      </dl></details>
      </div>

      <footer className="preview-command-area">
        <div className="preview-content-info"><span>{imageMetadata ? `${imageMetadata.width} × ${imageMetadata.height} · ${formatBytes(imageMetadata.byteSize)}` : item.contentType === "IMAGE" ? "圖片 · 尺寸未提供" : `${characterCount.toLocaleString("zh-TW")} 個字元`}</span>
          {canDragToCollection ? <button type="button" className="drag-handle" aria-label="拖曳內容到收藏" title="按住拖曳至資料夾，也可使用「保存到」" onPointerDown={(event) => onStartPointerDrag?.({ id: item.id, kind: "history" }, event)}><GripVertical size={13} />拖曳收藏</button> : <span>{collectionLabel || "已保存"}</span>}
        </div>
        <div className="preview-actions" aria-label="內容操作">
          <button className="primary-action" type="button" disabled={busy} onClick={() => onCopy(item.id)}><Copy size={16} /><span>複製內容</span><kbd>Enter ↵</kbd></button>
          {mode === "history" && <div className="save-control">
            <button ref={saveTrigger} className="save-trigger" type="button" disabled={busy} aria-expanded={saveOpen} aria-controls="save-destinations" onClick={() => setSaveOpen((current) => !current)}><ArrowDownToLine size={16} /><span>保存到</span><ChevronDown size={12} /></button>
            {saveOpen && <div ref={saveMenu} id="save-destinations" className="save-popover" aria-label="選擇保存位置" onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); setSaveOpen(false); saveTrigger.current?.focus(); } if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button")); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus(); } }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== saveTrigger.current) setSaveOpen(false); }}>
              <p>留在手邊，隨時再用</p>
              <button type="button" onClick={() => { onSave?.("personal", item.id); setSaveOpen(false); saveTrigger.current?.focus(); }}><Bookmark size={15} />常用片段</button>
              {folders.map((folder) => <button key={folder.id} type="button" title={folder.name} onClick={() => { onSave?.({ folderId: folder.id }, item.id); setSaveOpen(false); saveTrigger.current?.focus(); }}><Folder size={15} /><span>{folder.name}</span></button>)}
              <button type="button" className="save-new-folder" onClick={() => { setSaveOpen(false); onCreateFolder?.(); }}><FolderPlus size={15} />新增資料夾</button>
            </div>}
          </div>}
        </div>
      </footer>
    </aside>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
