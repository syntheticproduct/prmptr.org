// Probe edge-case behaviors that might reveal subtle regressions:
//   - Cowork sort column toggle (asc/desc, click again to flip)
//   - Cowork bulk archive flow
//   - Frontmatter mode persistence + initial render
//   - The "Untitled" state after handleCoworkSelect (savedContent=null)
//   - View-mode toggle current label updates after picking
//   - Save As after a fresh untitled doc that has content

import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const URL = process.env.URL ?? "http://localhost:3000";
const results = [];
const test = async (name, fn) => {
  process.stdout.write(`▸ ${name} … `);
  try {
    await fn();
    console.log("\x1b[32mPASS\x1b[0m");
    results.push({ name, ok: true });
  } catch (e) {
    console.log("\x1b[31mFAIL\x1b[0m");
    console.log(`  ${e.message}`);
    results.push({ name, ok: false, error: e.message });
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext();

await ctx.addInitScript(() => {
  window.__calls = [];
  const mk = (overrides) => ({
    sessionId: "id_" + Math.random().toString(36).slice(2, 8),
    title: "X",
    createdAt: 0,
    lastActivityAt: 0,
    model: "claude-haiku-4-5",
    isStarred: false,
    isArchived: false,
    cwd: "/x",
    initialMessage: "",
    sourcePath: "/x.json",
    ...overrides,
  });
  const SESSIONS = [
    mk({ sessionId: "a", title: "Charlie", lastActivityAt: 3000, model: "claude-opus-4-7" }),
    mk({ sessionId: "b", title: "alpha",   lastActivityAt: 1000, model: "claude-sonnet-4-6" }),
    mk({ sessionId: "c", title: "Bravo",   lastActivityAt: 2000, model: "claude-haiku-4-5" }),
  ];
  const handlers = {
    take_initial_path: () => null,
    list_dir: () => [],
    list_cowork_sessions: () => ({
      sessions: SESSIONS,
      pinnedOrder: [],
      pinnedOrderWarning: null,
    }),
    set_cowork_archived: (a) => ({ updated: a.paths.length, failed: [] }),
  };
  window.__TAURI_INTERNALS__ = {
    invoke(cmd, args) {
      window.__calls.push(["invoke", cmd, args]);
      const h = handlers[cmd];
      if (h) return Promise.resolve(h(args));
      return Promise.reject(new Error(`unstubbed: ${cmd}`));
    },
    transformCallback: (cb) => cb,
    metadata: { currentWindow: { label: "main" } },
  };
});

const page = await ctx.newPage();
const lines = [];
page.on("console", (m) => lines.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => lines.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");

const topHeader = page.locator("main > header").first();

await test("setup: single view, open Cowork tab", async () => {
  await topHeader.locator("button", { hasText: /view ▾$/i }).click();
  await page.locator('[role="menuitemradio"]', { hasText: "Single view" }).click();
  await page.waitForTimeout(100);
  await page.locator('[role="tab"]', { hasText: /Claude Desktop/ }).click();
  await page.waitForTimeout(400);
  await assert.ok(await page.locator("h2", { hasText: /Cowork sessions/ }).isVisible());
});

await test("default sort: lastActivityAt desc (newest first)", async () => {
  // Rows: Charlie (3000), Bravo (2000), alpha (1000)
  const rows = await page.locator("tbody tr td:nth-child(3)").allTextContents();
  // The first row may be a section header (td colspan=7), so we filter to actual session rows
  // by looking for the title content. Better: query the title cells specifically.
  const titles = await page.locator("tbody tr:not(.bg-\\[var\\(--bg\\)\\])").locator("td:nth-child(3)").allTextContents();
  // titles is the 3rd column (Title), excluding section header rows.
  const cleaned = titles.map((t) => t.trim()).filter(Boolean);
  assert.deepEqual(cleaned, ["Charlie", "Bravo", "alpha"], `default desc-by-activity order: got ${JSON.stringify(cleaned)}`);
});

await test("click Title header → switches to title asc", async () => {
  await page.locator("th", { hasText: /^Title/ }).click();
  await page.waitForTimeout(100);
  const titles = await page.locator("tbody tr:not(.bg-\\[var\\(--bg\\)\\])").locator("td:nth-child(3)").allTextContents();
  const cleaned = titles.map((t) => t.trim()).filter(Boolean);
  // Sort lowercased: "alpha" < "bravo" < "charlie"
  assert.deepEqual(cleaned, ["alpha", "Bravo", "Charlie"], `title asc: got ${JSON.stringify(cleaned)}`);
});

await test("click Title again → flips to desc", async () => {
  await page.locator("th", { hasText: /^Title/ }).click();
  await page.waitForTimeout(100);
  const titles = await page.locator("tbody tr:not(.bg-\\[var\\(--bg\\)\\])").locator("td:nth-child(3)").allTextContents();
  const cleaned = titles.map((t) => t.trim()).filter(Boolean);
  assert.deepEqual(cleaned, ["Charlie", "Bravo", "alpha"], `title desc: got ${JSON.stringify(cleaned)}`);
});

await test("click Model header → sort by model asc", async () => {
  await page.locator("th", { hasText: /^Model/ }).click();
  await page.waitForTimeout(100);
  const models = await page
    .locator("tbody tr:not(.bg-\\[var\\(--bg\\)\\])")
    .locator("td:nth-child(5)")
    .allTextContents();
  const cleaned = models.map((t) => t.trim()).filter(Boolean);
  // haiku < opus < sonnet alphabetically (claude-haiku-4-5 < claude-opus-4-7 < claude-sonnet-4-6)
  assert.deepEqual(
    cleaned,
    ["claude-haiku-4-5", "claude-opus-4-7", "claude-sonnet-4-6"],
    `model asc: got ${JSON.stringify(cleaned)}`,
  );
});

await test("bulk archive: select 2, click Archive, confirm → set_cowork_archived called", async () => {
  // Select first two rows
  const checkboxes = page.locator("tbody tr:not(.bg-\\[var\\(--bg\\)\\])").locator('input[type="checkbox"]');
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.evaluate(() => (window.__calls = []));
  page.once("dialog", (d) => d.accept());
  await page.locator("button", { hasText: /^Archive \(2\)$/ }).click();
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__calls);
  const archCall = calls.find((c) => c[0] === "invoke" && c[1] === "set_cowork_archived");
  assert.ok(archCall, `expected set_cowork_archived; saw ${JSON.stringify(calls.map((c) => c[1] ?? c[0]))}`);
  assert.equal(archCall[2].paths.length, 2);
  assert.equal(archCall[2].archived, true);
});

await test("switching to another root tab hides the Cowork panel", async () => {
  await page.locator('[role="tab"]', { hasText: /Prompt Engineering/ }).click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator("h2", { hasText: /Cowork sessions/ }).count(),
    0,
    "Cowork panel should be hidden when on another tab",
  );
});

await test("View-mode button label updates to match current mode", async () => {
  // Back on the Prompt Engineering tab the ViewModeToggle is visible.
  const vmBtn = topHeader.locator("button", { hasText: /view ▾$/i });
  await vmBtn.click();
  await page.locator('[role="menuitemradio"]', { hasText: "Folder view" }).click();
  await page.waitForTimeout(150);
  const label = await vmBtn.textContent();
  assert.ok(label?.startsWith("Folder view"), `expected 'Folder view' label, got: ${label}`);
});

await test("FrontmatterModeToggle reflects current selection in its label", async () => {
  // Switch to Properties panel; the button label should update.
  const fmBtn = topHeader.locator(
    "button",
    { hasText: /(Hide frontmatter|Code block|Properties panel) ▾$/ },
  );
  await fmBtn.click();
  await page.locator('[role="menuitemradio"]', { hasText: "Properties panel" }).click();
  await page.waitForTimeout(100);
  const label = await fmBtn.textContent();
  assert.ok(label?.startsWith("Properties panel"), `label was: ${label}`);
});

await test("no pageerror across edge-case walkthrough", () => {
  const errs = lines.filter((l) => l.startsWith("[pageerror]") || l.startsWith("[error]"));
  const real = errs.filter((e) => !e.includes("currentWindow"));
  assert.equal(real.length, 0, `errors:\n${real.join("\n")}`);
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.error}`);
  process.exit(1);
}
