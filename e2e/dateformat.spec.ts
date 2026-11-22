import { test, expect } from "@playwright/test";

test("date format set in Settings applies to pages and chart tooltips and persists", async ({ page, context }) => {
  await page.goto("/settings");
  const form = page.locator("form.format-form");
  await expect(form.locator("select[name=datefmt]")).toBeVisible();
  await form.locator("select[name=datefmt]").selectOption("dmy-dot");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator("html")).toHaveAttribute("data-datefmt", "dmy-dot");
  expect((await context.cookies()).find((c) => c.name === "yos_datefmt")?.value).toBe("dmy-dot");
  await expect(page.locator(".format-example")).toContainText(/\d\d\.\d\d\.\d{4} \d\d:\d\d/);

  const dd = /\d\d\.\d\d\.\d{4}/;
  await page.goto("/users/1/readings");
  await expect(page.locator(".when-date").first()).toHaveText(dd);
  await expect(page.locator("time.when").first()).toHaveAttribute("datetime", /^\d{4}-\d\d-\d\dT/);
  await page.goto("/users/1/overview?range=all");
  await expect(page.locator("main")).toContainText(dd);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-datefmt", "dmy-dot");

  await page.goto("/users/1/overview?range=all");
  const chart = page.locator("#chart-weight .chart[data-mounted='true']");
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator("svg")).toBeVisible();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.4);
  const tip = page.locator(".chart-tooltip").first();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(dd);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-datefmt", "dmy-dot");
  await page.goto("/settings");
  await expect(page.locator("select[name=datefmt]")).toHaveValue("dmy-dot");
});
