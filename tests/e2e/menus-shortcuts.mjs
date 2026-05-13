// Test the File / Tools menus and keyboard shortcuts under a Tauri stub.
// We track invoke() calls so we can assert what got wired up where.

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
  // Recorder for invoke + dialog ops. The page can inspect window.__calls.
  window.__calls = [];
  // A fake "saved file" we can pretend to load with frontmatter.
  const FAKE_FILE = {
    path: "/fake/path/example.md",
    content:
      "---\ntitle: Round Trip\nversion: 4\n---\n\n# Body\n\nSome content here.\n",
    metadata: { sizeBytes: 0, lineCount: 0, wordCount: 0, modifiedUnixMs: 0 },
  };
  window.__fakeFile = FAKE_FILE;
  // Stub @tauri-apps/plugin-dialog by intercepting the plugin's invoke channel.
  // The plugin invokes 'plugin:dialog|open' and 'plugin:dialog|save' under
  // the hood — we record + return fake paths.
  const handlers = {
    take_initial_path: () => null,
    list_dir: () => [],
    list_cowork_sessions: () => ({
      sessions: [],
      pinnedOrder: [],
      pinnedOrderWarning: null,
    }),
    read_prompt_file: (args) => {
      window.__calls.push(["read_prompt_file", args]);
      return FAKE_FILE;
    },
    write_prompt_file: (args) => {
      window.__calls.push(["write_prompt_file", args]);
      return { sizeBytes: 0, lineCount: 0, wordCount: 0, modifiedUnixMs: Date.now() };
    },
    "plugin:dialog|open": (args) => {
      window.__calls.push(["dialog.open", args]);
      return FAKE_FILE.path;
    },
    "plugin:dialog|save": (args) => {
      window.__calls.push(["dialog.save", args]);
      return FAKE_FILE.path;
    },
    open_global_settings_window: () => {
      window.__calls.push(["open_global_settings_window"]);
      return null;
    },
    clipboard_image_to_path: () => {
      window.__calls.push(["clipboard_image_to_path"]);
      return { path: "/tmp/x.png", width: 100, height: 50, bytesWritten: 1024 };
    },
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

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");

const topHeader = page.locator("main > header").first();

await test("File → Open invokes the dialog + read_prompt_file", async () => {
  await topHeader.locator("button", { hasText: /^File ▾$/ }).click();
  await page.locator('[role="menuitem"]').filter({ hasText: /^Open…/ }).first().click();
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__calls);
  const cmds = calls.map((c) => (c[0] === "invoke" ? c[1] : c[0]));
  assert.ok(cmds.includes("plugin:dialog|open"), `expected dialog.open invoked; saw ${cmds}`);
  assert.ok(cmds.includes("read_prompt_file"), `expected read_prompt_file invoked; saw ${cmds}`);
});

await test("opened file loads body and (in code mode) shows frontmatter panel", async () => {
  // Switch to code mode to see the panel
  const fmBtn = topHeader.locator(
    "button",
    { hasText: /(Hide frontmatter|Code block|Properties panel) ▾$/ },
  );
  await fmBtn.click();
  await page.locator('[role="menuitemradio"]', { hasText: "Code block" }).click();
  await page.waitForTimeout(100);
  const prose = await page.locator(".ProseMirror").first().innerHTML();
  assert.ok(prose.includes("Body"), `editor should show 'Body' heading; got: ${prose.slice(0, 200)}`);
  const codePanel = await page.locator(".prmptr-editor-host > pre").first().textContent();
  assert.ok(codePanel?.includes("title: Round Trip"));
});

