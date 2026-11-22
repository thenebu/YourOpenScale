/** Closes the People dropdown and the mobile menu on outside click and Escape. */
const MENUS = "details.nav-dropdown[open], details.nav-menu[open]";

export function initNav(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    for (const d of document.querySelectorAll<HTMLDetailsElement>(MENUS)) if (!d.contains(target)) d.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const d of document.querySelectorAll<HTMLDetailsElement>(MENUS)) {
      if (!d.open) continue;
      d.open = false;
      if (d.contains(document.activeElement)) d.querySelector<HTMLElement>("summary")?.focus();
    }
  });
  // Opening one menu closes the other.
  document.addEventListener("toggle", (event) => {
    const d = event.target as HTMLDetailsElement;
    if (!d.open || !d.matches?.("details.nav-dropdown, details.nav-menu")) return;
    for (const o of document.querySelectorAll<HTMLDetailsElement>(MENUS)) if (o !== d) o.open = false;
  }, true);
}
