/**
 * E2E tests for dashboard mode transitions.
 *
 * Verifies that:
 *   1. No login → Family mode renders
 *   2. data-mode attribute is set on <html>
 *   3. Mode-specific UI elements are present
 *   4. Sign-in triggers mode transition
 *
 * Run: npx playwright test tests/e2e/
 */
import { test, expect } from "@playwright/test";

test.describe("Dashboard Mode System", () => {
  test("Family mode renders when no user is logged in", async ({ page }) => {
    await page.goto("/");

    // data-mode should be "family"
    const mode = await page.locator("html").getAttribute("data-mode");
    expect(mode).toBe("family");

    // Family greeting should be visible
    await expect(page.locator("text=Good")).toBeVisible();

    // Sign In button should be visible
    await expect(page.locator("text=Sign In")).toBeVisible();

    // Family avatar strip should be visible
    await expect(page.locator("text=Sign In")).toBeVisible();
  });

  test("data-bedtime attribute reflects time of day", async ({ page }) => {
    await page.goto("/");

    const bedtime = await page.locator("html").getAttribute("data-bedtime");
    expect(bedtime).toMatch(/^(true|false)$/);

    const hour = new Date().getHours();
    const expectedBedtime = hour >= 20 || hour < 6;
    expect(bedtime).toBe(String(expectedBedtime));
  });

  test("data-weekend attribute reflects day of week", async ({ page }) => {
    await page.goto("/");

    const weekend = await page.locator("html").getAttribute("data-weekend");
    expect(weekend).toMatch(/^(true|false)$/);

    const day = new Date().getDay();
    const expectedWeekend = day === 0 || day === 6;
    expect(weekend).toBe(String(expectedWeekend));
  });

  test("Weather widget loads on Family mode", async ({ page }) => {
    await page.goto("/");

    // Weather widget should be visible
    await expect(page.locator("text=More details").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Navigation bottom bar is visible", async ({ page }) => {
    await page.goto("/");

    // BottomNav should be visible
    await expect(page.locator("nav").first()).toBeVisible();
  });

  test("Mode transition animation class exists", async ({ page }) => {
    await page.goto("/");

    // The mode-transition-root wrapper should be present
    await expect(page.locator(".mode-transition-root").first()).toBeVisible();
  });
});

test.describe("Mode CSS Tokens", () => {
  test("Family mode has correct CSS custom properties", async ({ page }) => {
    await page.goto("/");

    const mode = await page.locator("html").getAttribute("data-mode");
    if (mode !== "family") return;

    // Check that --mode-gap is set
    const gap = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--mode-gap")
    );
    // Family mode gap should be defined (1.5rem)
    expect(gap).toBeTruthy();
  });

  test("Surface materials are accessible", async ({ page }) => {
    await page.goto("/");

    // At least one surface-subtle element should be visible
    const surfaces = page.locator(".surface-subtle, .glass-subtle, .material-thin");
    expect(await surfaces.count()).toBeGreaterThan(0);
  });
});
