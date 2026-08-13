import {
  Archive,
  CalendarDays,
  Clock3,
  Code2,
  FileText,
  Folder,
  Image,
  Inbox,
  Link2,
  Mail,
  Network,
  Pin,
  Settings,
} from "lucide-react";
import type { ClipboardFilter } from "../types/clipboard";

interface SidebarProps {
  itemCount: number;
  activeFilter: ClipboardFilter;
  onFilterChange: (filter: ClipboardFilter) => void;
  onOpenSettings: () => void;
}

const contentFilters: Array<{ id: ClipboardFilter; label: string; icon: typeof FileText }> = [
  { id: "TEXT", label: "文字", icon: FileText },
  { id: "LINKS", label: "連結", icon: Link2 },
  { id: "IMAGES", label: "圖片", icon: Image },
  { id: "CODE", label: "程式碼", icon: Code2 },
  { id: "PATHS", label: "路徑", icon: Folder },
  { id: "EMAIL", label: "Email", icon: Mail },
  { id: "IP", label: "IP 位址", icon: Network },
];

const dateFilters: Array<{ id: ClipboardFilter; label: string; icon: typeof Clock3 }> = [
  { id: "TODAY", label: "今天", icon: Clock3 },
  { id: "YESTERDAY", label: "昨天", icon: CalendarDays },
  { id: "THIS_WEEK", label: "本週", icon: CalendarDays },
  { id: "OLDER", label: "更早", icon: Archive },
];

export function Sidebar({ itemCount, activeFilter, onFilterChange, onOpenSettings }: SidebarProps) {
  const filterButton = (
    id: ClipboardFilter,
    label: string,
    Icon: typeof Inbox,
    count?: number,
  ) => (
    <button
      className={`nav-item${activeFilter === id ? " active" : ""}`}
      type="button"
      aria-pressed={activeFilter === id}
      onClick={() => onFilterChange(id)}
      key={id}
    >
      <Icon size={16} />
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );

  return (
    <aside className="sidebar">
      <nav aria-label="剪貼簿分類">
        <p className="nav-label first-label">瀏覽</p>
        <div className="nav-group">
          {filterButton("ALL", "全部", Inbox, itemCount)}
          {filterButton("PINNED", "已釘選", Pin)}
        </div>

        <p className="nav-label">內容</p>
        <div className="nav-group">
          {contentFilters.map(({ id, label, icon }) => filterButton(id, label, icon))}
        </div>

        <p className="nav-label">時間</p>
        <div className="nav-group">
          {dateFilters.map(({ id, label, icon }) => filterButton(id, label, icon))}
        </div>
      </nav>

      <button className="settings-button" type="button" onClick={onOpenSettings}>
        <Settings size={16} />
        <span>設定</span>
        <kbd>Ctrl ,</kbd>
      </button>
    </aside>
  );
}
