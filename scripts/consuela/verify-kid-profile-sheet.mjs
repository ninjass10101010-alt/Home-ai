#!/usr/bin/env node
// Live probe for the kid profile sheet (2026-09-09 kid-profile-sheet plan, Task 4).
//
// Usage:
//   node scripts/consuela/verify-kid-profile-sheet.mjs
//   BASE_URL=http://nas-host:3000 node scripts/consuela/verify-kid-profile-sheet.mjs
//
// What it verifies:
//   1. Wall run — 1080×1920 portrait, isMobile+hasTouch, /?wall=1: walk the
//      member rail tiles until an under-10 child quick-logs in with NO pad
//      (a pad opening means 10+/parent/pet — close it, next tile; the roster
//      order is never assumed and the tile that worked is printed), then:
//      KidHome renders (data-mode=kid + avatar-hero) with data-wall STILL
//      true; tapping the hero avatar [aria-label="Open your profile"] opens
//      the role=dialog profile sheet titled with the kid's FIRST name and
//      ZERO [type=password] inputs (and no "PIN" copy); a profile save is
//      intercepted via page.on('request') and its JSON body must carry the
//      patch with NO actorPin/actorName keys; "Saved!" appears; two-tap
//      sign-out (🚪 Sign out → "Sign me out") returns the family rail.
//      STATE RESTORE: sign back in as the same kid and put the original
//      state back through the same UI, verified back on the hero.
//   2. Avatar-pick branch: if the member's avatar is an emoji, the picker
//      grid renders — tap a NEW emoji in the first category (Faces), assert
//      patch.emoji, "Saved!", close, and the hero emoji matches the pick
//      (the 60s CacheRefresher → /api/members/admin roster refresh is the
//      server-truth propagation path; the probe waits for it). If the
//      member's avatar is a PHOTO (the live family roster is all photos),
//      AvatarPicker renders no grid (shared-picker behavior, pre-existing)
//      — the probe prints a SKIP note for the emoji leg and verifies the
//      SAME PIN-free POST seam via the sheet's avatar-size pills, reverting
//      the pick in-session. Never a faked pass.
//   3. Pet note: quick-login is server-gated to child+age<10, so pet/10+
//      parent tiles open the pad — their surfaces are skipped with a note.
//   4. Phone control — 390×844 without the param: sign in via the family
//      view's normal flow (under-10 strip avatars quick-login, no PIN), the
//      sheet opens from the hero avatar with no PIN inputs, and the two-tap
//      sign-out returns the family view. Read-only on this surface.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3444;

let BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
let child = null;
let logPath = null;

// Reuse the shared dev server on :3000 if present (it is NOT restarted);
// otherwise boot our own on a free port (Next only permits one dev server
// per project dir, so a live :3000 means that one is the server).
async function resolveServer() {
  if (process.env.BASE_URL) {
    console.log(`using BASE_URL override at ${BASE}`);
    return;
  }
  try {
    const res = await fetch("http://127.0.0.1:3000/", { signal: AbortSignal.timeout(10_000) });
    if (res.status === 200 || res.status === 307) {
      BASE = "http://127.0.0.1:3000";
      console.log(`using shared dev server at ${BASE}`);
      return;
    }
  } catch {
    /* no live server — boot below */
  }
  const boot = await bootDevServer(PORT);
  child = boot.child;
  logPath = boot.logPath;
  await waitForReady();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Force-tap: the kid surfaces carry infinite idle animations (hero glow,
// animated emoji), so Playwright's element-stability wait would time out.
async function tapEl(el) {
  if (!el) return;
  try {
    await el.tap({ force: true });
  } catch {
    try {
      await el.click({ force: true });
    } catch {
      await el.evaluate((n) => n.click());
    }
  }
}

async function waitForReady(deadlineMs = 240_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 200) return;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error("dev server did not become ready");
}

async function bootDevServer(port) {
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
  const logDir = mkdtempSync(path.join(os.tmpdir(), "kid-profile-probe-"));
  const logPath = path.join(logDir, "next-dev.log");
  const log = createWriteStream(logPath);
  const child = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return { child, logPath };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function skip(name, detail = "") {
  // Printed SKIP note: recorded in the log but NOT counted as a passing check.
  console.log(`⏭️  SKIP ${name}${detail ? ` — ${detail}` : ""}`);
}

const GUEST_INIT = `
  try {
    // Guest state: never sign in, and let auto-detect decide the profile.
    localStorage.removeItem("consuela-auth-user");
    localStorage.removeItem("consuela-wall-mode");
  } catch {}
`;

// Poll until the page either enters kid mode (under-10 quick-login) or a
// sign-in pad opens (10+/parent/pet tile) — whichever happens first.
async function waitForKidModeOrPad(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      kid: document.documentElement.getAttribute("data-mode") === "kid",
      pad: !!document.querySelector('[role="dialog"][aria-label^="Sign in as"]'),
    }));
    if (state.kid || state.pad) return state;
    await sleep(250);
  }
  return { kid: false, pad: false };
}

