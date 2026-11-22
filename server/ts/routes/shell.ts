/** Shell routes such as "/theme" and the PWA files (WP-10, WP-16). */
import type { ForkCtx } from "./index.ts";

const YEAR = 365 * 24 * 60 * 60;

/** Returns a same-origin path+query, or "/" when `value` is missing or unsafe. The `notice` param is dropped. */
export function safeBack(value: string | null | undefined, origin: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin) return "/";
    target.searchParams.delete("notice");
    const out = target.pathname + target.search + target.hash;
    // new URL() normalises dot segments, so "/.//evil.com" becomes "//evil.com": re-check the result.
    if (!out.startsWith("/") || out.startsWith("//") || out.startsWith("/\\")) return "/";
    return out;
  } catch {
    return "/";
  }
}

function refererPath(request: Request, origin: string): string | null {
  const referer = request.headers.get("Referer");
  if (!referer) return null;
  try {
    const u = new URL(referer);
    return u.origin === origin ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}

export async function handleShellRoute(ctx: ForkCtx): Promise<Response | null> {
  if (ctx.path !== "/theme" || (ctx.method !== "GET" && ctx.method !== "HEAD")) return null;
  const set = ctx.url.searchParams.get("set");
  if (set !== "system" && set !== "light" && set !== "dark") return new Response("Unknown theme", { status: 400 });
  const origin = ctx.url.origin;
  const back = safeBack(ctx.url.searchParams.get("back") ?? refererPath(ctx.request, origin), origin);
  const secure = ctx.url.protocol === "https:" ? "; Secure" : "";
  const cookie =
    set === "system"
      ? `yow_theme=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `yow_theme=${set}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}`;
  return new Response(null, { status: 303, headers: { Location: back, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
