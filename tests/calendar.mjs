/** Isolated browser calendar checks, including full-history counts and stale requests. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createFixture, installTauriFixture } from "./fixtures.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const browser = await chromium.launch({ headless: true });
const output = path.join(os.tmpdir(), "clipboard-calendar-qa");
await mkdir(output, { recursive: true });
const start = +new Date("2026-10-04T00:00:00+08:00");
const errors = [];
const ready = page => page.locator("#history-list[aria-busy='false']").waitFor();
const open = async page => { await page.locator(".calendar-trigger").click(); await page.locator(".calendar-grid[aria-busy='false']").waitFor(); };
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
  const bounds = await page.locator(".calendar-popover").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= page.viewportSize().width && bounds.y + bounds.height <= page.viewportSize().height);
}
try {
  for (const width of [1180, 900]) {
    for (const textScale of [100, 120, 150]) {
      const context = await browser.newContext({ viewport: { width, height: width === 900 ? 600 : 760 }, timezoneId: "Asia/Taipei", locale: "zh-TW", reducedMotion: "reduce" });
      const fixture = createFixture({ textScale });
      fixture.history = Array.from({ length: 262 }, (_, index) => ({ ...fixture.history[0], id: `day-${index}`, isPinned: false,
        content: `calendar note ${index}`, contentType: index === 1 ? "IMAGE" : "TEXT", customName: `日期筆記 ${index}`,
        createdAt: index === 0 ? start - 1 : index === 261 ? start + 86400000 : start + index * 1000 }));
      await context.addInitScript(installTauriFixture, { fixture, persist: false });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on("pageerror", error => errors.push(String(error)));
      await page.clock.setFixedTime(new Date("2026-10-04T12:00:00+08:00"));
      await page.goto(process.env.UI_SMOKE_URL || "http://127.0.0.1:1420", { waitUntil: "domcontentloaded", timeout: 60000 }); await ready(page); await open(page);
      const day = page.locator("[data-date='2026-10-04']");
      assert.equal(await day.getAttribute("aria-label"), "2026-10-04，260 筆紀錄");
      assert.match(await day.getAttribute("class"), /has-activity/);
      assert.equal(await page.locator(".calendar-day.has-activity").count(), 3);
      await screenshot(page, `calendar-${width}-${textScale}`);
      await day.click(); await ready(page);
      await page.waitForFunction(() => document.querySelectorAll("[data-history-row]").length === 250);
      assert.equal(await page.locator(".calendar-trigger").innerText(), "2026 / 10 / 04");
      await page.locator(".sidebar-category-item").filter({ hasText: /^圖片$/ }).click(); await ready(page);
      await page.waitForFunction(() => document.querySelectorAll("[data-history-row]").length === 1);
      assert.equal(await page.locator("[data-history-row]").getAttribute("id"), "clipboard-item-day-1");
      await page.getByRole("textbox", { name: "搜尋內容", exact: true }).fill("does not exist");
      await page.getByText("這一天沒有符合的紀錄", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "搜尋內容", exact: true }).fill("");
      await ready(page);
      await page.locator(".sidebar-category-item").filter({ hasText: /^全部$/ }).click(); await ready(page);
      await page.locator(".calendar-presets").getByRole("button", { name: "全部時間", exact: true }).click(); await ready(page);
      await open(page);
      await page.getByRole("button", { name: "上一個月", exact: true }).click();
      await page.getByText("2026 年 9 月", { exact: true }).waitFor();
      await page.locator(".calendar-grid[aria-busy='false']").waitFor();
      await page.getByText("這個月還沒有紀錄", { exact: true }).waitFor();
      await screenshot(page, `empty-month-${width}-${textScale}`);
      await page.locator("[data-date='2026-09-30']").focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-date") === "2026-10-01");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".calendar-trigger").evaluate(el => el === document.activeElement), true);
      await open(page);
      await page.evaluate(() => { window.__CLIPBOARD_TEST__.fail(["list_clipboard_days"]); window.__CLIPBOARD_TEST__.emit(); });
      await page.getByText("無法讀取日期", { exact: true }).waitFor();
      await screenshot(page, `error-month-${width}-${textScale}`);
      await page.evaluate(() => window.__CLIPBOARD_TEST__.fail([]));
      await page.getByRole("button", { name: "重試", exact: true }).click();
      await page.getByText("3 天有紀錄 · 共 262 筆", { exact: false }).waitFor();
      await page.evaluate(() => { window.__CLIPBOARD_TEST__.state.history = []; window.__CLIPBOARD_TEST__.emit(); });
      await page.getByText("這個月還沒有紀錄", { exact: true }).waitFor();
      assert.equal(await page.locator(".calendar-day.has-activity").count(), 0);
      if (width === 1180 && textScale === 120) {
        await page.keyboard.press("Escape");
        await page.clock.setFixedTime(new Date("2026-10-05T00:00:01+08:00"));
        await page.locator(".calendar-presets").getByRole("button", { name: "今天", exact: true }).click();
        await ready(page);
        assert.equal(await page.locator(".calendar-trigger").innerText(), "2026 / 10 / 05", "Today uses the current date after midnight");
      }
      await context.close();
      console.log(`PASS calendar ${width} / ${textScale}%: dates, categories, counts, keyboard, empty, error, retry, live refresh`);
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
