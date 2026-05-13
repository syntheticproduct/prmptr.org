// Walk through the Tauri-gated UI by stubbing __TAURI_INTERNALS__ on the
// page. The app only checks `"__TAURI_INTERNALS__" in window`, so a stub
// flips on all the menus + the view/frontmatter toggles.
//
// We mock window.__TAURI_INTERNALS__.invoke for the Rust commands the page
// exercises during these tests:
//   - take_initial_path → null (no CLI file)
//   - list_dir → []          (folder pane shows "empty folder")
//   - read_prompt_file, list_cowork_sessions → reject (not under test here)

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

// Stub Tauri BEFORE the app's JS runs.
await ctx.addInitScript(() => {
  const handlers = {
    take_initial_path: () => null,
    list_dir: () => [],
    list_cowork_sessions: () => ({
      sessions: [],
      pinnedOrder: [],
      pinnedOrderWarning: null,
    }),
  };
  window.__TAURI_INTERNALS__ = {
    invoke(cmd, _args) {
      const h = handlers[cmd];
      if (h) return Promise.resolve(h());
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

await test("File menu is now visible", async () => {
  const fileBtn = topHeader.locator("button", { hasText: /^File ▾$/ });
  await assert.equal(await fileBtn.count(), 1, "File menu should render under Tauri");
});

await test("Tools menu is now visible", async () => {
  const toolsBtn = topHeader.locator("button", { hasText: /^Tools ▾$/ });
  await assert.equal(await toolsBtn.count(), 1);
});

await test("View-mode toggle is visible and opens", async () => {
  // The current label is "Folder view" because dev defaults set it that way.
  const vmBtn = topHeader.locator("button", { hasText: /view ▾$/i });
  await vmBtn.first().click();
  await page.waitForTimeout(50);
  await assert.ok(
    await page.locator('[role="menuitemradio"]', { hasText: "Single view" }).isVisible(),
  );
  await page.keyboard.press("Escape");
});

await test("Switching view mode to Single hides the FolderTreePane", async () => {
  const vmBtn = topHeader.locator("button", { hasText: /view ▾$/i });
  await vmBtn.first().click();
  await page.locator('[role="menuitemradio"]', { hasText: "Single view" }).click();
  await page.waitForTimeout(100);
  // FolderTreePane root contains a header with "No folder" or the basename.
  // Easier signal: its <aside> element. After switching, the aside should be gone.
  await assert.equal(await page.locator("aside").count(), 0, "FolderTreePane should be gone");
});

await test("Frontmatter mode toggle opens and is clickable", async () => {
  const fmBtn = topHeader.locator("button", { hasText: /(Hide frontmatter|Code block|Properties panel) ▾$/ });
  await assert.equal(await fmBtn.count(), 1);
  await fmBtn.click();
  await page.waitForTimeout(50);
  await assert.ok(
    await page.locator('[role="menuitemradio"]', { hasText: "Code block" }).isVisible(),
  );
  await page.keyboard.press("Escape");
});

// ─── Frontmatter feature deep test ────────────────────────────────────────
// Type a YAML block at the top of the editor and verify the panel reacts
// correctly to each of the three modes.
await test("loading a doc with frontmatter via drag-drop shows the panel in 'code' mode", async () => {
  // First switch frontmatter mode to "code"
  const fmBtn = topHeader.locator("button", { hasText: /(Hide frontmatter|Code block|Properties panel) ▾$/ });
  await fmBtn.click();
  await page.locator('[role="menuitemradio"]', { hasText: "Code block" }).click();
  await page.waitForTimeout(50);

  // Drop a file with frontmatter into the editor host. Use HTML5 DataTransfer.
  const content = "---\ntitle: Drop Test\nversion: 4\n---\n\n# Body heading\n\nHello from drop.\n";
  await page.evaluate(async (txt) => {
    const file = new File([txt], "dropped.md", { type: "text/markdown" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const host = document.querySelector(".prmptr-editor-host");
    if (!host) throw new Error("no editor host");
    host.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }));
    host.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
    host.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  }, content);
  await page.waitForTimeout(400);

  // Editor body should contain "Body heading" (no frontmatter).
  const prose = await page.locator(".ProseMirror").first().innerHTML();
  assert.ok(prose.includes("Body heading"), `editor body missing — got: ${prose.slice(0, 200)}`);
  // The code-mode panel renders a <pre> above the editor that contains the YAML.
  const codePanel = await page.locator(".prmptr-editor-host pre").first();
  const panelText = await codePanel.textContent();
  assert.ok(
    panelText?.includes("title: Drop Test") && panelText?.includes("version: 4"),
    `code-mode panel missing YAML — got: ${panelText}`,
  );
});

await test("switching to 'properties' renders key/value rows", async () => {
  const fmBtn = topHeader.locator("button", { hasText: /(Hide frontmatter|Code block|Properties panel) ▾$/ });
  await fmBtn.click();
  await page.locator('[role="menuitemradio"]', { hasText: "Properties panel" }).click();
  await page.waitForTimeout(150);
  // Each property row has the uppercase key label, e.g. "TITLE", "VERSION".
  const bodyText = await page.locator(".prmptr-editor-host").first().textContent();
  assert.ok(bodyText?.includes("title"), `properties panel missing title key`);
  assert.ok(bodyText?.includes("Drop Test"), `properties panel missing title value`);
  assert.ok(bodyText?.includes("version"), `properties panel missing version key`);
});

await test("switching to 'hide' removes the panel entirely", async () => {
  const fmBtn = topHeader.locator("button", { hasText: /(Hide frontmatter|Code block|Properties panel) ▾$/ });
  await fmBtn.click();
  await page.locator('[role="menuitemradio"]', { hasText: "Hide frontmatter" }).click();
  await page.waitForTimeout(100);
  const preCount = await page.locator(".prmptr-editor-host > pre").count();
  assert.equal(preCount, 0, "expected no panel pre under host");
});

await test("frontmatter mode persists across reloads via localStorage", async () => {
  // Set to 'code', reload, expect the button to show "Code block".
  const fmBtn = topHeader.locator("button", { hasText: /(Hide frontmatter|Code block|Properties panel) ▾$/ });
  await fmBtn.click();
  await page.locator('[role="menuitemradio"]', { hasText: "Code block" }).click();
  await page.waitForTimeout(50);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".ProseMirror");
  const label = await topHeader
    .locator("button", { hasText: /(Hide frontmatter|Code block|Properties panel) ▾$/ })
    .textContent();
  assert.ok(label?.includes("Code block"), `expected Code block to persist, got: ${label}`);
});

await test("no pageerror surfaced during the gated walkthrough", () => {
  const errs = consoleLines.filter(
    (l) => l.startsWith("[pageerror]") || l.startsWith("[error]"),
  );
  // The cowork-window-listen, etc. might emit warnings — ignore those, fail on real errors.
  const real = errs.filter((e) => !e.includes("currentWindow"));
  assert.equal(real.length, 0, `console errors:\n${real.join("\n")}`);
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.error}`);
  process.exit(1);
}
