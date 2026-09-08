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

The desktop grid has a 196px full-height navigation rail and two flexible
content columns (history 0.88fr; preview 1.12fr). The 84px topbar spans both
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
全部時間、今天、昨天、
本週、更早. No content button is hidden or horizontally scrolled out of view.
The existing single-filter contract is preserved: choosing time selects all
content in that period; choosing a content button resets the time to all time.
Collection queries search saved content independently.

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

Pin and delete are quiet header actions. History/personal item deletion uses
the existing two-step confirmation; folder deletion uses a dedicated dialog.
The confirmation state is visibly red and expires. Copy and save success use
short-lived status messages; failures use alert messages.

## Dialogs and settings

Settings are organized into General, Storage, and Privacy. Keep all preferences:
global shortcut, three text scales, retention, excluded processes and common
sensitive-content filtering. Save persists the complete object. Cancellation
does not save. Errors retain the draft and offer retry. The first-run guide is
one dismissible page with optional access to the same settings form.

Dialog panels use a fixed header/footer and independently scrolling body.
Focus enters the dialog, remains inside with Tab/Shift Tab, and returns to the
trigger when closed. Escape dismisses the top dialog unless a save is running.
Background keyboard actions are suspended. All inputs have visible labels;
icon-only actions have accessible names. Image snapshots permit title editing
only. Folder names and snippet titles retain existing validation.

## Responsive behavior, states and motion

Validate 1180×760 and the native minimum 900×600. Below 1060px, navigation
shrinks to 180px and preview padding to 20–22px. The topbar keeps only the
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
