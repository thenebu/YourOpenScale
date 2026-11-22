export const PAGES = [
  "/",
  "/users/1/overview",
  "/users/1/overview?range=all&morning=1&compare=yoy",
  "/users/2/overview",
  "/users/3/overview",
  "/users/1/readings",
  "/readings",
  "/users",
  "/scales",
  "/sync",
  "/settings",
  "/firmware",
  "/import/withings",
] as const;

export const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

export const slug = (p: string) => (p === "/" ? "dashboard" : p.slice(1).replace(/[/?&=]+/g, "-"));
