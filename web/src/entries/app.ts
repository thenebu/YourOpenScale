import "../styles/index.css";
import "@fontsource-variable/inter";
import { initCopy } from "../enhance/copy.ts";
import { initFlash } from "../enhance/flash.ts";
import { initNav } from "../enhance/nav.ts";
import { initSections } from "../enhance/sections.ts";
import { initTheme } from "../enhance/theme.ts";

document.documentElement.classList.add("js");
initTheme();
initNav();
initFlash();
initCopy();
initSections();
