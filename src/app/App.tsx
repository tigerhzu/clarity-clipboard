import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { register as registerGlobalHotkey, unregister as unregisterGlobalHotkey } from "@tauri-apps/plugin-global-shortcut";
import { isTauri } from "@tauri-apps/api/core";
import { Check, LoaderCircle, Plus, Search, X } from "lucide-react";
import { ConfirmFolderDeleteDialog, FolderDialog } from "../components/FolderDialog";
import { HistoryList } from "../components/HistoryList";
import { ClipboardCalendar } from "../components/ClipboardCalendar";
import { dayRange } from "../lib/calendar";
import { useWorkspaceLayout } from "../components/WorkspaceLayout";
import { PersonalItemDialog, type LibraryItemDialogMode } from "../components/PersonalItemDialog";
import { PreviewPane } from "../components/PreviewPane";
import { Sidebar, type SidebarSelection } from "../components/Sidebar";
import { OnboardingDialog } from "../components/OnboardingDialog";
import { SettingsDialog } from "../components/SettingsDialog";
import {
  addClipboardItemToFolder,
  addClipboardItemToPersonal,
  copyClipboardItem,
  copyFolderItem,
  copyPersonalItem,
  countClipboardItems,
  createFolder,
  saveManualItem,
  deleteClipboardItem,
  deleteFolder,
  deletePersonalItem,
  getClipboardSettings,
  listClipboardItems,
  listFolderItems,
  listFolders,
  listPersonalItems,
  onClipboardChanged,
  onLibraryChanged,
  removeFolderItem,
  renameFolder,
  reorderFolderItems,
  reorderFolders,
  reorderPersonalItems,
  toggleClipboardPin,
} from "../lib/clipboard-api";
import { DEFAULT_GLOBAL_HOTKEY, resolveGlobalHotkey } from "../lib/hotkey";
import type { ItemDragPayload } from "../lib/drag";
import type {
  ClipboardContentType,
  ClipboardFilter,
  ClipboardItem,
  DisplayItem,
  ClipboardSettings,
  Folder as FolderModel,
  FolderItem,
  ItemStorage,
  PersonalItem,
  ClipboardTextScale,
} from "../types/clipboard";

const filterLabels: Record<ClipboardFilter, string> = {
  ALL: "最近剪貼",
  PINNED: "已釘選",
  TEXT: "文字",
  LINKS: "連結",
  IMAGES: "圖片",
  CODE: "程式碼與命令",
  PATHS: "路徑",
  EMAIL: "Email",
  IP: "IP 位址",
  TODAY: "今天",
  YESTERDAY: "昨天",
  THIS_WEEK: "本週",
  OLDER: "更早",
};

type NoticeTone = "default" | "warning" | "error";

interface Notice {
  message: string;
  tone: NoticeTone;
}

// Bump the key when the guide's flow changes so an existing installation sees
// the updated first-run experience once after upgrading.
const ONBOARDING_STORAGE_KEY = "clarity-clipboard:onboarding-completed:v2";

