import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PAGES, VIEWPORTS } from "./pages.ts";

for (const path of PAGES) {
  for (const vp of VIEWPORTS) {
    test(`${path} @${vp.width}`, async ({ page }) => {
      await page.setViewportSize(vp);
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript(() => {
        (window as unknown as { __csp: string[] }).__csp = [];
        document.addEventListener("securitypolicyviolation", (e) =>
          (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
        );
      });
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      // Charts mount lazily near the viewport; scroll through so they all render.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 40));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
      expect(errors).toEqual([]);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      const axe = await new AxeBuilder({ page }).withRules(["color-contrast", "link-name", "button-name"]).withTags(["wcag2a", "wcag2aa"]).analyze();
      const bad = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ") + " | " + (n.any[0]?.message ?? "")).slice(0, 4).join(" ;; ")}`)).toEqual([]);
      const aria = await new AxeBuilder({ page }).options({ runOnly: { type: "rule", values: [
        "aria-allowed-attr", "aria-required-attr", "aria-valid-attr", "aria-valid-attr-value", "aria-roles", "aria-hidden-focus", "aria-required-children", "aria-required-parent",
      ] } }).analyze();
      expect(aria.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes[0]?.target.join(" "))).toEqual([]);
    });
  }
}
