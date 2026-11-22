import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const OVERVIEW = "/users/1/overview";

async function axeClean(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" ;; ")}`)).toEqual([]);
}

test("footer switch: German on dashboard and overview, chart tooltip, reload keeps it, axe clean", async ({ page, context }) => {
  // Playwright's default locale is en-US, so the first visit is English.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");

  const footer = page.locator("footer.site-footer");
  await expect(footer.locator('a[data-lang-set="en"]')).toHaveAttribute("aria-current", "page");
  await footer.locator('a[data-lang-set="de"]').click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Heute");
  await expect(page.getByRole("link", { name: "Messungen", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Analyse öffnen" }).first()).toBeVisible();
  await expect(footer.locator('a[data-lang-set="de"]')).toHaveAttribute("aria-current", "page");
  expect((await context.cookies()).find((c) => c.name === "yos_lang")?.value).toBe("de");
  await axeClean(page);

  await page.goto(`${OVERVIEW}?range=all`);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { name: "Zusammenfassung" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fortschritt" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Zeitraum" }).getByRole("link", { name: "Gesamter Zeitraum" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".overview-footer").getByRole("link", { name: "CSV herunterladen" })).toBeVisible();
  await expect(page.locator("#chart-weight .chart-summary")).toContainText("Gewicht, gesamter Zeitraum");
  await expect(page.locator("#chart-weight summary", { hasText: "Datentabelle anzeigen" })).toBeVisible();

  // Tooltip text comes from the browser bundle's German catalogue.
  const chart = page.locator("#chart-weight .chart[data-mounted='true']");
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator("svg")).toBeVisible();
  await expect(chart).toHaveAttribute("aria-label", /Diagramm .*Gewicht.*Pfeiltasten/);
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.4);
  const tip = page.locator(".chart-tooltip").first();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/Gewicht/);
  await expect(tip).toContainText(/Δ zum (Vorwert|Trend)/);
  await expect(tip).not.toContainText(/Δ from|previous|earlier/);
  await expect(tip).toContainText(/\d,\d/); // decimal comma
  await page.mouse.move(0, 0);
  await axeClean(page);

  // The cookie survives a reload, and the English link switches back.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { name: "Zusammenfassung" })).toBeVisible();
  await page.locator("footer.site-footer a[data-lang-set='en']").click();
  await expect(page).toHaveURL(/range=all/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
});

test("offline page follows the browser language and always carries both languages", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, locale: "fr-FR" });
  const page = await context.newPage();
  await page.goto("/offline");
  // Offline page: French browser falls back to English, German always present as the second language.
  await expect(page.locator("main.offline h1")).toHaveText("You are offline");
  await expect(page.locator("main.offline section[lang='de']")).toContainText("Du bist offline");
  await context.close();
  const de = await browser.newContext({ javaScriptEnabled: false, locale: "de-DE" });
  const p2 = await de.newPage();
  await p2.goto("/offline");
  await expect(p2.locator("main.offline h1")).toHaveText("Du bist offline");
  await expect(p2.locator("html")).toHaveAttribute("lang", "de");
  await de.close();
});
