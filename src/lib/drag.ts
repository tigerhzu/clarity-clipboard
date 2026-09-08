import type { DragEvent } from "react";
import type { ItemStorage } from "../types/clipboard";

export const CLIPBOARD_ITEM_DRAG_TYPE = "application/x-clarity-clipboard-item";
const TEXT_FALLBACK_PREFIX = "clarity-clipboard-item:";

export interface ItemDragPayload {
  id: string;
  kind: ItemStorage;
}

// WebView2 can expose only text/plain during an internal drag. Keep a short
// same-document fallback as well, so a drop still works when custom MIME data
// is unavailable at dragover/drop time.
let activeItemDragPayload: ItemDragPayload | null = null;

function parsePayload(raw: string): ItemDragPayload | null {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as Partial<ItemDragPayload>;
    if (
      typeof payload.id !== "string"
      || !payload.id
      || !["history", "folder", "personal"].includes(payload.kind ?? "")
    ) {
      return null;
    }
    return payload as ItemDragPayload;
  } catch {
    return null;
  }
}

function readDataSafely(dataTransfer: DataTransfer, type: string): string {
  try {
    return dataTransfer.getData(type);
  } catch {
    // Some WebView2 drag phases expose the DataTransfer object but reject
    // getData() until drop. The in-memory fallback remains available then.
    return "";
  }
}

export function writeItemDragPayload(event: DragEvent<HTMLElement>, payload: ItemDragPayload): void {
  const serialized = JSON.stringify(payload);
  activeItemDragPayload = payload;
  try {
    event.dataTransfer.setData(CLIPBOARD_ITEM_DRAG_TYPE, serialized);
  } catch {
    // The text fallback and in-memory payload below are enough for WebView2.
  }
  try {
    event.dataTransfer.setData("text/plain", `${TEXT_FALLBACK_PREFIX}${serialized}`);
  } catch {
    // Keep the in-memory payload as the final same-window fallback.
  }
  try {
    event.dataTransfer.effectAllowed = payload.kind === "history" ? "copy" : "move";
  } catch {
    // The browser chooses the default effect if this property is unavailable.
  }
}

export function readItemDragPayload(dataTransfer: DataTransfer): ItemDragPayload | null {
  const customPayload = parsePayload(readDataSafely(dataTransfer, CLIPBOARD_ITEM_DRAG_TYPE));
  if (customPayload) return customPayload;

  const text = readDataSafely(dataTransfer, "text/plain");
  if (text.startsWith(TEXT_FALLBACK_PREFIX)) {
    const textPayload = parsePayload(text.slice(TEXT_FALLBACK_PREFIX.length));
    if (textPayload) return textPayload;
  }

  return activeItemDragPayload;
}

export function clearItemDragPayload(): void {
  activeItemDragPayload = null;
}
