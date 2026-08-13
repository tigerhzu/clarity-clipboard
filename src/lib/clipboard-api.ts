import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ClipboardFilter,
  ClipboardImageMetadata,
  ClipboardItem,
  ClipboardSettings,
} from "../types/clipboard";

interface ListClipboardOptions {
  query?: string;
  filter?: ClipboardFilter;
  limit?: number;
}

export async function listClipboardItems({
  query = "",
  filter = "ALL",
  limit = 250,
}: ListClipboardOptions = {}): Promise<ClipboardItem[]> {
  if (!isTauri()) return [];
  return invoke<ClipboardItem[]>("list_clipboard_items", { query, filter, limit });
}

export async function onClipboardChanged(callback: () => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen("clipboard://changed", callback);
}

export async function toggleClipboardPin(id: string): Promise<ClipboardItem> {
  return invoke<ClipboardItem>("toggle_clipboard_pin", { id });
}

export async function deleteClipboardItem(id: string): Promise<boolean> {
  return invoke<boolean>("delete_clipboard_item", { id });
}

export async function copyClipboardItem(id: string): Promise<ClipboardItem> {
  return invoke<ClipboardItem>("copy_clipboard_item", { id });
}

export async function getClipboardSettings(): Promise<ClipboardSettings> {
  return invoke<ClipboardSettings>("get_clipboard_settings");
}

export async function updateClipboardSettings(
  settings: ClipboardSettings,
): Promise<ClipboardSettings> {
  return invoke<ClipboardSettings>("update_clipboard_settings", { settings });
}

export function parseImageMetadata(item: ClipboardItem): ClipboardImageMetadata | null {
  if (item.contentType !== "IMAGE" || !item.metadata) return null;
  try {
    return JSON.parse(item.metadata) as ClipboardImageMetadata;
  } catch {
    return null;
  }
}

export async function getClipboardImage(id: string, thumbnail = false): Promise<string> {
  return invoke<string>("get_clipboard_image", { id, thumbnail });
}
