import {
  Braces,
  Code2,
  FileCode2,
  FileText,
  Folder,
  Image,
  Link2,
  Mail,
  Network,
  TerminalSquare,
} from "lucide-react";
import type { ClipboardContentType } from "../types/clipboard";

export const contentTypeLabels: Record<ClipboardContentType, string> = {
  TEXT: "文字",
  URL: "網址",
  EMAIL: "Email",
  IP: "IP 位址",
  FILE_PATH: "檔案路徑",
  NETWORK_PATH: "網路路徑",
  CODE: "程式碼",
  IMAGE: "圖片",
  JSON: "JSON",
  COMMAND: "命令",
};

interface ContentTypeIconProps {
  type: ClipboardContentType;
  size?: number;
}

export function ContentTypeIcon({ type, size = 17 }: ContentTypeIconProps) {
  const props = { size, strokeWidth: 1.8 };
  switch (type) {
    case "URL": return <Link2 {...props} />;
    case "EMAIL": return <Mail {...props} />;
    case "IP": return <Network {...props} />;
    case "FILE_PATH":
    case "NETWORK_PATH": return <Folder {...props} />;
    case "CODE": return <FileCode2 {...props} />;
    case "JSON": return <Braces {...props} />;
    case "COMMAND": return <TerminalSquare {...props} />;
    case "IMAGE": return <Image {...props} />;
    case "TEXT": return <FileText {...props} />;
    default: return <Code2 {...props} />;
  }
}
