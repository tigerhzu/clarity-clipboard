import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, LoaderCircle, RefreshCw } from "lucide-react";
import { copyHermesPrompt, getHermesIntegration, type HermesIntegrationInfo } from "../lib/clipboard-api";

interface Props { enabled: boolean; savedEnabled: boolean; onChange: (enabled: boolean) => void }

export function HermesSettings({ enabled, savedEnabled, onChange }: Props) {
  const [info, setInfo] = useState<HermesIntegrationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setInfo(await getHermesIntegration()); }
    catch { setError("無法讀取 Hermes 串接資訊，請重新讀取。"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    setCopying(true); setError(null);
    try { await copyHermesPrompt(); setCopied(true); }
    catch { setCopied(false); setError("提示詞複製失敗，請再試一次，或選取下方文字手動複製。"); }
    finally { setCopying(false); }
  };
  return <>
    <div className="cc-setting-heading"><Bot size={18} /><div><h3>讓 Hermes 使用你的剪貼後台</h3><p>每台電腦都能用同一段提示詞完成本機串接。</p></div></div>
    <label className="cc-setting-row cc-toggle-row"><span><strong>允許 Hermes 讀寫</strong><small>搜尋、讀取、新增、編輯、刪除及複製指定內容</small></span>
      <input type="checkbox" className="cc-switch" role="switch" checked={enabled} disabled={loading || (!info?.available && !enabled)} onChange={(event) => onChange(event.target.checked)} />
    </label>
    <p className="cc-field-help" role="status">{enabled !== savedEnabled ? "開關變更將於儲存設定後生效。" : savedEnabled ? "已啟用；關閉並儲存即可停止 Hermes 存取。" : "尚未啟用。開啟並儲存後，把提示詞貼給 Hermes。"}</p>
    {loading && <p className="cc-hermes-loading" role="status"><LoaderCircle size={14} className="cc-dialog-spinner" />正在讀取串接資訊…</p>}
    {!loading && info && <>
      {!info.available && <div className="cc-dialog-error" role="alert"><p>本機串接尚未就緒。請重啟剪貼後台後再試。</p>{info.error && <p>{info.error}</p>}</div>}
      <label className="cc-dialog-field cc-hermes-field"><span>Hermes 串接提示詞</span>
        <textarea value={info.prompt} readOnly rows={7} spellCheck={false} aria-describedby="hermes-prompt-help" />
      </label>
      <div className="cc-hermes-copy"><button type="button" className="cc-dialog-secondary" disabled={copying || !info.available} onClick={() => void copy()}>
        {copying ? <LoaderCircle size={14} className="cc-dialog-spinner" /> : copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已複製提示詞" : "複製 Hermes 串接提示詞"}
      </button><span role="status">{copied ? "貼給 Hermes，依提示完成連線驗證。" : "適用於其他電腦與使用者"}</span></div>
      <p id="hermes-prompt-help" className="cc-field-help">Hermes 與剪貼後台需在同一台 Windows、同一使用者環境執行。串接存取這台電腦的資料；各台電腦各自設定，不會同步歷史。WSL、Docker 與遠端 Hermes 需另外規劃連線。</p>
      <p className="cc-field-help">啟用後，Hermes 依你的要求取用內容，可能將取用的文字或圖片送到它設定的模型服務。請只要求它讀取願意提供的內容。</p>
    </>}
    {error && <div className="cc-dialog-error" role="alert"><p>{error}</p>{!info && <button type="button" className="cc-dialog-secondary" onClick={() => void load()}><RefreshCw size={14} />重新讀取</button>}</div>}
  </>;
}
