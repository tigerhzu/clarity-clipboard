/** Browser-native drag QA using isolated synthetic data, never the native clipboard. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixture, installTauriFixture } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const browser = await chromium.launch({ headless: true });
const output = path.join(os.tmpdir(), "clipboard-folder-order-qa");
await mkdir(output, { recursive: true });
try {
  for (const width of [1180, 900]) {
    const fixture = createFixture();
    fixture.folders.push({ ...fixture.folders[1], id: "folder-third", name: "第三個收藏資料夾很長的名稱", sortOrder: 2 });
    const context = await browser.newContext({ viewport: { width, height: width === 900 ? 600 : 760 }, locale: "zh-TW" });
    await context.addInitScript(installTauriFixture, { fixture, persist: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto(process.env.UI_SMOKE_URL || "http://127.0.0.1:1420");
    const ready = () => page.locator("#history-list[aria-busy='false']").waitFor();
    await ready();
    const folder = id => page.locator(`[data-folder-reorder-target='${id}']`);
    const button = id => folder(id).locator(".folder-nav-item");
    const order = () => page.locator("[data-folder-reorder-target]").evaluateAll(rows => rows.map(row => row.dataset.folderReorderTarget));
    const waitOrder = expected => page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll("[data-folder-reorder-target]")].map(row => row.dataset.folderReorderTarget)) === JSON.stringify(expected), expected);
    const state = () => page.evaluate(() => window.__CLIPBOARD_TEST__.state);
    const calls = async () => (await state()).calls.filter(call => call.command === "reorder_folders").length;
    const start = async (sourceId, targetId, after) => {
      const source = await button(sourceId).boundingBox();
      const target = await folder(targetId).boundingBox();
      await page.mouse.move(source.x + 30, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 30, target.y + target.height * (after ? .8 : .2), { steps: 10 });
      await page.locator(".folder-drag-over").waitFor();
    };
    const drag = async (sourceId, targetId, after) => { await start(sourceId, targetId, after); await page.mouse.up(); };

    // A simple click still selects the folder; moving another folder does not change it.
    await button("folder-work").click(); await ready();
    assert.equal(await calls(), 0);
    await start("folder-third", "folder-work", false);
    assert.equal(await folder("folder-work").evaluate(row => row.classList.contains("folder-drag-after")), false);
    await page.screenshot({ path: path.join(output, `drag-before-${width}.png`) });
    await page.mouse.up();
    await waitOrder(["folder-third", "folder-work", "folder-ideas"]);
    assert.equal(await button("folder-work").getAttribute("aria-current"), "page");
    assert.equal((await state()).folderItems.length, 1, "folder sorting must not move saved contents");
    await drag("folder-third", "folder-ideas", true);
    await waitOrder(["folder-work", "folder-ideas", "folder-third"]);
    await drag("folder-work", "folder-ideas", false);
    assert.equal(await calls(), 2, "unchanged order should not write");

    await button("folder-third").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await waitOrder(["folder-work", "folder-third", "folder-ideas"]);
    await button("folder-third").focus();
    await page.keyboard.press("Alt+ArrowDown");
    await waitOrder(["folder-work", "folder-ideas", "folder-third"]);
    await page.reload(); await ready();
    assert.deepEqual(await order(), ["folder-work", "folder-ideas", "folder-third"]);

    const unchanged = await calls();
    await start("folder-third", "folder-work", false);
    await page.keyboard.press("Escape"); await page.mouse.up();
    await page.locator(".folder-drag-over").waitFor({ state: "hidden" });
    await start("folder-third", "folder-work", false);
    await page.mouse.move(500, 100); await page.mouse.up();
    await start("folder-third", "folder-work", false);
    await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.mouse.up();
    await start("folder-third", "folder-work", false);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }))); await page.mouse.up();
    assert.equal(await calls(), unchanged, "cancellation and outside release must not write");
    assert.deepEqual(await order(), ["folder-work", "folder-ideas", "folder-third"]);

    await page.evaluate(() => window.__CLIPBOARD_TEST__.fail(["reorder_folders"]));
    await drag("folder-third", "folder-work", false);
    await page.getByRole("alert").filter({ hasText: "資料夾排序保存失敗" }).waitFor();
    assert.deepEqual(await order(), ["folder-work", "folder-ideas", "folder-third"]);
    await page.evaluate(() => window.__CLIPBOARD_TEST__.fail([]));
    await drag("folder-third", "folder-work", false);
    await waitOrder(["folder-third", "folder-work", "folder-ideas"]);
    const savedOrderCalls = await calls();
    await button("folder-third").focus(); await page.keyboard.press("Alt+ArrowUp");
    assert.equal(await calls(), savedOrderCalls, "first folder cannot move farther up");
    const clip = await page.locator("#clipboard-item-note-release").boundingBox();
    const destination = await folder("folder-ideas").boundingBox();
    await page.mouse.move(clip.x + 30, clip.y + clip.height / 2); await page.mouse.down();
    await page.mouse.move(destination.x + 30, destination.y + destination.height / 2, { steps: 10 });
    await folder("folder-ideas").locator("..").locator(".drop-target").waitFor();
    assert.equal(await page.locator(".folder-drag-over").count(), 0, "content drops use destination outline, not folder sorting");
    await page.mouse.up();
    await page.waitForFunction(() => window.__CLIPBOARD_TEST__.state.folderItems.some(item => item.folderId === "folder-ideas" && item.sourceItemId === "note-release"));
    assert.equal(await calls(), savedOrderCalls, "content drop must not reorder folders");
    await page.screenshot({ path: path.join(output, `sorted-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(`PASS folder up/down drag, insertion, selection, keyboard, persistence, cancel, failure/retry and content drop at ${width}px`);
    await context.close();
  }

  // A long list scrolls continuously while the pointer rests near the rail edge.
  const fixture = createFixture();
  fixture.folders.push(...Array.from({ length: 22 }, (_, i) => ({ ...fixture.folders[1], id: `extra-folder-${i}`, name: `收藏 ${i}`, sortOrder: i + 2 })));
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await context.addInitScript(installTauriFixture, { fixture, persist: true });
  const page = await context.newPage();
  await page.goto(process.env.UI_SMOKE_URL || "http://127.0.0.1:1420");
  await page.locator("#history-list[aria-busy='false']").waitFor();
  const source = await page.locator(".folder-nav-item").first().boundingBox();
  const nav = await page.locator(".sidebar nav").boundingBox();
  await page.mouse.move(source.x + 30, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(nav.x + 30, nav.y + nav.height - 10, { steps: 12 });
  await page.waitForFunction(() => document.querySelector(".sidebar nav").scrollTop > 180);
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.equal((await page.evaluate(() => window.__CLIPBOARD_TEST__.state.calls)).filter(call => call.command === "reorder_folders").length, 0);
  console.log("PASS long folder list auto-scroll and cancel");
  await context.close();
} finally {
  await browser.close();
}
console.log(`Screenshots: ${output}`);
