import { test, expect } from "@playwright/test";

test("debug: home loads and shows upcoming (mocked PB)", async ({ page }) => {
  page.on("console", (msg) => console.log("[browser]", msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("requestfailed", (req) => {
    console.log("[fail]", req.method(), req.url(), req.failure()?.errorText);
  });

  const todayISO = new Date().toISOString().split("T")[0];
  const tom = (() => { const dt = new Date(); dt.setDate(dt.getDate() + 1); return dt.toISOString().split("T")[0]; })();

  await page.route("**/api/collections/events/records**", async (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get("filter") || "";
    console.log("[route]", route.request().method(), url.pathname + url.search);
    if (filter.includes("importanceScore")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          page: 1, perPage: 3, totalItems: 3, totalPages: 1,
          items: [
            { id: "up1", title: "Doctor appointment", date: tom, time: "10:00 AM", member: "Rebecca", icon: "🩺", color: "#f43f5e", importanceScore: 80, importanceReason: "doctor" },
            { id: "up2", title: "Game vs Riverside", date: (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split("T")[0]; })(), time: "", member: "Caspian", icon: "⚽", color: "#22c55e", importanceScore: 70, importanceReason: "game" },
            { id: "up3", title: "Parent Teacher Conference", date: (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().split("T")[0]; })(), time: "", member: "Rebecca", icon: "🗓️", color: "#3b82f6", importanceScore: 70, importanceReason: "parent teacher" },
          ],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ page: 1, perPage: 100, totalItems: 1, totalPages: 1, items: [
          { id: "t1", title: "Soccer Practice", date: todayISO, time: "16:00", member: "Emily", icon: "⚽", color: "violet" }
        ]}),
      });
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible({ timeout: 10_000 });
  const upcoming = page.getByText("Upcoming important");
  console.log("upcoming count", await upcoming.count());
  await expect(upcoming).toBeVisible({ timeout: 10_000 });
});