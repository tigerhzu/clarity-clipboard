import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Image, LoaderCircle, X } from "lucide-react";
import type { ClipboardContentType, DisplayItem } from "../types/clipboard";
import "./dialogs.css";

export type LibraryItemDialogMode = "personal" | "folder";
interface PersonalItemDialogProps {
  item: DisplayItem | null;
  mode?: LibraryItemDialogMode;
  saving: boolean;
  onClose: () => void;
  onSubmit: (title: string, content: string | null, contentType: ClipboardContentType) => void;
}
const typeOptions: Array<{ value: ClipboardContentType; label: string }> = [
  { value: "TEXT", label: "文字／備忘" }, { value: "URL", label: "網址" }, { value: "COMMAND", label: "指令" },
  { value: "EMAIL", label: "Email" }, { value: "IP", label: "IP 位址" }, { value: "CODE", label: "程式碼" },
  { value: "JSON", label: "JSON" }, { value: "FILE_PATH", label: "檔案路徑" }, { value: "NETWORK_PATH", label: "網路路徑" },
];
export function PersonalItemDialog({ item, mode: requestedMode, saving, onClose, onSubmit }: PersonalItemDialogProps) {
  const mode = requestedMode ?? (item?.storage === "folder" ? "folder" : "personal");
  const isFolder = mode === "folder";
  const editing = Boolean(item);
  const imageOnly = item?.contentType === "IMAGE";
  const [title, setTitle] = useState(item?.customName || "");
  const [content, setContent] = useState(item?.content || "");
  const [contentType, setContentType] = useState<ClipboardContentType>(item?.contentType && item.contentType !== "IMAGE" ? item.contentType : "TEXT");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<"title" | "content" | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const contentInput = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    setTitle(item?.customName || ""); setContent(item?.content || "");
    setContentType(item?.contentType && item.contentType !== "IMAGE" ? item.contentType : "TEXT");
    setValidationError(null); setInvalidField(null);
  }, [item, mode]);
  useEffect(() => {
    const previous = returnFocus.current;
    const frame = window.requestAnimationFrame(() => titleInput.current?.focus());
    return () => { window.cancelAnimationFrame(frame); previous?.focus?.(); };
  }, []);
  useEffect(() => { if (saving) dialog.current?.focus(); }, [saving]);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const nextTitle = title.trim();
    if (!nextTitle) { setValidationError("請輸入標題。"); setInvalidField("title"); titleInput.current?.focus(); return; }
    if (!imageOnly && !content) { setValidationError("請輸入要保存的內容。"); setInvalidField("content"); contentInput.current?.focus(); return; }
    setValidationError(null); setInvalidField(null);
    onSubmit(nextTitle, imageOnly ? null : content, imageOnly ? "IMAGE" : contentType);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); if (!saving) onClose(); return; }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!saving) dialog.current?.querySelector("form")?.requestSubmit(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)") ?? []).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); dialog.current?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="cc-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section ref={dialog} className="cc-modal cc-snippet-dialog" role="dialog" aria-modal="true" aria-labelledby="personal-dialog-title" aria-describedby="personal-dialog-description" aria-busy={saving} tabIndex={-1} onKeyDown={handleKeyDown}>
        <header className="cc-modal-header"><div><span className="cc-modal-eyebrow">{isFolder ? "資料夾內容" : "常用片段"}</span><h2 id="personal-dialog-title">{imageOnly ? "編輯圖片標題" : editing ? "編輯片段" : "新增片段"}</h2></div><button type="button" className="cc-dialog-close" onClick={onClose} disabled={saving} aria-label="關閉片段編輯" title="關閉（Esc）"><X size={18} /></button></header>
        <form className="cc-modal-form" onSubmit={handleSubmit}>
          <div className="cc-modal-body"><p id="personal-dialog-description" className="cc-dialog-intro">{isFolder ? "整理這個資料夾中的內容，方便下次取用。" : "把常用回覆、指令和備忘留在手邊。"}</p>
            <div className={imageOnly ? "" : "cc-snippet-fields"}>
              <label className="cc-dialog-field"><span>標題</span><input ref={titleInput} value={title} onChange={(event) => { setTitle(event.target.value); if (invalidField === "title") { setValidationError(null); setInvalidField(null); } }} placeholder="給這段內容一個好找的名字" maxLength={120} disabled={saving} aria-invalid={invalidField === "title"} aria-describedby={invalidField === "title" ? "personal-validation" : undefined} /></label>
              {!imageOnly && <label className="cc-dialog-field"><span>內容類型</span><select value={contentType} onChange={(event) => setContentType(event.target.value as ClipboardContentType)} disabled={saving}>{typeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>}
            </div>
            {imageOnly ? <div className="cc-image-note"><Image size={22} /><div><strong>圖片已保留</strong><p>這裡可編輯標題，原始圖片會保持完整。</p></div></div> : <label className="cc-dialog-field cc-content-field"><span>內容 <small>{content.length.toLocaleString()} 字元</small></span><textarea ref={contentInput} value={content} onChange={(event) => { setContent(event.target.value); if (invalidField === "content") { setValidationError(null); setInvalidField(null); } }} placeholder="輸入文字、網址、指令或備忘…" rows={7} spellCheck={false} disabled={saving} aria-invalid={invalidField === "content"} aria-describedby={invalidField === "content" ? "personal-validation" : undefined} data-code={["CODE", "JSON", "COMMAND"].includes(contentType)} /></label>}
            {validationError && <p id="personal-validation" className="cc-dialog-error" role="alert">{validationError}</p>}
          </div>
          <footer className="cc-modal-footer"><span className="cc-dialog-status"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 儲存</span><div className="cc-dialog-actions"><button type="button" className="cc-dialog-secondary" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="cc-dialog-primary" disabled={saving}>{saving && <LoaderCircle className="cc-dialog-spinner" size={14} />}{saving ? "儲存中…" : editing ? "儲存變更" : "新增片段"}</button></div></footer>
        </form>
      </section>
    </div>
  );
}
