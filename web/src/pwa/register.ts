import { toast } from "../enhance/copy.ts";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

function worker(): ServiceWorker | null {
  return navigator.serviceWorker.controller;
}

/** Ask the worker to delete runtime caches whenever the user is on the login page. */
function flushOnLogout(): void {
  const flush = () => worker()?.postMessage({ type: "LOGOUT" });
  if (location.pathname === "/login" || location.pathname === "/setup") flush();
  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement | null;
    if (form?.getAttribute("action") === "/logout") flush();
  });
}

function offerUpdate(reg: ServiceWorkerRegistration): void {
  const region = document.querySelector<HTMLElement>(".toast-region") ?? document.body;
  if (region.querySelector("[data-pwa-update]")) return;
  const t = document.createElement("div");
  t.className = "toast toast-info pwa-update";
  t.dataset.pwaUpdate = "";
  const text = document.createElement("span");
  text.textContent = "Update available";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary btn-sm";
  btn.textContent = "Reload";
  btn.addEventListener("click", () => {
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    reg.waiting?.postMessage({ type: "SKIP_WAITING" });
  });
  t.append(text, btn);
  let host = document.querySelector<HTMLElement>(".toast-region");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-region";
    host.setAttribute("role", "status");
    document.body.append(host);
  }
  host.append(t);
}

function watchUpdates(reg: ServiceWorkerRegistration): void {
  // Only offer a reload when an older worker already controls this page.
  const check = () => reg.waiting && worker() && offerUpdate(reg);
  check();
  reg.addEventListener("updatefound", () => {
    const next = reg.installing;
    next?.addEventListener("statechange", () => {
      if (next.state === "installed") check();
    });
  });
}

function installButton(): void {
  let deferred: InstallPromptEvent | null = null;
  let button: HTMLButtonElement | null = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    const footer = document.querySelector(".site-footer");
    if (!footer || button) return;
    button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost btn-sm pwa-install";
    button.textContent = "Install app";
    button.addEventListener("click", async () => {
      const prompt = deferred;
      deferred = null;
      button?.remove();
      button = null;
      if (!prompt) return;
      await prompt.prompt();
      await prompt.userChoice;
    });
    footer.append(button);
  });
  window.addEventListener("appinstalled", () => {
    button?.remove();
    button = null;
    toast("App installed");
  });
}

export function initPwa(): void {
  installButton();
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const start = () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        watchUpdates(reg);
        flushOnLogout();
      })
      .catch(() => {});
  };
  // Never block first paint.
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
