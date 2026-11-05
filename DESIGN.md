# 剪貼 · Clarity

## Product direction

A quiet space for copied things. The primary task is to find something, read it,
and copy it again. At the user's request, black is now the dominant UI color.
Near-black surface layers, silver text, quiet violet selection and a few static
stars give the workspace a restrained deep-space character. The main action is
silver-lavender with dark ink. There are no external fonts, remote thumbnails,
or network dependencies in the interface.

The vendored
Raycast and Linear references inform compact controls, keyboard affordances,
restrained borders and clear hierarchy; their palettes and layouts are not the
product specification.

## Tokens

| Purpose | Value |
| --- | --- |
| Canvas | `#08090d` |
| Reading surface | `#0d0f16` |
| History | `#101219` |
| Navigation | `#07080c` |
| Raised surface / hover | `#181b25` / `#202431` |
| Primary / body ink | `#eceef6` / `#c6cbd9` |
| Secondary ink | `#a0a7b9` |
| Accent / hover | `#b3adff` / `#d0cdff` |
| Selection | `#25273f`, 3px violet leading indicator |
| Main action background / ink | `#d8d6ff` / `#151421` |
| Hairline / strong line | `#282c39` / `#444b61`, 1px |
| Focus | `#b3adff`, 2px outline, 3px offset |
| Destructive | `#ffabb4`, dark `#351e29` surface |
| Code surface | `#090c13` |
| Overlay | near-black at 72% opacity; 93% for image lightbox |

Typography uses Segoe UI Variable Text, Segoe UI, Microsoft JhengHei UI and
Microsoft JhengHei. Code uses Consolas/Cascadia Code. Body weight is 400,
selected rows 600, headings 600. Content line height is 1.95; rows 1.45;
metadata 1.5. UI text is Traditional Chinese with small English collection
labels that are not needed to understand the application.

| Scale preference | xs | sm | md | lg | xl |
| --- | --- | --- | --- | --- | --- |
| 100 | 11 | 12 | 13 | 16 | 22 |
| 120 (default) | 12 | 13 | 14 | 18 | 24 |
| 150 | 14 | 15 | 17 | 20 | 27 |

These are optical text sizes in pixels. Text scales without enlarging the
entire window. Spacing follows 4/8/12/16/20/24/32px. Radius: 4px keycaps and
badges; 6px icon controls; 8px fields/buttons/rows; 10px content cards/popovers;
16px dialogs. Panels remain flat. Only popovers, dialogs and toasts have a
soft shadow. Scrollbars are 7px with a 2px transparent thumb inset, using the
strong-line token throughout. Native selects use color-scheme: dark. Every
component color references the central tokens in styles.css. The bundled
orbital-stars.svg is an inert, static decoration on navigation only; a small
orbit accompanies the empty preview. Decoration never animates or covers text.

## Layout and interaction

The desktop grid defaults to a 196px full-height navigation rail and two flexible
content columns (history 0.88fr; preview 1.12fr). Two vertical separators resize
navigation and history/preview horizontally. Their 10px pointer targets overlay
the boundary without consuming column width; a 2px hairline turns accent on
hover, focus or drag. Navigation is at least 180px and can expand until only the
content minimums remain; history is at least 300px, and preview at least 340px.
Smaller windows clamp visible widths without
overwriting the saved preference. Persist navigation pixels and the content split
ratio locally. Arrow keys adjust 10px (Shift 40px), Home/End choose limits,
double-click or Enter resets that separator, and Escape/blur cancels a drag.
The 84px topbar spans both
content columns, and the history/preview surfaces begin directly below it so
the reading area keeps the full available height. Navigation contains recent
clips, pins, personal snippets, folders, settings, and a compact category
section in the lower rail. The nine content categories are always visible as a
dense, icon-led list; the time range remains a separate select control. Type/date
filters live in that section rather than taking a full-width row away from the
content, and the navigation rail scrolls independently when text is enlarged.

The search field is always visible, searches the active store, and supports
Ctrl K and Ctrl F. History search is debounced 120ms and uses the existing
backend search/pagination. Mutations are disabled until current results arrive.
All nine content choices are visible category buttons with leading icons: 全部、
已釘選、文字、連結、圖片、程式碼、路徑、IP、Email. Time is the only dropdown:
全部時間、今天、昨天、本週、更早. The time label sits above a full-width
36px combobox so a selected YYYY-MM-DD date never competes with its label or
chevron for space. A themed listbox, at least 180px wide, opens above or below
the trigger according to available viewport space, outside the scrolling rail.
Use raised surface, an 8px radius, strong hairline and 34px option rows. Arrows,
Home/End and Enter navigate/choose; Escape, Tab, blur and outside clicks close.
No content button is hidden or horizontally scrolled out of view.
Legacy time presets select all content in that period. The calendar's selected
date is an independent outer scope: changing category retains the date, and
search and pagination apply within that date. Choosing a legacy time preset
clears the calendar date; the calendar's All time button clears any time preset.
Collection queries search saved content independently.

The history workspace has a compact date bar below search: 複製日曆, 全部時間,
今天 and 選擇日期. The date picker is a 336px floating month panel with 18px
padding, a 12px radius, the raised surface, a strong hairline and a soft shadow.
The Monday-first grid reserves six weeks at 36px per day with 4px gaps. Days
with retained records use accent-soft, accent-hover numerals and a 3px static
glowing dot (7px accent shadow); selection uses action-bg with action-ink.
Today has a strong-line outline, separate from selection. No pulse animation.
Calendar statistics aggregate all retained history, independent of category,
query and pagination. Empty, loading and retryable error states preserve the
grid footprint. Empty days remain selectable with a clear empty-results state.
Arrow keys, Home/End and PageUp/PageDown move the focused date; Enter selects;
Escape closes and returns focus. The panel scrolls within the window at 900×600
and large text sizes. Date boundaries use local midnight, including DST days.

