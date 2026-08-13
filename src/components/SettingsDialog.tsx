import { useEffect, useState } from "react";
import { Clock3, LoaderCircle, ShieldCheck, X } from "lucide-react";
import {
  getClipboardSettings,
  updateClipboardSettings,
} from "../lib/clipboard-api";
import type { ClipboardSettings } from "../types/clipboard";

interface SettingsDialogProps {
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsDialog({ onClose, onSaved }: SettingsDialogProps) {
  const [settings, setSettings] = useState<ClipboardSettings | null>(null);
  const [excludedApps, setExcludedApps] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getClipboardSettings()
      .then((value) => {
        setSettings(value);
        setExcludedApps(value.excludedApps.join("\n"));
      })
      .catch(() => setError("無法讀取設定，請重新開啟視窗。"));
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const save = async () => {
    if (!settings || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateClipboardSettings({
        ...settings,
        excludedApps: excludedApps.split(/\r?\n/),
      });
      onSaved();
      onClose();
    } catch (cause) {
      console.error(cause);
      setError("設定儲存失敗，請再試一次。" );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>CLARITY CLIPBOARD</span>
            <h2 id="settings-title">設定</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉設定"><X size={17} /></button>
        </header>

        {!settings && !error && (
          <div className="settings-loading"><LoaderCircle size={22} /><span>正在讀取設定…</span></div>
        )}

        {settings && (
          <div className="settings-content">
            <div className="settings-section-heading">
              <Clock3 size={16} />
              <div><strong>歷史保留期限</strong><span>釘選項目永遠不會被自動刪除。</span></div>
            </div>
            <select
              value={settings.retentionDays ?? "forever"}
              onChange={(event) => setSettings({
                ...settings,
                retentionDays: event.target.value === "forever"
                  ? null
                  : Number(event.target.value) as 7 | 30 | 90,
              })}
              aria-label="剪貼簿歷史保留期限"
            >
              <option value={7}>7 天</option>
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
              <option value="forever">永久保留</option>
            </select>

            <div className="settings-divider" />

            <div className="settings-section-heading">
              <ShieldCheck size={16} />
              <div><strong>隱私保護</strong><span>排除指定程式，並阻擋常見密碼、Token、私鑰與信用卡號。</span></div>
            </div>
            <label className="toggle-row">
              <span><strong>敏感內容過濾</strong><small>建議保持開啟</small></span>
              <input
                type="checkbox"
                checked={settings.sensitiveFilterEnabled}
                onChange={(event) => setSettings({
                  ...settings,
                  sensitiveFilterEnabled: event.target.checked,
                })}
              />
              <i aria-hidden="true" />
            </label>

            <label className="excluded-apps-field">
              <span>排除程式</span>
              <small>每行一個程式名稱，可填入 Bitwarden.exe 或 Bitwarden。</small>
              <textarea
                value={excludedApps}
                onChange={(event) => setExcludedApps(event.target.value)}
                spellCheck={false}
                rows={6}
              />
            </label>
          </div>
        )}

        {error && <p className="settings-error">{error}</p>}

        <footer>
          <span>所有設定與內容只保存在這台電腦。</span>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button className="save-settings" type="button" disabled={!settings || saving} onClick={() => void save()}>
              {saving ? "儲存中…" : "儲存設定"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
