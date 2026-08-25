import { test, expect } from "@playwright/test";

test("demo: upcoming important events render live", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Upcoming important")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Doctor appointment")).toBeVisible();
});