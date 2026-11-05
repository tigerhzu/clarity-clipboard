import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixture, installTauriFixture } from "./fixtures.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const browser = await chromium.launch({ headless: true });
const output = path.join(os.tmpdir(), "clipboard-editor-qa");
await mkdir(output, { recursive: true });
try {
  for (const width of [1180, 900]) {
    const context = await browser.newContext({ viewport: { width, height: width === 900 ? 600 : 760 } });
    await context.addInitScript(installTauriFixture, { fixture: createFixture(), persist: true });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    await page.goto(process.env.UI_SMOKE_URL || "http://127.0.0.1:1420");
    const ready = () => page.locator("#history-list[aria-busy='false']").waitFor();
    await ready();
    const state = () => page.evaluate(() => window.__CLIPBOARD_TEST__.state);
    for (const storage of ["history", "folder", "personal"]) {
      if (storage === "folder") await page.locator(".folder-nav-item").filter({ hasText: "工作收藏" }).click();
      if (storage === "personal") await page.locator(".personal-nav-item").click();
      await ready();
      await page.keyboard.press("Control+n");
      let dialog = page.getByRole("dialog", { name: "新增內容", exact: true });
      await dialog.getByLabel("標題", { exact: true }).fill(`新增-${storage}`);
      await dialog.getByRole("textbox", { name: /^內容\s/ }).fill("我的常用語句\n保留第二行");
      await page.screenshot({ path: path.join(output, `text-${width}-${storage}.png`) });
      await dialog.getByRole("button", { name: "新增內容", exact: true }).click();
      await dialog.waitFor({ state: "hidden" }); await ready();
      let store = storage === "history" ? "history" : storage === "folder" ? "folderItems" : "personal";
      let item = (await state())[store].find(item => item.customName === `新增-${storage}`);
      assert.ok(item); if (storage === "folder") assert.equal(item.folderId, "folder-work");
      await page.locator(`#clipboard-item-${item.id}`).click();
      await page.getByRole("button", { name: "編輯內容", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("標題", { exact: true }).fill(`編輯-${storage}`);
      await dialog.getByRole("textbox", { name: /^內容\s/ }).fill("更新內容");
      // Failed save must keep the draft and allow retry.
      await page.evaluate(() => window.__CLIPBOARD_TEST__.fail(["save_manual_item"]));
      await dialog.getByRole("button", { name: "儲存變更" }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(await dialog.getByLabel("標題", { exact: true }).inputValue(), `編輯-${storage}`);
      await page.evaluate(() => window.__CLIPBOARD_TEST__.fail([]));
      await dialog.getByRole("button", { name: "儲存變更" }).click();
      await dialog.waitFor({ state: "hidden" }); await ready();
      assert.equal((await state())[store].find(row => row.id === item.id).content, "更新內容");
      await page.locator(`#clipboard-item-${item.id}`).dblclick();
      await page.waitForFunction(() => window.__CLIPBOARD_TEST__.state.copies.at(-1)?.content === "更新內容");
      // New image, then replace it on the same record.
      await page.keyboard.press("Control+n"); dialog = page.getByRole("dialog");
      await dialog.getByLabel("內容類型").selectOption("IMAGE");
      await dialog.getByLabel("標題", { exact: true }).fill(`圖片-${storage}`);
      const file = { name: "sample.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=", "base64") };
      await dialog.locator('input[type="file"]').setInputFiles(file);
      await dialog.getByAltText("待儲存的圖片").waitFor();
      await page.screenshot({ path: path.join(output, `image-${width}-${storage}.png`) });
      const bounds = await dialog.boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= (width === 900 ? 600 : 760));
      await dialog.getByRole("button", { name: "新增內容", exact: true }).click();
      await dialog.waitFor({ state: "hidden" }); await ready();
      item = (await state())[store].find(row => row.customName === `圖片-${storage}`); assert.equal(item.contentType, "IMAGE");
      await page.locator(`#clipboard-item-${item.id}`).click();
      await page.getByRole("button", { name: "編輯內容", exact: true }).click(); dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles(file);
      await dialog.getByAltText("待儲存的圖片").waitFor();
      await dialog.getByRole("button", { name: "儲存變更" }).click();
      await dialog.waitFor({ state: "hidden" }); await ready();
      assert.notEqual((await state())[store].find(row => row.id === item.id).filePath, item.filePath);
      console.log(`PASS ${width}: ${storage} create, edit, retry, copy, image upload and replacement`);
    }
    await page.getByRole("button", { name: "最近複製", exact: true }).click(); await ready();
    await page.getByRole("button", { name: "新增常用片段", exact: true }).click();
    let sidebarDialog = page.getByRole("dialog");
    await sidebarDialog.getByLabel("標題", { exact: true }).fill("側欄快速新增");
    await sidebarDialog.getByRole("textbox", { name: /^內容\s/ }).fill("直接開啟常用片段");
    await sidebarDialog.getByRole("button", { name: "新增內容", exact: true }).click();
    await sidebarDialog.waitFor({ state: "hidden" }); await ready();
    await page.waitForFunction(() => document.querySelector(".personal-nav-item")?.getAttribute("aria-current") === "page");
    await page.getByRole("button", { name: "最近複製", exact: true }).click(); await ready();
    for (const [label, type] of [["圖片", "IMAGE"], ["文字", "TEXT"], ["連結", "URL"], ["程式碼", "CODE"], ["路徑", "FILE_PATH"], ["IP", "IP"], ["Email", "EMAIL"]]) {
      await page.locator(".sidebar-filter-section").getByRole("button", { name: label, exact: true }).click(); await ready();
      await page.keyboard.press("Control+n");
      assert.equal(await page.getByRole("dialog").getByLabel("內容類型").inputValue(), type);
      await page.getByRole("dialog").getByLabel("標題", { exact: true }).focus();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`Editor QA screenshots: ${output}`);
