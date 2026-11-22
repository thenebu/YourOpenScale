/** Web app release, shared by local Node and Cloudflare. Single source of truth is
 * package.json "version" (SemVer). It also cache-busts /app.js and /firmware.js.
 * Independent of bridge/firmware versions. */
import pkg from "../../package.json" with { type: "json" };

export const WEB_APP_VERSION: string = pkg.version;
