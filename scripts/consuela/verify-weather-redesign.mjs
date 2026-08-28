// Verify the "(Not Boring), Consuela-style" weather card redesign.
// Run: node scripts/consuela/verify-weather-redesign.mjs
import { chromium } from "playwright";

const url = process.env.DASH_URL || "http://localhost:3000";
const browser = await chromium.launch();
let failures = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);
const check = (cond, okMsg, failMsg) => (cond ? pass(okMsg) : fail(failMsg));

async function newPage(vp) {
  const page = await browser.newPage({ viewport: vp });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { page, errors };
}

// ── 1. Desktop day: scene, strip, fit, interaction ──────────────────────────
{
  console.log("\n[desktop 1440 — day]");
  const { page, errors } = await newPage({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[role="img"][aria-label*="degrees"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const probe = await page.evaluate(() => {
    const card = document.querySelector('[role="img"][aria-label*="degrees"]');
    if (!card) return { card: false };
    const rect = card.getBoundingClientRect();
    const activeSky = card.querySelector('.wx-sky[data-active="true"]');
    const strip = card.querySelector('[role="slider"][aria-label="Preview the rest of the day"]');
    const stripSvg = strip?.querySelector("svg");
    const rainTicks = stripSvg?.querySelectorAll("rect").length ?? 0;
    const curve = stripSvg?.querySelector("path");
    const details = Array.from(card.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Open weather details");
    return {
      card: true,
      h: Math.round(rect.height),
      w: Math.round(rect.width),
      sky: activeSky ? getComputedStyle(activeSky).background.slice(0, 60) : null,
      strip: !!strip,
      stripW: stripSvg?.getBoundingClientRect().width ?? 0,
      rainTicks,
      curve: !!curve,
      labels: strip?.textContent ?? "",
      details: !!details,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      tempText: card.querySelector('[role="status"]')?.textContent?.slice(0, 80) ?? "",
    };
  });

  check(probe.card, "weather card rendered", "weather card NOT found");
  if (probe.card) {
    check(probe.h <= 352 && probe.h >= 300, `card fits its 350px cell (${probe.h}px)`, `card height ${probe.h}px escapes the 350px cell`);
    check(!!probe.sky, `active sky layer (${probe.sky}…)`, "no active sky layer");
    check(probe.strip, "day strip slider present", "day strip slider missing");
    check(probe.stripW > 200, `strip measured real width (${Math.round(probe.stripW)}px)`, `strip width ${probe.stripW}px`);
    check(probe.curve, "temperature curve path drawn", "no temperature curve");
    check(probe.labels.includes("NOW"), "strip labels NOW", "strip missing NOW label");
    check(probe.details, "Details trigger present", "Details trigger missing");
    check(!probe.overflowX, "no horizontal overflow", "horizontal overflow detected");
    console.log(`    hero: ${probe.tempText}`);
  }
  check(errors.length === 0, "0 page errors", `page errors: ${errors.join(" | ")}`);

  // press-to-preview
  if (probe.strip) {
    const box = await page.locator('[role="slider"][aria-label="Preview the rest of the day"]').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 6 });
      await page.waitForTimeout(150);
      const duringPreview = await page.evaluate(() => {
        const strip = document.querySelector('[role="slider"][aria-label="Preview the rest of the day"]');
        const hero = document.querySelector('[role="status"]')?.textContent ?? "";
        return { valuenow: strip?.getAttribute("aria-valuenow"), hero: hero.slice(0, 60) };
      });
      check(duringPreview.valuenow !== "0", `press-to-preview engages (hour ${duringPreview.valuenow})`, "press-to-preview did not engage");
      console.log(`    preview hero: ${duringPreview.hero}`);
      await page.mouse.up();
      await page.waitForTimeout(1100);
      const afterRelease = await page.evaluate(() =>
        document.querySelector('[role="slider"][aria-label="Preview the rest of the day"]')?.getAttribute("aria-valuenow")
      );
      check(afterRelease === "0", "release animates back to now", `strip stuck at hour ${afterRelease}`);
    }
  }

  // modal
  await page.click('button[aria-label="Open weather details"]');
  await page.waitForTimeout(700);
  const modal = await page.evaluate(() => {
    const dialog = document.getElementById("weather-details-dialog");
    if (!dialog) return { open: false };
    const scrubber = dialog.querySelector('[role="slider"][aria-label="Scrub through the next 24 hours"]');
    const chips = dialog.querySelectorAll('[role="list"] button').length;
    const leaders = Array.from(dialog.querySelectorAll("span")).filter((s) => s.className.includes("border-dotted")).length;
    return {
      open: true,
      scrubber: !!scrubber,
      valuetext: scrubber?.getAttribute("aria-valuetext") ?? "",
      chips,
      leaders,
      uv: dialog.textContent?.includes("UV index") ?? false,
      sunArc: dialog.textContent?.includes("of daylight") ?? false,
      hourly: dialog.textContent?.includes("Next 24 Hours") ?? false,
    };
  });
  check(modal.open, "details modal opens", "modal did not open");
  if (modal.open) {
    check(modal.scrubber, `24h scrubber present (“${modal.valuetext}”)`, "scrubber missing");
    check(modal.leaders >= 4, `${modal.leaders} dotted-leader rows`, "dotted-leader rows missing");
    check(modal.chips >= 12, `${modal.chips} hourly chips`, "hourly chips missing");
    check(modal.uv, "UV index row present", "UV row missing");
    check(modal.sunArc, "sun arc with daylight length", "sun arc missing");
    check(modal.hourly, "hourly view default", "hourly view not default");

    // scrub to a later hour
    const sbox = await page.locator('[role="slider"][aria-label="Scrub through the next 24 hours"]').boundingBox();
    if (sbox) {
      await page.mouse.click(sbox.x + sbox.width * 0.8, sbox.y + sbox.height / 2);
      await page.waitForTimeout(300);
      const scrubbed = await page.evaluate(() => {
        const s = document.querySelector('[role="slider"][aria-label="Scrub through the next 24 hours"]');
        return { now: s?.getAttribute("aria-valuenow"), text: s?.getAttribute("aria-valuetext") ?? "" };
      });
      check(Number(scrubbed.now) > 0, `scrub moves to hour ${scrubbed.now} (“${scrubbed.text}”)`, "scrub did not move");
    }

    // daily toggle
    await page.click('[role="tab"]:has-text("daily")');
    await page.waitForTimeout(300);
    const daily = await page.evaluate(() => document.body.textContent?.includes("5-Day Forecast") ?? false);
    check(daily, "daily toggle shows 5-Day Forecast", "daily toggle broken");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => !document.getElementById("weather-details-dialog"));
    check(closed, "ESC closes the modal", "ESC did not close");
  }
  await page.close();
}

