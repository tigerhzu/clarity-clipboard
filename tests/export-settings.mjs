import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { createFixture, installTauriFixture } from "./fixtures.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
try {
  for (const viewport of [{ width: 1180, height: 760 }, { width: 900, height: 600 }]) {
    for (const textScale of [100, 120, 150]) {
      const context = await browser.newContext({ viewport, locale: "zh-TW" });
      const fixture = createFixture({ textScale }); fixture.delayCommands = { export_clipboard_csv: 600 };
      await context.addInitScript(installTauriFixture, { fixture });
      const page = await context.newPage();
      await page.goto(process.env.UI_SMOKE_URL || "http://127.0.0.1:1420", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByRole("button", { name: /^設定/ }).click();
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()), '#08090d');
      await page.getByLabel(/介面配色/).selectOption('light');
      const startup = page.getByRole("switch", { name: /登入 Windows 時自動啟動/ });
      assert.equal(await startup.isChecked(), true);
      await startup.uncheck();
      await page.getByRole("button", { name: "儲存設定", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => window.__CLIPBOARD_TEST__.state.settings.launchAtLogin), false);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()), '#edf3fa');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole("button", { name: /^設定/ }).click();
      assert.equal(await page.getByLabel(/介面配色/).inputValue(), 'light');
      await page.getByLabel(/介面配色/).selectOption('dark');
      await page.getByRole('button', { name: '關閉設定' }).click();
      await page.getByRole('button', { name: '捨棄變更', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.colorTheme), 'light', 'Cancel must preserve theme');
      await page.getByRole("button", { name: /^設定/ }).click();
      await page.getByLabel(/介面配色/).selectOption('dark');
      await page.getByRole('button', { name: '儲存設定', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()), '#08090d');
      await page.getByRole("button", { name: /^設定/ }).click();
      await page.getByRole("tab", { name: "匯出", exact: true }).click();
      await page.getByLabel("開始日期", { exact: true }).fill("2026-11-01");
      await page.getByLabel("結束日期", { exact: true }).fill("2026-11-02");
      await page.getByLabel("匯出範圍").selectOption("all");
      assert.equal(await page.getByLabel("工作表分組").count(), 0);
      await page.getByText(/第一頁「日期總覽」可篩選當天所有類型/).waitFor();
      await page.getByLabel("分類篩選（選填）").fill("IMAGE");
      await page.getByRole("button", { name: "匯出彩色 Excel", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "關閉設定" }).isDisabled(), true);
      await page.getByLabel("匯出 Excel 路徑").waitFor();
      const call = await page.evaluate(() => window.__CLIPBOARD_TEST__.state.calls.find((call) => call.command === "export_clipboard_csv"));
      assert.deepEqual(call.args.options, { startDate: "2026-11-01", endDate: "2026-11-02", storage: "all", tag: "IMAGE", outputDirectory: "C:\\Reports" });
      await page.getByText("有 1 個匯出警告").click();
      await page.locator(".cc-settings-body").evaluate((el) => { el.scrollTop = 0; });
      assert.equal(await page.locator(".cc-settings-fields").evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
      const bounds = await page.getByRole("dialog").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
      await page.evaluate(() => window.__CLIPBOARD_TEST__.fail(["export_clipboard_csv"]));
      await page.getByRole("button", { name: "匯出彩色 Excel", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "匯出失敗" }).waitFor();
      assert.equal(await page.getByLabel("開始日期", { exact: true }).inputValue(), "2026-11-01");
      await page.getByLabel("開始日期", { exact: true }).fill("2026-11-03");
      assert.equal(await page.getByRole("button", { name: "匯出彩色 Excel", exact: true }).isDisabled(), true);
      console.log(`PASS startup/export ${viewport.width} scale ${textScale}`);
      await context.close();
    }
  }
} finally { await browser.close(); }
