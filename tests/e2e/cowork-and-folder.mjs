// Test the Claude Cowork root tab (inline CoworkSessions panel) and the
// FolderTreePane with realistic stubbed data.
//
// Why: these flows are the most user-visible and most likely to harbor
// regressions after the four-tab shell refactor.

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
  // Realistic fake cowork listing.
  const mkSession = (overrides) => ({
    sessionId: "local_" + Math.random().toString(36).slice(2, 10),
    title: "Untitled",
    createdAt: Date.now() - 86400000,
    lastActivityAt: Date.now() - 3600000,
    model: "claude-sonnet-4-6",
    isStarred: false,
    isArchived: false,
    cwd: "/home/user/project",
    initialMessage: "Hello world",
    sourcePath: "/fake/source.json",
    ...overrides,
  });
  const SESSIONS = [
    mkSession({
      sessionId: "local_pin1",
      title: "Pinned alpha",
      isStarred: true,
      lastActivityAt: Date.now() - 7200000,
    }),
    mkSession({
      sessionId: "local_pin2",
      title: "Pinned beta",
      isStarred: true,
      lastActivityAt: Date.now() - 10000000,
    }),
    mkSession({
      sessionId: "local_recent1",
      title: "Active recent",
      lastActivityAt: Date.now() - 1000,
    }),
    mkSession({
      sessionId: "local_recent2",
      title: "Old recent",
      lastActivityAt: Date.now() - 200000000,
    }),
    mkSession({
      sessionId: "local_arch",
      title: "Hidden archive",
      isArchived: true,
    }),
    mkSession({
      sessionId: "local_nullmodel",
      title: "No model",
      model: null,
      lastActivityAt: null,
      createdAt: null,
    }),
  ];

  const FOLDER_ROOT = "/fake/folder/root";
  const FOLDER_TREE = {
    "/fake/folder/root": [
      { name: "alpha.md", path: "/fake/folder/root/alpha.md", isDir: false, isHidden: false },
      { name: "subdir", path: "/fake/folder/root/subdir", isDir: true, isHidden: false },
      { name: ".hidden.md", path: "/fake/folder/root/.hidden.md", isDir: false, isHidden: true },
    ],
    "/fake/folder/root/subdir": [
      { name: "nested.md", path: "/fake/folder/root/subdir/nested.md", isDir: false, isHidden: false },
    ],
  };

  const handlers = {
    take_initial_path: () => null,
    list_dir: (args) => FOLDER_TREE[args.path] ?? [],
    list_cowork_sessions: () => ({
      sessions: SESSIONS,
      // Claude Desktop's manual pin order: pin2 first, then pin1
      pinnedOrder: ["local_pin2", "local_pin1"],
      pinnedOrderWarning: null,
    }),
    read_prompt_file: (args) => ({
      path: args.path,
      content: "# " + args.path + "\n\nfake body\n",
      metadata: { sizeBytes: 0, lineCount: 0, wordCount: 0, modifiedUnixMs: 0 },
    }),
    set_cowork_archived: (args) => {
      window.__calls.push(["set_cowork_archived", args]);
      return { updated: args.paths.length, failed: [] };
    },
    "plugin:dialog|open": () => FOLDER_ROOT,
  };
  window.__TAURI_INTERNALS__ = {
    invoke(cmd, args) {
      window.__calls.push(["invoke", cmd, args]);
      const h = handlers[cmd];
      if (h) return Promise.resolve(h(args));
      return Promise.reject(new Error(`unstubbed invoke: ${cmd}`));
    },
    transformCallback: (cb) => cb,
    metadata: { currentWindow: { label: "main" } },
  };
});

const page = await ctx.newPage();
const consoleLines = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));
// Auto-accept every confirm() dialog that fires during this walkthrough.
// Replaces ad-hoc `page.once("dialog", ...)` calls — if a dialog handler is
// registered but the dialog doesn't fire that turn, it persists and clashes
// with the next handler.
page.on("dialog", (d) => d.accept());

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");

const topHeader = page.locator("main > header").first();

// Switch to single view first so the folder pane doesn't interfere.
await test("setup: switch to Single view", async () => {
  await topHeader.locator("button", { hasText: /view ▾$/i }).click();
  await page.locator('[role="menuitemradio"]', { hasText: "Single view" }).click();
  await page.waitForTimeout(150);
});

// ─── Cowork tab ───────────────────────────────────────────────────────────
const openCowork = async () => {
  await page.locator('[role="tab"]', { hasText: /Claude Cowork/ }).click();
  await page.waitForTimeout(400);
};

await test("Cowork tab lists all non-archived sessions", async () => {
  await openCowork();
  // Header counts: by default show archived is off, starred-only is off.
  // 6 total, 1 archived → 5 shown.
  const counter = await page.locator("text=/\\d+\\/\\d+ shown/").textContent();
  assert.ok(counter?.startsWith("5/6 shown"), `counter was: ${counter}`);
});

await test("Cowork tab honors Claude Desktop's pinnedOrder", async () => {
  // The pinned section should have pin2 BEFORE pin1 because pinnedOrder = [pin2, pin1].
  const rows = await page.locator("tbody tr").allTextContents();
  const idxPin2 = rows.findIndex((t) => t.includes("Pinned beta"));
  const idxPin1 = rows.findIndex((t) => t.includes("Pinned alpha"));
  assert.ok(idxPin2 >= 0 && idxPin1 >= 0, "both pins should render");
  assert.ok(idxPin2 < idxPin1, `pinnedOrder ignored: pin2 idx=${idxPin2}, pin1 idx=${idxPin1}`);
});

