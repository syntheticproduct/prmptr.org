// Suspect: in CoworkSessions.tsx the <tr onClick> calls both onSelect AND
// onClose unconditionally — but onSelect's confirmDiscard may bail. If the
// user clicks Cancel on the "discard unsaved?" prompt, the modal still
// closes and the user has to reopen it. That's a usability bug worth
// catching.

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

await test("setup: single view + dirty doc + open Cowork modal", async () => {
  await topHeader.locator("button", { hasText: /view ▾$/i }).click();
  await page.locator('[role="menuitemradio"]', { hasText: "Single view" }).click();
  await page.waitForTimeout(150);
  // make dirty
  const prose = page.locator(".ProseMirror").first();
  await prose.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" DIRTY", { delay: 10 });
  await page.waitForTimeout(300);
  // Open Cowork modal
  await topHeader.locator("button", { hasText: /^Tools ▾$/ }).click();
  await page.locator('[role="menuitem"]').filter({ hasText: /^Claude Cowork/ }).first().hover();
  await page.waitForTimeout(100);
  await page.locator('[role="menuitem"]').filter({ hasText: /Browse sessions/ }).first().click();
  await page.waitForTimeout(400);
  await assert.ok(await page.locator("h2", { hasText: /Cowork sessions/ }).isVisible());
});

await test("Cancel on discard prompt should KEEP the cowork modal open", async () => {
  // window.confirm returns false (user clicked Cancel)
  await page.evaluate(() => (window.__confirmAnswer = false));
  await page.locator("tbody tr", { hasText: "Session A" }).first().click();
  await page.waitForTimeout(400);
  const stillOpen = await page.locator("h2", { hasText: /Cowork sessions/ }).count();
  assert.equal(
    stillOpen,
    1,
    "expected modal to stay open when user cancels discard, but onClose() runs unconditionally",
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