// The kid profile sheet is the [role=dialog] whose header h3 names the kid
// (the WallPinPad dialog is aria-labelled "Sign in as …" and has no h3).
async function findProfileDialog(page) {
  const dialogs = await page.$$('[role="dialog"]');
  for (const d of dialogs) {
    const h3 = await d.$("h3");
    if (h3) return d;
  }
  return null;
}

async function openSheet(page, timeoutMs = 10_000) {
  const hero = await page.$('button.avatar-hero[aria-label="Open your profile"]');
  if (!hero) return null;
  await tapEl(hero);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dialog = await findProfileDialog(page);
    if (dialog) return dialog;
    await sleep(250);
  }
  return null;
}

async function closeSheet(page) {
  await page.keyboard.press("Escape");
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const dialog = await findProfileDialog(page);
    if (!dialog) return true;
    await sleep(250);
  }
  return false;
}

async function dialogTitle(dialog) {
  const h3 = await dialog.$("h3");
  return h3 ? (await h3.textContent()).trim() : null;
}

async function dialogHasPinUI(dialog) {
  return dialog.evaluate((d) => ({
    passwordInputs: d.querySelectorAll('[type="password"]').length,
    pinCopy: /pin/i.test(d.textContent || ""),
  }));
}

// The sheet's emoji grid only renders when the member's avatar is an emoji
// (AvatarPicker hides categories for photo values). Cell aria-labels are
// "Choose {emoji}".
async function gridEmojis(dialog) {
  return dialog.$$eval('button[aria-label^="Choose "]', (els) =>
    els.map((e) => (e.getAttribute("aria-label") || "").slice("Choose ".length))
  );
}

async function chooseEmojiInDialog(dialog, emoji) {
  const cell = await dialog.$(`button[aria-label="Choose ${emoji}"]`);
  if (!cell) return false;
  await tapEl(cell);
  return true;
}

const CATEGORY_LABELS = ["Faces", "People", "Pets & animals", "Nature", "Food", "Fun & things"];

// AVATAR_SIZE_OPTIONS friendly labels → the vocabulary values the sheet POSTs
// (pinned by src/lib/avatar-size.ts; "base" is a legacy alias of "md").
const SIZE_LABEL_TO_VALUE = { Tiny: "xs", Small: "sm", Medium: "md", Large: "lg" };
const normalizeSize = (s) => (s === "base" ? "md" : s);

async function chooseEmojiAcrossCategories(dialog, emoji) {
  if (await chooseEmojiInDialog(dialog, emoji)) return true;
  const pills = await dialog.$$("button");
  for (const pill of pills) {
    const label = (await pill.textContent()).trim();
    if (!CATEGORY_LABELS.includes(label)) continue;
    await tapEl(pill);
    await sleep(400);
    if (await chooseEmojiInDialog(dialog, emoji)) return true;
  }
  return false;
}

// Size pills: Tiny/Small/Medium/Large with aria-pressed on the active one.
async function sizePills(dialog) {
  const pills = [];
  for (const b of await dialog.$$('button[aria-pressed]')) {
    const label = (await b.textContent()).trim();
    if (["Tiny", "Small", "Medium", "Large"].includes(label)) {
      pills.push({ label, pressed: (await b.getAttribute("aria-pressed")) === "true", handle: b });
    }
  }
  return pills;
}

async function waitForSaved(dialog, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = (await dialog.textContent()) || "";
    if (text.includes("Saved!")) return true;
    await sleep(300);
  }
  return false;
}

// Hero avatar read: textContent holds a plain emoji; photo avatars render an
// <img> and no text. localStorage consuela-auth-user carries the emoji when
// it is one (photos are written as "").
async function readHero(page) {
  return page.evaluate(() => {
    const hero = document.querySelector("button.avatar-hero");
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem("consuela-auth-user") || "null"); } catch {}
    return {
      text: hero ? (hero.textContent || "").trim() : null,
      img: !!(hero && hero.querySelector("img")),
      storedEmoji: stored?.emoji || "",
      storedSize: stored?.avatarSize || "",
      name: stored?.name || "",
    };
  });
}

