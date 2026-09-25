import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { SERVICES_REGISTRY } from "@/lib/services/registry";

const repoFile = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");
const launcherProbe = repoFile("scripts/consuela/verify-settings-launcher.mjs");
const emergencyProbe = repoFile("scripts/consuela/verify-emergency-settings.mjs");
const sectionView = repoFile("src/components/settings/SettingsSectionView.tsx");
const settingsPage = repoFile("src/app/settings/page.tsx");
const probeEnvPath = resolve(__dirname, "../../scripts/consuela/probe-env.mjs");
const probeHelpersPath = resolve(__dirname, "../../scripts/consuela/probe-helpers.mjs");

function collectSourceEnvNames(directory: string): Set<string> {
  const names = new Set<string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      for (const name of collectSourceEnvNames(entryPath)) names.add(name);
      continue;
    }
    if (!/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const source = readFileSync(entryPath, "utf8");
    const pattern = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['\"]([A-Z][A-Z0-9_]*)['\"]\])/g;
    for (const match of source.matchAll(pattern)) names.add(match[1] ?? match[2]);
  }
  return names;
}

function collectBracketEnvAccesses(directory: string): Array<{ file: string; expression: string }> {
  const sourceRoot = resolve(__dirname, "../../src");
  const accesses: Array<{ file: string; expression: string }> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      accesses.push(...collectBracketEnvAccesses(entryPath));
      continue;
    }
    if (!/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const source = readFileSync(entryPath, "utf8");
    const pattern = /process\.env\[\s*([^\]'"]+)\s*\]/g;
    for (const match of source.matchAll(pattern)) {
      accesses.push({
        file: entryPath.slice(sourceRoot.length + 1).replaceAll("\\", "/"),
        expression: match[0].replace(/\s+/g, " "),
      });
    }
  }
  return accesses;
}

function documentedEnvKeys(): string[] {
  return repoFile(".env.example")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")));
}

function hasOwn(object: object, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

describe.each([
  ["settings launcher", launcherProbe],
  ["emergency settings", emergencyProbe],
])("%s probe hardening", (name, source) => {
  it("uses the shared hardened probe environment", () => {
    expect(source).toContain('from "./probe-env.mjs"');
    expect(source).toContain("buildProbeEnv");
    expect(source).not.toContain("function buildProbeEnv");
    expect(source).not.toMatch(/env:\s*\{\s*\.\.\.process\.env\s*\}/);
    expect(source).toMatch(/env:\s*buildProbeEnv\(/);
  });

  it("waits for section content after the loading marker is removed", async () => {
    const { waitForSettingsSectionReady } = await import(pathToFileURL(probeHelpersPath).href);
    const states = [
      {
        getAttribute: () => "me",
        querySelector: () => ({}),
        textContent: "Loading",
      },
      {
        getAttribute: () => "me",
        querySelector: () => null,
        textContent: "Your profile",
      },
    ];
    let reads = 0;
    const ready = await waitForSettingsSectionReady(async () => states[reads++], {
      section: "me",
      readyText: "Your profile",
      timeoutMs: 100,
    });

    expect(ready.textContent).toBe("Your profile");
    expect(reads).toBe(2);
  });

  it("uses the shared local font mock and blocks external font attempts", async () => {
    const probeEnv = await import(pathToFileURL(probeEnvPath).href) as {
      SAFE_PROBE_ENV: Record<string, string>;
      buildProbeEnv: (appUrl: string, sourceEnv?: Record<string, string | undefined>) => Record<string, string>;
    };
    const { installFontRouteGuards } = await import(pathToFileURL(probeHelpersPath).href);
    const built = probeEnv.buildProbeEnv("http://127.0.0.1:54321", {
      HTTPS_PROXY: "https://unsafe.example.com",
      HTTP_PROXY: "https://unsafe.example.com",
    });
    const routes = new Map<string, (route: { request: () => { url: () => string }; abort: (reason: string) => Promise<void> }) => Promise<void>>();
    const fontRequests: string[] = [];
    const aborts: string[] = [];
    const context = {
      route: async (pattern: string, handler: (route: { request: () => { url: () => string }; abort: (reason: string) => Promise<void> }) => Promise<void>) => {
        routes.set(pattern, handler);
      },
    };

    await installFontRouteGuards(context, fontRequests);
    await routes.get("https://fonts.googleapis.com/**")?.({ request: () => ({ url: () => "https://fonts.googleapis.com/css2" }), abort: async (reason) => { aborts.push(reason); } });
    await routes.get("https://fonts.gstatic.com/**")?.({ request: () => ({ url: () => "https://fonts.gstatic.com/font.woff2" }), abort: async (reason) => { aborts.push(reason); } });

    expect(probeEnv.SAFE_PROBE_ENV.NEXT_FONT_GOOGLE_MOCKED_RESPONSES).toMatch(/next-font-mock/);
    expect(built.NEXT_FONT_GOOGLE_MOCKED_RESPONSES).toMatch(/next-font-mock/);
    expect(built.HTTPS_PROXY).toBeUndefined();
    expect(built.HTTP_PROXY).toBeUndefined();
    expect(fontRequests).toEqual(["https://fonts.googleapis.com/css2", "https://fonts.gstatic.com/font.woff2"]);
    expect(aborts).toEqual(["blockedbyclient", "blockedbyclient"]);
  });

  it("cleans detached probe resources once and exits safely on termination", async () => {
    const { createIdempotentProbeCleanup, installProbeSignalHandlers } = await import(pathToFileURL(probeHelpersPath).href);
    const calls = { browser: 0, server: 0, log: 0, temp: 0 };
    const browser = { close: async () => { calls.browser += 1; } };
    const server = { id: "server" };
    const cleanup = createIdempotentProbeCleanup({
      browser,
      server,
      stopServer: async (value: typeof server) => {
        expect(value).toBe(server);
        calls.server += 1;
      },
      closeLog: async () => { calls.log += 1; },
      removeTemp: () => { calls.temp += 1; },
    });
    const handlers = new Map<string, () => void>();
    const emitter = { once: (signal: string, handler: () => void) => { handlers.set(signal, handler); } };
    const exitCodes: number[] = [];

    installProbeSignalHandlers(cleanup, (code: number) => { exitCodes.push(code); }, emitter);
    await Promise.all([cleanup(), cleanup(), cleanup()]);
    await cleanup();
    handlers.get("SIGINT")?.();
    handlers.get("SIGTERM")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual({ browser: 1, server: 1, log: 1, temp: 1 });
    expect(exitCodes).toEqual([130, 143]);
  });

  it("does not substitute navigation after category activation", () => {
    expect(source).not.toContain("navigateToSection");
    expect(source).toContain("page.waitForURL");
    expect(source).toContain("window.location.pathname");
  });
  it("routes executable probes through the tested readiness and cleanup helpers", () => {
    expect(source).toContain("waitForSettingsSectionReady");
    expect(source).toContain("createIdempotentProbeCleanup");
    expect(source).not.toMatch(/async function openSection\s*\(/);
    expect(source).not.toMatch(/async function cleanupProbe\s*\(/);
  });
  it("uses an OS-assigned port and fails readiness on child failure", () => {
    expect(source).toContain("createServer");
    expect(source).toContain("getFreePort");
    expect(source).toContain("child.exitCode");
    expect(source).toContain("child.signalCode");
    expect(source).toContain("childError");
  });

  it("uses the shared cleanup while preserving log-before-temp ordering", () => {
    expect(source).toContain("createIdempotentProbeCleanup");
    expect(source).toContain("installProbeSignalHandlers(cleanupProbe)");
    expect(source).toContain("await cleanupProbe()");
    const stopStart = source.indexOf("async function stopDevServer");
    const stopEnd = source.indexOf("function serverLogTail", stopStart);
    const stopSource = source.slice(stopStart, stopEnd);
    const finishIndex = stopSource.indexOf("await finishLogStream(log)");
    const nextDevDeleteIndex = stopSource.indexOf('rmSync(path.join(REPO_ROOT, ".next", "dev")');
    expect(finishIndex).toBeGreaterThan(-1);
    expect(finishIndex).toBeLessThan(nextDevDeleteIndex);
    expect(source).toContain("stopServer: async () => { await stopDevServer(server); }");
  });
});

describe("shared probe environment", () => {
  it("explicitly neutralizes every documented and source-referenced environment key", async () => {
    expect(existsSync(probeEnvPath)).toBe(true);
    if (!existsSync(probeEnvPath)) return;

    const probeEnv = await import(pathToFileURL(probeEnvPath).href) as {
      PROBE_RUNTIME_KEYS: readonly string[];
      SAFE_PROBE_ENV: Record<string, string>;
      buildProbeEnv: (appUrl: string, sourceEnv?: Record<string, string | undefined>) => Record<string, string>;
    };
    const documented = documentedEnvKeys();
    const sourceNames = collectSourceEnvNames(resolve(__dirname, "../../src"));
    const registryFields = new Map(SERVICES_REGISTRY.flatMap((service) => service.fields).map((field) => [field.key, field]));
    const sensitive = /(?:SECRET|TOKEN|PASS|PASSWORD|KEY|EMAIL|CHAT_ID|SCOPE|MODELS|PIN_BYPASS|CLIENT_ID|GMAIL_USER)/;
    const service = /(?:URL|HOST|BROKER|PROXY)/;
    const localServiceUrl = "http://127.0.0.1:1";

    for (const key of documented) {
      expect(hasOwn(probeEnv.SAFE_PROBE_ENV, key), `${key} missing from safe probe map`).toBe(true);
    }
    for (const key of sourceNames) {
      expect(hasOwn(probeEnv.SAFE_PROBE_ENV, key), `${key} missing from source env audit`).toBe(true);
    }
    for (const [key, value] of Object.entries(probeEnv.SAFE_PROBE_ENV)) {
      const registryField = registryFields.get(key);
      if (registryField ? registryField.secret : sensitive.test(key)) {
        expect(value, `${key} must be empty`).toBe("");
      }
      if (service.test(key)) expect(value, `${key} must use local discard URL`).toBe(localServiceUrl);
    }

    const unsafeSourceEnv: Record<string, string> = {
      PATH: "/probe/bin",
      HOME: "/probe/home",
      TMPDIR: "/probe/tmp",
      PB_ADMIN_EMAIL: "unsafe@example.com",
      PB_ADMIN_PASS: "unsafe-password",
      SESSION_SECRET: "unsafe-session",
      NEXT_PUBLIC_PB_URL: "https://unsafe.example.com",
      NEXT_PUBLIC_APP_URL: "https://unsafe.example.com",
      FINANCE_DASHBOARD_URL: "https://unsafe.example.com",
      HERMES_CHAT_URL: "https://unsafe.example.com",
      GOOGLE_OAUTH_SCOPES: "unsafe-scope",
      TELEGRAM_ALERT_CHAT_ID: "unsafe-chat",
      AI_PROVIDER_KEY: "unsafe-key",
      FALLBACK_MODELS: "unsafe-model",
    };
    const appUrl = "http://127.0.0.1:54321";
    const built = probeEnv.buildProbeEnv(appUrl, unsafeSourceEnv);

    for (const key of probeEnv.PROBE_RUNTIME_KEYS) {
      if (unsafeSourceEnv[key]) expect(built[key]).toBe(unsafeSourceEnv[key]);
    }
    for (const key of [...documented, ...sourceNames]) {
      if (probeEnv.PROBE_RUNTIME_KEYS.includes(key)) continue;
      expect(hasOwn(built, key), `${key} missing from built env`).toBe(true);
    }
    expect(built.PB_ADMIN_EMAIL).toBe("");
    expect(built.PB_ADMIN_PASS).toBe("");
    expect(built.SESSION_SECRET).toBe("");
    expect(built.GOOGLE_OAUTH_SCOPES).toBe("");
    expect(built.TELEGRAM_ALERT_CHAT_ID).toBe("");
    expect(built.AI_PROVIDER_KEY).toBe("");
    expect(built.FALLBACK_MODELS).toBe("");
    expect(built.NEXT_PUBLIC_PB_URL).toBe(localServiceUrl);
    expect(built.FINANCE_DASHBOARD_URL).toBe(localServiceUrl);
    expect(built.HERMES_CHAT_URL).toBe(localServiceUrl);
    expect(built.NEXT_PUBLIC_APP_URL).toBe(appUrl);
    expect(Object.values(built)).not.toContain("unsafe-password");
    expect(Object.values(built)).not.toContain("https://unsafe.example.com");
  });

  it("explicitly neutralizes every SERVICES_REGISTRY field", async () => {
    const probeEnv = await import(pathToFileURL(probeEnvPath).href) as {
      SAFE_PROBE_ENV: Record<string, string>;
      buildProbeEnv: (appUrl: string, sourceEnv?: Record<string, string | undefined>) => Record<string, string>;
    };
    const fields = SERVICES_REGISTRY.flatMap((service) => service.fields);
    const unsafeRegistryEnv = Object.fromEntries(fields.map((field) => [field.key, "unsafe-inherited-value"]));
    const built = probeEnv.buildProbeEnv("http://127.0.0.1:54321", {
      PATH: "/probe/bin",
      ...unsafeRegistryEnv,
    });
    const localServiceUrl = "http://127.0.0.1:1";

    for (const field of fields) {
      expect(hasOwn(probeEnv.SAFE_PROBE_ENV, field.key), `${field.key} missing from registry safe map`).toBe(true);
      expect(hasOwn(built, field.key), `${field.key} missing from built registry env`).toBe(true);
      if (field.secret) {
        expect(probeEnv.SAFE_PROBE_ENV[field.key], `${field.key} secret field must be empty`).toBe("");
      } else if (field.key === "MEALDB_KEY") {
        expect(probeEnv.SAFE_PROBE_ENV[field.key]).toBe("1");
      } else if (field.key === "LAT" || field.key === "LON") {
        expect(probeEnv.SAFE_PROBE_ENV[field.key]).toBe("0");
      } else {
        expect(["", localServiceUrl], `${field.key} non-secret field must be safely deterministic`).toContain(probeEnv.SAFE_PROBE_ENV[field.key]);
      }
      expect(built[field.key]).toBe(probeEnv.SAFE_PROBE_ENV[field.key]);
    }
  });

  it("allows bracket env access only in the two service-registry lookups", () => {
    const accesses = collectBracketEnvAccesses(resolve(__dirname, "../../src"));

    expect(accesses).toHaveLength(2);
    expect(accesses.every((access) => access.file === "lib/services/config.ts")).toBe(true);
    expect(accesses.map((access) => access.expression).sort()).toEqual([
      "process.env[f.key]",
      "process.env[key]",
    ]);
  });
});

describe("focused Settings contracts", () => {
  it("loads every extracted section through an isolated next/dynamic entry", () => {
    const entries = [
      ["MeSettingsRoute", "MeSettingsSection"],
      ["FamilySettingsRoute", "FamilySettingsSection"],
      ["SafetySettingsRoute", "SafetySettingsSection"],
      ["AppearanceSettingsRoute", "AppearanceSettingsSection"],
      ["HomeSettingsRoute", "HomeSettingsSection"],
      ["SystemSettingsRoute", "SystemSettingsSection"],
    ] as const;
    const paths = entries.map(([entry]) => `src/components/settings/routes/${entry}.tsx`);
    const allExist = paths.every((path) => existsSync(resolve(__dirname, "../..", path)));
    expect(allExist).toBe(true);
    if (!allExist) return;

    for (const [index, [entry, component]] of entries.entries()) {
      const source = repoFile(paths[index]);
      expect(source).toContain('import dynamic from "next/dynamic"');
      expect(source).toContain(`dynamic(() => import("@/components/settings/${component}")`);
      expect(source).toContain("SettingsSectionLoading");
    }
    expect(sectionView).not.toMatch(/^import .*SettingsSection/m);
    expect(sectionView).not.toContain("@/components/settings/routes/");
    const loadingPath = "src/components/settings/routes/SettingsSectionLoading.tsx";
    expect(existsSync(resolve(__dirname, "../..", loadingPath))).toBe(true);
    if (existsSync(resolve(__dirname, "../..", loadingPath))) {
      expect(repoFile(loadingPath)).toContain('data-settings-section-loading="true"');
    }
    const routeIds = ["me", "family", "safety", "appearance", "home", "system"];
    const pagePaths = routeIds.map((routeId) => `src/app/settings/${routeId}/page.tsx`);
    const allPagesExist = pagePaths.every((pagePath) => existsSync(resolve(__dirname, "../..", pagePath)));
    expect(allPagesExist).toBe(true);
    if (!allPagesExist) return;
    for (const [index, [entry]] of entries.entries()) {
      const pageSource = repoFile(pagePaths[index]);
      expect(pageSource).toContain(`@/components/settings/routes/${entry}`);
      expect(pageSource).toContain(`section="${routeIds[index]}"`);
    }
  });

  it("marks both launcher and focused content for descendant overflow inspection", () => {
    expect(settingsPage).toContain('data-settings-content="true"');
    expect(sectionView).toContain('data-settings-content="true"');
  });

  it("checks Me isolation in a brand-new context with listeners installed before navigation", () => {
    const functionSource = launcherProbe.match(/async function verifyMeIsolation\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(functionSource).toContain("browser.newContext");
    expect(functionSource).toContain("installSanitizedState");
    expect(functionSource.indexOf('page.on("request"')).toBeLessThan(functionSource.indexOf("page.goto"));
    expect(functionSource.indexOf('page.on("response"')).toBeLessThan(functionSource.indexOf("page.goto"));
    expect(launcherProbe).toContain("data-settings-overflow-regression");
    expect(launcherProbe).toContain("SystemSettingsSection");
    expect(launcherProbe).toContain("System-only API request");
    expect(launcherProbe).toContain("focus-visible");
  });

  it("asserts the Emergency page through its h1 role", () => {
    expect(emergencyProbe).toContain('getByRole("heading", { level: 1, name: "Emergency" })');
  });
});