// ── 2. Forced night: full Not Boring palette ────────────────────────────────
{
  console.log("\n[desktop 1440 — forced night]");
  const { page, errors } = await newPage({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay: "night" }));
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[role="img"][aria-label*="degrees"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const night = await page.evaluate(() => {
    const card = document.querySelector('[role="img"][aria-label*="degrees"]');
    if (!card) return { card: false };
    const activeSky = card.querySelector('.wx-sky[data-active="true"]');
    const temp = card.querySelector('[role="status"] span');
    return {
      card: true,
      sky: activeSky ? getComputedStyle(activeSky).backgroundColor : null,
      skyBg: activeSky ? getComputedStyle(activeSky).background.slice(0, 60) : null,
      tempColor: temp ? getComputedStyle(temp).color : null,
    };
  });
  check(night.card, "card rendered at night", "card missing at night");
  if (night.card) {
    check(night.skyBg?.includes("rgb(6, 6, 9)"), `night sky active (${night.skyBg}…)`, `night sky wrong: ${night.skyBg}`);
    check(night.tempColor === "rgb(255, 255, 255)", `white hero numerals (${night.tempColor})`, `hero color ${night.tempColor}`);
  }
  check(errors.length === 0, "0 page errors", `page errors: ${errors.join(" | ")}`);
  await page.close();
}

// ── 3. Phone 390 ─────────────────────────────────────────────────────────────
{
  console.log("\n[phone 390]");
  const { page, errors } = await newPage({ width: 390, height: 844 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[role="img"][aria-label*="degrees"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const phone = await page.evaluate(() => {
    const card = document.querySelector('[role="img"][aria-label*="degrees"]');
    if (!card) return { card: false };
    const rect = card.getBoundingClientRect();
    const strip = card.querySelector('[role="slider"][aria-label="Preview the rest of the day"]');
    return {
      card: true,
      w: Math.round(rect.width),
      strip: !!strip,
      stripW: Math.round(strip?.querySelector("svg")?.getBoundingClientRect().width ?? 0),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  check(phone.card, "card rendered on phone", "card missing on phone");
  if (phone.card) {
    check(phone.w <= 390, `card width ${phone.w}px fits viewport`, `card overflows: ${phone.w}px`);
    check(phone.strip && phone.stripW > 250, `strip fills card (${phone.stripW}px)`, `strip too narrow: ${phone.stripW}px`);
    check(!phone.overflowX, "no horizontal overflow", "horizontal overflow on phone");
  }
  check(errors.length === 0, "0 page errors", `page errors: ${errors.join(" | ")}`);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
