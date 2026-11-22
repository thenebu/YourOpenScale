/** Submits a form when a `select[data-submit-on-change]` inside it changes (the overview user switcher). */
export function initSubmitOnChange(): void {
  document.addEventListener("change", (event) => {
    const select = (event.target as Element | null)?.closest<HTMLSelectElement>("select[data-submit-on-change]");
    select?.form?.requestSubmit();
  });
}