function hasCompletedOnboarding(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function toDisplayItem(
  item: ClipboardItem | FolderItem | PersonalItem,
  storage: ItemStorage,
  collectionId?: string,
): DisplayItem {
  return { ...item, storage, collectionId };
}

function matchesQuery(item: DisplayItem, query: string): boolean {
  if (!query) return true;
  const searchable = [
    item.customName,
    item.content,
    item.contentType,
    item.sourceApp,
    item.sourceProcess,
    item.tags,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return searchable.includes(query);
}

function movedItemIds(
  items: { id: string }[],
  sourceId: string,
  targetId: string,
  after = false,
): string[] | null {
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  if (sourceIndex < 0 || sourceId === targetId) return null;
  const next = [...items];
  const [source] = next.splice(sourceIndex, 1);
  const targetIndex = next.findIndex((item) => item.id === targetId);
  if (!source || targetIndex < 0) return null;
  next.splice(targetIndex + (after ? 1 : 0), 0, source);
  return next.map((item) => item.id);
}

function pointerDropTargetAt(clientX: number, clientY: number): string | null {
  const element = document.elementFromPoint(clientX, clientY);
  return element?.closest<HTMLElement>("[data-clipboard-drop-target]")
    ?.dataset.clipboardDropTarget ?? null;
}

interface PointerReorderTarget {
  id: string;
  after: boolean;
}

function pointerReorderTargetAt(clientX: number, clientY: number, folderNavigation = false): PointerReorderTarget | null {
  const element = document.elementFromPoint(clientX, clientY);
  const target = element?.closest<HTMLElement>(folderNavigation ? "[data-folder-reorder-target]" : "[data-clipboard-reorder-target]");
  const id = folderNavigation ? target?.dataset.folderReorderTarget : target?.dataset.clipboardReorderTarget;
  if (!target || !id) return null;
  const bounds = target.getBoundingClientRect();
  return { id, after: clientY >= bounds.top + bounds.height / 2 };
}

function collectionTargetFromKey(targetKey: string): "personal" | { folderId: string } | null {
  if (targetKey === "personal") return "personal";
  if (targetKey.startsWith("folder:")) {
    const folderId = targetKey.slice("folder:".length);
    return folderId ? { folderId } : null;
  }
  return null;
}

type PointerDragPayload = ItemDragPayload | { id: string; kind: "folder-navigation" };

interface PointerDragSession {
  payload: PointerDragPayload;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  cleanup?: () => void;
}

interface PointerDragVisual {
  payload: PointerDragPayload;
  targetKey: string | null;
  reorderTargetId: string | null;
  reorderAfter: boolean;
}

export function App() {
  const layout = useWorkspaceLayout();
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [folders, setFolders] = useState<FolderModel[]>([]);
  const [collectionItems, setCollectionItems] = useState<DisplayItem[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [textScale, setTextScale] = useState<ClipboardTextScale>(120);
  const [clipboardSettings, setClipboardSettings] = useState<ClipboardSettings | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<ClipboardFilter>("ALL");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const dateRange = useMemo(() => dayRange(selectedDate), [selectedDate]);
  const [activeView, setActiveView] = useState<SidebarSelection>({ kind: "history", filter: "ALL" });
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [appliedCriteria, setAppliedCriteria] = useState({ query: "", filter: "ALL" as ClipboardFilter, date: null as string | null });
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState<{ folder: FolderModel | null } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<FolderModel | null>(null);
  const [personalDialog, setPersonalDialog] = useState<{
    item: DisplayItem | null;
    mode: LibraryItemDialogMode;
    folderId?: string;
    initialType?: ClipboardContentType;
  } | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  useEffect(() => { setEditorError(null); }, [personalDialog]);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [pointerDrag, setPointerDrag] = useState<PointerDragVisual | null>(null);
  const requestSequence = useRef(0);
  const collectionSequence = useRef(0);
  const historyRefreshRef = useRef<() => Promise<void>>(async () => undefined);
  const searchInput = useRef<HTMLInputElement>(null);
  const registeredHotkey = useRef<string | null>(null);
  const pointerDragSession = useRef<PointerDragSession | null>(null);
  const suppressFolderClickUntil = useRef(0);

  const registerToggleHotkey = useCallback(async (requestedHotkey: string) => {
    if (!isTauri()) return true;
    const nextHotkey = resolveGlobalHotkey(requestedHotkey.trim() || DEFAULT_GLOBAL_HOTKEY);
    const previousHotkey = registeredHotkey.current;
    if (previousHotkey === nextHotkey) return true;

    try {
      await registerGlobalHotkey(nextHotkey, () => undefined);
    } catch {
      return false;
    }

    if (previousHotkey) {
      await unregisterGlobalHotkey(previousHotkey).catch(() => undefined);
    }
    registeredHotkey.current = nextHotkey;
    return true;
  }, []);

  const completeOnboarding = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    } catch {
      // The current session can still be completed if storage is unavailable.
    }
    setOnboardingOpen(false);
  }, []);

  useEffect(() => {
    let disposed = false;
    const initializeApp = async () => {
      try {
        const settings = await getClipboardSettings();
        if (disposed) return;
        setClipboardSettings(settings);
        setTextScale(settings.textScale);
        void registerToggleHotkey(settings.hotkey).then((registered) => {
          if (!registered && !disposed) {
            setNotice({ message: "預設快捷鍵無法註冊，請在設定中更換組合鍵", tone: "warning" });
          }
        });
      } catch {
        void registerToggleHotkey(DEFAULT_GLOBAL_HOTKEY);
      }
      if (!disposed && !hasCompletedOnboarding()) setOnboardingOpen(true);
    };
    void initializeApp();
    return () => {
      disposed = true;
      const current = registeredHotkey.current;
      registeredHotkey.current = null;
      if (current) void unregisterGlobalHotkey(current).catch(() => undefined);
    };
  }, [registerToggleHotkey]);

  const refreshFolders = useCallback(async () => {
    try {
      setFolders(await listFolders());
    } catch {
      setNotice({ message: "無法讀取資料夾，請稍後重試", tone: "error" });
    }
  }, []);

  useEffect(() => {
    void refreshFolders();
  }, [refreshFolders]);

  const refreshHistory = useCallback(async () => {
    if (activeViewRef.current.kind !== "history" || activeViewRef.current.filter !== filter) return;
    const requestId = ++requestSequence.current;
    setSearching(true);
    try {
      const [nextItems, nextTotal] = await Promise.all([
        listClipboardItems({ query: debouncedQuery, filter, ...dateRange }),
        countClipboardItems({ query: debouncedQuery, filter, ...dateRange }),
      ]);
      if (requestId !== requestSequence.current) return;
      setItems(nextItems);
      setTotalCount(nextTotal);
      setAppliedCriteria({ query: debouncedQuery, filter, date: selectedDate });
      setCalendarRevision((value) => value + 1);
      setSelectedId((current) => {
        if (current && nextItems.some((item) => item.id === current)) return current;
        return nextItems[0]?.id ?? null;
      });
      setError(null);
    } catch {
      if (requestId !== requestSequence.current) return;
      setError("無法讀取本機剪貼簿資料庫。請稍後重試。");
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setSearching(false);
      }
    }
  }, [debouncedQuery, filter, dateRange, selectedDate]);
  historyRefreshRef.current = refreshHistory;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (activeView.kind !== "history") return;
    void refreshHistory();
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void onClipboardChanged(() => void refreshHistory()).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      requestSequence.current += 1;
      unlisten();
    };
  }, [activeView.kind, refreshHistory]);

  const refreshCollection = useCallback(async () => {
    if (activeView.kind === "history" || activeViewRef.current !== activeView) return;
    const requestId = ++collectionSequence.current;
    setCollectionLoading(true);
    try {
      if (activeView.kind === "folder") {
        const nextItems = await listFolderItems(activeView.folderId);
        if (requestId !== collectionSequence.current || activeViewRef.current !== activeView) return;
        setCollectionItems(nextItems.map((item) => toDisplayItem(item, "folder", activeView.folderId)));
      } else {
        const nextItems = await listPersonalItems();
        if (requestId !== collectionSequence.current || activeViewRef.current !== activeView) return;
        setCollectionItems(nextItems.map((item) => toDisplayItem(item, "personal")));
      }
      setCollectionError(null);
    } catch {
      if (requestId !== collectionSequence.current) return;
      setCollectionError("無法讀取保存的內容，請稍後重試。");
    } finally {
      if (requestId === collectionSequence.current) setCollectionLoading(false);
    }
  }, [activeView]);

  useEffect(() => {
    setCollectionItems([]);
    setCollectionError(null);
    if (activeView.kind !== "history") void refreshCollection();
    return () => { collectionSequence.current += 1; };
  }, [activeView, refreshCollection]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    void onLibraryChanged(() => {
      void refreshFolders();
      void (activeView.kind === "history" ? refreshHistory() : refreshCollection());
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; });
    return () => { disposed = true; unlisten(); };
  }, [activeView.kind, refreshCollection, refreshFolders, refreshHistory]);

  const historyDisplayItems = useMemo(
    () => items.map((item) => toDisplayItem(item, "history")),
    [items],
  );
  const visibleCollectionItems = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();
    return collectionItems.filter((item) => matchesQuery(item, normalizedQuery));
  }, [collectionItems, debouncedQuery]);
  const displayItems = activeView.kind === "history" ? historyDisplayItems : visibleCollectionItems;
  const selectedItem = useMemo(
    () => displayItems.find((item) => item.id === selectedId) ?? null,
    [displayItems, selectedId],
  );

  useEffect(() => {
    setSelectedId((current) => {
      if (current && displayItems.some((item) => item.id === current)) return current;
      return displayItems[0]?.id ?? null;
    });
  }, [displayItems]);

  const historyCriteriaPending = query !== debouncedQuery
    || appliedCriteria.query !== debouncedQuery
    || appliedCriteria.filter !== filter
    || appliedCriteria.date !== selectedDate;
  const criteriaPending = activeView.kind === "history"
    ? historyCriteriaPending
    : query !== debouncedQuery;

  const loadMore = useCallback(async () => {
    if (activeView.kind !== "history" || loadingMore || criteriaPending || items.length >= totalCount) return;
    const requestId = requestSequence.current;
    const offset = items.length;
    setLoadingMore(true);
    try {
      const [nextItems, nextTotal] = await Promise.all([
        listClipboardItems({ query: debouncedQuery, filter, offset, ...dateRange }),
        countClipboardItems({ query: debouncedQuery, filter, ...dateRange }),
      ]);
      if (requestId !== requestSequence.current) return;
      setItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...nextItems.filter((item) => !existing.has(item.id))];
      });
      setTotalCount(nextTotal);
    } catch {
      setNotice({ message: "無法載入更多歷史記錄，請再試一次", tone: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [activeView.kind, criteriaPending, debouncedQuery, filter, dateRange, items.length, loadingMore, totalCount]);

  const adjacentSelection = useCallback((list: DisplayItem[], id: string) => {
    const currentIndex = list.findIndex((item) => item.id === id);
    if (currentIndex < 0) return null;
    return list[currentIndex + 1]?.id ?? list[currentIndex - 1]?.id ?? null;
  }, []);

  const runItemAction = useCallback(async (
    id: string,
    action: "copy" | "pin" | "delete",
  ) => {
    if (actionId) return;

    if (action === "delete" && deleteArmedId !== id) {
      setDeleteArmedId(id);
      setNotice({ message: "再按一次刪除以確認移除此項目", tone: "warning" });
      return;
    }

    setDeleteArmedId(null);
    setActionId(`${action}:${id}`);
    try {
      if (action === "copy") {
        await copyClipboardItem(id);
        setNotice({ message: "已複製到剪貼簿", tone: "default" });
      } else if (action === "pin") {
        const current = items.find((item) => item.id === id);
        const nextSelection = filter === "PINNED" && current?.isPinned
          ? adjacentSelection(historyDisplayItems, id)
          : null;
        const updated = await toggleClipboardPin(id);
        if (nextSelection && activeViewRef.current.kind === "history" && activeViewRef.current.filter === filter) setSelectedId(nextSelection);
        setNotice({
          message: updated.isPinned ? "已釘選" : "已取消釘選",
          tone: "default",
        });
        await historyRefreshRef.current();
      } else {
        const nextSelection = adjacentSelection(historyDisplayItems, id);
        await deleteClipboardItem(id);
        if (activeViewRef.current.kind === "history" && activeViewRef.current.filter === filter) setSelectedId(nextSelection);
        setNotice({ message: "已刪除剪貼簿項目", tone: "default" });
        await historyRefreshRef.current();
      }
    } catch {
      setNotice({ message: "操作失敗，請再試一次", tone: "error" });
    } finally {
      setActionId(null);
    }
  }, [actionId, adjacentSelection, deleteArmedId, filter, historyDisplayItems, items, refreshHistory]);

  const runCollectionCopy = useCallback(async (id: string) => {
    if (actionId || activeView.kind === "history") return;
    setActionId(`copy:${activeView.kind}:${id}`);
    try {
      if (activeView.kind === "folder") await copyFolderItem(id);
      else await copyPersonalItem(id);
      setNotice({ message: "已複製到剪貼簿", tone: "default" });
    } catch {
      setNotice({ message: "無法複製這筆保存內容", tone: "error" });
    } finally {
      setActionId(null);
    }
  }, [actionId, activeView]);

  const runCollectionAction = useCallback(async (id: string) => {
    if (actionId || activeView.kind === "history") return;
    if (deleteArmedId !== id) {
      setDeleteArmedId(id);
      setNotice({
        message: activeView.kind === "folder"
          ? "再按一次以確認從資料夾移除"
          : "再按一次刪除以確認移除常用片段",
        tone: "warning",
      });
      return;
    }

    const kind = activeView.kind;
    const nextSelection = adjacentSelection(collectionItems, id);
    setDeleteArmedId(null);
    setActionId(`${kind}:remove:${id}`);
    try {
      if (kind === "folder") {
        await removeFolderItem(id);
        setNotice({ message: "已從資料夾移除，歷史紀錄仍保留", tone: "default" });
      } else {
        await deletePersonalItem(id);
        setNotice({ message: "已刪除常用片段", tone: "default" });
      }
      if (activeViewRef.current === activeView) {
        setSelectedId(nextSelection);
        await refreshCollection();
      }
      if (kind === "folder") await refreshFolders();
    } catch {
      setNotice({ message: "移除失敗，請再試一次", tone: "error" });
    } finally {
      setActionId(null);
    }
  }, [actionId, activeView, adjacentSelection, collectionItems, deleteArmedId, refreshCollection, refreshFolders]);

  const reorderCollectionItems = useCallback(async (
    sourceId: string,
    targetId: string,
    after = false,
  ) => {
    if (actionId || activeView.kind === "history") return;
    const itemIds = movedItemIds(collectionItems, sourceId, targetId, after);
    if (!itemIds) return;
    const kind = activeView.kind;
    setActionId(`${kind}:reorder`);
    try {
      if (kind === "folder") {
        const updated = await reorderFolderItems(activeView.folderId, itemIds);
        if (activeViewRef.current !== activeView) return;
        setCollectionItems(updated.map((item) => toDisplayItem(item, "folder", activeView.folderId)));
      } else {
        const updated = await reorderPersonalItems(itemIds);
        if (activeViewRef.current !== activeView) return;
        setCollectionItems(updated.map((item) => toDisplayItem(item, "personal")));
      }
      setNotice({ message: "排序已保存", tone: "default" });
    } catch {
      setNotice({ message: "排序保存失敗，請再試一次", tone: "error" });
    } finally {
      setActionId(null);
    }
  }, [actionId, activeView, collectionItems]);

  const handleDropClipboardItem = useCallback(async (
    target: "personal" | { folderId: string },
    sourceItemId: string,
  ) => {
    if (actionId) return;
    setActionId("save-dragged-item");
    try {
      if (target === "personal") {
        await addClipboardItemToPersonal(sourceItemId);
      } else {
        await addClipboardItemToFolder(target.folderId, sourceItemId);
      }
      setNotice({ message: target === "personal" ? "已保存到常用片段" : "已保存到資料夾", tone: "default" });
      await refreshFolders();
      if (
        (target === "personal" && activeView.kind === "personal")
        || (target !== "personal" && activeView.kind === "folder" && activeView.folderId === target.folderId)
      ) {
        await refreshCollection();
      }
    } catch {
      setNotice({ message: "保存失敗，請確認歷史項目仍然存在", tone: "error" });
    } finally {
      setActionId(null);
    }
  }, [actionId, activeView, refreshCollection, refreshFolders]);

  const reorderNavigationFolders = useCallback(async (sourceId: string, targetId: string, after = false) => {
    if (actionId || dialogSaving) return;
    const folderIds = movedItemIds(folders, sourceId, targetId, after);
    if (!folderIds || folderIds.every((id, index) => id === folders[index].id)) return;
    setActionId("folder:reorder");
    try {
      setFolders(await reorderFolders(folderIds));
      setNotice({ message: "資料夾排序已保存", tone: "default" });
    } catch {
      setNotice({ message: "資料夾排序保存失敗，請再試一次", tone: "error" });
      void refreshFolders();
    } finally {
      setActionId(null);
    }
  }, [actionId, dialogSaving, folders, refreshFolders]);

  const finishPointerDrag = useCallback((
    payload: PointerDragPayload,
    targetKey: string | null,
    reorderTargetId: string | null,
    reorderAfter: boolean,
  ) => {
    if (payload.kind === "folder-navigation") {
      if (reorderTargetId) void reorderNavigationFolders(payload.id, reorderTargetId, reorderAfter);
      return;
    }
    if (payload.kind === "history") {
      if (!targetKey) return;
      const target = collectionTargetFromKey(targetKey);
      if (target) void handleDropClipboardItem(target, payload.id);
      return;
    }
    if (
      (payload.kind === "folder" || payload.kind === "personal")
      && activeView.kind === payload.kind
      && reorderTargetId
    ) {
      void reorderCollectionItems(payload.id, reorderTargetId, reorderAfter);
    }
  }, [activeView.kind, handleDropClipboardItem, reorderCollectionItems, reorderNavigationFolders]);

  const startPointerDrag = useCallback((payload: PointerDragPayload, event: ReactPointerEvent<HTMLElement>) => {
    if (
      actionId
      || dialogSaving
      || !["history", "folder", "personal", "folder-navigation"].includes(payload.kind)
      || event.button !== 0
      || !event.isPrimary
      || pointerDragSession.current
    ) return;

    const session: PointerDragSession = {
      payload,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };

    let clientX = event.clientX;
    let clientY = event.clientY;
    let scrollFrame = 0;
    const updateDragTarget = () => {
      const reorderTarget = pointerReorderTargetAt(clientX, clientY, session.payload.kind === "folder-navigation");
      setPointerDrag({
        payload: session.payload,
        targetKey: session.payload.kind === "history"
          ? pointerDropTargetAt(clientX, clientY)
          : null,
        reorderTargetId: reorderTarget?.id && reorderTarget.id !== session.payload.id
          ? reorderTarget.id
          : null,
        reorderAfter: reorderTarget?.id && reorderTarget.id !== session.payload.id
          ? reorderTarget.after
          : false,
      });
    };

    const handleMove = (move: globalThis.PointerEvent) => {
      if (pointerDragSession.current !== session || move.pointerId !== session.pointerId) return;
      clientX = move.clientX; clientY = move.clientY;
      if (!session.dragging) {
        if (Math.hypot(clientX - session.startX, clientY - session.startY) < 6) return;
        session.dragging = true;
      }
      move.preventDefault();
      updateDragTarget();
    };

    const scrollNavigation = () => {
      if (session.dragging) {
        const nav = document.querySelector<HTMLElement>(".sidebar nav");
        const bounds = nav?.getBoundingClientRect();
        if (nav && bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) {
          const delta = clientY < bounds.top + 28 ? -8 : clientY > bounds.bottom - 28 ? 8 : 0;
          if (delta) { nav.scrollTop += delta; updateDragTarget(); }
        }
      }
      scrollFrame = window.requestAnimationFrame(scrollNavigation);
    };

    const handleEnd = (end: globalThis.PointerEvent) => {
      if (pointerDragSession.current !== session || end.pointerId !== session.pointerId) return;
      const wasDragging = session.dragging && end.type === "pointerup";
      const targetKey = wasDragging ? pointerDropTargetAt(end.clientX, end.clientY) : null;
      const reorderTarget = wasDragging ? pointerReorderTargetAt(end.clientX, end.clientY, session.payload.kind === "folder-navigation") : null;
      if (session.dragging && session.payload.kind === "folder-navigation") suppressFolderClickUntil.current = Date.now() + 250;
      session.cleanup?.();
      if (wasDragging) {
        finishPointerDrag(
          session.payload,
          session.payload.kind === "history" ? targetKey : null,
          reorderTarget?.id && reorderTarget.id !== session.payload.id ? reorderTarget.id : null,
          reorderTarget?.id && reorderTarget.id !== session.payload.id ? reorderTarget.after : false,
        );
      }
    };

    const handleCancel = () => {
      if (session.dragging && session.payload.kind === "folder-navigation") suppressFolderClickUntil.current = Date.now() + 250;
      session.cleanup?.();
    };
    const handleEscape = (key: KeyboardEvent) => {
      if (key.key === "Escape") { key.preventDefault(); handleCancel(); }
    };
    session.cleanup = () => {
      window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      window.removeEventListener("blur", handleCancel);
      window.removeEventListener("keydown", handleEscape);
      pointerDragSession.current = null;
      setPointerDrag(null);
    };
    pointerDragSession.current = session;
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    window.addEventListener("blur", handleCancel);
    window.addEventListener("keydown", handleEscape);
    if (payload.kind === "folder-navigation") scrollFrame = window.requestAnimationFrame(scrollNavigation);
  }, [actionId, dialogSaving, finishPointerDrag]);

  useEffect(() => () => {
    pointerDragSession.current?.cleanup?.();
  }, []);

  const handleFolderSubmit = useCallback(async (name: string) => {
    if (dialogSaving) return;
    setDialogSaving(true);
    try {
      if (folderDialog?.folder) {
        await renameFolder(folderDialog.folder.id, name);
        setNotice({ message: "資料夾名稱已更新", tone: "default" });
      } else {
        await createFolder(name);
        setNotice({ message: "資料夾已建立", tone: "default" });
      }
      setFolderDialog(null);
      await refreshFolders();
    } catch {
      setNotice({ message: "資料夾儲存失敗，請換一個名稱再試", tone: "error" });
    } finally {
      setDialogSaving(false);
    }
  }, [dialogSaving, folderDialog, refreshFolders]);

  const handleDeleteFolder = useCallback(async (folder: FolderModel) => {
    if (actionId) return;
    setActionId(`folder:delete:${folder.id}`);
    try {
      await deleteFolder(folder.id);
      if (activeView.kind === "folder" && activeView.folderId === folder.id) {
        setFilter("ALL");
        setActiveView({ kind: "history", filter: "ALL" });
        setSelectedId(null);
      }
      await refreshFolders();
      setFolderToDelete(null);
      setNotice({ message: "資料夾已刪除，歷史紀錄不受影響", tone: "default" });
    } catch {
      setNotice({ message: "刪除資料夾失敗，請再試一次", tone: "error" });
    } finally {
      setActionId(null);
    }
  }, [actionId, activeView, refreshFolders]);

  const handlePersonalSubmit = useCallback(async (
    title: string,
    content: string | null,
    contentType: ClipboardContentType,
    imageBase64?: string,
  ) => {
    if (dialogSaving || !personalDialog) return;
    const dialogMode = personalDialog.mode;
    setDialogSaving(true); setEditorError(null);
    try {
      const saved = await saveManualItem({ storage: dialogMode, id: personalDialog.item?.id,
        folderId: personalDialog.folderId, title, content, contentType, imageBase64,
        pinned: !personalDialog.item && filter === "PINNED" });
      setPersonalDialog(null);
      setQuery(""); setDebouncedQuery("");
      if (dialogMode === "history") {
        setSelectedDate(null);
        setFilter("ALL"); setActiveView({ kind: "history", filter: "ALL" });
        await refreshHistory();
      } else if (activeView.kind === dialogMode) await refreshCollection();
      else if (dialogMode === "personal") setActiveView({ kind: "personal" });
      await refreshFolders();
      setSelectedId(saved.id);
      setNotice({ message: personalDialog.item ? "內容已更新" : "內容已新增", tone: "default" });
    } catch (error) {
      setEditorError("儲存失敗，內容仍保留，可重試。" + String(error));
    } finally { setDialogSaving(false); }
  }, [activeView.kind, filter, dialogSaving, personalDialog, refreshCollection, refreshHistory, refreshFolders]);

  const openNewItem = useCallback(() => {
    const initialType: ClipboardContentType = activeView.kind === "history"
      ? ({ IMAGES: "IMAGE", LINKS: "URL", CODE: "CODE", PATHS: "FILE_PATH", EMAIL: "EMAIL", IP: "IP" } as Partial<Record<ClipboardFilter, ClipboardContentType>>)[filter] ?? "TEXT" : "TEXT";
    setPersonalDialog({ item: null, mode: activeView.kind, initialType,
      folderId: activeView.kind === "folder" ? activeView.folderId : undefined });
  }, [activeView, filter]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!deleteArmedId) return;
    const timer = window.setTimeout(() => setDeleteArmedId(null), 3600);
    return () => window.clearTimeout(timer);
  }, [deleteArmedId]);

  useEffect(() => {
    setDeleteArmedId(null);
  }, [selectedId, activeView]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[role='separator']") && !event.ctrlKey) return;
      const isSearch = target === searchInput.current;

      if (event.ctrlKey && event.key === ",") {
        event.preventDefault();
        if (!settingsOpen && !onboardingOpen) setSettingsOpen(true);
        return;
      }

      if (settingsOpen || onboardingOpen || folderDialog || personalDialog) return;

      if (event.ctrlKey && ["f", "k"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openNewItem();
        return;
      }

      if (target?.matches("input, textarea, select, [contenteditable='true']") && !isSearch) return;

      if (event.ctrlKey && event.key.toLowerCase() === "p" && activeView.kind === "history" && selectedId && !criteriaPending) {
        event.preventDefault();
        void runItemAction(selectedId, "pin");
        return;
      }

      if (isSearch) {
        if (event.key === "Escape") {
          event.preventDefault();
          if (query) setQuery("");
          else searchInput.current?.blur();
        } else if (event.key === "Enter" && selectedId && !criteriaPending) {
          event.preventDefault();
          if (activeView.kind === "history") void runItemAction(selectedId, "copy");
          else void runCollectionCopy(selectedId);
        } else if (event.key === "ArrowDown" && selectedId && !criteriaPending) {
          event.preventDefault();
          searchInput.current?.blur();
          document.getElementById(`clipboard-item-${selectedId}`)?.focus();
        }
        return;
      }

      const isEditable = target?.matches("input, textarea, select, [contenteditable='true']");
      const isHistoryRow = Boolean(target?.closest("[data-history-row='true']"));
      const isOtherControl = Boolean(target?.closest("button, a, summary, [role='button']")) && !isHistoryRow;
      if (isEditable || isOtherControl || displayItems.length === 0 || criteriaPending) return;

      const currentIndex = Math.max(0, displayItems.findIndex((item) => item.id === selectedId));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = Math.min(displayItems.length - 1, Math.max(0, currentIndex + offset));
        setSelectedId(displayItems[nextIndex].id);
      } else if (event.key === "Enter" && selectedId) {
        event.preventDefault();
        if (activeView.kind === "history") void runItemAction(selectedId, "copy");
        else void runCollectionCopy(selectedId);
      } else if (event.key === "Delete" && selectedId) {
        event.preventDefault();
        if (activeView.kind === "history") void runItemAction(selectedId, "delete");
        else void runCollectionAction(selectedId);
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [openNewItem, activeView, criteriaPending, displayItems, folderDialog, personalDialog, onboardingOpen, query, runCollectionAction, runCollectionCopy, runItemAction, selectedId, settingsOpen]);

  const isHistoryView = activeView.kind === "history";
  const activeFolder = activeView.kind === "folder"
    ? folders.find((folder) => folder.id === activeView.folderId)
    : null;
  const activeTitle = isHistoryView
    ? selectedDate ? `${selectedDate.slice(5).replace("-", " / ")} · ${filterLabels[filter]}` : filterLabels[filter]
    : activeView.kind === "folder"
      ? activeFolder?.name || "資料夾"
      : "常用片段";
  const activeCollectionLabel = activeView.kind === "folder"
    ? activeFolder?.name || "資料夾"
    : activeView.kind === "personal" ? "常用片段" : undefined;
  const currentItems = displayItems;
  const currentTotal = isHistoryView ? totalCount : currentItems.length;
  const currentLoading = isHistoryView ? loading : collectionLoading;
  const currentError = isHistoryView ? error : collectionError;
  const hasCriteria = isHistoryView ? Boolean(query.trim()) || filter !== "ALL" || Boolean(selectedDate) : Boolean(query.trim());

  return (
    <main
      ref={layout.frameRef}
      style={layout.style}
      data-resizing={layout.resizing || undefined}
      className={`app-frame${isHistoryView ? " has-calendar" : ""}`}
      data-text-scale={textScale}
      data-pointer-dragging={pointerDrag ? "true" : undefined}
      onClickCapture={(event) => {
        if (Date.now() < suppressFolderClickUntil.current && (event.target as HTMLElement).closest(".nav-folder-row")) {
          event.preventDefault(); event.stopPropagation();
        }
      }}
    >
      {layout.dividers}
      <header className="topbar">
        <label className="topbar-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={isHistoryView ? "找回剛才複製的內容…" : "搜尋這裡保存的內容…"}
            spellCheck={false}
            aria-label="搜尋內容"
            aria-controls="history-list"
          />
          {isHistoryView && searching && <LoaderCircle className="search-spinner" size={14} aria-label="搜尋中" />}
          {query ? (
            <button
              type="button"
              className="clear-search"
              onClick={() => {
                setQuery("");
                searchInput.current?.focus();
              }}
              aria-label="清除搜尋"
              title="清除搜尋"
            >
              <X size={14} />
            </button>
          ) : <kbd>Ctrl K</kbd>}
        </label>

        <div className="topbar-tools">
          <button
            type="button"
            className="new-snippet-button"
            onClick={() => openNewItem()}
            title="在目前類別新增內容（Ctrl N）"
          >
            <Plus size={16} /><span>新增內容</span>
          </button>
        </div>
      </header>

      {isHistoryView && <ClipboardCalendar selectedDate={selectedDate} timeLabel={["TODAY", "YESTERDAY", "THIS_WEEK", "OLDER"].includes(filter) ? filterLabels[filter] : undefined} revision={calendarRevision} onSelectDate={(date) => {
        requestSequence.current += 1;
        setSelectedDate(date);
        setDeleteArmedId(null);
        const nextFilter = ["TODAY", "YESTERDAY", "THIS_WEEK", "OLDER"].includes(filter) ? "ALL" : filter;
        setFilter(nextFilter);
        setActiveView({ kind: "history", filter: nextFilter });
      }} />}

      <div className="workspace">
        <Sidebar
          activeFilter={filter}
          selectedDate={selectedDate}
          onTimeFilterChange={(nextFilter) => {
            requestSequence.current += 1;
            setSelectedDate(null);
            setDeleteArmedId(null);
            setFilter(nextFilter);
            setActiveView({ kind: "history", filter: nextFilter });
          }}
          activeView={activeView}
          folders={folders}
          pointerDropTarget={pointerDrag?.targetKey ?? null}
          folderDraggingId={pointerDrag?.payload.kind === "folder-navigation" ? pointerDrag.payload.id : null}
          folderReorderTargetId={pointerDrag?.payload.kind === "folder-navigation" ? pointerDrag.reorderTargetId : null}
          folderReorderAfter={pointerDrag?.payload.kind === "folder-navigation" ? pointerDrag.reorderAfter : false}
          folderSortingDisabled={Boolean(actionId) || dialogSaving}
          onStartFolderDrag={(id, event) => startPointerDrag({ id, kind: "folder-navigation" }, event)}
          onMoveFolder={reorderNavigationFolders}
          onFilterChange={(nextFilter) => {
            setDeleteArmedId(null);
            setFilter(nextFilter);
            setActiveView({ kind: "history", filter: nextFilter });
          }}
          onSelectFolder={(folderId) => {
            setDeleteArmedId(null);
            setActiveView({ kind: "folder", folderId });
          }}
          onSelectPersonal={() => {
            setDeleteArmedId(null);
            setActiveView({ kind: "personal" });
          }}
          onCreateFolder={() => setFolderDialog({ folder: null })}
          onRenameFolder={(folder) => setFolderDialog({ folder })}
          onDeleteFolder={setFolderToDelete}
          onAddPersonal={() => setPersonalDialog({ item: null, mode: "personal" })}
          onDropClipboardItem={(target, sourceItemId) => void handleDropClipboardItem(target, sourceItemId)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <HistoryList
          key={`${activeView.kind}:${activeView.kind === "folder" ? activeView.folderId : ""}`}
          items={currentItems}
          totalCount={currentTotal}
          selectedId={selectedId}
          loading={currentLoading}
          searching={isHistoryView && searching}
          loadingMore={loadingMore}
          pending={criteriaPending}
          error={currentError}
          query={query}
          hasCriteria={hasCriteria}
          activeFilterLabel={activeTitle}
          panelKicker={isHistoryView ? "CLIPBOARD" : "COLLECTION"}
          headerAction={(
            <button
              type="button"
              className="panel-action"
              onClick={() => openNewItem()}
              title="在目前類別新增內容"
            >
              <Plus size={14} />
              <span>新增</span>
            </button>
          )}
          emptyTitle={isHistoryView && selectedDate ? "這一天沒有符合的紀錄" : hasCriteria ? undefined : isHistoryView ? "美好的工作，從複製開始" : activeView.kind === "folder" ? "留個位置給重要內容" : "把常用的話，放在手邊"}
          emptyDescription={isHistoryView && selectedDate ? "試試其他分類或日期，也可以切回全部時間。" : hasCriteria ? undefined : isHistoryView
            ? "複製文字或圖片後，它會立刻出現在這裡並只保存在這台電腦。"
            : activeView.kind === "folder"
              ? "直接新增文字或圖片，也可從剪貼紀錄保存到此資料夾。"
              : "新增常用文字，或從剪貼紀錄保存，隨時一鍵複製。"}
          emptyAction={!hasCriteria ? (
            <button type="button" className="state-action" onClick={() => openNewItem()}>
              <Plus size={14} />新增內容
            </button>
          ) : undefined}
          viewKind={activeView.kind}
          reorderable={!isHistoryView}
          onSelect={setSelectedId}
          onCopy={(id) => { if (isHistoryView) void runItemAction(id, "copy"); else void runCollectionCopy(id); }}
          onRetry={() => void (isHistoryView ? refreshHistory() : refreshCollection())}
          onLoadMore={() => void loadMore()}
          onReorder={(sourceId, targetId, after) => void reorderCollectionItems(sourceId, targetId, after)}
          onStartPointerDrag={startPointerDrag}
          pointerDraggingId={pointerDrag?.payload.kind === activeView.kind ? pointerDrag.payload.id : null}
          pointerReorderTargetId={pointerDrag?.payload.kind === activeView.kind ? pointerDrag.reorderTargetId : null}
          pointerReorderAfter={pointerDrag?.payload.kind === activeView.kind ? pointerDrag.reorderAfter : false}
        />
        <PreviewPane
          key={criteriaPending ? "pending" : `${activeView.kind}:${selectedItem?.id ?? "empty"}`}
          item={criteriaPending ? null : selectedItem}
          pending={criteriaPending}
          busy={Boolean(actionId)}
          deleteArmed={deleteArmedId === selectedItem?.id}
          mode={activeView.kind}
          collectionLabel={activeCollectionLabel}
          folders={folders}
          onSave={(target, id) => void handleDropClipboardItem(target, id)}
          onCreateFolder={() => setFolderDialog({ folder: null })}
          onStartPointerDrag={startPointerDrag}
          onCopy={(id) => {
            if (activeView.kind === "history") void runItemAction(id, "copy");
            else void runCollectionCopy(id);
          }}
          onTogglePin={(id) => void runItemAction(id, "pin")}
          onDelete={(id) => {
            if (activeView.kind === "history") void runItemAction(id, "delete");
            else void runCollectionAction(id);
          }}
          onRemove={(id) => void runCollectionAction(id)}
          onEdit={(id) => {
            const item = displayItems.find((candidate) => candidate.id === id);
            if (item) {
              setPersonalDialog({ item, mode: activeView.kind });
            }
          }}
        />
      </div>

      {notice && (
        <div className={`action-toast tone-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.tone === "default" && <Check size={16} />}{notice.message}
        </div>
      )}

      {onboardingOpen && (
        <OnboardingDialog
          initialSettings={clipboardSettings}
          onClose={completeOnboarding}
          onSettingsSaved={(savedSettings) => {
            setClipboardSettings(savedSettings);
            setTextScale(savedSettings.textScale);
            void registerToggleHotkey(savedSettings.hotkey).then((registered) => {
              setNotice(registered
                ? { message: "設定已儲存", tone: "default" }
                : { message: "設定已儲存，但快捷鍵與其他程式衝突", tone: "warning" });
            });
            void (activeView.kind === "history" ? refreshHistory() : refreshCollection());
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(savedSettings) => {
            setClipboardSettings(savedSettings);
            setTextScale(savedSettings.textScale);
            void registerToggleHotkey(savedSettings.hotkey).then((registered) => {
              setNotice(registered
                ? { message: "設定已儲存", tone: "default" }
                : { message: "設定已儲存，但快捷鍵與其他程式衝突", tone: "warning" });
            });
            void (activeView.kind === "history" ? refreshHistory() : refreshCollection());
          }}
        />
      )}

      {folderToDelete && <ConfirmFolderDeleteDialog folder={folderToDelete} saving={Boolean(actionId)} onClose={() => setFolderToDelete(null)} onConfirm={() => void handleDeleteFolder(folderToDelete)} />}

      {folderDialog && (
        <FolderDialog
          folder={folderDialog.folder}
          saving={dialogSaving}
          onClose={() => setFolderDialog(null)}
          onSubmit={(name) => void handleFolderSubmit(name)}
        />
      )}

      {personalDialog && (
        <PersonalItemDialog
          item={personalDialog.item}
          mode={personalDialog.mode}
          initialType={personalDialog.initialType}
          error={editorError}
          saving={dialogSaving}
          onClose={() => setPersonalDialog(null)}
          onSubmit={(title, content, contentType, imageBase64) => void handlePersonalSubmit(title, content, contentType, imageBase64)}
        />
      )}
    </main>
  );
}
