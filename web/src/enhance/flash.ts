/** Dismiss button on the flash notice. */
export function initFlash(): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>(".flash [data-dismiss]");
    if (!button) return;
    const flash = button.closest<HTMLElement>(".flash-wrap, .flash");
    flash?.remove();
  });
}
