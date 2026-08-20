// Verify protruding top-left icons on all Home widget cards across viewports.
// Run: node scripts/consuela/verify-protruding-icons.mjs
import { chromium } from "playwright";

const url = process.env.DASH_URL || "http://localhost:3000";
const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1280, height: 800 },
  { name: "wide", width: 1440, height: 900 },
];

const browser = await chromium.launch();
let failures = 0;

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const probe = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".widget-card"));
    const result = { cards: cards.length, protruding: 0, clipped: [], overflowX: false };
    for (const card of cards) {
      const icon = Array.from(card.querySelectorAll("div")).find(
        (d) =>
          d.className.includes("absolute") &&
          d.className.includes("z-30") &&
          d.className.includes("pointer-events-none") &&
          d.className.includes("top-[-12px]")
      );
      if (!icon) continue;
      result.protruding++;
      const cardRect = card.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      // Icon must overhang the card's top-left corner (protrusion works).
      const overhangs = iconRect.left < cardRect.left && iconRect.top < cardRect.top;
      // Same xl behavior as the weather widget: in the leftmost column the
      // 88px halo box overhangs the viewport edge by up to ~8px of soft glow
      // (page padding 16px minus 24px protrusion). Only flag if it's worse.
      const clipped = iconRect.left < -12 || iconRect.top < -12;
      if (!overhangs || clipped) {
        result.clipped.push({ left: Math.round(iconRect.left), top: Math.round(iconRect.top) });
      }
    }
    result.overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return result;
  });

  const ok = probe.cards > 0 && probe.protruding >= 6 && probe.clipped.length === 0 && !probe.overflowX;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${vp.name.padEnd(10)} ${vp.width}px  cards=${probe.cards} protruding=${probe.protruding} clipped=${JSON.stringify(probe.clipped)} overflowX=${probe.overflowX}`
  );
  if (!ok) failures++;
  await page.close();
}

await browser.close();
process.exit(failures ? 1 : 0);