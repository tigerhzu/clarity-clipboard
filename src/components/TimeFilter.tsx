import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import type { ClipboardFilter } from "../types/clipboard";

const options = [
  { value: "ALL", label: "全部時間" }, { value: "TODAY", label: "今天" },
  { value: "YESTERDAY", label: "昨天" }, { value: "THIS_WEEK", label: "本週" }, { value: "OLDER", label: "更早" },
] as const;

export function TimeFilter({ value, selectedDate, onChange }: { value: ClipboardFilter; selectedDate: string | null; onChange: (value: ClipboardFilter) => void }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 180, maxHeight: 240 });
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const chosen = options.findIndex((option) => option.value === value);
  const label = selectedDate || options[Math.max(0, chosen)].label;
  const close = (focus = true) => { setOpen(false); if (focus) trigger.current?.focus(); };
  const choose = (next: number) => { onChange(options[next].value); close(); };
  const show = (next = Math.max(0, chosen)) => { setIndex(next); setOpen(true); };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !list.current) return;
    const update = () => {
      if (!trigger.current || !list.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const menuHeight = list.current.scrollHeight;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < menuHeight && above > below;
      const maxHeight = Math.max(60, upwards ? above : below);
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - Math.max(180, rect.width) - 8)), width: Math.max(180, rect.width),
        top: upwards ? Math.max(8, rect.top - Math.min(menuHeight, maxHeight) - 6) : rect.bottom + 6, maxHeight });
    };
    update();
    const resize = new ResizeObserver(update); resize.observe(trigger.current);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { resize.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index='${index}']`)?.scrollIntoView({ block: "nearest" });
  }, [open, index]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) close(false);
    };
    const blur = () => close(false);
    document.addEventListener("pointerdown", outside); window.addEventListener("blur", blur);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("blur", blur); };
  }, [open]);
  return <div className="sidebar-time-filter">
    <span className="time-filter-label"><CalendarDays size={14} aria-hidden="true" />時間</span>
    <button ref={trigger} type="button" className="time-filter-trigger" role="combobox" aria-label="時間篩選"
      aria-expanded={open} aria-haspopup="listbox" aria-controls="time-filter-options" data-value={selectedDate ? "DATE" : value}
      aria-activedescendant={open ? `time-option-${index}` : undefined} title={label}
      onClick={() => open ? close() : show()} onBlur={() => close(false)}
      onKeyDown={(event) => {
        if (event.key === "Tab") { close(false); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Enter", " "].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Escape") { close(); return; }
        if (event.key === "Enter" || event.key === " ") { if (open) choose(index); else show(); return; }
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        if (!open) show(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, chosen)); else setIndex(next);
      }}><span>{label}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {open && createPortal(<div ref={list} id="time-filter-options" role="listbox" aria-label="時間範圍" className="time-filter-menu"
      style={{ ...position, fontSize: trigger.current ? getComputedStyle(trigger.current).fontSize : undefined }}
      onPointerDown={(event) => event.preventDefault()}>
      {options.map((option, optionIndex) => <div role="option" id={`time-option-${optionIndex}`} data-index={optionIndex} data-value={option.value}
        aria-selected={!selectedDate && option.value === value} key={option.value}
        className={`time-filter-option${optionIndex === index ? " focused" : ""}`}
        onPointerMove={() => setIndex(optionIndex)} onClick={() => choose(optionIndex)}>
        <span>{option.label}</span>{!selectedDate && option.value === value && <Check size={14} aria-hidden="true" />}
      </div>)}
    </div>, document.body)}
  </div>;
}
