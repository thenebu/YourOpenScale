import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const OVERVIEW = "/users/1/overview";

async function mounted(page: Page, id: string) {
  const chart = page.locator(`#${id} .chart[data-mounted="true"]`);
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();
  await expect(chart.locator("svg")).toBeVisible();
  return chart;
}
const marks = (page: Page) => page.locator("#chart-weight .chart svg path").count();

test("dashboard: clicking a name opens the overview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Alex", exact: true }).first().click();
  await expect(page).toHaveURL(/\/users\/1\/overview/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alex");
});

test("range link changes aria-current and the morning chip sets morning=1", async ({ page }) => {
  await page.goto(OVERVIEW);
  const range = page.getByRole("navigation", { name: "Time range" });
  const before = await range.locator("a[aria-current]").innerText();
  await range.getByRole("link", { name: "All time" }).click();
  await expect(page).toHaveURL(/range=all/);
  const after = range.locator("a[aria-current]");
  await expect(after).toHaveText("All");
  expect(before).not.toBe("All");
  await page.getByRole("link", { name: "Morning only" }).click();
  await expect(page).toHaveURL(/morning=1/);
  await expect(page.getByRole("link", { name: "Morning only" })).toHaveAttribute("aria-current", /.+/);
});

test("overview on range=all has no dot cloud", async ({ page }) => {
  await page.goto(`${OVERVIEW}?range=all`);
  await mounted(page, "chart-weight");
  await page.waitForTimeout(500);
  const n = await marks(page);
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(1500);
});

test("chart tooltip appears on hover and on keyboard", async ({ page }) => {
  await page.goto(OVERVIEW);
  const chart = await mounted(page, "chart-weight");
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.4);
  await expect(page.locator(".chart-tooltip").first()).toBeVisible();
  await page.mouse.move(0, 0);

  await chart.focus();
  const live = page.locator("#chart-weight .chart-live");
  await page.keyboard.press("ArrowLeft");
  await expect(live).not.toBeEmpty();
  const first = await live.textContent();
  await page.keyboard.press("ArrowLeft");
  await expect(live).not.toHaveText(first!);
  await page.keyboard.press("Escape");
});

test("zooming keeps the number of marks at most 1500 and offers reset", async ({ page }) => {
  await page.goto(`${OVERVIEW}?range=all`);
  const chart = await mounted(page, "chart-weight");
  const wide = await marks(page);
  await chart.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("+");
  await expect(page.locator("#chart-weight").getByRole("button", { name: "Reset zoom" })).toBeVisible();
  await page.waitForTimeout(600);
  const zoomed = await marks(page);
  expect(zoomed).toBeLessThanOrEqual(1500);
  expect(zoomed).not.toBe(wide); // the level of detail changed with the window
  await page.locator("#chart-weight").getByRole("button", { name: "Reset zoom" }).click();
  await expect(page.locator("#chart-weight").getByRole("button", { name: "Reset zoom" })).toBeHidden();
});

