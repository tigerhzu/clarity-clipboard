import { useEffect, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { exportClipboardCsv, getExportDirectory, type ExportOptions, type ExportResult } from "../lib/clipboard-api";
import "./export.css";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function ExportSettings({ busy, onBusy }: { busy: boolean; onBusy: (busy: boolean) => void }) {
  const [options, setOptions] = useState<ExportOptions>(() => ({ startDate: today(), endDate: today(), outputDirectory: "", storage: "history", tag: "" }));
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getExportDirectory().then((path) => { if (active) setOptions((value) => ({ ...value, outputDirectory: value.outputDirectory || path })); }).catch(() => { if (active) setError("無法取得預設位置，請自行輸入資料夾完整路徑。"); });
    return () => { active = false; };
  }, []);
  const update = (patch: Partial<ExportOptions>) => { setOptions({ ...options, ...patch }); setResult(null); setError(null); };
  const invalid = !options.startDate || !options.endDate || options.startDate > options.endDate || !options.outputDirectory.trim();
  const run = async () => {
    if (invalid || busy) return;
    onBusy(true); setResult(null); setError(null);
    try { setResult(await exportClipboardCsv({ ...options, outputDirectory: options.outputDirectory.trim() })); }
    catch (error) { setError(`匯出失敗：${String(error)}`); }
    finally { onBusy(false); }
  };
  return <div className="cc-export">
    <div className="cc-setting-heading"><Download size={18} /><div><h3>依日期匯出 Excel</h3><p>第一頁可選日期，後續依類型分頁，圖片直接顯示。</p></div></div>
    <fieldset className="cc-export-fields" disabled={busy}>
      <div className="cc-export-dates">
        <label className="cc-dialog-field"><span>開始日期</span><input type="date" value={options.startDate} max={options.endDate || undefined} onChange={(event) => update({ startDate: event.target.value })} /></label>
        <label className="cc-dialog-field"><span>結束日期</span><input type="date" value={options.endDate} min={options.startDate || undefined} onChange={(event) => update({ endDate: event.target.value })} /></label>
      </div>
      <p className="cc-field-help">包含起訖兩天，依電腦本機時間與項目建立日期篩選。</p>
      <label className="cc-setting-row"><span><strong>匯出範圍</strong></span><select value={options.storage} onChange={(event) => update({ storage: event.target.value as ExportOptions["storage"] })}><option value="history">最近複製</option><option value="folder">所有收藏資料夾</option><option value="personal">常用片段</option><option value="all">全部工作區</option></select></label>
      <label className="cc-dialog-field"><span>分類篩選（選填）</span><input value={options.tag} placeholder="留空匯出全部，例如 IMAGE、URL、TEXT" onChange={(event) => update({ tag: event.target.value })} /></label>
      <label className="cc-dialog-field"><span>匯出位置</span><input value={options.outputDirectory} placeholder="資料夾完整路徑，例如 C:\Reports" onChange={(event) => update({ outputDirectory: event.target.value })} /></label>
      <p className="cc-field-help">每次建立新資料夾，內含 Excel（.xlsx）、原圖及備用 CSV。第一頁「日期總覽」可篩選當天所有類型，其他頁維持類型分類並嵌入圖片，長文另附完整文字檔。全程本機執行，無需 AI 或 tokens。</p>
      <button className="cc-dialog-primary" type="button" disabled={invalid || busy} onClick={() => void run()}>{busy ? <LoaderCircle size={15} className="cc-dialog-spinner" /> : <Download size={15} />}{busy ? "正在匯出…" : "匯出彩色 Excel"}</button>
    </fieldset>
    {error && <p className="cc-dialog-error" role="alert">{error}</p>}
    {result && <div className="cc-export-result" role="status"><strong>{result.itemCount === 0 ? "此日期範圍沒有資料，已產生說明工作表。" : `已匯出 ${result.itemCount} 筆項目、${result.sheetCount} 個工作表分頁、${result.embeddedImageCount} 張內嵌圖片。`}</strong><span>Excel 檔案位置</span><input aria-label="匯出 Excel 路徑" readOnly value={result.xlsxPath} onFocus={(event) => event.target.select()} />{result.warnings.length > 0 && <details><summary>有 {result.warnings.length} 個匯出警告</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}</div>}
  </div>;
}
