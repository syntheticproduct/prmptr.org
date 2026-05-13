// End-to-end walkthrough of the prmptr.org Next.js shell.
// Runs against `npm run dev` on http://localhost:3000.
//
//   node tests/e2e/walkthrough.mjs
//
// Note: the app gates file ops behind isTauri() (a Tauri-only check), so in
// the browser we exercise only what's reachable: editor render, view-mode
// toggle, frontmatter toggle, drag-drop, stats footer, dirty indicator.

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
    if (e.stack) console.log(e.stack.split("\n").slice(1, 4).join("\n"));
    results.push({ name, ok: false, error: e.message });
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const consoleLines = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });

// The top toolbar and the FolderTreePane both render a <header>. Scope to
// the top-level toolbar so locators don't trip on the folder-pane chrome
// when dev defaults switch the view mode to "folder".
const topHeader = page.locator("main > header").first();
const footer = page.locator("main > footer").first();

await test("page loads with prmptr.org branding", async () => {
  const brand = await topHeader.locator("text=prmptr").first().textContent();
  assert.ok(brand?.includes("prmptr"), `brand was: ${brand}`);
});

await test("Milkdown editor mounts with SAMPLE content", async () => {
  await page.waitForSelector(".ProseMirror", { timeout: 5000 });
  const html = await page.locator(".ProseMirror").first().innerHTML();
  assert.ok(html.includes("Untitled prompt"), "expected SAMPLE title in DOM");
});

await test("typing into the editor triggers an update + dirty marker", async () => {
  const prose = page.locator(".ProseMirror").first();
  await prose.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" edited", { delay: 15 });
  await page.waitForTimeout(400);
  const headerText = await topHeader.textContent();
  assert.ok(headerText?.includes("●"), `expected dirty ● in header, got: ${headerText}`);
});

await test("character counter increases when text is added", async () => {
  // Read once, type, read again — verifies the App's stats useMemo and the
  // Milkdown listener fire end-to-end.
  const before = (await footer.textContent()) ?? "";
  const m1 = /(\d+) chars/.exec(before);
  assert.ok(m1, `couldn't read 'N chars' from footer: ${before}`);
  await page.locator(".ProseMirror").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("ABCDEFGHIJ", { delay: 15 });
  await page.waitForTimeout(400);
  const after = (await footer.textContent()) ?? "";
  const m2 = /(\d+) chars/.exec(after);
  assert.ok(m2, `couldn't read 'N chars' after typing: ${after}`);
  assert.ok(
    Number(m2[1]) > Number(m1[1]),
    `expected char count to grow: was ${m1[1]}, now ${m2[1]}`,
  );
});

await test("non-Tauri builds show 'file ops require desktop app' notice", async () => {
  // In the browser, isTauri() === false → header shows the New button + notice
  const notice = topHeader.locator("text=file ops require desktop app");
  assert.ok(await notice.isVisible(), "expected the non-Tauri notice");
});

await test("ViewModeToggle is hidden in browser (Tauri-only)", async () => {
  const single = await topHeader.locator("text=Single view").count();
  const folder = await topHeader.locator("text=Folder view").count();
  assert.equal(single + folder, 0, "view-mode toggle should be hidden in browser");
});

await test("FrontmatterModeToggle is hidden in browser (Tauri-only)", async () => {
  const hide = await topHeader.locator("text=Hide frontmatter").count();
  assert.equal(hide, 0, "frontmatter toggle should be hidden in browser");
});

await test("non-Tauri 'New' button clears the editor (after confirm)", async () => {
  page.once("dialog", (d) => d.accept());
  const newBtn = topHeader.locator("button", { hasText: /^New$/ });
  await newBtn.click();
  await page.waitForTimeout(200);
  const html = await page.locator(".ProseMirror").first().innerHTML();
  // ProseMirror leaves a single empty <p> after clearing.
  const stripped = html.trim();
  assert.ok(
    /^<p[^>]*>(<br[^>]*>)?<\/p>$/.test(stripped) || stripped === "",
    `expected an empty editor, got: ${stripped.slice(0, 200)}`,
  );
});

await test("dirty marker clears after New on an empty doc", async () => {
  const headerText = await topHeader.textContent();
  assert.ok(!headerText?.includes("●"), `expected no dirty ●, got: ${headerText}`);
});

await test("no console errors during the walkthrough", () => {
  const errors = consoleLines.filter((l) => l.startsWith("[error]") || l.startsWith("[pageerror]"));
  assert.equal(errors.length, 0, `console errors:\n${errors.join("\n")}`);
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.error}`);
  process.exit(1);
}
