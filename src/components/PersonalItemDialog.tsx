import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { LoaderCircle, X } from "lucide-react";
import type { ClipboardContentType, DisplayItem } from "../types/clipboard";
import { ClipboardImage } from "./ClipboardImage";
import "./dialogs.css";

export type LibraryItemDialogMode = "personal" | "folder" | "history";
interface PersonalItemDialogProps {
  item: DisplayItem | null;
  mode?: LibraryItemDialogMode;
  initialType?: ClipboardContentType;
  error?: string | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (title: string, content: string | null, contentType: ClipboardContentType, imageBase64?: string) => void;
}
const typeOptions: Array<{ value: ClipboardContentType; label: string }> = [
  { value: "IMAGE", label: "圖片" },
  { value: "TEXT", label: "文字／備忘" }, { value: "URL", label: "網址" }, { value: "COMMAND", label: "指令" },
  { value: "EMAIL", label: "Email" }, { value: "IP", label: "IP 位址" }, { value: "CODE", label: "程式碼" },
  { value: "JSON", label: "JSON" }, { value: "FILE_PATH", label: "檔案路徑" }, { value: "NETWORK_PATH", label: "網路路徑" },
];
export function PersonalItemDialog({ item, mode: requestedMode, initialType = "TEXT", error, saving, onClose, onSubmit }: PersonalItemDialogProps) {
  const mode = requestedMode ?? (item?.storage === "folder" ? "folder" : "personal");
  const isFolder = mode === "folder";
  const editing = Boolean(item);
  const [imageData, setImageData] = useState<string>();
  const [readingImage, setReadingImage] = useState(false);
  const [title, setTitle] = useState(item?.customName || "");
  const [content, setContent] = useState(item?.content || "");
  const [contentType, setContentType] = useState<ClipboardContentType>(item?.contentType ?? initialType);
  const imageOnly = contentType === "IMAGE";
  const [validationError, setValidationError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<"title" | "content" | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const contentInput = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    setTitle(item?.customName || ""); setContent(item?.content || "");
    setContentType(item?.contentType ?? initialType);
    setImageData(undefined); setValidationError(null); setInvalidField(null);
  }, [item, mode, initialType]);
  useEffect(() => {
    const previous = returnFocus.current;
    const frame = window.requestAnimationFrame(() => titleInput.current?.focus());
    return () => { window.cancelAnimationFrame(frame); previous?.focus?.(); };
  }, []);
  useEffect(() => { if (saving) dialog.current?.focus(); }, [saving]);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || readingImage) return;
    const nextTitle = title.trim();
    if (!nextTitle) { setValidationError("請輸入標題。"); setInvalidField("title"); titleInput.current?.focus(); return; }
    if (!imageOnly && !content) { setValidationError("請輸入要保存的內容。"); setInvalidField("content"); contentInput.current?.focus(); return; }
    if (imageOnly && !imageData && item?.contentType !== "IMAGE") { setValidationError("請選擇要保存的圖片。"); return; }
    if (!imageOnly && new TextEncoder().encode(content).length > 4 * 1024 * 1024) { setValidationError("文字內容不可超過 4 MB。"); return; }
    setValidationError(null); setInvalidField(null);
    onSubmit(nextTitle, imageOnly ? null : content, contentType, imageOnly ? imageData?.split(",")[1] : undefined);
  };
  const chooseImage = async (file?: File) => {
    if (!file) return;
    setImageData(undefined);
    if (file.size > 20 * 1024 * 1024 || !/\.(png|jpe?g|bmp)$/i.test(file.name)) { setValidationError("請選擇 20 MB 以下的 PNG、JPEG 或 BMP 圖片。"); return; }
    setReadingImage(true); setValidationError(null);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
      setImageData(data);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 120));
    } catch { setValidationError("無法讀取圖片，請重新選擇。"); }
    finally { setReadingImage(false); }
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
        <header className="cc-modal-header"><div><span className="cc-modal-eyebrow">{isFolder ? "資料夾內容" : mode === "history" ? "最近複製" : "常用片段"}</span><h2 id="personal-dialog-title">{editing ? "編輯內容" : "新增內容"}</h2></div><button type="button" className="cc-dialog-close" onClick={onClose} disabled={saving} aria-label="關閉片段編輯" title="關閉（Esc）"><X size={18} /></button></header>
        <form className="cc-modal-form" onSubmit={handleSubmit}>
          <div className="cc-modal-body"><p id="personal-dialog-description" className="cc-dialog-intro">{isFolder ? "整理這個資料夾中的內容，方便下次取用。" : "把常用回覆、指令和備忘留在手邊。"}</p>
            <div className="cc-snippet-fields">
              <label className="cc-dialog-field"><span>標題</span><input ref={titleInput} value={title} onChange={(event) => { setTitle(event.target.value); if (invalidField === "title") { setValidationError(null); setInvalidField(null); } }} placeholder="給這段內容一個好找的名字" maxLength={120} disabled={saving} aria-invalid={invalidField === "title"} aria-describedby={invalidField === "title" ? "personal-validation" : undefined} /></label>
              <label className="cc-dialog-field"><span>內容類型</span><select value={contentType} onChange={(event) => setContentType(event.target.value as ClipboardContentType)} disabled={saving}>{typeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            </div>
            {imageOnly ? <div className="cc-image-editor">
              <label className="cc-dialog-field"><span>{item?.contentType === "IMAGE" ? "替換圖片（未選擇則保留原圖）" : "選擇圖片"}</span><input type="file" accept=".png,.jpg,.jpeg,.bmp" disabled={saving || readingImage} onChange={(event) => void chooseImage(event.target.files?.[0])} /></label>
              <p className="cc-dialog-status">PNG、JPEG、BMP，最大 20 MB、8192 × 8192 像素。</p>
              {readingImage ? <p role="status">正在讀取圖片…</p> : imageData ? <img src={imageData} alt="待儲存的圖片" /> : item?.contentType === "IMAGE" ? <ClipboardImage id={item.id} storage={item.storage} sourcePath={item.filePath ?? undefined} alt="目前圖片" /> : null}
            </div> : <label className="cc-dialog-field cc-content-field"><span>內容 <small>{content.length.toLocaleString()} 字元</small></span><textarea ref={contentInput} value={content} onChange={(event) => { setContent(event.target.value); if (invalidField === "content") { setValidationError(null); setInvalidField(null); } }} placeholder="輸入文字、網址、指令或備忘…" rows={7} spellCheck={false} disabled={saving} aria-invalid={invalidField === "content"} aria-describedby={invalidField === "content" ? "personal-validation" : undefined} data-code={["CODE", "JSON", "COMMAND"].includes(contentType)} /></label>}
            {(validationError || error) && <p id="personal-validation" className="cc-dialog-error" role="alert">{validationError || error}</p>}
          </div>
          <footer className="cc-modal-footer"><span className="cc-dialog-status"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 儲存</span><div className="cc-dialog-actions"><button type="button" className="cc-dialog-secondary" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="cc-dialog-primary" disabled={saving || readingImage}>{saving && <LoaderCircle className="cc-dialog-spinner" size={14} />}{saving ? "儲存中…" : editing ? "儲存變更" : "新增內容"}</button></div></footer>
        </form>
      </section>
    </div>
  );
}