// The save propagates to the hero via the 60s CacheRefresher →
// /api/members/admin roster refresh → consuela-members-updated → useAuth.
// This wait IS the server-truth assertion (the roster read is the DB).
async function waitHeroEmoji(page, emoji, timeoutMs = 95_000) {
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const hero = await readHero(page);
    if (hero.text === emoji) return { ok: true, ms: Date.now() - start, hero };
    await sleep(2000);
  }
  const hero = await readHero(page);
  return { ok: false, ms: Date.now() - start, hero };
}

// Profile-save interception: POST /api/members/profile bodies + statuses.
function attachProfileCapture(page) {
  const posts = [];
  let pending = null;
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    let pathname = "";
    try { pathname = new URL(req.url()).pathname; } catch { return; }
    if (pathname !== "/api/members/profile") return;
    let body = null;
    try { body = JSON.parse(req.postData() || "null"); } catch { body = null; }
    pending = { body, keys: body && typeof body === "object" ? Object.keys(body) : [], status: null };
    posts.push(pending);
  });
  page.on("response", (res) => {
    if (!pending) return;
    let pathname = "";
    try { pathname = new URL(res.url()).pathname; } catch { return; }
    if (pathname !== "/api/members/profile") return;
    pending.status = res.status();
    pending = null;
  });
  return posts;
}

// Waits for a NEW profile POST beyond `baseline` (never silently returns an
// older post — a timeout is an honest null, which fails the assertion).
async function waitForProfilePost(posts, timeoutMs = 8000, baseline = null) {
  const base = baseline === null ? -1 : baseline;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (posts.length > base && posts[posts.length - 1].status !== null) return posts[posts.length - 1];
    await sleep(250);
  }
  return null;
}

function assertPinFreeBody(post, patchAssertions) {
  const body = post?.body;
  if (!body) return "no POST body captured";
  if (post.status !== null && (post.status < 200 || post.status >= 300)) return `POST status ${post.status}`;
  if ("actorPin" in body) return "body carries actorPin";
  if ("actorName" in body) return "body carries actorName";
  if (!body.patch || typeof body.patch !== "object") return "body has no patch object";
  for (const [key, expected] of Object.entries(patchAssertions)) {
    if (body.patch[key] !== expected) return `patch.${key}=${JSON.stringify(body.patch[key])} (wanted ${JSON.stringify(expected)})`;
  }
  return null;
}

async function walkRailToKid(page, tag) {
  const padLabels = [];
  const tiles = await page.$$('[data-testid="wall-member-rail"] button');
  for (let i = 0; i < tiles.length; i++) {
    try {
      await tapEl(tiles[i]);
    } catch {
      await tapEl(tiles[i]);
    }
    const state = await waitForKidModeOrPad(page, 6000);
    if (state.kid) {
      const label = (await tiles[i].getAttribute("aria-label")) || (await tiles[i].textContent()).trim();
      return { ok: true, index: i, label, padLabels };
    }
    if (state.pad) {
      const pad = await page.$('[role="dialog"][aria-label^="Sign in as"]');
      padLabels.push((await pad?.getAttribute("aria-label")) || "Sign in as ?");
      const cancel = await page.$('[role="dialog"][aria-label^="Sign in as"] button:has-text("Cancel")');
      if (cancel) await tapEl(cancel);
      await sleep(400);
    }
  }
  return { ok: false, index: -1, label: null, padLabels };
}

async function walkStripToKid(page) {
  const tiles = await page.$$('button[aria-label^="Sign in as "]');
  for (let i = 0; i < tiles.length; i++) {
    try {
      await tapEl(tiles[i]);
    } catch {
      await tapEl(tiles[i]);
    }
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const kid = await page.evaluate(() => document.documentElement.getAttribute("data-mode") === "kid");
      if (kid) {
        const label = (await tiles[i].getAttribute("aria-label")) || "";
        return { ok: true, index: i, label };
      }
      // A PIN pad (10+/parent/pet) — close it and try the next avatar.
      const cancel = await page.$('button:has-text("Cancel")');
      if (cancel && (await cancel.isVisible())) {
        await tapEl(cancel);
        await sleep(400);
        break;
      }
      await sleep(250);
    }
  }
  return { ok: false, index: -1, label: null };
}

