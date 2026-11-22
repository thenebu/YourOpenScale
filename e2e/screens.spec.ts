import { test } from "@playwright/test";
import { PAGES, VIEWPORTS, slug } from "./pages.ts";

for (const path of PAGES) {
  for (const vp of VIEWPORTS) {
    test(`screen ${path} @${vp.width}`, async ({ page }, info) => {
      await page.setViewportSize(vp);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `test-results/screens/${slug(path)}-${vp.width}-${info.project.name}.png`, fullPage: true });
    });
  }
}
