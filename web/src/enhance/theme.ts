/** Footer theme switch: applies instantly and stores the cookie; falls back to the /theme navigation. */
const MAX_AGE = 365 * 24 * 60 * 60;

export function initTheme(): void {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[data-theme-set]");
    if (!link) return;
    const value = link.dataset.themeSet;
    if (value !== "system" && value !== "light" && value !== "dark") return;
    try {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie =
        value === "system"
          ? `yow_theme=; Path=/; Max-Age=0; SameSite=Lax${secure}`
          : `yow_theme=${value}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
      if (value === "system") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.dataset.theme = value;
      event.preventDefault();
      for (const a of document.querySelectorAll<HTMLAnchorElement>("a[data-theme-set]")) {
        if (a.dataset.themeSet === value) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      }
      document.dispatchEvent(new CustomEvent("yow:themechange", { detail: { theme: value } }));
    } catch {
      /* let the link navigate */
    }
  });
}