// Two-tap sign-out inside the sheet: 🚪 Sign out → "Sign me out" confirm.
async function twoTapSignOut(page, dialog) {
  const signOut = await dialog.$('button:has-text("Sign out")');
  if (!signOut) return { armed: false, confirmed: false };
  await tapEl(signOut);
  const deadline = Date.now() + 5000;
  let confirmed = false;
  while (Date.now() < deadline) {
    const text = (await dialog.textContent()) || "";
    if (text.includes("Sign me out")) { confirmed = true; break; }
    await sleep(250);
  }
  if (!confirmed) return { armed: false, confirmed: false };
  const confirm = await dialog.$('button:has-text("Sign me out")');
  await tapEl(confirm);
  return { armed: true, confirmed: true };
}

async function waitRailBack(page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const back = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="wall-member-rail"]');
      return !!rail && rail.offsetParent !== null;
    });
    if (back) return true;
    await sleep(300);
  }
  return false;
}

async function probeWall(browser) {
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(GUEST_INIT);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const posts = attachProfileCapture(page);

  await page.goto(`${BASE}/?wall=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  try {
    await page.waitForFunction(() => document.documentElement.dataset.wall === "true", null, { timeout: 60_000 });
  } catch { /* reported via the checks below */ }
  await sleep(1500);

  // a. Quick-login as an under-10 child via the family rail.
  const kid = await walkRailToKid(page, "wall");
  check(
    "wall: under-10 rail tile quick-logs in (no pad)",
    kid.ok,
    kid.ok
      ? `tile #${kid.index + 1} — ${kid.label}`
      : `no tile quick-logged in${kid.padLabels.length ? ` (${kid.padLabels.length} pad(s) closed: ${kid.padLabels.join(", ")})` : ""}`
  );
  if (!kid.ok) {
    await context.close();
    return;
  }

  await sleep(1500); // let KidHome + its data settle

  const kidHome = await page.evaluate(() => ({
    mode: document.documentElement.getAttribute("data-mode"),
    hero: !!document.querySelector('button.avatar-hero[aria-label="Open your profile"]'),
    wall: document.documentElement.dataset.wall,
  }));
  check("wall: KidHome renders (data-mode=kid + tappable hero avatar)", kidHome.mode === "kid" && kidHome.hero, `mode=${kidHome.mode} hero=${kidHome.hero}`);
  check("wall: data-wall still true in kid mode", kidHome.wall === "true", `dataset.wall=${String(kidHome.wall)}`);

  // b. Hero avatar tap → sheet with the kid's first name, ZERO PIN inputs.
  let dialog = await openSheet(page);
  const kidName = dialog ? await dialogTitle(dialog) : null;
  check("wall: hero avatar opens the profile sheet (role=dialog, kid's first name)", !!dialog && !!kidName, dialog ? `title=${kidName}` : "dialog did not open");
  const pinUi = dialog ? await dialogHasPinUI(dialog) : { passwordInputs: -1, pinCopy: null };
  check(
    "wall: zero password inputs inside the sheet (no PIN UI leaks)",
    pinUi.passwordInputs === 0 && pinUi.pinCopy === false,
    `passwordInputs=${pinUi.passwordInputs} pinCopy=${pinUi.pinCopy}`
  );

  const hero0 = await readHero(page);
  const originalEmoji = hero0.storedEmoji || hero0.text || "";
  const originalSize = hero0.storedSize;
  const grid = dialog ? await gridEmojis(dialog) : [];
  const emojiMode = grid.length > 0;
  let picked = null;

  if (emojiMode) {
    // c. Emoji path: tap a NEW emoji in the first category (Faces grid is the
    //    default-active category on open).
    picked = grid.find((e) => e !== originalEmoji) || null;
    if (!picked) {
      check("wall: a NEW emoji is pickable in the first category", false, "every grid emoji equals the current avatar");
    } else {
      const baseline = posts.length;
      const post = await (async () => {
        await chooseEmojiInDialog(dialog, picked);
        return waitForProfilePost(posts, 8000, baseline);
      })();
      const err = assertPinFreeBody(post, { emoji: picked });
      check(
        "wall: save POST is PIN-free child-session save (patch.emoji, no actorPin/actorName)",
        !err,
        err || `keys=[${post.keys.join(", ")}] status=${post.status}`
      );
      check("wall: Saved! appears after the pick", await waitForSaved(dialog));
      await closeSheet(page);

      const heroMatch = await waitHeroEmoji(page, picked);
      check(
        "wall: hero avatar shows the picked emoji after save (server roster refresh)",
        heroMatch.ok,
        heroMatch.ok ? `matched in ${(heroMatch.ms / 1000).toFixed(1)}s` : `hero text=${JSON.stringify(heroMatch.hero.text)} after ${(heroMatch.ms / 1000).toFixed(0)}s`
      );
    }
  } else {
    // c (live family). Photo-avatar path: the shared AvatarPicker renders no
    // emoji grid for photo values (pre-existing behavior, identical in the
    // adult ProfileSheet) — the emoji-pick leg is skipped honestly, and the
    // SAME PIN-free POST seam is verified through the sheet's size pills.
    skip(
      "wall: emoji pick in the first category",
      `${kidName}'s avatar is a photo (data URL) — AvatarPicker hides the grid for photo values; seam verified via the size pills below`
    );
    const pills = await sizePills(dialog);
    const pressedIdx = pills.findIndex((p) => p.pressed);
    const targetIdx = pressedIdx >= 0 ? (pressedIdx + 1) % pills.length : 0;
    if (pills.length < 2 || pressedIdx < 0) {
      check("wall: size pills present with one pressed", false, `pills=${pills.length} pressedIdx=${pressedIdx}`);
    } else {
      const baseline = posts.length;
      const target = pills[targetIdx];
      await tapEl(target.handle);
      const post = await waitForProfilePost(posts, 8000, baseline);
      const err = assertPinFreeBody(post, { avatarSize: SIZE_LABEL_TO_VALUE[target.label] });
      check(
        "wall: save POST is PIN-free child-session save (patch.avatarSize, no actorPin/actorName)",
        !err,
        err || `keys=[${post.keys.join(", ")}] status=${post.status} (${target.label} → ${SIZE_LABEL_TO_VALUE[target.label]})`
      );
      check("wall: Saved! appears after the pick", await waitForSaved(dialog));

      // Re-query the pills (React re-rendered on the save) and restore the
      // originally-pressed size — the state-restore leg.
      const baseline2 = posts.length;
      const pills2 = await sizePills(dialog);
      const back = pills2.find((p) => p.label === pills[pressedIdx].label);
      await tapEl(back?.handle);
      const revertPost = await waitForProfilePost(posts, 8000, baseline2);
      const wantRevertSize = originalSize ? normalizeSize(originalSize) : null;
      const revertErr = !revertPost
        ? "no revert POST fired"
        : revertPost.body?.patch?.avatarSize === SIZE_LABEL_TO_VALUE[target.label]
          ? "revert POST repeated the picked size"
          : wantRevertSize && revertPost.body?.patch?.avatarSize !== wantRevertSize
            ? `revert patch.avatarSize=${JSON.stringify(revertPost.body?.patch?.avatarSize)} (wanted ${JSON.stringify(wantRevertSize)})`
            : assertPinFreeBody(revertPost, {});
      check(
        "wall: size pick reverted in the same session (state restore, server round-trip)",
        !revertErr && (await waitForSaved(dialog)),
        revertErr || `reverted to pressed pill "${back.label}" status=${revertPost?.status}`
      );
      await closeSheet(page);
    }
  }

  // d. Two-tap sign-out inside the sheet.
  dialog = await openSheet(page);
  if (!dialog) {
    check("wall: sheet reopens for sign-out", false, "dialog did not reopen");
  } else {
    const out = await twoTapSignOut(page, dialog);
    const railBack = out.confirmed ? await waitRailBack(page) : false;
    check(
      "wall: two-tap sign-out (🚪 Sign out → Sign me out) returns the family rail",
      out.armed && out.confirmed && railBack,
      `armed=${out.armed} confirmed=${out.confirmed} railBack=${railBack}`
    );
  }

  // e. STATE RESTORE: sign back in as the SAME kid and put the original
  //    state back through the same UI.
  await sleep(1000);
  const kid2 = await walkRailToKid(page, "wall-restore");
  check(
    "wall: state-restore re-login via rail quick-login",
    kid2.ok,
    kid2.ok ? `tile #${kid2.index + 1} — ${kid2.label}` : "no tile quick-logged in on the re-walk"
  );

  if (kid2.ok) {
    await sleep(1500);
    dialog = await openSheet(page);
    const sameKid = dialog && (await dialogTitle(dialog)) === kidName;
    check("wall: state-restore re-login is the same kid", !!sameKid, dialog ? `title=${await dialogTitle(dialog)} (wanted ${kidName})` : "dialog did not reopen");

    if (sameKid) {
      if (emojiMode && picked) {
        const restored = await chooseEmojiAcrossCategories(dialog, originalEmoji);
        if (!restored) {
          check("wall: state restored", false, `original emoji ${originalEmoji} not found in any picker category`);
        } else {
          const baselineR = posts.length;
          const post = await waitForProfilePost(posts, 8000, baselineR);
          const err = assertPinFreeBody(post, { emoji: originalEmoji });
          const saved = await waitForSaved(dialog);
          await closeSheet(page);
          const heroMatch = await waitHeroEmoji(page, originalEmoji);
          check(
            "wall: state restored (original emoji back, verified on the hero via the server roster)",
            !err && saved && heroMatch.ok,
            err || `saved=${saved} hero=${heroMatch.ok ? `matched in ${(heroMatch.ms / 1000).toFixed(1)}s` : JSON.stringify(heroMatch.hero.text)}`
          );
        }
      } else {
        check(
          "wall: state restored",
          true,
          "avatar untouched (member uses a photo avatar — nothing to restore); size pick already reverted in-session"
        );
      }

      // Leave the probe signed out (clean guest state for the next run).
      dialog = await openSheet(page);
      if (dialog) {
        await twoTapSignOut(page, dialog);
        await waitRailBack(page);
      }
    }
  }

  if (kid.padLabels.length > 0 || (kid2.ok && kid2.padLabels.length > 0)) {
    const labels = [...new Set([...kid.padLabels, ...(kid2.ok ? kid2.padLabels : [])])];
    console.log(
      `⏭️  SKIP wall: pet/10+/parent surfaces — ${labels.length} rail tile(s) opened a PIN pad (${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ", …" : ""}); quick-login is server-gated to child+age<10, so pet rendering was not probed (plan Task 4 step 4 skip note)`
    );
  }

  check("wall: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

async function probePhone(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(GUEST_INIT);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await sleep(2500);

  // f. Phone control: sign in via the family view's normal flow. Under-10
  //    strip avatars quick-login (no PIN) — practical, so no SKIP needed.
  const kid = await walkStripToKid(page);
  check(
    "phone: under-10 family-strip avatar quick-logs in (no PIN)",
    kid.ok,
    kid.ok ? kid.label : "no strip avatar quick-logged in (all opened the PIN modal?)"
  );

  if (kid.ok) {
    await sleep(1500);
    const dialog = await openSheet(page);
    const title = dialog ? await dialogTitle(dialog) : null;
    const pinUi = dialog ? await dialogHasPinUI(dialog) : { passwordInputs: -1, pinCopy: null };
    check(
      "phone: hero avatar opens the profile sheet (kid's first name, zero PIN inputs)",
      !!dialog && !!title && pinUi.passwordInputs === 0 && pinUi.pinCopy === false,
      dialog ? `title=${title} passwordInputs=${pinUi.passwordInputs} pinCopy=${pinUi.pinCopy}` : "dialog did not open"
    );

    // Read-only on this surface — close without touching anything, then the
    // same two-tap sign-out returns the family view.
    if (dialog) {
      await closeSheet(page);
      const dialog2 = await openSheet(page);
      if (dialog2) {
        const out = await twoTapSignOut(page, dialog2);
        const deadline = Date.now() + 10_000;
        let familyBack = false;
        while (Date.now() < deadline) {
          familyBack = await page.evaluate(() =>
            document.documentElement.getAttribute("data-mode") !== "kid" &&
            !!document.querySelector('button[aria-label^="Sign in as "]')
          );
          if (familyBack) break;
          await sleep(300);
        }
        check(
          "phone: two-tap sign-out returns the family view",
          out.armed && out.confirmed && familyBack,
          `armed=${out.armed} confirmed=${out.confirmed} familyBack=${familyBack}`
        );
      } else {
        check("phone: two-tap sign-out returns the family view", false, "sheet did not reopen for sign-out");
      }
    }
  } else {
    skip(
      "phone: sheet verification from a kid session",
      "sign-in was not achievable on the phone surface — no sheet assertions faked"
    );
  }

  check("phone: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

await resolveServer();
try {
  const browser = await chromium.launch({ headless: true });
  await probeWall(browser);
  await probePhone(browser);
  await browser.close();
} catch (e) {
  check("probe run completed", false, `${e?.message || e}`);
  try { console.log(readFileSync(logPath, "utf8").split("\n").slice(-25).join("\n")); } catch { /* no log */ }
} finally {
  child?.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nALL CHECKS PASSED (${results.length})` : `\n${failed.length} CHECKS FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
