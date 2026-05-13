// Verify the "unsaved changes" confirm() fires on EVERY path that replaces
// the editor contents:
//   1. File → Open                  → expected: confirms
//   2. Tools → Cowork → row click   → expected: confirms (handleCoworkSelect)
//   3. FolderTreePane file click    → expected: ??? (loadFromPath has no guard)
//   4. Drag-drop a file             → expected: confirms (loadFromDroppedFile)
//   5. File → New                   → expected: confirms (handleNew)
//   6. Ctrl+N                       → expected: confirms

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
  window.__confirms = []; // track every confirm() that fires
  const _origConfirm = window.confirm;
  window.confirm = (msg) => {
    window.__confirms.push(msg);
    return true; // always accept so flows complete
  };
  const FOLDER_ROOT = "/fake/root";
  const TREE = {
    "/fake/root": [
      { name: "a.md", path: "/fake/root/a.md", isDir: false, isHidden: false },
      { name: "b.md", path: "/fake/root/b.md", isDir: false, isHidden: false },
    ],
  };
  const handlers = {
    take_initial_path: () => null,
    list_dir: (a) => TREE[a.path] ?? [],
    list_cowork_sessions: () => ({
      sessions: [
        {
          sessionId: "id1",
          title: "Session A",
          createdAt: 0, lastActivityAt: 0,
          model: "m", isStarred: false, isArchived: false,
          cwd: "/x", initialMessage: "hi", sourcePath: "/x.json",
        },
      ],
      pinnedOrder: [],
      pinnedOrderWarning: null,
    }),
    read_prompt_file: (a) => ({
      path: a.path,
      content: "# Loaded " + a.path + "\n\nbody\n",
      metadata: { sizeBytes: 0, lineCount: 0, wordCount: 0, modifiedUnixMs: 0 },
    }),
    "plugin:dialog|open": (args) =>
      args?.options?.directory ? FOLDER_ROOT : "/fake/root/a.md",
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
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
const topHeader = page.locator("main > header").first();

const makeDirty = async () => {
  await page.evaluate(() => (window.__confirms = []));
  const prose = page.locator(".ProseMirror").first();
  await prose.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" dirty", { delay: 10 });
  await page.waitForTimeout(300);
};

// ── 1. File → Open ────────────────────────────────────────────────────
await test("File → Open prompts to discard when dirty", async () => {
  // Open the folder pane root once so the tree can later be exercised.
  await topHeader.locator("button", { hasText: /view ▾$/i }).click();
  await page.locator('[role="menuitemradio"]', { hasText: "Folder view" }).click();
  await page.waitForTimeout(150);
  const openFolderBtn = page.locator("aside").locator('[aria-label="Open folder"]');
  await openFolderBtn.click();
  await page.waitForTimeout(300);

  // Now do the test
  await makeDirty();
  await topHeader.locator("button", { hasText: /^File ▾$/ }).click();
  await page.locator('[role="menuitem"]').filter({ hasText: /^Open…/ }).first().click();
  await page.waitForTimeout(400);
  const confirms = await page.evaluate(() => window.__confirms);
  assert.ok(confirms.length >= 1, `expected confirm() before Open, got ${confirms.length}`);
  assert.match(confirms[0], /unsaved/i);
});

// ── 2. Cowork session row click ───────────────────────────────────────
await test("Cowork session click prompts to discard when dirty", async () => {
  await makeDirty();
  // Open cowork
  await topHeader.locator("button", { hasText: /^Tools ▾$/ }).click();
  await page.locator('[role="menuitem"]').filter({ hasText: /^Claude Cowork/ }).first().hover();
  await page.waitForTimeout(100);
  await page.locator('[role="menuitem"]').filter({ hasText: /Browse sessions/ }).first().click();
  await page.waitForTimeout(400);
  await page.evaluate(() => (window.__confirms = []));
  await page.locator("tbody tr", { hasText: "Session A" }).first().click();
  await page.waitForTimeout(400);
  const confirms = await page.evaluate(() => window.__confirms);
  assert.ok(confirms.length >= 1, `expected confirm() before cowork load, got ${confirms.length}`);
});

// ── 3. FolderTreePane file click ──────────────────────────────────────
await test("FolderTreePane file click prompts to discard when dirty", async () => {
  // Ensure folder pane is still open + populated; re-open root if needed.
  const asideCount = await page.locator("aside").count();
  if (asideCount === 0) {
    await topHeader.locator("button", { hasText: /view ▾$/i }).click();
    await page.locator('[role="menuitemradio"]', { hasText: "Folder view" }).click();
    await page.waitForTimeout(150);
  }
  // Are a.md / b.md rendered? If not, re-trigger open-folder.
  let amd = await page.locator("aside").locator("button", { hasText: /a\.md/ }).count();
  if (amd === 0) {
    await page.locator("aside").locator('[aria-label="Open folder"]').click();
    await page.waitForTimeout(300);
    amd = await page.locator("aside").locator("button", { hasText: /a\.md/ }).count();
  }
  if (amd === 0) {
    // dump state to help diagnose
    const asideText = await page.locator("aside").textContent();
    throw new Error(`a.md not visible in folder pane; aside text was: ${asideText?.slice(0, 200)}`);
  }
  await makeDirty();
  await page.evaluate(() => (window.__confirms = []));
  await page.locator("aside").locator("button", { hasText: /a\.md/ }).first().click();
  await page.waitForTimeout(400);
  const confirms = await page.evaluate(() => window.__confirms);
  assert.ok(
    confirms.length >= 1,
    `EXPECTED a confirm() before clobbering dirty doc from folder pane, got NONE. ` +
      `loadFromPath in src/app/page.tsx skips confirmDiscard.`,
  );
});

// ── 4. Drag-drop a file ───────────────────────────────────────────────
await test("Drag-drop a file prompts to discard when dirty", async () => {
  await makeDirty();
  await page.evaluate(() => (window.__confirms = []));
  await page.evaluate(() => {
    const file = new File(["# Dropped\n"], "x.md", { type: "text/markdown" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const host = document.querySelector(".prmptr-editor-host");
    host.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(400);
  const confirms = await page.evaluate(() => window.__confirms);
  assert.ok(confirms.length >= 1, `expected confirm() before drop, got ${confirms.length}`);
});

// ── 5. File → New ─────────────────────────────────────────────────────
await test("File → New prompts to discard when dirty", async () => {
  await makeDirty();
  await page.evaluate(() => (window.__confirms = []));
  await topHeader.locator("button", { hasText: /^File ▾$/ }).click();
  // Menuitem text concatenates "New" + "Ctrl+N" with no whitespace separator
  // in textContent — match by leading "New" then the keycap modifier.
  await page.locator('[role="menuitem"]').filter({ hasText: /^New(Ctrl|⌘)\+N$/ }).first().click();
  await page.waitForTimeout(300);
  const confirms = await page.evaluate(() => window.__confirms);
  assert.ok(confirms.length >= 1, `expected confirm() before New, got ${confirms.length}`);
});

// ── 6. Ctrl+N ─────────────────────────────────────────────────────────
await test("Ctrl+N prompts to discard when dirty", async () => {
  await makeDirty();
  await page.evaluate(() => (window.__confirms = []));
  await page.keyboard.press("Control+n");
  await page.waitForTimeout(300);
  const confirms = await page.evaluate(() => window.__confirms);
  assert.ok(confirms.length >= 1, `expected confirm() before Ctrl+N, got ${confirms.length}`);
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
