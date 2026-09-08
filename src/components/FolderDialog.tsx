import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Folder, LoaderCircle, X } from "lucide-react";
import type { Folder as FolderModel } from "../types/clipboard";
import "./dialogs.css";

interface FolderDialogProps {
  folder: FolderModel | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}
export function FolderDialog({ folder, saving, onClose, onSubmit }: FolderDialogProps) {
  const editing = Boolean(folder);
  const [name, setName] = useState(folder?.name || "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => { setName(folder?.name || ""); setValidationError(null); }, [folder]);
  useEffect(() => {
    const previous = returnFocus.current;
    const frame = window.requestAnimationFrame(() => { nameInput.current?.focus(); nameInput.current?.select(); });
    return () => { window.cancelAnimationFrame(frame); previous?.focus?.(); };
  }, []);
  useEffect(() => { if (saving) dialog.current?.focus(); }, [saving]);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) { setValidationError("請輸入資料夾名稱。"); nameInput.current?.focus(); return; }
    setValidationError(null); onSubmit(name.trim());
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); if (!saving) onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); dialog.current?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="cc-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section ref={dialog} className="cc-modal cc-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" aria-describedby="folder-dialog-description" aria-busy={saving} tabIndex={-1} onKeyDown={handleKeyDown}>
        <header className="cc-modal-header"><div><span className="cc-modal-eyebrow">整理你的收藏</span><h2 id="folder-dialog-title">{editing ? "重新命名資料夾" : "新增資料夾"}</h2></div><button type="button" className="cc-dialog-close" onClick={onClose} disabled={saving} aria-label="關閉資料夾編輯" title="關閉（Esc）"><X size={18} /></button></header>
        <form className="cc-modal-form" onSubmit={handleSubmit}>
          <div className="cc-modal-body"><p id="folder-dialog-description" className="cc-dialog-intro">{editing ? "使用容易辨識的名稱，讓內容更好找。" : "依專案、主題或用途，把想留下的內容放在一起。"}</p>
            <label className="cc-dialog-field"><span>資料夾名稱</span><span className="cc-input-with-icon"><Folder size={17} aria-hidden="true" /><input ref={nameInput} value={name} onChange={(event) => { setName(event.target.value); setValidationError(null); }} placeholder="例如：專案靈感" maxLength={120} disabled={saving} aria-invalid={Boolean(validationError)} aria-describedby={validationError ? "folder-validation" : undefined} /></span></label>
            {validationError && <p id="folder-validation" className="cc-dialog-error" role="alert">{validationError}</p>}
          </div>
          <footer className="cc-modal-footer"><span className="cc-dialog-status">收藏內容會持續保留</span><div className="cc-dialog-actions"><button type="button" className="cc-dialog-secondary" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="cc-dialog-primary" disabled={saving}>{saving && <LoaderCircle className="cc-dialog-spinner" size={14} />}{saving ? "儲存中…" : editing ? "儲存名稱" : "建立資料夾"}</button></div></footer>
        </form>
      </section>
    </div>
  );
}

interface ConfirmFolderDeleteDialogProps {
  folder: FolderModel;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmFolderDeleteDialog({ folder, saving, onClose, onConfirm }: ConfirmFolderDeleteDialogProps) {
  const dialog = useRef<HTMLElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const previous = returnFocus.current;
    const frame = window.requestAnimationFrame(() => cancelButton.current?.focus());
    return () => { window.cancelAnimationFrame(frame); previous?.focus?.(); };
  }, []);
  useEffect(() => { if (saving) dialog.current?.focus(); }, [saving]);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); if (!saving) onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); dialog.current?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="cc-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section ref={dialog} className="cc-modal cc-folder-dialog" role="alertdialog" aria-modal="true" aria-labelledby="folder-delete-title" aria-describedby="folder-delete-description" aria-busy={saving} tabIndex={-1} onKeyDown={handleKeyDown}>
        <header className="cc-modal-header"><div><span className="cc-modal-eyebrow">整理收藏</span><h2 id="folder-delete-title">刪除資料夾？</h2></div><button type="button" className="cc-dialog-close" onClick={onClose} disabled={saving} aria-label="取消刪除資料夾"><X size={18} /></button></header>
        <div className="cc-modal-body"><div className="cc-delete-folder-summary"><Folder size={20} /><strong>{folder.name}</strong><span>{folder.itemCount} 個項目</span></div><p id="folder-delete-description" className="cc-delete-description">資料夾與其中保存的 {folder.itemCount} 個項目將永久刪除。原本的剪貼簿歷史會保留。</p></div>
        <footer className="cc-modal-footer"><span /><div className="cc-dialog-actions"><button ref={cancelButton} type="button" className="cc-dialog-secondary" onClick={onClose} disabled={saving}>取消</button><button type="button" className="cc-dialog-danger" onClick={() => { if (!saving) onConfirm(); }} disabled={saving}>{saving && <LoaderCircle size={14} className="cc-dialog-spinner" />}{saving ? "刪除中…" : "刪除資料夾"}</button></div></footer>
      </section>
    </div>
  );
}
