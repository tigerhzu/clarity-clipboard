export type ClipboardContentType =
  | "TEXT"
  | "URL"
  | "EMAIL"
  | "IP"
  | "FILE_PATH"
  | "NETWORK_PATH"
  | "CODE"
  | "IMAGE"
  | "JSON"
  | "COMMAND";

export type ClipboardFilter =
  | "ALL"
  | "PINNED"
  | "TEXT"
  | "LINKS"
  | "IMAGES"
  | "CODE"
  | "PATHS"
  | "EMAIL"
  | "IP"
  | "TODAY"
  | "YESTERDAY"
  | "THIS_WEEK"
  | "OLDER";

export interface ClipboardItem {
  id: string;
  content: string | null;
  contentType: ClipboardContentType;
  contentHash: string;
  sourceApp: string | null;
  sourceProcess: string | null;
  sourceWindow: string | null;
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
  customName: string | null;
  filePath: string | null;
  metadata: string | null;
  tags: string | null;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
  itemCount: number;
}

export interface FolderItem extends ClipboardItem {
  folderId: string;
  sourceItemId: string | null;
  sortOrder: number;
}

export interface PersonalItem extends ClipboardItem {
  title: string;
  sourceItemId: string | null;
  sortOrder: number;
}

export type ItemStorage = "history" | "folder" | "personal";

export interface DisplayItem extends ClipboardItem {
  storage: ItemStorage;
  collectionId?: string;
}

export interface ClipboardImageMetadata {
  width: number;
  height: number;
  byteSize: number;
  thumbnailPath: string;
}

export type ClipboardTextScale = 100 | 120 | 150;

export interface ClipboardSettings {
  retentionDays: 7 | 14 | 30 | null;
  excludedApps: string[];
  sensitiveFilterEnabled: boolean;
  textScale: ClipboardTextScale;
  hotkey: string;
}
