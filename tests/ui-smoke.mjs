/**
 * Run after starting Vite: node tests/ui-smoke.mjs
 * Optional: UI_SMOKE_URL, UI_SMOKE_OUTPUT, PLAYWRIGHT_MODULE, PLAYWRIGHT_EXECUTABLE.
 * --visual-only / --functional-only / --standard-only / --metadata-only limit the run.
 * All data stays in an isolated browser mock.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { createFixture, installTauriFixture } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")].filter(Boolean);
let playwright;
for (const candidate of candidates) { try { playwright = require(candidate); break; } catch { /* try bundled runtime */ } }
if (!playwright) throw new Error("Playwright was not found. Set PLAYWRIGHT_MODULE to its installed directory.");
const output = path.resolve(process.env.UI_SMOKE_OUTPUT || path.join(os.tmpdir(), "clipboard-ui-smoke"));
const url = process.env.UI_SMOKE_URL || "http://127.0.0.1:1420";
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const results = [];
const browserErrors = [];

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1180, height: 760 }, locale: "zh-TW", timezoneId: "Asia/Taipei", reducedMotion: "reduce" });
  await context.addInitScript(installTauriFixture, { fixture: createFixture(options), persist: true, historyError: Boolean(options.historyError), onboarding: Boolean(options.onboarding) });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator(".app-frame").waitFor();
  await page.waitForFunction(() => window.__CLIPBOARD_TEST__.state.calls.some((call) => call.command === "list_clipboard_items"));
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function eventually(page, fn, arg) { await page.waitForFunction(fn, arg, { timeout: 8000 }); }
async function ready(page) { await page.locator("#history-list[aria-busy='false']").waitFor(); }
async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator(".action-toast").count()) await page.locator(".action-toast").waitFor({ state: "hidden" });
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
  const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1, `${name}: document overflows horizontally (${dimensions.scrollWidth}/${dimensions.width})`);
  assert.ok(dimensions.scrollHeight <= dimensions.height + 1, `${name}: document overflows vertically (${dimensions.scrollHeight}/${dimensions.height})`);
  results.push({ check: name, screenshot: file, dimensions });
}
async function check(name, action) {
  const start = Date.now();
  try { await action(); results.push({ check: name, passed: true, ms: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ check: name, passed: false, error: String(error) }); throw error; }
}
const rows = (page) => page.locator("[data-history-row='true']");
const row = (page, id) => page.locator(`[id='clipboard-item-${id}']`);
const search = (page) => page.getByRole("textbox", { name: "搜尋內容", exact: true });
async function resetSearch(page) { await search(page).fill(""); await ready(page); }
async function recent(page) { await page.getByRole("button", { name: /最近複製|全部內容/, exact: true }).first().click(); await resetSearch(page); }
async function selectRow(page, id) { await row(page, id).click(); await eventually(page, (id) => document.getElementById(`clipboard-item-${id}`)?.getAttribute("aria-selected") === "true", id); }
async function getState(page) { return page.evaluate(() => window.__CLIPBOARD_TEST__.state); }

async function contentFiltersAvailable(page) {
  const filters = page.locator(".sidebar-filter-section");
  assert.deepEqual(await filters.getByRole("button").allTextContents(), ["全部", "已釘選", "文字", "連結", "圖片", "程式碼", "路徑", "IP", "Email"]);
  assert.equal(await filters.getByRole("combobox").count(), 1, "only time uses a dropdown");
  assert.deepEqual(await filters.getByRole("combobox", { name: "時間篩選", exact: true }).locator("option").evaluateAll((options) => options.map((option) => [option.value, option.textContent])), [
    ["ALL", "全部時間"], ["TODAY", "今天"], ["YESTERDAY", "昨天"], ["THIS_WEEK", "本週"], ["OLDER", "更早"],
  ]);
  const layout = await filters.locator("button, select").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const section = element.closest(".sidebar-filter-section").getBoundingClientRect();
    return {
      label: element.tagName === "SELECT" ? element.getAttribute("aria-label") : element.textContent,
      visible: rect.width > 0 && rect.height > 0 && rect.left >= section.left && rect.right <= section.right + 1 && rect.top >= section.top && rect.bottom <= section.bottom + 1,
      unobscured: element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
      unclipped: element.scrollWidth <= element.clientWidth + 1,
    };
  }));
  for (const control of layout) assert.ok(control.visible && control.unobscured && control.unclipped, `${control.label} must be fully visible and usable in the sidebar filter section: ${JSON.stringify(control)}`);
}

