/** Keyboard model for a chart (01 §B5) plus a polite live region that mirrors the tooltip text. */

export type KeyboardNav = {
  /** Number of navigable points at the current level of detail. */
  count(): number;
  /** Shows the tooltip for point i and returns its plain-text reading. */
  show(i: number): string;
  hide(): void;
  /** Index of the point the cursor is on, or -1. */
  cursor(): number;
  zoom(direction: 1 | -1): void;
};

export function attachKeyboard(el: HTMLElement, nav: KeyboardNav): () => void {
  const live = document.createElement("div");
  live.className = "chart-live";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  el.insertAdjacentElement("afterend", live);

  let timer = 0;
  const announce = (text: string) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      live.textContent = text;
    }, 250);
  };
  const go = (i: number) => {
    const n = nav.count();
    if (!n) return;
    announce(nav.show(Math.min(n - 1, Math.max(0, i))));
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const n = nav.count();
    const cur = nav.cursor();
    const step = e.shiftKey ? 7 : 1;
    switch (e.key) {
      case "ArrowRight": go(cur < 0 ? n - 1 : cur + step); break;
      case "ArrowLeft": go(cur < 0 ? n - 1 : cur - step); break;
      case "Home": go(0); break;
      case "End": go(n - 1); break;
      case "Escape": nav.hide(); announce(""); break;
      case "+": case "=": nav.zoom(1); break;
      case "-": case "_": nav.zoom(-1); break;
      default: return;
    }
    e.preventDefault();
  };
  const onBlur = () => nav.hide();
  el.addEventListener("keydown", onKey);
  el.addEventListener("blur", onBlur);
  return () => {
    clearTimeout(timer);
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("blur", onBlur);
    live.remove();
  };
}
