export function isSettingsSectionReady(surface, section, readyText) {
  const actualSection = typeof surface?.getAttribute === "function"
    ? surface.getAttribute("data-section")
    : surface?.section;
  const loading = typeof surface?.querySelector === "function"
    ? Boolean(surface.querySelector('[data-settings-section-loading="true"]'))
    : Boolean(surface?.loading);
  const text = typeof surface?.textContent === "string" ? surface.textContent : String(surface?.text ?? "");
  return Boolean(actualSection === section && !loading && text.includes(readyText));
}

export async function waitForSettingsSectionReady(readSurface, { section, readyText, timeoutMs = 5000, intervalMs = 0 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const surface = await readSurface();
    if (isSettingsSectionReady(surface, section, readyText)) return surface;
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    else await Promise.resolve();
  }
  throw new Error(`Settings section did not become ready: ${section}`);
}

export async function installFontRouteGuards(context, fontRequests) {
  const abort = async (route) => {
    fontRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  };
  await context.route("https://fonts.googleapis.com/**", abort);
  await context.route("https://fonts.gstatic.com/**", abort);
}

export function createIdempotentProbeCleanup({ browser, server, stopServer, closeLog, removeTemp, keepTemp = false }) {
  let cleanupPromise = null;
  return () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      try {
        if (browser) await browser.close();
      } finally {
        try {
          if (server) await stopServer(server);
        } finally {
          try {
            if (closeLog) await closeLog();
          } finally {
            if (!keepTemp) removeTemp();
          }
        }
      }
    })();
    return cleanupPromise;
  };
}

export function installProbeSignalHandlers(cleanup, exit = process.exit, emitter = process) {
  const handle = (code) => {
    void cleanup().catch(() => undefined).finally(() => exit(code));
  };
  emitter.once("SIGINT", () => handle(130));
  emitter.once("SIGTERM", () => handle(143));
}
