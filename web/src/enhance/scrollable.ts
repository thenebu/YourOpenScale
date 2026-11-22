/** Horizontally scrollable `.table-wrap` regions become keyboard-focusable while they overflow (WCAG 2.1.1). */
export function initScrollable(): void {
  if (typeof ResizeObserver === "undefined") return;
  const update = (el: HTMLElement) => {
    if (el.scrollWidth > el.clientWidth + 1) {
      el.tabIndex = 0;
      el.setAttribute("role", "region");
      if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", "Scrollable table");
    } else if (el.getAttribute("aria-label") === "Scrollable table") {
      el.removeAttribute("tabindex");
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
    }
  };
  const ro = new ResizeObserver((entries) => entries.forEach((e) => update(e.target as HTMLElement)));
  for (const el of document.querySelectorAll<HTMLElement>(".table-wrap")) {
    ro.observe(el);
    const table = el.firstElementChild;
    if (table) ro.observe(table);
    update(el);
  }
}
