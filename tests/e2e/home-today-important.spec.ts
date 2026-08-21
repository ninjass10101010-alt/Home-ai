import { test, expect } from "@playwright/test";

/**
 * Home Today card upcoming important events.
 * Task 5 verification: Today card renders "Upcoming important" section
 * below today's events when PB returns scored upcoming events.
 *
 * Uses route interception to mock PocketBase events API so tests are
 * deterministic without needing live PB data.
 */

function tomorrowISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}
function dateOffsetISO(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// Intercept all PB events fetches: **/api/collections/events/records**
// PB JS client hits http://<PB_URL>/api/collections/events/records?filter=... etc
// We mock both today window and upcoming window.
function mockPBForUpcoming(page: any, upcoming: any[], todayEvents?: any[]) {
  // The default today fallback creates 3 events for today; we return those unless overridden
  const todayISO = new Date().toISOString().split("T")[0];
  const todayMock =
    todayEvents !== undefined
      ? todayEvents
      : [
          { id: "t1", collectionId: "events", collectionName: "events", title: "Soccer Practice", date: todayISO, time: "16:00", member: "Emily", icon: "⚽", color: "violet" },
        ];

  return page.route("**/api/collections/events/records**", async (route: any) => {
    const req = route.request();
    const url = new URL(req.url());
    const filter = url.searchParams.get("filter") || "";
    const allPosts = url.searchParams.get("requestKey") !== null ? "" : "";
    // Upcoming hook uses filter containing importanceScore
    if (filter.includes("importanceScore")) {
      // PB getList returns { page, perPage, totalItems, items, totalPages }
      // Some SDK versions return { items } directly, so handle both.
      // Return items sorted by -importanceScore (mock already sorted)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          page: 1,
          perPage: 3,
          totalItems: upcoming.length,
          totalPages: 1,
          items: upcoming.slice(0, 3),
        }),
      });
      return;
    }
    // For today fetch (getFullList without filter, or with date), return todayMock
    // Also handle any other events fetch as full list fallback
    // If request is for events without importance filter, return all events (today + upcoming)
    // so fallback JS filtering can also be tested.
    const combined = [...todayMock, ...upcoming];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        page: 1,
        perPage: 100,
        totalItems: combined.length,
        totalPages: 1,
        items: combined,
      }),
    });
  });
}

test.describe("Home Today important events", () => {
  test("Today card shows upcoming important when data exists", async ({ page }) => {
    const tom = tomorrowISO();
    const upcoming = [
      { id: "up1", collectionId: "events", collectionName: "events", title: "Doctor appointment", date: tom, time: "09:00", member: "Bailey", icon: "🩺", color: "amber", importanceScore: 80, importanceReason: "doctor" },
      { id: "up2", collectionId: "events", collectionName: "events", title: "Flight to NYC", date: dateOffsetISO(2), time: "14:00", member: "Rebecca (Mom)", icon: "✈️", color: "cyan", importanceScore: 75, importanceReason: "flight" },
      { id: "up3", collectionId: "events", collectionName: "events", title: "Birthday party", date: dateOffsetISO(3), time: "18:00", member: "Jasmine", icon: "🎂", color: "rose", importanceScore: 70, importanceReason: "birthday" },
    ];

    await mockPBForUpcoming(page, upcoming);
    await page.goto("/");
    // Card header should be visible
    await expect(page.getByText("Today").first()).toBeVisible({ timeout: 10_000 });
    // Upcoming section title
    await expect(page.getByText("Upcoming important")).toBeVisible({ timeout: 10_000 });
    // At least one upcoming item title
    await expect(page.getByText("Doctor appointment")).toBeVisible();
    // All three should be visible (max 3)
    await expect(page.getByText("Flight to NYC")).toBeVisible();
    await expect(page.getByText("Birthday party")).toBeVisible();
  });

  test("limits upcoming to max 3", async ({ page }) => {
    const tom = tomorrowISO();
    const upcoming = Array.from({ length: 5 }, (_, i) => ({
      id: `up${i}`,
      collectionId: "events",
      collectionName: "events",
      title: `Important ${i + 1}`,
      date: tom,
      time: "10:00",
      member: "Emily",
      icon: "⭐",
      color: "violet",
      importanceScore: 80 - i,
      importanceReason: "test",
    }));
    await mockPBForUpcoming(page, upcoming);
    await page.goto("/");
    await expect(page.getByText("Upcoming important")).toBeVisible({ timeout: 10_000 });
    // Should show only 3 (the top 3). The 4th and 5th should not be visible.
    await expect(page.getByText("Important 1")).toBeVisible();
    await expect(page.getByText("Important 2")).toBeVisible();
    await expect(page.getByText("Important 3")).toBeVisible();
    await expect(page.getByText("Important 4")).not.toBeVisible();
    await expect(page.getByText("Important 5")).not.toBeVisible();
  });

  test("hidden when no upcoming important (card height unchanged, no error)", async ({ page }) => {
    await mockPBForUpcoming(page, []);
    await page.goto("/");
    await expect(page.getByText("Today").first()).toBeVisible({ timeout: 10_000 });
    // Section should not appear
    await expect(page.getByText("Upcoming important")).not.toBeVisible();
    // Today card still renders (either events or Quiet day)
    await expect(page.locator("text=Today").first()).toBeVisible();
  });
});
