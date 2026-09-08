import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ClipboardFilter,
  ClipboardImageMetadata,
  ClipboardItem,
  ClipboardSettings,
  Folder,
  FolderItem,
  ItemStorage,
  PersonalItem,
} from "../types/clipboard";

interface ListClipboardOptions {
  query?: string;
  filter?: ClipboardFilter;
  limit?: number;
  offset?: number;
}

export async function listClipboardItems({
  query = "",
  filter = "ALL",
  limit = 250,
  offset = 0,
}: ListClipboardOptions = {}): Promise<ClipboardItem[]> {
  if (!isTauri()) return [];
  return invoke<ClipboardItem[]>("list_clipboard_items", { query, filter, limit, offset });
}

export async function countClipboardItems({
  query = "",
  filter = "ALL",
}: Omit<ListClipboardOptions, "limit" | "offset"> = {}): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("count_clipboard_items", { query, filter });
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
    const value: unknown = JSON.parse(item.metadata);
    if (!value || typeof value !== "object") return null;
    const metadata = value as Partial<ClipboardImageMetadata>;
    if (typeof metadata.width !== "number" || !Number.isFinite(metadata.width) || metadata.width <= 0
      || typeof metadata.height !== "number" || !Number.isFinite(metadata.height) || metadata.height <= 0
      || typeof metadata.byteSize !== "number" || !Number.isFinite(metadata.byteSize) || metadata.byteSize < 0) return null;
    return { width: metadata.width, height: metadata.height, byteSize: metadata.byteSize,
      thumbnailPath: typeof metadata.thumbnailPath === "string" ? metadata.thumbnailPath : "" };
  } catch {
    return null;
  }
}

export async function getClipboardImage(id: string, thumbnail = false): Promise<string> {
  return invoke<string>("get_clipboard_image", { id, thumbnail });
}

export async function listFolders(): Promise<Folder[]> {
  if (!isTauri()) return [];
  return invoke<Folder[]>("list_folders");
}

export async function createFolder(name: string): Promise<Folder> {
  return invoke<Folder>("create_folder", { name });
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  return invoke<Folder>("rename_folder", { id, name });
}

export async function deleteFolder(id: string): Promise<boolean> {
  return invoke<boolean>("delete_folder", { id });
}

export async function listFolderItems(folderId: string): Promise<FolderItem[]> {
  if (!isTauri()) return [];
  return invoke<FolderItem[]>("list_folder_items", { folderId });
}

export async function addClipboardItemToFolder(
  folderId: string,
  sourceItemId: string,
): Promise<FolderItem> {
  return invoke<FolderItem>("add_clipboard_item_to_folder", { folderId, sourceItemId });
}

export async function removeFolderItem(id: string): Promise<boolean> {
  return invoke<boolean>("remove_folder_item", { id });
}

export async function reorderFolderItems(folderId: string, itemIds: string[]): Promise<FolderItem[]> {
  return invoke<FolderItem[]>("reorder_folder_items", { folderId, itemIds });
}

export async function updateFolderItem(
  id: string,
  title: string,
  content: string | null,
  contentType: string,
): Promise<FolderItem> {
  return invoke<FolderItem>("update_folder_item", {
    id,
    title,
    content,
    contentType,
  });
}

export async function copyFolderItem(id: string): Promise<FolderItem> {
  return invoke<FolderItem>("copy_folder_item", { id });
}

export async function listPersonalItems(): Promise<PersonalItem[]> {
  if (!isTauri()) return [];
  return invoke<PersonalItem[]>("list_personal_items");
}

export async function createPersonalItem(
  title: string,
  content: string,
  contentType: string,
): Promise<PersonalItem> {
  return invoke<PersonalItem>("create_personal_item", {
    title,
    content,
    contentType,
  });
}

export async function updatePersonalItem(
  id: string,
  title: string,
  content: string | null,
  contentType: string,
): Promise<PersonalItem> {
  return invoke<PersonalItem>("update_personal_item", {
    id,
    title,
    content,
    contentType,
  });
}

export async function deletePersonalItem(id: string): Promise<boolean> {
  return invoke<boolean>("delete_personal_item", { id });
}

export async function addClipboardItemToPersonal(sourceItemId: string): Promise<PersonalItem> {
  return invoke<PersonalItem>("add_clipboard_item_to_personal", { sourceItemId });
}

export async function reorderPersonalItems(itemIds: string[]): Promise<PersonalItem[]> {
  return invoke<PersonalItem[]>("reorder_personal_items", { itemIds });
}

export async function copyPersonalItem(id: string): Promise<PersonalItem> {
  return invoke<PersonalItem>("copy_personal_item", { id });
}

export async function getStoredImage(
  storage: ItemStorage,
  id: string,
  thumbnail = false,
): Promise<string> {
  if (storage === "folder") {
    return invoke<string>("get_folder_item_image", { id, thumbnail });
  }
  if (storage === "personal") {
    return invoke<string>("get_personal_item_image", { id, thumbnail });
  }
  return getClipboardImage(id, thumbnail);
}
