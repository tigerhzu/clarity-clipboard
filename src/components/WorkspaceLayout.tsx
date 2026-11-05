import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

type Divider = "sidebar" | "history";
interface Preferences { sidebar: number | null; ratio: number }
const STORAGE_KEY = "clarity-clipboard:column-widths:v1";
const defaults: Preferences = { sidebar: null, ratio: 0.44 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return {
      sidebar: Number.isFinite(value?.sidebar) ? Math.max(180, value.sidebar) : null,
      ratio: Number.isFinite(value?.ratio) ? clamp(value.ratio, 0, 1) : defaults.ratio,
    };
  } catch { return defaults; }
}

export function useWorkspaceLayout() {
  const frameRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [preferences, setPreferences] = useState(readPreferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [resizing, setResizing] = useState<Divider | null>(null);
  const drag = useRef<{ pointerId: number; target: HTMLElement; x: number; start: number; divider: Divider; original: Preferences } | null>(null);
  const sidebarMax = Math.max(180, width - 640);
  const sidebar = clamp(preferences.sidebar ?? (width <= 1060 ? 180 : 196), 180, sidebarMax);
  const available = width - sidebar;
  const historyMax = Math.max(300, available - 340);
  const history = clamp(available * preferences.ratio, 300, historyMax);
  const metrics = useRef({ sidebar, available, history, sidebarMax, historyMax });
  metrics.current = { sidebar, available, history, sidebarMax, historyMax };

  function commit(value: Preferences) {
    setPreferences(value);
    preferencesRef.current = value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Still usable for this session. */ }
  }
  function finish(cancel = false) {
    const session = drag.current;
    if (!session) return;
    drag.current = null;
    if (cancel) setPreferences(session.original); else commit(preferencesRef.current);
    setResizing(null);
    if (session.target.hasPointerCapture(session.pointerId)) session.target.releasePointerCapture(session.pointerId);
  }
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(frame);
    const cancel = () => finish(true);
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape, true);
    return () => { observer.disconnect(); window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true); };
  }, []);

  function update(divider: Divider, value: number, save = false) {
    const current = metrics.current;
    const next = divider === "sidebar"
      ? { ...preferencesRef.current, sidebar: clamp(value, 180, current.sidebarMax) }
      : { ...preferencesRef.current, ratio: clamp(value, 300, current.historyMax) / current.available };
    preferencesRef.current = next;
    if (save) commit(next); else setPreferences(next);
  }
  function reset(divider: Divider) {
    commit(divider === "sidebar" ? { ...preferencesRef.current, sidebar: null } : { ...preferencesRef.current, ratio: defaults.ratio });
  }
  function separator(divider: Divider) {
    const value = divider === "sidebar" ? sidebar : history;
    const minimum = divider === "sidebar" ? 180 : 300;
    const maximum = divider === "sidebar" ? sidebarMax : historyMax;
    return <div key={divider} role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={divider === "sidebar" ? "調整側欄寬度" : "調整清單與預覽寬度"}
      aria-valuemin={minimum} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} 像素`} aria-controls={divider === "sidebar" ? "workspace-sidebar" : "workspace-history"}
      className={`workspace-divider divider-${divider}${resizing === divider ? " resizing" : ""}`}
      title="左右拖曳調整寬度 · 雙擊還原 · 方向鍵微調"
      onDoubleClick={() => reset(divider)}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Enter") { reset(divider); return; }
        update(divider, event.key === "Home" ? minimum : event.key === "End" ? maximum : value + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 40 : 10), true);
      }}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault(); event.currentTarget.focus();
        drag.current = { pointerId: event.pointerId, target: event.currentTarget, x: event.clientX, start: value, divider, original: preferencesRef.current };
        event.currentTarget.setPointerCapture(event.pointerId); setResizing(divider);
      }}
      onPointerMove={(event) => {
        const session = drag.current;
        if (session && session.pointerId === event.pointerId) update(session.divider, session.start + event.clientX - session.x);
      }}
      onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) finish(); }}
      onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)} />;
  }
  return { frameRef, resizing, style: { gridTemplateColumns: `${sidebar}px ${history}px minmax(0, 1fr)` }, dividers: [separator("sidebar"), separator("history")] };
}
