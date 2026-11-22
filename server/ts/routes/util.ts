/** Helpers shared by the fork routes. */
export function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** Reads the `yow_theme` cookie: "light" | "dark", otherwise null (system). */
export function themeFromCookie(request: Request): "light" | "dark" | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== "yow_theme") continue;
    const value = part.slice(index + 1).trim();
    return value === "light" || value === "dark" ? value : null;
  }
  return null;
}
