import { chromium } from "playwright";

const BASE = process.env.DASH_URL || "http://localhost:3000";
const CARD = '[role="group"][aria-label*="degrees"]';
let failures = 0;
const ok = (cond, label, extra = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` (${extra})` : ""}`);
  if (!cond) failures++;
};

function makePayload({ cloud = 90, visibility = 800, isDay = 1, code = 3 } = {}) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const hourlyTimes = [];
  for (let i = -1; i < 24; i++) hourlyTimes.push(new Date(now.getTime() + i * 3600000).toISOString());
  const dailyTimes = [];
  for (let i = 0; i < 6; i++) dailyTimes.push(new Date(now.getTime() + i * 86400000).toISOString().slice(0, 10));
  const sunrise = new Date(now.getTime() - 4 * 3600000);
  const sunset = new Date(now.getTime() + 6 * 3600000);
  return {
    current: { temperature_2m: 70, relative_humidity_2m: 55, apparent_temperature: 72, weather_code: code, wind_speed_10m: 8, wind_direction_10m: 250, is_day: isDay, cloud_cover: cloud, uv_index: 6, pressure_msl: 1016, visibility },
    hourly: {
      time: hourlyTimes,
      temperature_2m: hourlyTimes.map(() => 70),
      weather_code: hourlyTimes.map(() => code),
      precipitation_probability: hourlyTimes.map(() => 5),
      is_day: hourlyTimes.map(() => isDay),
      cloud_cover: hourlyTimes.map(() => cloud),
      wind_speed_10m: hourlyTimes.map(() => 8),
      wind_direction_10m: hourlyTimes.map(() => 250),
      relative_humidity_2m: hourlyTimes.map(() => 55),
      visibility: hourlyTimes.map(() => visibility),
    },
    daily: {
      time: dailyTimes,
      weather_code: [code, 1, 1, 1, 1, 1],
      temperature_2m_max: [75, 76, 77, 78, 79, 80],
      temperature_2m_min: [58, 59, 60, 61, 62, 63],
      precipitation_probability_max: [10, 10, 10, 10, 10, 10],
      sunrise: dailyTimes.map(() => sunrise.toISOString()),
      sunset: dailyTimes.map(() => sunset.toISOString()),
      uv_index_max: [6, 5, 4, 3, 2, 1],
    },
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

let scenario = { cloud: 90, visibility: 800 };
let fetchedUrl = "";
await page.route("**/api.open-meteo.com/**", (route) => {
  if (route.request().url().includes("temperature_2m")) fetchedUrl = route.request().url();
  route.fulfill({ json: makePayload(scenario) });
});

const load = async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(CARD, { timeout: 15000 });
  await page.waitForTimeout(2500);
};

// ── Scenario A: overcast + low visibility (day) ─────────────────────────────
await load();

console.log("[data wiring]");
ok(/current=[^&]*visibility/.test(fetchedUrl), "fetch requests current visibility");
ok(/hourly=[^&]*visibility/.test(fetchedUrl), "fetch requests hourly visibility");

console.log("[poster clouds — 90% cover]");
const cloudInfo = await page.evaluate((selector) => {
  const card = document.querySelector(selector);
  const cloudLayer = card?.querySelector('[data-testid="wx-poster-clouds"]');
  if (!cloudLayer) return null;
  const puffs = Array.from(cloudLayer.querySelectorAll("[data-cloud-layer]")).map((puff) => {
    const style = getComputedStyle(puff);
    return {
      form: puff.getAttribute("data-cloud-form"),
      layer: puff.getAttribute("data-cloud-layer"),
      opacity: Number(style.opacity),
      visibility: style.visibility,
    };
  });
  return {
    cover: cloudLayer.getAttribute("data-cloud-cover"),
    visible: cloudLayer.getAttribute("data-visible"),
    count: puffs.length,
    characters: cloudLayer.querySelectorAll('[data-weather-character="cloud"]').length,
    puffs,
  };
}, CARD);
ok(cloudInfo?.cover === "90" && cloudInfo.visible === "true", "poster cloud layer carries measured 90% cover", JSON.stringify(cloudInfo));
ok(cloudInfo?.count === 2, "measured cover renders a finite two-layer cloud stack", cloudInfo?.count);
ok(cloudInfo?.puffs.every(({ form, layer, opacity, visibility }) => form && layer && opacity > 0 && visibility === "visible"), "cloud puffs expose data-backed visible layers", JSON.stringify(cloudInfo?.puffs));
ok(cloudInfo?.characters === 1, "measured front cloud carries one geometric character", `characters=${cloudInfo?.characters}`);

console.log("[visibility fog — 800m]");
const fogA = await page.evaluate(() => !!document.querySelector('[data-testid="wx-fog"]'));
ok(fogA, "fog renders from real 800m visibility");

// ── Scenario B: clear visibility ────────────────────────────────────────────
scenario = { cloud: 90, visibility: 16000 };
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(CARD, { timeout: 15000 });
await page.waitForTimeout(2500);
console.log("[visibility fog — 16km]");
const fogB = await page.evaluate(() => !!document.querySelector('[data-testid="wx-fog"]'));
ok(!fogB, "no fog when visibility is clear");
const birdsB = await page.evaluate(() => {
  const birds = document.querySelector('[data-testid="wx-birds"]');
  if (!birds) return null;
  const style = getComputedStyle(birds);
  return { visible: birds.getAttribute("data-visible"), opacity: style.opacity, visibility: style.visibility };
});
ok(birdsB?.visible === "false" && birdsB.opacity === "0" && birdsB.visibility === "hidden", "birds stay data-visible false and hidden under 90% cloud cover", JSON.stringify(birdsB));

// ── Scenario D: clear sky — birds out ───────────────────────────────────────
scenario = { cloud: 10, visibility: 16000, code: 0 };
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(CARD, { timeout: 15000 });
await page.waitForTimeout(2500);
console.log("[birds — clear sky]");
const sunCharacter = await page.evaluate(() => document.querySelectorAll('[data-testid="wx-poster-accents"] [data-weather-character="sun"]').length);
ok(sunCharacter === 1, "clear-day sun carries the geometric character", `characters=${sunCharacter}`);
const birdsD = await page.evaluate(() => {
  const b = document.querySelector('[data-testid="wx-birds"]');
  if (!b) return null;
  const wrappers = [...b.children];
  return {
    opacity: b.style.opacity,
    count: b.querySelectorAll("svg path").length,
    orbit: wrappers.length === 3 && wrappers.every((w) => (w.style.animation || "").includes("wxBirdOrbit")),
    flap: b.querySelectorAll('animate[attributeName="d"]').length,
  };
});
ok(birdsD && birdsD.opacity === "1", "birds visible on a clear day", JSON.stringify(birdsD));
ok(birdsD && birdsD.count === 3, "three birds orbit the sun");
ok(birdsD && birdsD.orbit, "birds fly the left-to-right-then-behind-the-sun orbit");
ok(birdsD && birdsD.flap === 3, "seagull wing-flap morphs each bird's path");

// ── Scenario C: forced night — single poster moon ────────────────────────────
scenario = { cloud: 20, visibility: 16000, isDay: 0, code: 0 };
await page.evaluate(() => {
  const raw = localStorage.getItem("home-ai-weather-config");
  const cfg = raw ? JSON.parse(raw) : {};
  cfg.timeOfDay = "night";
  localStorage.setItem("home-ai-weather-config", JSON.stringify(cfg));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(CARD, { timeout: 15000 });
await page.waitForTimeout(2500);
console.log("[single poster moon — forced night]");
const moon = await page.evaluate((selector) => {
  const card = document.querySelector(selector);
  const scene = card?.querySelector('[data-testid="wx-scene-layers"]');
  const hero = card?.querySelector('[data-testid="wx-hero-icon"]');
  return {
    posterMoons: scene?.querySelectorAll('[data-weather-character="moon"]').length ?? 0,
    heroStars: !!hero?.querySelector('[data-weather-icon="night-stars"]'),
    heroMoons: hero?.querySelectorAll('[data-testid="wx-moon"]').length ?? 0,
  };
}, CARD);
ok(moon.posterMoons === 1, "one illustrated poster moon renders at night", JSON.stringify(moon));
ok(moon.heroStars && moon.heroMoons === 0, "condition glyph uses stars instead of duplicating the moon", JSON.stringify(moon));

console.log("[modal moon row]");
await page.locator('button[aria-label="Open weather details"]').click();
await page.waitForTimeout(400);
const moonRow = await page.evaluate(() => {
  const text = document.body.textContent || "";
  const phaseWord = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"].find((w) => text.includes(w));
  const pct = phaseWord ? /(\d{1,3})%/.exec(text.slice(text.indexOf(phaseWord))) : null;
  return { hasMoon: text.includes("Moon"), phaseWord, pct: pct?.[1] };
});
ok(moonRow.hasMoon, "Daylight card shows Moon row");
ok(!!moonRow.phaseWord, "moon phase name shown", moonRow.phaseWord);
ok(moonRow.pct != null && Number(moonRow.pct) >= 0 && Number(moonRow.pct) <= 100, "illumination % shown", `${moonRow.pct}%`);
await page.keyboard.press("Escape");

// ── cleanup ─────────────────────────────────────────────────────────────────
await page.evaluate(() => {
  const raw = localStorage.getItem("home-ai-weather-config");
  const cfg = raw ? JSON.parse(raw) : {};
  delete cfg.timeOfDay;
  localStorage.setItem("home-ai-weather-config", JSON.stringify(cfg));
});
ok(errors.length === 0, "0 page errors", errors.slice(0, 2).join(" | "));

await browser.close();
console.log(failures === 0 ? "\nALL FEATURE CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
