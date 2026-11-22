import { t } from "../i18n/index.ts";
/** `[data-copy]` and `[data-copy-target]` buttons copy their value (or the text of `data-copy-target`) and show a toast. */
function region(): HTMLElement {
  let el = document.querySelector<HTMLElement>(".toast-region");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast-region";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  return el;
}

export function toast(text: string, tone: "good" | "warn" | "bad" | "info" = "good"): void {
  const t = document.createElement("div");
  t.className = `toast toast-${tone}`;
  t.textContent = text;
  region().append(t);
  setTimeout(() => {
    t.dataset.leaving = "";
    setTimeout(() => t.remove(), 250);
  }, 2200);
}

export function initCopy(): void {
  document.addEventListener("click", async (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>("[data-copy],[data-copy-target]");
    if (!button) return;
    const targetSel = button.dataset.copyTarget;
    const source = targetSel ? document.querySelector<HTMLElement>(targetSel) : null;
    const text = button.dataset.copy || (source instanceof HTMLInputElement ? source.value : source?.textContent) || "";
    try {
      await navigator.clipboard.writeText(text.trim());
      toast(t("ui.copied"));
    } catch {
      toast(t("ui.copyFailed"), "bad");
    }
  });
}
