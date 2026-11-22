/** Fork route hook: handlers return null for paths they do not own. */
import type { LayoutOpts } from "../ui.ts";
import { handleAnalyticsRoute } from "./analytics.ts";
import { handleShellRoute } from "./shell.ts";

export type ForkCtx = {
  request: Request;
  db: D1Database;
  url: URL;
  path: string;
  method: string;
  csrf: string;
  loggedIn: boolean;
  adminConfigured: boolean;
  page: (title: string, body: string, active?: string, opts?: LayoutOpts) => Response;
  go: (location: string, message?: string) => Response;
  cookie?: string;
};

// Fork handlers must check `ctx.loggedIn && ctx.adminConfigured` themselves
// (redirect to /login, or 401 JSON for /api/ui/*). For POSTs they read the form
// themselves and compare `_csrf` with `equal()`. They return null, without
// consuming the body, for paths they do not own.
export async function handleForkRoute(ctx: ForkCtx): Promise<Response | null> {
  return (await handleShellRoute(ctx)) ?? (await handleAnalyticsRoute(ctx));
}
