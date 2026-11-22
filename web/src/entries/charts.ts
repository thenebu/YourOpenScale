/** Charts entry (dashboard + overview): registers the islands and mounts them as they scroll into view. */
import "../charts/islands.ts";
import { mountIslands } from "../charts/mount.ts";

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mountIslands());
else mountIslands();
