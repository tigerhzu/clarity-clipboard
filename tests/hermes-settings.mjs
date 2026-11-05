import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createFixture, installTauriFixture } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const prompt = await readFile(new URL("../src-tauri/src/integration/hermes-prompt.txt", import.meta.url), "utf8");
// Textareas expose LF even when the Windows checkout uses CRLF.
const displayedPrompt = prompt.replace(/\r\n?/g, "\n");
const output = path.resolve(process.env.UI_SMOKE_OUTPUT || path.join(os.tmpdir(), "clipboard-hermes-ui"));
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const errors = [];
try {
  for (const viewport of [{ width: 1180, height: 760 }, { width: 900, height: 600 }]) {
    for (const textScale of [100, 120, 150]) {
      const context = await browser.newContext({ viewport, locale: "zh-TW" });
      const fixture = createFixture({ textScale });
      fixture.hermesInfo.prompt = prompt;
      await context.addInitScript(installTauriFixture, { fixture });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(process.env.UI_SMOKE_URL || "http://127.0.0.1:1420");
      const open = async () => {
        await page.getByRole("button", { name: /^設定/ }).click();
        await page.getByRole("tab", { name: "Hermes", exact: true }).click();
        await page.getByRole("textbox", { name: "Hermes 串接提示詞", exact: true }).waitFor();
      };
      await open();
      const toggle = page.getByRole("switch", { name: /允許 Hermes 讀寫/ });
      assert.equal(await toggle.isChecked(), false);
      const field = page.getByRole("textbox", { name: "Hermes 串接提示詞", exact: true });
      assert.equal(await field.inputValue(), displayedPrompt);
      assert.equal(await field.getAttribute("readonly"), "");
      await toggle.check();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("button", { name: "捨棄變更", exact: true }).click();
      assert.equal(await page.evaluate(() => window.__CLIPBOARD_TEST__.state.settings.hermesEnabled), false);
      await open();
      await toggle.check();
      await page.getByRole("button", { name: "儲存設定", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => window.__CLIPBOARD_TEST__.state.settings.hermesEnabled), true);
      await open();
      await page.getByRole("button", { name: "複製 Hermes 串接提示詞", exact: true }).click();
      await page.getByRole("button", { name: "已複製提示詞", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__CLIPBOARD_TEST__.state.copies.at(-1).content), prompt);
      // Failed copy retains selectable prompt and a retryable action.
      await page.evaluate(() => window.__CLIPBOARD_TEST__.fail(["copy_hermes_prompt"]));
      await page.getByRole("button", { name: /已複製提示詞|複製 Hermes 串接提示詞/ }).click();
      await page.getByRole("alert").filter({ hasText: "提示詞複製失敗" }).waitFor();
      assert.equal(await field.inputValue(), displayedPrompt);
      await page.evaluate(() => window.__CLIPBOARD_TEST__.fail([]));
      await page.getByRole("button", { name: "複製 Hermes 串接提示詞", exact: true }).click();
      await page.getByRole("button", { name: "已複製提示詞", exact: true }).waitFor();
      if (await page.locator(".action-toast").count()) await page.locator(".action-toast").waitFor({ state: "hidden" });
      await page.locator(".cc-settings-body").evaluate((el) => { el.scrollTop = 0; });
      await page.screenshot({ path: path.join(output, `hermes-${viewport.width}-${textScale}.png`) });
      const bounds = await page.getByRole("dialog").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
      const overflow = await page.locator(".cc-settings-fields").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false);
      await toggle.uncheck();
      await page.getByRole("button", { name: "儲存設定", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => window.__CLIPBOARD_TEST__.state.settings.hermesEnabled), false);
      // Actual native integration events refresh visible history/collections.
      await page.getByRole("button", { name: /常用片段/ }).first().click();
      await page.waitForFunction(() => window.__CLIPBOARD_TEST__.state.calls.some((call) => call.command === "list_personal_items"));
      const before = await page.evaluate(() => window.__CLIPBOARD_TEST__.state.calls.filter((call) => call.command === "list_personal_items").length);
      await page.evaluate(() => window.__CLIPBOARD_TEST__.emit("clarity://library-changed"));
      await page.waitForFunction((before) => window.__CLIPBOARD_TEST__.state.calls.filter((call) => call.command === "list_personal_items").length > before, before);
      console.log(`PASS Hermes settings ${viewport.width}×${viewport.height} scale ${textScale}`);
      await context.close();
    }
  }
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const fixture = createFixture(); fixture.failCommands = ["get_hermes_integration"];
  await context.addInitScript(installTauriFixture, { fixture });
  const page = await context.newPage();
  await page.goto(process.env.UI_SMOKE_URL || "http://127.0.0.1:1420");
  await page.getByRole("button", { name: /^設定/ }).click();
  await page.getByRole("tab", { name: "Hermes", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "無法讀取 Hermes" }).waitFor();
  await page.evaluate(() => window.__CLIPBOARD_TEST__.fail([]));
  await page.getByRole("button", { name: "重新讀取", exact: true }).click();
  await page.getByRole("textbox", { name: "Hermes 串接提示詞", exact: true }).waitFor();
  console.log("PASS Hermes connection info retry");
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