await test("Cowork filter narrows by title substring", async () => {
  const input = page.locator('input[placeholder*="Search title"]');
  await input.fill("recent");
  await page.waitForTimeout(150);
  const counter = await page.locator("text=/\\d+\\/\\d+ shown/").textContent();
  assert.ok(counter?.startsWith("2/6 shown"), `expected 2/6 with filter='recent', got: ${counter}`);
});

await test("'★ only' filter shows only starred sessions", async () => {
  await page.locator('input[placeholder*="Search title"]').fill("");
  await page.locator("label").filter({ hasText: "★ only" }).click();
  await page.waitForTimeout(150);
  const counter = await page.locator("text=/\\d+\\/\\d+ shown/").textContent();
  assert.ok(counter?.startsWith("2/6 shown"), `expected 2/6 starred, got: ${counter}`);
});

await test("'show archived' toggles archived session visibility", async () => {
  await page.locator("label").filter({ hasText: "★ only" }).click(); // turn star off
  await page.locator("label").filter({ hasText: "show archived" }).click();
  await page.waitForTimeout(150);
  const counter = await page.locator("text=/\\d+\\/\\d+ shown/").textContent();
  assert.ok(counter?.startsWith("6/6 shown"), `expected 6/6 with archived, got: ${counter}`);
});

await test("clicking a row jumps to Prompt Engineering tab and loads its summary", async () => {
  await page.locator("tbody tr", { hasText: "Active recent" }).first().click();
  await page.waitForTimeout(400);

  // Cowork panel should be hidden because we switched to the PE tab.
  assert.equal(
    await page.locator("h2", { hasText: /Cowork sessions/ }).count(),
    0,
    "Cowork panel should be hidden after PE switch",
  );
  // Active tab should be Prompt Engineering.
  const peTab = page.locator('[role="tab"]', { hasText: /Prompt Engineering/ });
  await assert.equal(await peTab.getAttribute("aria-selected"), "true");
  // Editor should now show the cowork summary template — "# Active recent"
  const prose = await page.locator(".ProseMirror").first().innerHTML();
  assert.ok(
    prose.includes("Active recent"),
    `editor body missing session title; got: ${prose.slice(0, 300)}`,
  );
  assert.ok(
    prose.includes("Initial prompt"),
    `editor body missing 'Initial prompt' section`,
  );
});

// ─── Folder pane ──────────────────────────────────────────────────────────
await test("switch to Folder view, then open root via pane button", async () => {
  await topHeader.locator("button", { hasText: /view ▾$/i }).click();
  await page.locator('[role="menuitemradio"]', { hasText: "Folder view" }).click();
  await page.waitForTimeout(200);
  // FolderTreePane shows "Open folder…" when no root is set yet — but the
  // dev-default folder root may have prepopulated it. Either way, the pane
  // must render.
  await assert.ok(await page.locator("aside").count() > 0, "FolderTreePane should render");
});

await test("Folder pane renders cached children", async () => {
  // Give the pane time to call list_dir on the dev default root.
  await page.waitForTimeout(400);
  // Our stub returns FOLDER_TREE entries for "/fake/folder/root".
  // The pane was started against DEV_DEFAULT_FOLDER_ROOT (the dev hardcoded
  // path, NOT /fake/folder/root). Our stub falls back to [] for that path.
  // Click "Open folder…" to switch the root to FOLDER_ROOT.
  const openBtn = page.locator("aside").locator('[aria-label="Open folder"]');
  await openBtn.click();
  await page.waitForTimeout(400);
  // Now we should see "alpha.md" and "subdir"
  await assert.ok(
    await page.locator("aside").locator("text=alpha.md").count() > 0,
    "alpha.md should render in tree",
  );
  await assert.ok(
    await page.locator("aside").locator("text=subdir").count() > 0,
    "subdir should render in tree",
  );
  // .hidden.md is hidden by default
  await assert.equal(
    await page.locator("aside").locator("text=.hidden.md").count(),
    0,
    ".hidden.md should be hidden by default",
  );
});

await test("Folder pane: toggling 'Show hidden files' reveals dotfiles", async () => {
  await page.locator("aside").locator('[aria-label*="hidden files"]').click();
  await page.waitForTimeout(100);
  await assert.ok(
    await page.locator("aside").locator("text=.hidden.md").count() > 0,
    ".hidden.md should appear after toggle",
  );
});

await test("Folder pane: expanding 'subdir' shows nested.md", async () => {
  await page.locator("aside").locator("button", { hasText: "subdir" }).click();
  await page.waitForTimeout(300);
  await assert.ok(
    await page.locator("aside").locator("text=nested.md").count() > 0,
    "nested.md should render under expanded subdir",
  );
});

await test("Folder pane: clicking a file invokes read_prompt_file", async () => {
  await page.evaluate(() => (window.__calls = []));
  await page.locator("aside").locator("button", { hasText: "alpha.md" }).click();
  await page.waitForTimeout(400);
  const cmds = (await page.evaluate(() => window.__calls)).map((c) => (c[0] === "invoke" ? c[1] : c[0]));
  assert.ok(cmds.includes("read_prompt_file"), `expected read_prompt_file; saw ${cmds}`);
});

await test("Folder pane: filter narrows the visible tree", async () => {
  const filter = page.locator("aside").locator('input[placeholder="Filter…"]');
  await filter.fill("alpha");
  await page.waitForTimeout(150);
  // alpha.md should still render, but subdir should be filtered out.
  await assert.ok(
    await page.locator("aside").locator("text=alpha.md").count() > 0,
    "alpha.md should match filter",
  );
  await assert.equal(
    await page.locator("aside").locator("text=subdir").count(),
    0,
    "subdir should be filtered out",
  );
});

await test("no pageerror surfaced during cowork/folder walkthrough", () => {
  const errs = consoleLines.filter((l) => l.startsWith("[pageerror]") || l.startsWith("[error]"));
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
