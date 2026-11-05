import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, Check, Clock3, Keyboard, LoaderCircle, Lock, Monitor, RefreshCw, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { getClipboardSettings, updateClipboardSettings } from "../lib/clipboard-api";
import type { ClipboardSettings, ClipboardTextScale } from "../types/clipboard";
import { DEFAULT_GLOBAL_HOTKEY, formatHotkey, hotkeyFromKeyboardEvent } from "../lib/hotkey";
import "./dialogs.css";
import { HermesSettings } from "./HermesSettings";

interface SettingsDialogProps {
  onClose: () => void;
  onSaved: (settings: ClipboardSettings) => void;
}
const sections = [
  { id: "general", label: "一般", icon: SlidersHorizontal },
  { id: "storage", label: "儲存", icon: Clock3 },
  { id: "privacy", label: "隱私", icon: ShieldCheck },
  { id: "hermes", label: "Hermes", icon: Bot },
] as const;
const PROTECTED_EXCLUDED_APP = "1Password.exe";
const PROTECTED_EXCLUDED_KEY = "1password";
const MAX_EXCLUDED_APPS = 100;

function excludedAppKey(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.endsWith(".exe") ? normalized.slice(0, -4) : normalized;
}

function normalizeExcludedApps(values: string[]) {
  const normalized = [PROTECTED_EXCLUDED_APP];
  const seen = new Set([PROTECTED_EXCLUDED_KEY]);
  for (const rawValue of values) {
    const value = rawValue.trim();
    const key = excludedAppKey(value);
    if (!value || seen.has(key)) continue;
    if (normalized.length >= MAX_EXCLUDED_APPS) break;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function editableExcludedApps(values: string[]) {
  return values.filter((value) => excludedAppKey(value) !== PROTECTED_EXCLUDED_KEY);
}

function parseExcludedDraft(value: string) {
  const seen = new Set<string>();
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => {
    const key = excludedAppKey(entry);
    if (!entry || key === PROTECTED_EXCLUDED_KEY || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serializeSettings(settings: ClipboardSettings) {
  return JSON.stringify({ retentionDays: settings.retentionDays, sensitiveFilterEnabled: settings.sensitiveFilterEnabled,
    excludedApps: settings.excludedApps, textScale: settings.textScale, hotkey: settings.hotkey, hermesEnabled: settings.hermesEnabled });
}
export function SettingsDialog({ onClose, onSaved }: SettingsDialogProps) {
  const [settings, setSettings] = useState<ClipboardSettings | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [savedHermesEnabled, setSavedHermesEnabled] = useState(false);
  const [excludedDraft, setExcludedDraft] = useState("");
  const [activeSection, setActiveSection] = useState<(typeof sections)[number]["id"]>("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const value = await getClipboardSettings();
      const normalized = { ...value, hermesEnabled: value.hermesEnabled ?? false, excludedApps: normalizeExcludedApps(value.excludedApps) };
      setSavedHermesEnabled(normalized.hermesEnabled);
      setSettings(normalized); setExcludedDraft(editableExcludedApps(normalized.excludedApps).join("\n"));
      setInitialSnapshot(serializeSettings(normalized));
    } catch { setSettings(null); setError("無法讀取設定，請再試一次。"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => closeButton.current?.focus());
    const previous = returnFocus.current;
    return () => { window.cancelAnimationFrame(frame); previous?.focus?.(); };
  }, []);
  useEffect(() => { if (confirmingClose) continueButton.current?.focus(); }, [confirmingClose]);
  const dirty = useMemo(() => Boolean(settings && initialSnapshot && serializeSettings(settings) !== initialSnapshot), [initialSnapshot, settings]);
  const requestClose = useCallback(() => {
    if (saving) return;
    if (confirmingClose) { setConfirmingClose(false); closeButton.current?.focus(); return; }
    if (dirty) { setRecordingHotkey(false); setConfirmingClose(true); return; }
    onClose();
  }, [confirmingClose, dirty, onClose, saving]);
  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); requestClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled):not([tabindex='-1']), select:not(:disabled), textarea:not(:disabled), input:not(:disabled)",
    ) ?? []).filter((element) => element.getClientRects().length > 0 && !element.closest("fieldset:disabled"));
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); dialog.current?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const handleHotkeyKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recordingHotkey || !settings) return;
    if (event.key === "Tab") { setRecordingHotkey(false); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") { setRecordingHotkey(false); return; }
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
    const nextHotkey = hotkeyFromKeyboardEvent(event.nativeEvent);
    if (!nextHotkey) { setError("請同時按下 Ctrl、Alt 或 Shift，再按一個按鍵。"); return; }
    setSettings({ ...settings, hotkey: nextHotkey }); setRecordingHotkey(false); setError(null);
  };
  const save = async () => {
    if (!settings || saving || !dirty) return;
    if (settings.excludedApps.length > 100) { setActiveSection("privacy"); setError("最多可排除 100 個應用程式，請減少清單後再儲存。"); return; }
    setSaving(true); setRecordingHotkey(false); setError(null); dialog.current?.focus();
    try { const savedSettings = await updateClipboardSettings(settings); onSaved(savedSettings); onClose(); }
    catch { setError("設定儲存失敗，變更仍保留在這裡，請再試一次。"); }
    finally { setSaving(false); }
  };
  return (
    <div className="cc-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section ref={dialog} className="cc-modal cc-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title"
        aria-describedby="settings-description" aria-busy={loading || saving} tabIndex={-1} onKeyDown={handleDialogKeyDown}>
        <header className="cc-modal-header">
          <div><span className="cc-modal-eyebrow">你的工作空間</span><h2 id="settings-title">{confirmingClose ? "捨棄變更？" : "設定"}</h2></div>
          <button ref={closeButton} type="button" className="cc-dialog-close" onClick={requestClose} disabled={saving} aria-label={confirmingClose ? "繼續編輯" : "關閉設定"} title="關閉（Esc）"><X size={18} /></button>
        </header>
        {confirmingClose ? (
          <div className="cc-modal-body cc-discard-body"><p id="settings-description">尚未儲存的設定將會還原。你也可以回到設定繼續編輯。</p></div>
        ) : <>
          <p id="settings-description" className="cc-sr-only">調整顯示、快捷鍵、歷史保留期限、隱私與 Hermes 串接。</p>
          <div className="cc-settings-tabs" role="tablist" aria-label="設定分類">
            {sections.map(({ id, label, icon: Icon }, index) => (
              <button key={id} id={`settings-tab-${id}`} type="button" role="tab" aria-selected={activeSection === id}
                aria-controls={`settings-panel-${id}`} tabIndex={activeSection === id ? 0 : -1} disabled={saving}
                onClick={() => { setActiveSection(id); setRecordingHotkey(false); }} onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + sections.length) % sections.length;
                  setActiveSection(sections[next].id); setRecordingHotkey(false);
                  document.getElementById(`settings-tab-${sections[next].id}`)?.focus();
                }}><Icon size={15} />{label}</button>
            ))}
          </div>
          <div className="cc-modal-body cc-settings-body">
            {loading && <div className="cc-dialog-loading" role="status"><LoaderCircle className="cc-dialog-spinner" size={22} /><span>正在讀取設定…</span></div>}
            {!loading && settings && (
              <fieldset className="cc-settings-fields" disabled={saving} role="tabpanel" id={`settings-panel-${activeSection}`} aria-labelledby={`settings-tab-${activeSection}`}>
                {activeSection === "general" && <>
                  <div className="cc-setting-heading"><Monitor size={18} /><div><h3>閱讀與顯示</h3><p>讓文字和操作介面保持舒適。</p></div></div>
                  <label className="cc-setting-row"><span><strong>介面比例</strong><small>同時調整文字與控制項大小</small></span>
                    <select value={settings.textScale} onChange={(event) => setSettings({ ...settings, textScale: Number(event.target.value) as ClipboardTextScale })}>
                      <option value={100}>標準</option><option value={120}>舒適</option><option value={150}>大字</option>
                    </select>
                  </label>
                  <div className="cc-setting-heading cc-setting-heading-spaced"><Keyboard size={18} /><div><h3>隨時叫出剪貼簿</h3><p>在任何應用程式中快速開啟或隱藏視窗。</p></div></div>
                  <div className="cc-setting-row"><span id="hotkey-label"><strong>全域快捷鍵</strong><small>點擊後按下新的組合鍵</small></span>
                    <div className="cc-hotkey-control"><button type="button" className="cc-hotkey-recorder" data-recording={recordingHotkey} onClick={() => { setRecordingHotkey(true); setError(null); }} onKeyDown={handleHotkeyKeyDown} onBlur={() => setRecordingHotkey(false)} aria-labelledby="hotkey-label" aria-describedby="hotkey-help">{recordingHotkey ? "請按下組合鍵…" : formatHotkey(settings.hotkey)}</button>
                      <button type="button" className="cc-dialog-tertiary" disabled={settings.hotkey === DEFAULT_GLOBAL_HOTKEY} onClick={() => { setSettings({ ...settings, hotkey: DEFAULT_GLOBAL_HOTKEY }); setRecordingHotkey(false); setError(null); }}>重設</button></div>
                  </div>
                  <p id="hotkey-help" className="cc-field-help">預設 Alt + Z。錄製時按 Esc 取消；若快捷鍵衝突，請換一組再儲存。</p>
                </>}
                {activeSection === "storage" && <>
                  <div className="cc-setting-heading"><Clock3 size={18} /><div><h3>讓歷史保持剛剛好</h3><p>自動清除不再需要的舊內容。</p></div></div>
                  <label className="cc-setting-row"><span><strong>歷史保留期限</strong><small>僅清除超過期限的未釘選項目</small></span>
                    <select value={settings.retentionDays ?? "forever"} onChange={(event) => setSettings({ ...settings, retentionDays: event.target.value === "forever" ? null : Number(event.target.value) as 7 | 14 | 30 })}>
                      <option value={7}>7 天</option><option value={14}>14 天</option><option value={30}>30 天</option><option value="forever">永久保留</option>
                    </select>
                  </label>
                  <div className="cc-setting-note"><Check size={16} /><p>釘選、資料夾與常用片段會保留，不受自動清除影響。</p></div>
                </>}
                {activeSection === "privacy" && <>
                  <div className="cc-setting-heading"><ShieldCheck size={18} /><div><h3>決定哪些內容被記錄</h3><p>這些選項適用於之後複製的新內容。</p></div></div>
                  <label className="cc-setting-row cc-toggle-row"><span><strong>過濾敏感內容</strong><small>略過可辨識的金鑰、密碼欄位及信用卡號</small></span><input type="checkbox" className="cc-switch" role="switch" checked={settings.sensitiveFilterEnabled} onChange={(event) => setSettings({ ...settings, sensitiveFilterEnabled: event.target.checked })} /></label>
                  <div className="cc-protected-exclusion" role="status" aria-label="固定排除的應用程式">
                    <Lock size={15} aria-hidden="true" />
                    <span><strong>{PROTECTED_EXCLUDED_APP}</strong><small>固定排除，無法移除</small></span>
                  </div>
                  <label className="cc-dialog-field cc-excluded-field"><span>其他排除的應用程式 <small>{settings.excludedApps.length} / {MAX_EXCLUDED_APPS}</small></span>
                    <textarea value={excludedDraft} rows={4} spellCheck={false} placeholder={"例如：\nBitwarden.exe\nKeePass.exe"} aria-describedby="excluded-apps-help" onChange={(event) => {
                      const excludedApps = normalizeExcludedApps(parseExcludedDraft(event.target.value));
                      setExcludedDraft(editableExcludedApps(excludedApps).join("\n"));
                      setSettings({ ...settings, excludedApps });
                    }} />
                  </label>
                  <p id="excluded-apps-help" className="cc-field-help">1Password.exe 會固定排除；其餘每行一個應用程式或執行檔名稱。從這些程式複製的內容不會加入歷史。</p>
                </>}
                {activeSection === "hermes" && <HermesSettings enabled={settings.hermesEnabled} savedEnabled={savedHermesEnabled} onChange={(hermesEnabled) => setSettings({ ...settings, hermesEnabled })} />}
              </fieldset>
            )}
            {!loading && error && <div className="cc-dialog-error" role="alert"><p>{error}</p>{!settings && <button className="cc-dialog-secondary" type="button" onClick={() => void load()}><RefreshCw size={14} />重新讀取</button>}</div>}
          </div>
        </>}
        <footer className="cc-modal-footer">
          {confirmingClose ? <><span /><div className="cc-dialog-actions"><button ref={continueButton} type="button" className="cc-dialog-secondary" onClick={() => { setConfirmingClose(false); closeButton.current?.focus(); }}>繼續編輯</button><button type="button" className="cc-dialog-danger" onClick={onClose}>捨棄變更</button></div></> : <>
            <span className={dirty ? "cc-dialog-status is-dirty" : "cc-dialog-status"}>{saving ? "正在儲存…" : dirty ? "有未儲存的變更" : "僅儲存於這台電腦"}</span>
            <div className="cc-dialog-actions"><button type="button" className="cc-dialog-secondary" onClick={requestClose} disabled={saving}>取消</button><button type="button" className="cc-dialog-primary" disabled={!settings || saving || !dirty} onClick={() => void save()}>{saving && <LoaderCircle size={14} className="cc-dialog-spinner" />}{saving ? "儲存中…" : "儲存設定"}</button></div>
          </>}
        </footer>
      </section>
    </div>
  );
}