History rows have a type icon or real image thumbnail, a two-line excerpt,
source/type/time metadata, and a pin indicator. Row height is at least 86px.
Day labels preserve backend result order. A click selects; double click or
Enter copies. Arrow keys move selection and scroll the selected row into view.
Loading, empty, search-empty and retryable error states occupy the same area.
Explicit pagination preserves access to records beyond the first 250.

Preview has a compact action bar, readable title/source/time, complete content,
expanded detailed metadata by default, and a fixed copy action at the bottom.
Image previews use the available width with a viewport-aware height cap so the
image remains the visual focus; the image title stays on one line. Text is
selectable. Only the explicit drag handle initiates dragging from the preview.
Code/JSON have syntax coloring; JSON formatting changes the view only. Long
previews initially cap at 80,000 characters / 500 lines and can expand; copy
always uses the original stored record. Images fit without cropping and open
a contain-fit modal with Escape and focus restoration.

The Save to control offers personal snippets and every folder. It supports
Tab, arrows and Escape, closes after selection, and complements existing
drag-to-collection. Saved content remains an independent snapshot. Folder and
personal sorting use the complete collection order, even during search.

Sidebar folders can be dragged vertically from the folder icon/name. A 6px
movement threshold preserves clicks; the source dims to 40% opacity and a 2px
accent line marks insertion before/after the target without shifting layout.
The navigation scrolls near its edges during dragging. Escape, pointer cancel,
window blur, or release outside a folder cancels the move. Alt+Up/Down offers
the same ordering from a focused folder button. Ordering saves to SQLite and
survives reopening; failures keep the previous order and show an alert. Clipboard
content drops retain their separate dashed destination outline.

Pin and delete are quiet header actions. History/personal item deletion uses
the existing two-step confirmation; folder deletion uses a dedicated dialog.
The confirmation state is visibly red and expires. Copy and save success use
short-lived status messages; failures use alert messages.

## Dialogs and settings

Settings are organized into General, Storage, Privacy, and Hermes. Keep all preferences:
global shortcut, three text scales, retention, excluded processes and common
sensitive-content filtering. In Privacy, `1Password.exe` is a protected exclusion
shown as a locked row outside the editable list; all other exclusions remain
editable. Save persists the complete object. Cancellation does not save. Errors retain the draft and offer retry. The first-run guide is
one dismissible page with optional access to the same settings form.

The Hermes tab has a default-off read/write switch, a labeled read-only setup
prompt and a compact copy action with pending/success/error feedback. The switch
uses the normal draft/save/cancel flow; copy works independently of saving and
states when the switch still needs to be saved. The prompt is portable across
Windows users and installations, contains no token or personal paths, and
explains connection verification. State local-machine scope and model-service
data handling in plain language. Use the existing scrolling body, control tokens
and keyboard focus rules at both supported window sizes and all text scales.

Dialog panels use a fixed header/footer and independently scrolling body.
Focus enters the dialog, remains inside with Tab/Shift Tab, and returns to the
trigger when closed. Escape dismisses the top dialog unless a save is running.
Background keyboard actions are suspended. All inputs have visible labels;
icon-only actions have accessible names. Image snapshots permit title editing
only. Folder names and snippet titles retain existing validation.

## Responsive behavior, states and motion

Validate 1180×760 and the native minimum 900×600. Below 1060px, navigation
defaults to 180px and preview padding to 20–22px. The topbar keeps only the
search and creation controls so they remain usable at every width. Below
650px height, the topbar becomes 70px; the lower-rail category section stays
inside the independently scrollable navigation. All columns use min-height:0 and
independent scrolling; content never enlarges the outer window. Test every
text scale at the minimum size. Long names truncate in navigation and lists,
while full content and details wrap in preview.

Hover changes only color/surface. Selected, focus-visible, pressed, disabled,
pending, error and drag target states remain distinguishable. Missing metadata
uses explicit fallback text; missing images show a finite error state. Normal
transitions are 110–140ms and never delay input or animate layout. Respect
prefers-reduced-motion.

## Compatibility and verification

Preserve `com.tigerhzu.clarityclipboard`, existing databases, settings keys,
clipboard monitor, privacy/retention logic, tray behavior and global shortcut.
No migration or rewrite of user data is required for this redesign.

`tests/ui-smoke.mjs` runs browser-native Playwright checks with isolated
synthetic Tauri IPC data. It never reads or changes real clipboard content.
Screenshot artifacts and the test report are written outside user data.
Production build and the Rust regression suite complement the UI checks.

### 全工作區新增與編輯

最近複製、所有類型篩選、收藏資料夾與常用片段皆提供新增內容；Ctrl+N 使用目前目的地，類型篩選預填相應類型。每筆預覽皆可編輯標題、內容與類型；圖片支援選檔新增與替換，未選新圖則保留原圖。編輯視窗沿用既有緊密雙欄欄位、可捲動內容與固定操作列；圖片預覽高 160px、object-fit: contain。儲存錯誤留在視窗並保留草稿；成功後清空搜尋並選取儲存結果，歷史回到全部內容以避免篩選隱藏新資料。