test("dragging the range slider zooms", async ({ page }) => {
  await page.goto(`${OVERVIEW}?range=all`);
  const chart = await mounted(page, "chart-weight");
  const box = (await chart.boundingBox())!;
  const y = box.y + box.height - 20;
  await page.mouse.move(box.x + 45, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#chart-weight").getByRole("button", { name: "Reset zoom" })).toBeVisible();
  expect(await marks(page)).toBeLessThanOrEqual(1500);
});

test("theme switch toggles data-theme and chart colours", async ({ page }) => {
  await page.goto(OVERVIEW);
  const chart = await mounted(page, "chart-weight");
  await page.waitForTimeout(400);
  const colours = () =>
    chart.evaluate((el) => {
      const t = el.querySelector("svg text");
      return { text: t ? getComputedStyle(t).fill || t.getAttribute("fill") : null, bg: getComputedStyle(document.querySelector(".card")!).backgroundColor };
    });
  const footer = page.locator("footer");
  await footer.locator('a[data-theme-set="light"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.waitForTimeout(500);
  const light = await colours();
  await footer.locator('a[data-theme-set="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForTimeout(700);
  const dark = await colours();
  expect(dark.bg).not.toBe(light.bg);
  expect(dark.text).not.toBe(light.text);
});

test("CSV download has the right filename and header row", async ({ page }) => {
  await page.goto(OVERVIEW);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".overview-footer").getByRole("link", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^.*\.csv$/);
  expect(download.suggestedFilename()).toMatch(/alex|user-?1|yow|weight/i);
  const stream = await download.createReadStream();
  let body = "";
  for await (const c of stream) body += c;
  const header = body.split(/\r?\n/)[0];
  expect(header).toMatch(/^reading_id,timestamp_utc,local_date,/);
  expect(header).toContain("weight_kg");
  expect(header.split(",").length).toBeGreaterThan(2);
  expect(body.split(/\r?\n/).length).toBeGreaterThan(10);
});

test("goal form saves and the goal line appears", async ({ page }, info) => {
  test.skip(info.project.name !== "light", "mutates shared state; run once");
  await page.goto("/users/2/overview");
  const legend = page.locator("#chart-weight");
  await expect(page.locator("#goal .goal-target")).toHaveCount(0);
  const edit = page.locator("#goal details.goal-edit");
  if (!(await edit.evaluate((d: HTMLDetailsElement) => d.open))) await page.locator("#goal summary").click();
  await page.getByLabel(/Goal weight/).fill("58");
  await page.getByRole("button", { name: "Save goal" }).click();
  await expect(page).toHaveURL(/\/users\/2\/overview/);
  await expect(page.locator("#goal .goal-target")).toContainText("58");
  await expect(legend.getByText("Goal", { exact: true })).toBeVisible();
  // clean up: empty weight removes the goal
  await page.locator("#goal summary").click();
  await expect(edit).toHaveJSProperty("open", true);
  await page.getByLabel(/Goal weight/).fill("");
  await page.getByRole("button", { name: "Save goal" }).click();
  await expect(page.locator("#goal .goal-target")).toHaveCount(0);
});

test("goal start date in the past gives progress on the dashboard", async ({ page }, info) => {
  test.skip(info.project.name !== "light", "mutates shared state; run once");
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await page.goto(OVERVIEW);
  const edit = page.locator("#goal details.goal-edit");
  if (!(await edit.evaluate((d: HTMLDetailsElement) => d.open))) await page.locator("#goal summary").click();
  // Prefilled with the stored start day; the hint shows the start weight derived from the trend.
  await expect(page.getByLabel("Start date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByLabel("Start date").fill(daysAgo(895));
  await page.getByLabel(/Start weight/).fill("");
  await page.getByRole("button", { name: "Save goal" }).click();
  await expect(page.locator("#goal .goal-progress-text")).toContainText("since");
  await page.locator("#goal summary").click();
  await expect(page.locator(".goal-start-hint")).toContainText("Start weight from your trend on");
  await page.goto("/");
  const bar = page.locator(".user-card", { hasText: "Alex" }).locator("progress.progress");
  await expect(bar).toBeVisible();
  expect(Number(await bar.getAttribute("value"))).toBeGreaterThan(0);
});

test("section nav jumps land below the sticky controls", async ({ page }) => {
  for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(vp);
    await page.goto(OVERVIEW);
    await page.waitForLoadState("networkidle");
    const links = page.locator(".section-nav a");
    const count = await links.count();
    expect(count).toBeGreaterThan(2);
    for (let i = 0; i < count; i++) {
      const href = (await links.nth(i).getAttribute("href"))!;
      await page.evaluate((h) => { location.hash = ""; (document.querySelector(`.section-nav a[href="${h}"]`) as HTMLElement).click(); }, href);
      await page.waitForTimeout(700);
      const { bar, head } = await page.evaluate((h) => {
        const sec = document.querySelector(h)!;
        const heading = sec.querySelector("h2, h3") ?? sec;
        return {
          bar: document.querySelector(".overview-controls")!.getBoundingClientRect().bottom,
          head: heading.getBoundingClientRect().top,
        };
      }, href);
      const atEnd = await page.evaluate(() => window.innerHeight + scrollY >= document.documentElement.scrollHeight - 2);
      // The last sections can't scroll further; everything else must clear the sticky bar.
      if (!atEnd) expect(head, `${href} @${vp.width}`).toBeGreaterThanOrEqual(bar - 1);
    }
  }
});

test.describe("dialogs", () => {
  test("/users dialogs open and close", async ({ page }) => {
    await page.goto("/users");
    for (const id of ["add-user-dialog", "edit-user-1", "import-users-dialog"]) {
      const trigger = page.locator(`[data-open-dialog="${id}"]`).first();
      if (id === "import-users-dialog") await page.getByText("Import", { exact: true }).first().click();
      await trigger.click();
      const dlg = page.locator(`#${id}`);
      await expect(dlg).toBeVisible();
      await page.waitForTimeout(500); // let the open animation finish before measuring contrast
      const bad = (await new AxeBuilder({ page }).include(`#${id}`).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ") + " " + (n.any[0]?.message ?? "")).join(" ;; "))).toEqual([]);
      await dlg.locator("[data-close-dialog]").first().click();
      await expect(dlg).toBeHidden();
    }
    // Escape closes too
    await page.locator('[data-open-dialog="add-user-dialog"]').click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#add-user-dialog")).toBeHidden();
  });

  test("/firmware: invitation can be generated, dialogs open and close", async ({ page }) => {
    const posts: number[] = [];
    page.on("response", (r) => r.request().method() === "POST" && posts.push(r.status()));
    await page.goto("/firmware");
    await page.getByRole("button", { name: "Generate Connection Invitation" }).click();
    await expect(page.locator("#bridge-invitation")).not.toHaveValue("");
    await expect(page.locator("#copy-invitation")).toBeVisible();
    expect(posts).not.toContain(403);
    expect(posts).toContain(200);

    for (const id of ["enroll-dialog", "roster-dialog", "flash-dialog"]) {
      await page.evaluate((i) => (document.getElementById(i) as HTMLDialogElement).showModal(), id);
      const dlg = page.locator(`#${id}`);
      await expect(dlg).toBeVisible();
      await page.waitForTimeout(500); // let the open animation finish before measuring contrast
      const bad = (await new AxeBuilder({ page }).include(`#${id}`).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ") + " " + (n.any[0]?.message ?? "")).join(" ;; "))).toEqual([]);
      await dlg.locator("[data-close-dialog]").first().click();
      await expect(dlg).toBeHidden();
    }
  });
});

test("composition chart hover throws no console error on a long history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${OVERVIEW}?range=all`);
  await page.locator("#chart-composition").scrollIntoViewIfNeeded();
  const chart = await mounted(page, "chart-composition");
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4);
  await expect(page.locator("#chart-composition .chart-tooltip").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("copy buttons with data-copy-target are handled by the copy listener", async ({ page }) => {
  await page.goto("/");
  const ok = await page.evaluate(async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => { (window as any).__copied = t; } }, configurable: true });
    const code = document.createElement("code"); code.id = "tmp-src"; code.textContent = " hello ";
    const b = document.createElement("button"); b.dataset.copyTarget = "#tmp-src";
    document.body.append(code, b); b.click();
    await new Promise((r) => setTimeout(r, 50));
    return (window as any).__copied;
  });
  expect(ok).toBe("hello");
});
