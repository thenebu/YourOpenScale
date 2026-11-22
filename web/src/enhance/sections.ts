/** Scroll-spy for `.section-nav`: marks the link of the section in view with aria-current="location". */
export function initSections(): void {
  const navs = document.querySelectorAll<HTMLElement>(".section-nav");
  if (!navs.length || !("IntersectionObserver" in window)) return;
  for (const nav of navs) {
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    const byId = new Map<string, HTMLAnchorElement>();
    for (const a of links) byId.set(decodeURIComponent(a.hash.slice(1)), a);
    const sections = [...byId.keys()].map((id) => document.getElementById(id)).filter((s): s is HTMLElement => !!s);
    if (!sections.length) continue;
    const visible = new Set<string>();
    const mark = () => {
      const current = sections.find((s) => visible.has(s.id));
      for (const a of links) a.removeAttribute("aria-current");
      const a = current && byId.get(current.id);
      if (a) {
        a.setAttribute("aria-current", "location");
        const box = nav.getBoundingClientRect();
        const r = a.getBoundingClientRect();
        if (r.left < box.left || r.right > box.right) nav.scrollTo({ left: a.offsetLeft - nav.clientWidth / 2, behavior: "smooth" });
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) visible.add(en.target.id);
          else visible.delete(en.target.id);
        }
        mark();
      },
      { rootMargin: "-112px 0px -60% 0px" },
    );
    for (const s of sections) io.observe(s);
  }
}
