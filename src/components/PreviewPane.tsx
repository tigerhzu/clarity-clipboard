import {
  CheckCircle2,
  Clipboard,
  Copy,
  Globe2,
  HardDrive,
  ImageOff,
  Pin,
  PinOff,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { ClipboardContentType, ClipboardItem } from "../types/clipboard";
import { CodePreview } from "./CodePreview";
import { ContentTypeIcon, contentTypeLabels } from "./ContentTypeIcon";
import { parseImageMetadata } from "../lib/clipboard-api";
import { ClipboardImage } from "./ClipboardImage";

interface PreviewPaneProps {
  item: ClipboardItem | null;
  busy: boolean;
  onCopy: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function displayContent(item: ClipboardItem): string {
  const content = item.content || "";
  if (item.contentType === "JSON") {
    try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; }
  }
  return content;
}

function urlDomain(content: string): string | null {
  try { return new URL(content).hostname; } catch { return null; }
}

function PreviewContent({ item }: { item: ClipboardItem }) {
  if (item.contentType === "IMAGE") {
    const metadata = parseImageMetadata(item);
    return item.filePath ? (
      <figure className="image-preview">
        <ClipboardImage id={item.id} alt={item.customName || "剪貼簿圖片"} />
        {metadata && <figcaption>{metadata.width} × {metadata.height}</figcaption>}
      </figure>
    ) : (
      <div className="image-missing"><ImageOff size={28} /><span>圖片檔案不存在</span></div>
    );
  }
  const content = displayContent(item);
  if (["CODE", "JSON", "COMMAND"].includes(item.contentType)) {
    return <CodePreview content={content} />;
  }
  if (item.contentType === "URL") {
    const domain = urlDomain(content);
    return (
      <div className="structured-preview url-preview">
        <div className="structured-icon"><Globe2 size={24} /></div>
        {domain && <span className="structured-label">{domain}</span>}
        <p>{content}</p>
      </div>
    );
  }
  if (["EMAIL", "IP", "FILE_PATH", "NETWORK_PATH"].includes(item.contentType)) {
    return (
      <div className="structured-preview value-preview">
        <span className="structured-label">{contentTypeLabels[item.contentType]}</span>
        <p>{content}</p>
      </div>
    );
  }
  return <pre className="text-preview">{content}</pre>;
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

export function PreviewPane({ item, busy, onCopy, onTogglePin, onDelete }: PreviewPaneProps) {
  if (!item) {
    return (
      <aside className="preview-panel preview-empty">
        <div className="preview-empty-art"><Clipboard size={34} /></div>
        <h2>選擇一筆內容</h2>
        <p>完整內容與來源資訊會顯示在這裡。</p>
      </aside>
    );
  }

  const imageMetadata = parseImageMetadata(item);

  return (
    <aside className="preview-panel">
      <header className="preview-header">
        <div className={`preview-type-icon type-${item.contentType.toLowerCase()}`}>
          <ContentTypeIcon type={item.contentType} size={20} />
        </div>
        <div>
          <span>內容預覽</span>
          <strong>{item.customName || previewTitle(item.contentType)}</strong>
        </div>
        <span className="type-pill">{item.contentType}</span>
      </header>

      <div className="preview-body">
        <PreviewContent item={item} />
      </div>

      <dl className="metadata-list">
        <div><dt>複製時間</dt><dd>{dateFormatter.format(item.createdAt)}</dd></div>
        <div><dt>來源程式</dt><dd>{item.sourceApp || "尚未辨識"}</dd></div>
        {item.sourceProcess && <div><dt>Process</dt><dd>{item.sourceProcess}</dd></div>}
        {item.sourceWindow && <div><dt>視窗標題</dt><dd title={item.sourceWindow}>{item.sourceWindow}</dd></div>}
        {imageMetadata ? (
          <>
            <div><dt>圖片尺寸</dt><dd>{imageMetadata.width} × {imageMetadata.height}</dd></div>
            <div><dt>檔案大小</dt><dd>{formatBytes(imageMetadata.byteSize)}</dd></div>
          </>
        ) : (
          <div><dt>字元數</dt><dd>{item.content?.length.toLocaleString("zh-TW") || 0}</dd></div>
        )}
      </dl>

      <div className="preview-actions" aria-label="剪貼簿操作">
        <button className="primary-action" type="button" disabled={busy} onClick={() => onCopy(item.id)}>
          <Copy size={15} />
          <span>複製</span>
          <kbd>Enter</kbd>
        </button>
        <button type="button" disabled={busy} onClick={() => onTogglePin(item.id)}>
          {item.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
          <span>{item.isPinned ? "取消釘選" : "釘選"}</span>
          <kbd>Ctrl P</kbd>
        </button>
        <button className="delete-action" type="button" disabled={busy} onClick={() => onDelete(item.id)}>
          <Trash2 size={15} />
          <span>刪除</span>
          <kbd>Del</kbd>
        </button>
      </div>

      <div className="privacy-note">
        <ShieldCheck size={17} />
        <div><strong>保留在這台電腦</strong><span>沒有雲端同步，也不會上傳內容。</span></div>
      </div>

      <footer className="phase-note">
        <CheckCircle2 size={15} />
        <span>Phase 4 本機圖片與隱私</span>
        <HardDrive size={15} />
        <span>SQLite</span>
      </footer>
    </aside>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