async function historyMatches(page, filter, ids) {
  await eventually(page, ({ filter, ids }) => {
    const latest = window.__CLIPBOARD_TEST__.state.calls.filter((call) => call.command === "list_clipboard_items").at(-1);
    const actual = [...document.querySelectorAll("[data-history-row='true']")].map((element) => element.id.replace("clipboard-item-", "")).sort();
    return latest?.args.filter === filter && JSON.stringify(actual) === JSON.stringify([...ids].sort());
  }, { filter, ids });
  await ready(page);
}

async function functional() {
  const page = await newPage();
  try {
    await ready(page);
    await check("search, selection and Enter copy", async () => {
      await page.keyboard.press("Control+f");
      assert.equal(await search(page).evaluate((element) => document.activeElement === element), true);
      await search(page).fill("git log");
      await eventually(page, () => document.querySelectorAll("[data-history-row='true']").length === 1 && document.querySelector("#clipboard-item-command-git"));
      await ready(page);
      await page.keyboard.press("Enter");
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.copies.at(-1)?.id === "command-git");
      await page.keyboard.press("Escape");
      await ready(page);
      await eventually(page, () => document.querySelectorAll("[data-history-row='true']").length === 11);
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-history-row")), "true");
      const prior = await page.locator("[data-history-row='true'][aria-selected='true']").getAttribute("id");
      await page.keyboard.press("ArrowDown");
      await eventually(page, (prior) => document.querySelector("[data-history-row='true'][aria-selected='true']")?.id !== prior, prior);
    });
    await check("double-click copies without mutating history", async () => {
      const before = (await getState(page)).history.map((item) => [item.id, item.createdAt]);
      await row(page, "url-guide").dblclick();
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.copies.at(-1)?.id === "url-guide");
      assert.deepEqual((await getState(page)).history.map((item) => [item.id, item.createdAt]), before);
    });
    await check("metadata Enter toggles disclosure without copying", async () => {
      const copies = (await getState(page)).copies.length;
      const summary = page.locator(".metadata-details summary");
      await summary.focus();
      const opened = await summary.evaluate((element) => element.parentElement.open);
      assert.equal(opened, true);
      await page.keyboard.press("Enter");
      await eventually(page, (opened) => document.querySelector(".metadata-details").open !== opened, opened);
      assert.equal((await getState(page)).copies.length, copies);
    });
    await check("pin keyboard shortcut and filtered results", async () => {
      await selectRow(page, "command-git");
      await page.keyboard.press("Control+p");
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.history.find((item) => item.id === "command-git").isPinned);
      await page.locator(".sidebar-filter-section").getByRole("button", { name: "已釘選", exact: true }).click();
      await ready(page);
      assert.equal(await rows(page).count(), 2);
      await recent(page);
      await page.locator(".sidebar-filter-section").getByRole("button", { name: "程式碼", exact: true }).click();
      await ready(page);
      await eventually(page, () => document.querySelectorAll("[data-history-row='true']").length === 3);
      await recent(page);
    });
    await check("direct content filters return matching history", async () => {
      const filters = page.locator(".sidebar-filter-section");
      for (const [value, label, ids] of [
        ["ALL", "全部", (await getState(page)).history.map((item) => item.id)],
        ["PINNED", "已釘選", ["note-release", "command-git"]],
        ["TEXT", "文字", ["note-release", "long-text"]],
        ["LINKS", "連結", ["url-guide"]],
        ["IMAGES", "圖片", ["image-board"]],
        ["CODE", "程式碼", ["command-git", "json-config", "code-format"]],
        ["PATHS", "路徑", ["path-assets", "network-share"]],
        ["IP", "IP", ["ip-server"]],
        ["EMAIL", "Email", ["email-team"]],
      ]) {
        const button = filters.getByRole("button", { name: label, exact: true });
        await button.click();
        await historyMatches(page, value, ids);
        assert.equal(await button.getAttribute("aria-pressed"), "true");
        assert.equal(await filters.getByRole("combobox", { name: "時間篩選", exact: true }).inputValue(), "ALL");
      }
    });
    await check("time filter selects all content and clears on content change", async () => {
      const filters = page.locator(".sidebar-filter-section");
      const time = filters.getByRole("combobox", { name: "時間篩選", exact: true });
      for (const value of ["TODAY", "YESTERDAY", "THIS_WEEK", "OLDER"]) {
        const expected = await page.evaluate((value) => {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const monday = new Date(today); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
          return window.__CLIPBOARD_TEST__.state.history.filter((item) => value === "TODAY" ? item.createdAt >= +today
            : value === "YESTERDAY" ? item.createdAt >= +today - 86400000 && item.createdAt < +today
              : value === "THIS_WEEK" ? item.createdAt >= +monday : item.createdAt < +monday).map((item) => item.id);
        }, value);
        await time.selectOption(value);
        await historyMatches(page, value, expected);
        assert.deepEqual(await filters.locator("button[aria-pressed='true']").allTextContents(), ["全部"]);
      }
      await filters.getByRole("button", { name: "Email", exact: true }).click();
      await historyMatches(page, "EMAIL", ["email-team"]);
      assert.equal(await time.inputValue(), "ALL", "content selection resets the time selection");
      await time.selectOption("TODAY");
      await time.selectOption("ALL");
      await historyMatches(page, "ALL", (await getState(page)).history.map((item) => item.id));
      assert.deepEqual(await filters.locator("button[aria-pressed='true']").allTextContents(), ["全部"]);
      await recent(page);
    });
    await check("non-drag save to folder and correct copy dispatch", async () => {
      await selectRow(page, "url-guide");
      await page.getByRole("button", { name: "保存到", exact: true }).click();
      await page.locator("#save-destinations").waitFor();
      await page.getByRole("button", { name: "保存到", exact: true }).click();
      await page.locator("#save-destinations").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "保存到", exact: true }).click();
      await page.locator("#save-destinations").getByRole("button", { name: "工作收藏", exact: true }).click();
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.folderItems.some((item) => item.sourceItemId === "url-guide"));
      await page.locator(".folder-nav-item").filter({ hasText: "工作收藏" }).click();
      await ready(page);
      const id = (await getState(page)).folderItems.find((item) => item.sourceItemId === "url-guide").id;
      await row(page, id).dblclick();
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.copies.at(-1)?.storage === "folder");
    });
    await check("personal create, edit, copy and deliberate delete", async () => {
      await page.locator(".personal-nav-item").click();
      await ready(page);
      await page.getByRole("button", { name: /新增常用片段|新增個人資料/, exact: true }).first().click();
      let dialog = page.getByRole("dialog");
      await dialog.getByLabel("標題", { exact: true }).fill("測試用常用片段");
      await dialog.getByRole("textbox", { name: /^內容(?:\s|$)/ }).fill("這是測試建立的內容。\n第二行應完整保存。");
      await dialog.getByRole("button", { name: /新增片段|新增資料/, exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const item = (await getState(page)).personal.find((entry) => entry.title === "測試用常用片段");
      assert.ok(item, "create command persisted the item");
      await selectRow(page, item.id);
      await page.getByRole("button", { name: /編輯內容|編輯/, exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("標題", { exact: true }).fill("更新後的片段");
      await dialog.getByRole("textbox", { name: /^內容(?:\s|$)/ }).fill("更新後的內容");
      await dialog.getByRole("button", { name: "儲存變更", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await row(page, item.id).dblclick();
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.copies.at(-1)?.content === "更新後的內容");
      assert.equal((await getState(page)).copies.at(-1).storage, "personal");
      await page.getByRole("button", { name: /刪除內容|刪除個人資料/, exact: true }).click();
      assert.ok((await getState(page)).personal.some((entry) => entry.id === item.id), "first delete only arms confirmation");
      await page.getByRole("button", { name: "再次按下以確認刪除", exact: true }).click();
      await eventually(page, (id) => !window.__CLIPBOARD_TEST__.state.personal.some((entry) => entry.id === id), item.id);
    });
    await check("late folder response cannot replace newer personal view", async () => {
      await page.evaluate(() => { window.__CLIPBOARD_TEST__.state.delayCommands = { list_folder_items: 700 }; window.__CLIPBOARD_TEST__.state.completedDelays = 0; });
      await page.locator(".folder-nav-item").filter({ hasText: "工作收藏" }).click();
      await page.locator(".personal-nav-item").click();
      await row(page, "personal-reply").waitFor();
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.completedDelays > 0);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator(".personal-nav-item").getAttribute("aria-current"), "page");
      assert.deepEqual(await rows(page).evaluateAll((elements) => elements.map((element) => element.id)), ["clipboard-item-personal-reply", "clipboard-item-personal-command"]);
      await page.evaluate(() => { window.__CLIPBOARD_TEST__.state.delayCommands = {}; });
    });
    await check("pending history cannot reset personal selection", async () => {
      await page.evaluate(() => { window.__CLIPBOARD_TEST__.state.delayCommands = { list_clipboard_items: 700, count_clipboard_items: 700 }; window.__CLIPBOARD_TEST__.state.completedDelays = 0; });
      await page.getByRole("button", { name: "最近複製", exact: true }).click();
      await page.locator(".personal-nav-item").click();
      await selectRow(page, "personal-command");
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.completedDelays >= 2);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await row(page, "personal-command").getAttribute("aria-selected"), "true");
      assert.equal(await page.locator("#preview-title").textContent(), "查看工作進度");
      await page.evaluate(() => { window.__CLIPBOARD_TEST__.state.delayCommands = {}; });
    });
    await check("late folder reorder cannot replace newly opened collection", async () => {
      await page.locator(".folder-nav-item").filter({ hasText: "工作收藏" }).click(); await ready(page);
      await page.evaluate(() => { window.__CLIPBOARD_TEST__.state.delayCommands = { reorder_folder_items: 700 }; window.__CLIPBOARD_TEST__.state.completedDelays = 0; });
      const collection = (await getState(page)).folderItems.filter((item) => item.folderId === "folder-work");
      const source = await row(page, collection[0].id).boundingBox();
      const target = await row(page, collection[1].id).boundingBox();
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + target.height * .8, { steps: 8 });
      await page.mouse.up();
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.calls.some((call) => call.command === "reorder_folder_items"));
      await page.locator(".folder-nav-item").filter({ hasText: "靈感與參考" }).click();
      await ready(page);
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.completedDelays > 0);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await rows(page).count(), 0);
      assert.deepEqual((await getState(page)).folderItems.filter((item) => item.folderId === "folder-work").sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.id), [collection[1].id, collection[0].id]);
      await page.evaluate(() => { window.__CLIPBOARD_TEST__.state.delayCommands = {}; });
    });
    await check("folder deletion allows cancellation and preserves history", async () => {
      const historyIds = (await getState(page)).history.map((item) => item.id);
      await page.getByRole("button", { name: "刪除靈感與參考", exact: true }).click();
      let dialog = page.getByRole("alertdialog", { name: "刪除資料夾？", exact: true });
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      assert.ok((await getState(page)).folders.some((folder) => folder.id === "folder-ideas"));
      await page.getByRole("button", { name: "刪除靈感與參考", exact: true }).click();
      dialog = page.getByRole("alertdialog", { name: "刪除資料夾？", exact: true });
      await dialog.getByRole("button", { name: "刪除資料夾", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal((await getState(page)).folders.some((folder) => folder.id === "folder-ideas"), false);
      assert.deepEqual((await getState(page)).history.map((item) => item.id), historyIds);
    });
    await check("settings save and reload preserve privacy fields", async () => {
      const previous = (await getState(page)).settings;
      await page.keyboard.press("Control+,");
      const dialog = page.getByRole("dialog", { name: "設定", exact: true });
      await dialog.getByLabel(/介面比例|顯示比例/).selectOption("150");
      if (await dialog.getByRole("tab", { name: "儲存", exact: true }).count()) await dialog.getByRole("tab", { name: "儲存", exact: true }).click();
      await dialog.getByLabel(/歷史保留期限|自動清除未釘選項目/).selectOption("14");
      await dialog.getByRole("button", { name: "儲存設定", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const settings = (await getState(page)).settings;
      assert.equal(settings.textScale, 150);
      assert.equal(settings.retentionDays, 14);
      assert.deepEqual(settings.excludedApps, previous.excludedApps);
      assert.equal(settings.sensitiveFilterEnabled, previous.sensitiveFilterEnabled);
      assert.equal(settings.hotkey, previous.hotkey);
      await page.reload({ waitUntil: "domcontentloaded" });
      await eventually(page, () => document.querySelector(".app-frame")?.getAttribute("data-text-scale") === "150");
      await page.keyboard.press("Control+,");
      assert.equal(await page.getByRole("dialog").getByLabel(/介面比例|顯示比例/).inputValue(), "150");
      await page.getByRole("button", { name: "關閉設定", exact: true }).click();
    });
    await check("privacy controls persist normalized exclusions", async () => {
      await page.keyboard.press("Control+,");
      const dialog = page.getByRole("dialog", { name: "設定", exact: true });
      await dialog.getByRole("tab", { name: "隱私", exact: true }).click();
      await dialog.getByRole("switch", { name: /過濾敏感內容/ }).uncheck();
      await dialog.getByRole("textbox", { name: /排除的應用程式/ }).fill("Bitwarden.exe\n Synthetic.exe \nsynthetic.exe\n");
      await dialog.getByRole("button", { name: "儲存設定", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const settings = (await getState(page)).settings;
      assert.equal(settings.sensitiveFilterEnabled, false);
      assert.deepEqual(settings.excludedApps, ["Bitwarden.exe", "Synthetic.exe"]);
      assert.equal(settings.textScale, 150);
    });
    await check("clipboard event refreshes history", async () => {
      await recent(page);
      await page.evaluate(() => { const test = window.__CLIPBOARD_TEST__; test.state.history.push({ ...test.state.history[0], id: "event-new", customName: "事件更新", content: "由剪貼簿事件新增", isPinned: false, createdAt: Date.now() }); test.emit(); });
      await row(page, "event-new").waitFor();
    });
    await screenshot(page, "functional-final");
  } catch (error) { await page.screenshot({ path: path.join(output, "failure-functional.png"), animations: "disabled" }); throw error; }
  finally { await page.context().close(); }

  await check("history loads beyond initial 250", async () => {
    const page = await newPage({ extraRows: 250 });
    try { await ready(page); assert.equal(await rows(page).count(), 250); await page.getByRole("button", { name: /載入更多/ }).click(); await eventually(page, () => document.querySelectorAll("[data-history-row='true']").length === 261); }
    finally { await page.context().close(); }
  });
}

async function imageEdgeCases(onlyMetadata = false) {
  for (const [name, options] of [["image-malformed-metadata", { badMetadata: true }], ["image-file-missing", { missingImage: true }]]) {
    if (onlyMetadata && !options.badMetadata) continue;
    await check(name, async () => {
      const page = await newPage(options);
      try {
        await selectRow(page, "image-board"); await screenshot(page, name);
        const preview = await page.locator(".preview-panel").textContent();
        assert.doesNotMatch(preview, /NaN|undefined/);
        if (options.badMetadata) assert.ok(preview.includes("尺寸未提供"));
        if (options.missingImage) assert.ok((await page.locator(".image-missing").textContent()).includes("圖片"));
      } finally { await page.context().close(); }
    });
  }
}

async function visual() {
  if (process.argv.includes("--metadata-only")) { await imageEdgeCases(true); return; }
  for (const [name, options] of [
    ["desktop-1180x760", {}], ["compact-900x600", { viewport: { width: 900, height: 600 } }],
    ["standard-100-desktop", { textScale: 100 }], ["standard-100-compact", { textScale: 100, viewport: { width: 900, height: 600 } }],
    ["large-text-150", { textScale: 150 }], ["compact-large-text-150", { textScale: 150, viewport: { width: 900, height: 600 } }],
    ["empty-history", { empty: true }], ["history-error", { historyError: true }],
  ]) {
    if (process.argv.includes("--standard-only") && options.textScale !== 100) continue;
    await check(name, async () => { const page = await newPage(options); try {
      await ready(page); await contentFiltersAvailable(page); await screenshot(page, name);
      if (options.historyError) {
        await page.evaluate(() => window.__CLIPBOARD_TEST__.fail([]));
        await page.getByRole("button", { name: "重新載入", exact: true }).click();
        await eventually(page, () => document.querySelectorAll("[data-history-row='true']").length === 11);
      }
    } finally { await page.context().close(); } });
  }
  if (process.argv.includes("--standard-only")) return;
  const page = await newPage();
  try {
    await check("no-search-results", async () => { await search(page).fill("此查詢不會找到任何內容xyz987"); await eventually(page, () => document.querySelectorAll("[data-history-row='true']").length === 0); await ready(page); await screenshot(page, "no-search-results"); await resetSearch(page); });
    await check("image-preview-and-lightbox", async () => {
      await selectRow(page, "image-board"); await page.locator(".preview-body img").waitFor(); await screenshot(page, "image-preview");
      await page.getByRole("button", { name: "放大圖片預覽", exact: true }).click(); await page.getByRole("dialog", { name: "放大圖片預覽", exact: true }).waitFor();
      await eventually(page, () => { const image = document.querySelector(".image-lightbox img"); return image?.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 100 && image.getBoundingClientRect().height > 100; });
      await screenshot(page, "image-lightbox"); await page.keyboard.press("Escape");
    });
    await check("long-text-preview", async () => {
      await selectRow(page, "long-text"); await screenshot(page, "long-text-preview");
      await page.getByRole("button", { name: "顯示完整內容", exact: true }).click();
      assert.ok((await page.locator(".text-preview").textContent()).includes("第 650 項"));
      await page.getByRole("button", { name: /複製內容|複製/, exact: false }).filter({ has: page.locator("kbd") }).first().click();
      await eventually(page, () => window.__CLIPBOARD_TEST__.state.copies.at(-1)?.content?.includes("第 650 項"));
    });
    await check("settings-desktop-and-compact", async () => { await page.keyboard.press("Control+,"); await page.getByRole("dialog", { name: "設定", exact: true }).waitFor(); await screenshot(page, "settings-desktop"); await page.setViewportSize({ width: 900, height: 600 }); await screenshot(page, "settings-compact"); });
  } finally { await page.context().close(); }
  const dialogPage = await newPage({ textScale: 150 });
  try {
    await check("settings-150-and-privacy-tabs", async () => {
      await dialogPage.keyboard.press("Control+,");
      const dialog = dialogPage.getByRole("dialog", { name: "設定", exact: true }); await dialog.waitFor();
      await screenshot(dialogPage, "settings-large-150");
      await dialog.getByRole("tab", { name: "隱私", exact: true }).click(); await screenshot(dialogPage, "settings-privacy-150");
      await dialogPage.setViewportSize({ width: 900, height: 600 }); await screenshot(dialogPage, "settings-compact-150");
      await dialogPage.keyboard.press("Escape");
    });
    await check("folder-dialogs-and-snippet-editor", async () => {
      await dialogPage.setViewportSize({ width: 1180, height: 760 });
      await dialogPage.getByRole("button", { name: "新增資料夾", exact: true }).click();
      await dialogPage.getByRole("dialog", { name: "新增資料夾", exact: true }).waitFor(); await screenshot(dialogPage, "folder-create-150"); await dialogPage.keyboard.press("Escape");
      await dialogPage.locator(".nav-folder-row").filter({ hasText: "工作收藏" }).hover();
      await dialogPage.getByRole("button", { name: "刪除工作收藏", exact: true }).click();
      await dialogPage.getByRole("alertdialog", { name: "刪除資料夾？", exact: true }).waitFor(); await screenshot(dialogPage, "folder-delete-150"); await dialogPage.keyboard.press("Escape");
      await dialogPage.getByRole("button", { name: "新增片段", exact: true }).click();
      const dialog = dialogPage.getByRole("dialog", { name: "新增片段", exact: true });
      await dialog.getByLabel("標題", { exact: true }).fill("常用的專案回覆");
      await dialog.getByRole("textbox", { name: /^內容(?:\s|$)/ }).fill("收到，謝謝提供資料。\n我會整理好內容，再與您確認後續安排。");
      await screenshot(dialogPage, "snippet-editor-150");
      await dialogPage.setViewportSize({ width: 900, height: 600 }); await screenshot(dialogPage, "snippet-editor-compact-150");
      await dialogPage.keyboard.press("Escape");
    });
  } finally { await dialogPage.context().close(); }
  await check("onboarding-and-nested-preferences", async () => {
    const page = await newPage({ onboarding: true });
    try {
      await page.getByRole("button", { name: "開始使用", exact: true }).waitFor(); await screenshot(page, "onboarding-desktop");
      await page.setViewportSize({ width: 900, height: 600 }); await screenshot(page, "onboarding-compact");
      await page.getByRole("button", { name: "調整偏好", exact: true }).click(); await page.getByRole("dialog", { name: "設定", exact: true }).waitFor();
      await page.keyboard.press("Escape"); await page.getByRole("button", { name: "開始使用", exact: true }).waitFor();
      await page.getByRole("button", { name: "開始使用", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "hidden" });
    } finally { await page.context().close(); }
  });
  await imageEdgeCases();
}

let failure;
try {
  if (!["--visual-only", "--standard-only", "--metadata-only"].some((flag) => process.argv.includes(flag))) await functional();
  if (!process.argv.includes("--functional-only")) await visual();
  assert.deepEqual(browserErrors, [], "browser emitted uncaught errors");
} catch (error) { failure = error; console.error(error); }
finally {
  await browser.close();
  const reportName = process.argv.includes("--standard-only") ? "report-standard.json" : process.argv.includes("--metadata-only") ? "report-metadata.json" : "report.json";
  await writeFile(path.join(output, reportName), JSON.stringify({ url, timestamp: new Date().toISOString(), results, browserErrors, passed: !failure }, null, 2));
  console.log(`Report and screenshots: ${output}`);
}
if (failure) process.exitCode = 1;
