// Invariant: when the user is on the Claude Cowork tab with unsaved edits
// and clicks a session row, the discard prompt fires. If they Cancel, we
// must stay on the Cowork tab and leave the editor untouched — no silent
// switch to Prompt Engineering with the cowork summary loaded.

import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const URL = process.env.URL ?? "http://localhost:3000";
const results = [];
const test = async (name, fn) => {
  process.stdout.write(`▸ ${name} … `);
  try { await fn(); console.log("\x1b[32mPASS\x1b[0m"); results.push({ name, ok: true }); }
  catch (e) { console.log("\x1b[31mFAIL\x1b[0m"); console.log(`  ${e.message}`); results.push({ name, ok: false, error: e.message }); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__calls = [];
  window.__confirmAnswer = false; // user clicks Cancel
  window.confirm = () => window.__confirmAnswer;
  const handlers = {
    take_initial_path: () => null,
    list_dir: () => [],
    list_cowork_sessions: () => ({
      sessions: [{
        sessionId: "s1", title: "Session A",
        createdAt: 0, lastActivityAt: 0,
        model: "m", isStarred: false, isArchived: false,
        cwd: "/x", initialMessage: "hi", sourcePath: "/x.json",
      }],
      pinnedOrder: [], pinnedOrderWarning: null,
    }),
  };
  window.__TAURI_INTERNALS__ = {
    invoke(cmd, args) {
      window.__calls.push([cmd, args]);
      const h = handlers[cmd];
      if (h) return Promise.resolve(h(args));
      return Promise.reject(new Error(`unstubbed: ${cmd}`));
    },
    transformCallback: (cb) => cb,
    metadata: { currentWindow: { label: "main" } },
  };
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
const topHeader = page.locator("main > header").first();

await test("setup: single view + dirty doc + switch to Cowork tab", async () => {
  await topHeader.locator("button", { hasText: /view ▾$/i }).click();
  await page.locator('[role="menuitemradio"]', { hasText: "Single view" }).click();
  await page.waitForTimeout(150);
  // make dirty
  const prose = page.locator(".ProseMirror").first();
  await prose.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" DIRTY", { delay: 10 });
  await page.waitForTimeout(300);
  // Switch to the Cowork tab
  await page.locator('[role="tab"]', { hasText: /Claude Cowork/ }).click();
  await page.waitForTimeout(400);
  await assert.ok(await page.locator("h2", { hasText: /Cowork sessions/ }).isVisible());
});

await test("Cancel on discard prompt should KEEP user on the Cowork tab", async () => {
  // window.confirm returns false (user clicked Cancel)
  await page.evaluate(() => (window.__confirmAnswer = false));
  await page.locator("tbody tr", { hasText: "Session A" }).first().click();
  await page.waitForTimeout(400);
  const coworkTab = page.locator('[role="tab"]', { hasText: /Claude Cowork/ });
  assert.equal(
    await coworkTab.getAttribute("aria-selected"),
    "true",
    "expected to stay on Cowork tab when user cancels discard",
  );
  // The Cowork panel should still be rendering.
  await assert.ok(
    await page.locator("h2", { hasText: /Cowork sessions/ }).isVisible(),
    "Cowork panel should still be visible",
  );
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.error}`);
  process.exit(1);
}
