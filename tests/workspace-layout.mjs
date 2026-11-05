import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createFixture, installTauriFixture } from "./fixtures.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const browser = await chromium.launch({ headless: true });
const output = path.join(os.tmpdir(), "clipboard-layout-qa");
await mkdir(output, { recursive: true });
const errors = [];
async function sizes(page) { return page.locator(".sidebar, .history-panel, .preview-panel").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width)); }
async function drag(page, divider, delta, cancel = false) {
  const bounds = await divider.boundingBox();
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 8 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
async function noOverflow(page) {
  const widths = await sizes(page);
  assert.ok(widths[0] >= 180 && widths[1] >= 299 && widths[2] >= 339, JSON.stringify(widths));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
try {
  for (const width of [1180, 900, 2560]) for (const textScale of [100, 120, 150]) {
    const context = await browser.newContext({ viewport: { width, height: width === 900 ? 600 : 760 }, timezoneId: "Asia/Taipei", locale: "zh-TW" });
    await context.addInitScript(installTauriFixture, { fixture: createFixture({ textScale }), persist: true });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto(process.env.UI_SMOKE_URL || "http://127.0.0.1:1420");
    await page.locator("#history-list[aria-busy='false']").waitFor();
    const side = page.getByRole("separator", { name: "調整側欄寬度", exact: true });
    const middle = page.getByRole("separator", { name: "調整清單與預覽寬度", exact: true });
    const initial = await sizes(page);
    await drag(page, side, 55); assert.ok((await sizes(page))[0] > initial[0] + 40);
    await drag(page, middle, -60); await noOverflow(page);
    const saved = await sizes(page);
    await page.reload(); await page.locator("#history-list[aria-busy='false']").waitFor();
    const restored = await sizes(page); restored.forEach((n, i) => assert.ok(Math.abs(n - saved[i]) < 2));
    await drag(page, side, -45, true); assert.ok(Math.abs((await sizes(page))[0] - saved[0]) < 2);
    await side.focus(); await page.keyboard.press("Home"); assert.equal((await sizes(page))[0], 180);
    await page.keyboard.press("Control+k");
    assert.equal(await page.getByRole("textbox", { name: "搜尋內容", exact: true }).evaluate(el => el === document.activeElement), true);
    await middle.focus(); await page.keyboard.press("End"); await noOverflow(page);
    await middle.press("Enter"); await side.press("Enter");
    await page.locator(".calendar-presets").getByRole("button", { name: "今天", exact: true }).click();
    const time = page.getByRole("combobox", { name: "時間篩選", exact: true });
    await time.scrollIntoViewIfNeeded();
    assert.match(await time.innerText(), /\d{4}-\d{2}-\d{2}/);
    assert.equal(await time.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await time.click();
    const menu = page.getByRole("listbox", { name: "時間範圍", exact: true });
    const rect = await menu.boundingBox();
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= page.viewportSize().height + 1);
    assert.ok(rect.width >= 180);
    await page.screenshot({ path: path.join(output, `time-menu-${width}-${textScale}.png`) });
    await page.keyboard.press("Escape"); assert.equal(await time.getAttribute("aria-expanded"), "false");
    await time.press("Enter"); await time.press("Home"); await time.press("ArrowDown"); await time.press("Enter");
    assert.equal(await time.getAttribute("data-value"), "TODAY");
    await time.click(); await page.locator(".time-filter-option[data-value='ALL']").click();
    assert.equal(await time.getAttribute("data-value"), "ALL");
    await time.press("End"); await time.press("Enter");
    assert.equal(await time.getAttribute("data-value"), "OLDER");
    await time.press("Home"); await time.press("Enter");
    assert.equal(await time.getAttribute("data-value"), "ALL");
    await drag(page, side, 10000); await drag(page, middle, -10000); await noOverflow(page);
    await page.screenshot({ path: path.join(output, `resized-${width}-${textScale}.png`) });
    await page.locator(".personal-nav-item").click();
    await middle.focus(); await middle.press("ArrowRight"); await noOverflow(page);
    await page.setViewportSize({ width: 900, height: 600 }); await page.waitForTimeout(100); await noOverflow(page);
    if (width === 1180 && textScale === 120) {
      await page.setViewportSize({ width: 900, height: 1200 });
      await time.scrollIntoViewIfNeeded(); await time.click();
      const triggerRect = await time.boundingBox(); const menuRect = await menu.boundingBox();
      assert.ok(menuRect.y >= triggerRect.y + triggerRect.height, "menu opens below when there is room");
      await page.getByRole("textbox", { name: "搜尋內容", exact: true }).click();
      assert.equal(await time.getAttribute("aria-expanded"), "false");
    }
    await context.close();
    console.log(`PASS ${width} / ${textScale}%: resize, persistence, cancel, reset, keyboard, date menu, window resize`);
  }
  assert.deepEqual(errors, []); console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
