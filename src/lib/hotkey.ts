export const DEFAULT_GLOBAL_HOTKEY = "Alt+Z";
export const LEGACY_GLOBAL_HOTKEY = "Control+Fn";

export function resolveGlobalHotkey(hotkey: string): string {
  const normalized = hotkey.trim();
  return normalized.toLowerCase() === LEGACY_GLOBAL_HOTKEY.toLowerCase()
    ? DEFAULT_GLOBAL_HOTKEY
    : normalized;
}

const modifierLabels: Record<string, string> = {
  Control: "Ctrl",
  Ctrl: "Ctrl",
  CommandOrControl: "Ctrl",
  CmdOrCtrl: "Ctrl",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
  Super: "Win",
  Command: "Win",
};

const keyLabels: Record<string, string> = {
  Space: "空白鍵",
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Del",
  Insert: "Ins",
  PageUp: "Page Up",
  PageDown: "Page Down",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

export function formatHotkey(hotkey: string): string {
  return hotkey
    .split("+")
    .map((part) => {
      if (modifierLabels[part]) return modifierLabels[part];
      if (keyLabels[part]) return keyLabels[part];
      if (part.startsWith("Key")) return part.slice(3);
      if (part.startsWith("Digit")) return part.slice(5);
      return part;
    })
    .join(" + ");
}

function codeForShortcut(event: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code;
  if (/^Digit\d$/.test(event.code)) return event.code;
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.code)) return event.code;
  if ([
    "Space",
    "Enter",
    "Escape",
    "Tab",
    "Backspace",
    "Delete",
    "Insert",
    "PageUp",
    "PageDown",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "Comma",
    "Period",
    "Slash",
    "Semicolon",
    "Quote",
    "BracketLeft",
    "BracketRight",
    "Backslash",
    "Minus",
    "Equal",
    "Backquote",
  ].includes(event.code)) return event.code;
  return null;
}

export function hotkeyFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = codeForShortcut(event);
  if (!key) return null;

  const modifiers = [
    event.ctrlKey ? "Control" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.metaKey ? "Super" : null,
  ].filter((value): value is string => value !== null);

  if (modifiers.length === 0) return null;
  return [...modifiers, key].join("+");
}