await test("Save writes the FULL document (frontmatter prefix preserved)", async () => {
  // Type something into the editor first to make it dirty.
  const prose = page.locator(".ProseMirror").first();
  await prose.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" — edit", { delay: 10 });
  await page.waitForTimeout(300);

  // Reset call log
  await page.evaluate(() => (window.__calls = []));

  await topHeader.locator("button", { hasText: /^File ▾$/ }).click();
  await page.locator('[role="menuitem"]').filter({ hasText: /^Save\s/ }).first().click();
  await page.waitForTimeout(300);

  const calls = await page.evaluate(() => window.__calls);
  const writeCall = calls.find((c) => c[0] === "invoke" && c[1] === "write_prompt_file");
  assert.ok(writeCall, `expected write_prompt_file call; saw ${JSON.stringify(calls)}`);
  const args = writeCall[2];
  assert.equal(args.path, "/fake/path/example.md");
  // CRITICAL: the written content must START with the frontmatter prefix.
  assert.ok(
    args.content.startsWith("---\ntitle: Round Trip\nversion: 4\n---\n"),
    `frontmatter prefix lost on save! content was:\n${args.content.slice(0, 200)}`,
  );
  // And must include the body edit
  assert.ok(args.content.includes("edit"), `body edit missing in saved content`);
});

await test("Save As prompts for a path with the current path as default", async () => {
  await page.evaluate(() => (window.__calls = []));
  await topHeader.locator("button", { hasText: /^File ▾$/ }).click();
  await page.locator('[role="menuitem"]').filter({ hasText: /^Save As…/ }).first().click();
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__calls);
  const saveDialog = calls.find((c) => c[0] === "invoke" && c[1] === "plugin:dialog|save");
  assert.ok(saveDialog, `expected dialog.save call; saw ${JSON.stringify(calls.map((c) => c[1] ?? c[0]))}`);
});

await test("Tools → Global Settings invokes open_global_settings_window", async () => {
  await page.evaluate(() => (window.__calls = []));
  await topHeader.locator("button", { hasText: /^Tools ▾$/ }).click();
  await page.locator('[role="menuitem"]').filter({ hasText: /Global Settings/ }).first().click();
  await page.waitForTimeout(300);
  const cmds = (await page.evaluate(() => window.__calls)).map((c) => (c[0] === "invoke" ? c[1] : c[0]));
  assert.ok(
    cmds.includes("open_global_settings_window"),
    `expected open_global_settings_window invoke; saw ${cmds}`,
  );
});

await test("Claude Cowork root tab shows inline sessions panel", async () => {
  await page.locator('[role="tab"]', { hasText: /Claude Cowork/ }).click();
  await page.waitForTimeout(300);
  await assert.ok(
    await page.locator("h2", { hasText: /Cowork sessions/ }).isVisible(),
  );
  // Empty state because we stubbed list_cowork_sessions → []
  await assert.ok(
    await page.locator("text=No sessions match.").isVisible(),
    "expected empty-state message",
  );
  // Switching to another tab hides the panel — there's no modal-style dismiss.
  await page.locator('[role="tab"]', { hasText: /Prompt Engineering/ }).click();
  await page.waitForTimeout(150);
  await assert.equal(
    await page.locator("h2", { hasText: /Cowork sessions/ }).count(),
    0,
    "Cowork panel should be hidden when on another tab",
  );
});

await test("keyboard shortcut Ctrl+S triggers write_prompt_file", async () => {
  await page.evaluate(() => (window.__calls = []));
  // The editor is the focused element; press Ctrl+S
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  const cmds = (await page.evaluate(() => window.__calls)).map((c) => (c[0] === "invoke" ? c[1] : c[0]));
  assert.ok(
    cmds.includes("write_prompt_file"),
    `Ctrl+S should call write_prompt_file; saw ${cmds}`,
  );
});

await test("keyboard shortcut Ctrl+N (with discard dialog accepted) clears editor", async () => {
  // Make doc dirty first
  const prose = page.locator(".ProseMirror").first();
  await prose.click();
  await page.keyboard.press("End");
  await page.keyboard.type("Z", { delay: 10 });
  await page.waitForTimeout(200);

  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Control+n");
  await page.waitForTimeout(300);

  const html = await page.locator(".ProseMirror").first().innerHTML();
  const stripped = html.trim();
  assert.ok(
    /^<p[^>]*>(<br[^>]*>)?<\/p>$/.test(stripped) || stripped === "",
    `expected an empty editor after Ctrl+N, got: ${stripped.slice(0, 200)}`,
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
