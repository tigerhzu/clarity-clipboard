import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import { listClipboardDays, onClipboardChanged, type ClipboardDay } from "../lib/clipboard-api";
import { localDateKey, parseLocalDate } from "../lib/calendar";
import "./calendar.css";

interface Props {
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  revision: number;
  timeLabel?: string;
}

export function ClipboardCalendar({ selectedDate, onSelectDate, revision, timeLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [days, setDays] = useState<ClipboardDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [focusedDate, setFocusedDate] = useState(localDateKey(new Date()));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusDayAfterLoad = useRef(false);
  const [today, setToday] = useState(() => localDateKey(new Date()));
  const startMs = +month;
  const endMs = +new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const monthLabel = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
  const counts = new Map(days.map((day) => [day.date, day.count]));
  const monthCount = days.reduce((total, day) => total + day.count, 0);

  useEffect(() => {
    let timer = 0;
    const refreshToday = () => {
      const now = new Date();
      setToday(localDateKey(now));
      window.clearTimeout(timer);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(refreshToday, +midnight - +now + 100);
    };
    refreshToday();
    window.addEventListener("focus", refreshToday);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", refreshToday); };
  }, []);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      setLoading(true);
      setError(false);
      try {
        const next = await listClipboardDays(startMs, endMs);
        if (!disposed && request === sequence) setDays(next);
      } catch {
        if (!disposed && request === sequence) { setDays([]); setError(true); }
      } finally {
        if (!disposed && request === sequence) setLoading(false);
      }
    };
    setDays([]);
    void refresh();
    let unlisten = () => {};
    void onClipboardChanged(() => void refresh()).then((cleanup) => {
      if (disposed) cleanup(); else unlisten = cleanup;
    });
    return () => { disposed = true; unlisten(); };
  }, [open, startMs, endMs, retry, revision]);

  useEffect(() => {
    if (open && !loading && focusDayAfterLoad.current) {
      root.current?.querySelector<HTMLButtonElement>(`[data-date='${focusedDate}']`)?.focus();
      focusDayAfterLoad.current = false;
    }
  }, [open, loading, focusedDate, startMs]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close() { setOpen(false); trigger.current?.focus(); }
  function select(date: string | null) { onSelectDate(date); close(); }
  function changeMonth(delta: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next); setFocusedDate(localDateKey(next));
  }
  function onDayKey(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -(date.getDay() + 6) % 7, End: 6 - (date.getDay() + 6) % 7 };
    if (!(event.key in offsets) && !["PageUp", "PageDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === "PageUp" || event.key === "PageDown"
      ? new Date(date.getFullYear(), date.getMonth() + (event.key === "PageUp" ? -1 : 1), 1)
      : new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsets[event.key]);
    focusDayAfterLoad.current = true;
    setFocusedDate(localDateKey(next));
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  const offset = (month.getDay() + 6) % 7;
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return (
    <div className="calendar-bar" ref={root} onKeyDown={(event) => {
      if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <span className="calendar-caption"><CalendarDays size={15} />複製日曆</span>
      <div className="calendar-presets" aria-label="日期範圍">
        <button type="button" aria-pressed={selectedDate === null && !timeLabel} onClick={() => select(null)}>全部時間</button>
        <button type="button" aria-pressed={selectedDate === today || timeLabel === "今天"} onClick={() => select(localDateKey(new Date()))}>今天</button>
      </div>
      <button type="button" ref={trigger} className={`calendar-trigger${selectedDate ? " active" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="clipboard-calendar" onClick={() => {
        if (open) { close(); return; }
        const date = selectedDate ? parseLocalDate(selectedDate) : new Date();
        setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
        setFocusedDate(localDateKey(date));
        focusDayAfterLoad.current = true;
        setOpen(true);
      }}><CalendarDays size={14} /><span>{selectedDate ? selectedDate.replaceAll("-", " / ") : timeLabel || "選擇日期"}</span></button>
      <span className="calendar-scope">{selectedDate ? "當天紀錄 · 可搭配分類與搜尋" : "依日期找回複製的內容"}</span>
      {open && (
        <section id="clipboard-calendar" className="calendar-popover" role="dialog" aria-label="複製日曆" onKeyDown={(event) => {
          if (event.key === "Tab") {
            const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")].filter((button) => button.tabIndex >= 0);
            const first = controls[0]; const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
          <div className="calendar-heading"><div><h2>複製的日子</h2><p>發光的日期，留有你的紀錄</p></div><button type="button" onClick={close} aria-label="關閉日曆"><X size={16} /></button></div>
          <div className="calendar-month"><button type="button" onClick={() => changeMonth(-1)} aria-label="上一個月"><ChevronLeft size={17} /></button><strong aria-live="polite">{monthLabel}</strong><button type="button" onClick={() => changeMonth(1)} aria-label="下一個月"><ChevronRight size={17} /></button></div>
          <div className="calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-grid" aria-label={monthLabel} aria-busy={loading}>
            {Array.from({ length: 42 }, (_, index) => {
              const day = index - offset + 1;
              if (day < 1 || day > dayCount) return <span key={index} />;
              const date = new Date(month.getFullYear(), month.getMonth(), day);
              const key = localDateKey(date);
              const count = counts.get(key) ?? 0;
              return <button type="button" key={index} data-date={key} tabIndex={focusedDate === key ? 0 : -1}
                className={`calendar-day${count > 0 && !loading ? " has-activity" : ""}${key === selectedDate ? " selected" : ""}`}
                aria-pressed={key === selectedDate} aria-current={key === today ? "date" : undefined}
                aria-label={`${key}，${loading ? "讀取中" : error ? "紀錄讀取失敗" : count ? `${count} 筆紀錄` : "沒有紀錄"}`}
                title={`${key} · ${count} 筆紀錄`} onFocus={() => setFocusedDate(key)} onKeyDown={(event) => onDayKey(event, date)} onClick={() => select(key)}>
                <span>{day}</span><i aria-hidden="true" />
              </button>;
            })}
          </div>
          <div className="calendar-summary" aria-live="polite">{loading ? <><LoaderCircle size={13} className="search-spinner" />讀取本月紀錄…</> : error ? <><span role="alert">無法讀取日期</span><button type="button" onClick={() => setRetry((value) => value + 1)}>重試</button></> : <><i />{days.length ? `${days.length} 天有紀錄 · 共 ${monthCount} 筆` : "這個月還沒有紀錄"}</>}</div>
          <div className="calendar-footer"><button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setFocusedDate(localDateKey(now)); }}>回到本月</button><button type="button" onClick={() => select(null)}>查看全部時間</button></div>
        </section>
      )}
    </div>
  );
}
