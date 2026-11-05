import { useState } from "react";
import {
  Code2,
  Clock3,
  FileText,
  Folder,
  FolderPlus,
  Image,
  Inbox,
  Link2,
  Mail,
  Network,
  Pencil,
  Pin,
  Plus,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { DragEvent, PointerEvent } from "react";
import { clearItemDragPayload, CLIPBOARD_ITEM_DRAG_TYPE, readItemDragPayload } from "../lib/drag";
import type { ClipboardFilter, Folder as FolderModel } from "../types/clipboard";
import "./navigation.css";
import { TimeFilter } from "./TimeFilter";

const contentFilters = [
  { value: "ALL", label: "全部", icon: Inbox },
  { value: "PINNED", label: "已釘選", icon: Pin },
  { value: "TEXT", label: "文字", icon: FileText },
  { value: "LINKS", label: "連結", icon: Link2 },
  { value: "IMAGES", label: "圖片", icon: Image },
  { value: "CODE", label: "程式碼", icon: Code2 },
  { value: "PATHS", label: "路徑", icon: Folder },
  { value: "IP", label: "IP", icon: Network },
  { value: "EMAIL", label: "Email", icon: Mail },
] as const;

const timeFilters = ["TODAY", "YESTERDAY", "THIS_WEEK", "OLDER"] as const;

export type SidebarSelection =
  | { kind: "history"; filter: ClipboardFilter }
  | { kind: "folder"; folderId: string }
  | { kind: "personal" };

interface SidebarProps {
  selectedDate: string | null;
  onTimeFilterChange: (filter: ClipboardFilter) => void;
  activeFilter: ClipboardFilter;
  activeView: SidebarSelection;
  folders: FolderModel[];
  pointerDropTarget: string | null;
  folderDraggingId: string | null;
  folderReorderTargetId: string | null;
  folderReorderAfter: boolean;
  folderSortingDisabled: boolean;
  onStartFolderDrag: (id: string, event: PointerEvent<HTMLElement>) => void;
  onMoveFolder: (id: string, targetId: string, after: boolean) => void;
  onFilterChange: (filter: ClipboardFilter) => void;
  onSelectFolder: (folderId: string) => void;
  onSelectPersonal: () => void;
  onCreateFolder: () => void;
  onRenameFolder: (folder: FolderModel) => void;
  onDeleteFolder: (folder: FolderModel) => void;
  onAddPersonal: () => void;
  onDropClipboardItem: (target: "personal" | { folderId: string }, sourceItemId: string) => void;
  onOpenSettings: () => void;
}

function isInternalDrag(event: DragEvent<HTMLElement>): boolean {
  try {
    if (event.dataTransfer.types.includes(CLIPBOARD_ITEM_DRAG_TYPE)) return true;
  } catch {
    // Fall through to the same-document payload fallback.
  }
  return readItemDragPayload(event.dataTransfer)?.kind === "history";
}

export function Sidebar({
  selectedDate,
  onTimeFilterChange,
  activeFilter,
  activeView,
  folders,
  pointerDropTarget,
  folderDraggingId,
  folderReorderTargetId,
  folderReorderAfter,
  folderSortingDisabled,
  onStartFolderDrag,
  onMoveFolder,
  onFilterChange,
  onSelectFolder,
  onSelectPersonal,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onAddPersonal,
  onDropClipboardItem,
  onOpenSettings,
}: SidebarProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const isDropTarget = (target: string) => dropTarget === target || pointerDropTarget === target;

  const clearDropTarget = (event: DragEvent<HTMLElement>, target: string) => {
    const related = event.relatedTarget as Node | null;
    if (!related || !event.currentTarget.contains(related)) {
      if (dropTarget === target) setDropTarget(null);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, target: string) => {
    if (!isInternalDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropTarget(target);
  };

  const handleDrop = (
    event: DragEvent<HTMLElement>,
    target: "personal" | { folderId: string },
  ) => {
    const payload = readItemDragPayload(event.dataTransfer);
    if (!payload || payload.kind !== "history") return;
    event.preventDefault();
    event.stopPropagation();
    onDropClipboardItem(target, payload.id);
    clearItemDragPayload();
    setDropTarget(null);
  };
  const isRecent = activeView.kind === "history" && activeFilter !== "PINNED";
  const isPinned = activeView.kind === "history" && activeFilter === "PINNED";
  const isTimeFilter = timeFilters.includes(activeFilter as (typeof timeFilters)[number]);
  const activeContentFilter = isTimeFilter ? "ALL" : activeFilter;

  return (
    <aside className="sidebar" id="workspace-sidebar">
      <nav aria-label="剪貼簿分類">
        <section className="nav-section" aria-label="工作空間">
          <h2>工作空間</h2>
          <div className="nav-group">
            <button
              className={`nav-item${isRecent ? " active" : ""}`}
              type="button"
              aria-current={isRecent ? "page" : undefined}
              onClick={() => onFilterChange("ALL")}
              title="瀏覽全部剪貼簿記錄"
            >
              <Clock3 size={17} /><span>最近複製</span>
            </button>
            <button
              className={`nav-item${isPinned ? " active" : ""}`}
              type="button"
              aria-current={isPinned ? "page" : undefined}
              onClick={() => onFilterChange("PINNED")}
              title="已釘選的剪貼簿內容"
            >
              <Pin size={17} /><span>已釘選</span>
            </button>
            <div
              className={`nav-personal-row${activeView.kind === "personal" ? " active" : ""}${isDropTarget("personal") ? " drop-target" : ""}`}
              data-clipboard-drop-target="personal"
              onDragEnter={(event) => handleDragOver(event, "personal")}
              onDragOver={(event) => handleDragOver(event, "personal")}
              onDragLeave={(event) => clearDropTarget(event, "personal")}
              onDrop={(event) => handleDrop(event, "personal")}
            >
              <button
                className="nav-item personal-nav-item"
                type="button"
                aria-current={activeView.kind === "personal" ? "page" : undefined}
                onClick={onSelectPersonal}
                title="保存常用文字、連結與其他片段"
              >
                <Sparkles size={17} /><span>常用片段</span>
              </button>
              <button
                type="button"
                className="nav-mini-action personal-add-action"
                onClick={onAddPersonal}
                aria-label="新增常用片段"
                title="新增常用片段"
              ><Plus size={15} /></button>
            </div>
          </div>
        </section>

        <section className="nav-section my-data-section" aria-label="收藏資料夾">
          <div className="nav-section-heading">
            <h2>收藏資料夾</h2>
            <button
              type="button"
              className="nav-add-button"
              onClick={onCreateFolder}
              aria-label="新增資料夾"
              title="新增資料夾"
            >
              <FolderPlus size={15} />
            </button>
          </div>
          <div className="nav-group folder-group">
            {folders.length === 0 && (
              <button className="nav-empty" type="button" onClick={onCreateFolder}>
                <Plus size={14} /><span>建立第一個資料夾</span>
              </button>
            )}
            {folders.map((folder, index) => {
              const targetKey = `folder:${folder.id}`;
              const active = activeView.kind === "folder" && activeView.folderId === folder.id;
              return (
                <div
                  className={`nav-folder-row${active ? " active" : ""}${isDropTarget(targetKey) ? " drop-target" : ""}${folderDraggingId === folder.id ? " folder-dragging" : ""}${folderReorderTargetId === folder.id ? ` folder-drag-over${folderReorderAfter ? " folder-drag-after" : ""}` : ""}`}
                  data-clipboard-drop-target={targetKey}
                  data-folder-reorder-target={folder.id}
                  key={folder.id}
                  onDragEnter={(event) => handleDragOver(event, targetKey)}
                  onDragOver={(event) => handleDragOver(event, targetKey)}
                  onDragLeave={(event) => clearDropTarget(event, targetKey)}
                  onDrop={(event) => handleDrop(event, { folderId: folder.id })}
                >
                  <button
                    className="nav-item folder-nav-item"
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelectFolder(folder.id)}
                    onPointerDown={(event) => onStartFolderDrag(folder.id, event)}
                    onKeyDown={(event) => {
                      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                      event.preventDefault();
                      if (folderSortingDisabled) return;
                      const next = folders[index + (event.key === "ArrowUp" ? -1 : 1)];
                      if (next) onMoveFolder(folder.id, next.id, event.key === "ArrowDown");
                    }}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    title={`${folder.name}（${folder.itemCount} 筆）· 按住上下拖曳排序，或 Alt + ↑ / ↓`}
                  >
                    <Folder size={16} />
                    <span title={folder.name}>{folder.name}</span>
                    <em>{folder.itemCount}</em>
                  </button>
                  <div className="nav-folder-actions">
                    <button
                      type="button"
                      className="nav-mini-action"
                      onClick={() => onRenameFolder(folder)}
                      aria-label={`重新命名${folder.name}`}
                      title="重新命名"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="nav-mini-action danger"
                      onClick={() => onDeleteFolder(folder)}
                      aria-label={`刪除${folder.name}`}
                      title="刪除資料夾"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

        </section>

        <section className="nav-section sidebar-filter-section" aria-label="剪貼簿分類">
          <h2>分類</h2>
          <div className="sidebar-category-list content-filters" aria-label="內容分類">
            {contentFilters.map(({ value, label, icon: Icon }) => {
              const active = activeView.kind === "history" && activeContentFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  className={`sidebar-category-item${active ? " active" : ""}`}
                  onClick={() => onFilterChange(value)}
                >
                  <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
          <TimeFilter value={isTimeFilter ? activeFilter : "ALL"}
            selectedDate={activeView.kind === "history" ? selectedDate : null} onChange={onTimeFilterChange} />
        </section>
      </nav>

      <footer className="sidebar-footer">
        <button className="settings-button" type="button" onClick={onOpenSettings} title="設定（Ctrl ,）">
          <Settings size={16} /><span>設定</span><kbd>Ctrl ,</kbd>
        </button>
      </footer>
    </aside>
  );
}
