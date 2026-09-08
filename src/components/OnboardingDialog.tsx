import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, Bookmark, Clipboard, Copy, Keyboard as KeyboardIcon, Search, Settings2, X } from "lucide-react";
import { DEFAULT_GLOBAL_HOTKEY, formatHotkey } from "../lib/hotkey";
import type { ClipboardSettings } from "../types/clipboard";
import { SettingsDialog } from "./SettingsDialog";
import "./dialogs.css";

interface OnboardingDialogProps {
  initialSettings: ClipboardSettings | null;
  onClose: () => void;
  onSettingsSaved: (settings: ClipboardSettings) => void;
}
export function OnboardingDialog({ initialSettings, onClose, onSettingsSaved }: OnboardingDialogProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedHotkey, setSavedHotkey] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const preferencesButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const hotkey = formatHotkey(savedHotkey ?? initialSettings?.hotkey ?? DEFAULT_GLOBAL_HOTKEY);
  useEffect(() => {
    const previous = returnFocus.current;
    const frame = window.requestAnimationFrame(() => primaryButton.current?.focus());
    return () => { window.cancelAnimationFrame(frame); previous?.focus?.(); };
  }, []);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (!first) event.preventDefault();
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => preferencesButton.current?.focus());
  };
  return (
    <>
      <div className="cc-modal-backdrop" role="presentation" inert={settingsOpen} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={dialog} className="cc-modal cc-welcome" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description" onKeyDown={handleKeyDown}>
          <header className="cc-modal-header"><div className="cc-welcome-brand"><span><Clipboard size={20} /></span><strong>CLARITY <small>剪貼簿</small></strong></div><button type="button" className="cc-dialog-close" onClick={onClose} aria-label="關閉快速上手" title="關閉（Esc）"><X size={18} /></button></header>
          <div className="cc-modal-body cc-welcome-body">
            <span className="cc-modal-eyebrow">少一點重複，多一點專注</span>
            <h2 id="onboarding-title">複製過的，<br />隨時回到手邊。</h2>
            <p id="onboarding-description" className="cc-welcome-description">文字、圖片與靈感，一個安靜有序的存放空間。</p>
            <div className="cc-welcome-hotkey"><KeyboardIcon size={19} /><span>在任何地方叫出剪貼簿</span><kbd>{hotkey}</kbd></div>
            <div className="cc-welcome-steps">
              <div><Copy size={20} /><strong>照常複製</strong><p>文字與圖片<br />自動加入歷史</p></div>
              <div><Search size={20} /><strong>搜尋並取用</strong><p>用方向鍵選擇<br />按 Enter 再次複製</p></div>
              <div><Bookmark size={20} /><strong>留下常用內容</strong><p>釘選、拖入資料夾<br />或存成常用片段</p></div>
            </div>
          </div>
          <footer className="cc-modal-footer"><button ref={preferencesButton} type="button" className="cc-dialog-tertiary" onClick={() => setSettingsOpen(true)}><Settings2 size={15} />調整偏好</button><button ref={primaryButton} type="button" className="cc-dialog-primary" onClick={onClose}>開始使用<ArrowRight size={15} /></button></footer>
        </section>
      </div>
      {settingsOpen && <SettingsDialog onClose={closeSettings} onSaved={(settings) => { setSavedHotkey(settings.hotkey); onSettingsSaved(settings); }} />}
    </>
  );
}
