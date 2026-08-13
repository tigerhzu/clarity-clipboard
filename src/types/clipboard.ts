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

export interface ClipboardImageMetadata {
  width: number;
  height: number;
  byteSize: number;
  thumbnailPath: string;
}

export interface ClipboardSettings {
  retentionDays: 7 | 30 | 90 | null;
  excludedApps: string[];
  sensitiveFilterEnabled: boolean;
}
