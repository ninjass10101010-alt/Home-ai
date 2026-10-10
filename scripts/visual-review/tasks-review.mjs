#!/usr/bin/env node
// U3-0 — the committed machine gate for the /tasks page (Task 6 §B).
//
// This script is the ONLY evidence source a critic may use for the visual
// matrix: composited contrast (backdrop captured with the glyph hidden, 5th
// percentile glyph-core luminance), two-way CLS, overflow at 320 and 390,
// live-DOM fixture counts, tap targets, focus rings, motion budgets, the
// committed baselines and the keyboard transcript.
//
// It IMPORTS the exported seams of harness.mjs (bootServer, installSanitizedState,
// auditPage, withBrowser, ROLES, VIEWPORTS) and never modifies harness.mjs or
// review.mjs. It owns its browser contexts because harness.mjs hardcodes
// `reducedMotion: "reduce"` (harness.mjs:485) and this gate must measure BOTH
// motion states. No new dependency is used: the composited-pixel readback runs
// in-page via createImageBitmap + OffscreenCanvas + getImageData.
//
// Exit contract (§B-9): exit 0 only when every `gates{}` value is "pass" and
// `problemsBySeverity.error === 0`. `AUDIT_FN`'s contrast findings stay `warn`
// and are never the gate's contrast evidence.
//
// Usage:
//   node scripts/visual-review/tasks-review.mjs --route /tasks --viewport all \
//     --role parent,child,guest --theme dark,light --state populated
//   node scripts/visual-review/tasks-review.mjs --state skeleton --role parent --viewport phoneSmall,phone
//   node scripts/visual-review/tasks-review.mjs --wall on --viewport wide1536,wall --role parent
//   node scripts/visual-review/tasks-review.mjs --update-baselines --state populated
//
// `--update-baselines` is a recording action and is NEVER used in a critic pass.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  auditPage,
  bootServer,
  installSanitizedState,
  withBrowser,
  ROLES,
  VIEWPORTS,
} from "./harness.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA = 1;
export const DEFAULT_FIXTURES_DIR = path.join(SCRIPT_DIR, "fixtures", "tasks");
export const DEFAULT_BASELINES_DIR = path.join(SCRIPT_DIR, "baselines", "tasks");
export const BASELINE_DIR_REL = "scripts/visual-review/baselines/tasks";
export const DEFAULT_OUT_DIR = "/tmp/warmglass/tasks-review";
// Pinned wall-clock for the browser contexts: baselines are files, and a
// baseline that changes with the calendar is not a baseline. 2026-10-08 13:00
// America/Detroit is a Thursday inside the fixtures' current week (2026-10-05).
export const FIXED_NOW_MS = Date.parse("2026-10-08T17:00:00.000Z");
export const FIXED_TIMEZONE = "America/Detroit";

// The matrix entry stretches the skeleton fixture's delayed `/api/tasks/sync`
// read to 20s: the entry's composited-contrast pass takes two full-page
// captures, and at 1920 the fixture's real 4s window closed between them — the
// pair then mixed loading and settled pixels and reported false ~1.0:1 nodes.
// The state probe keeps the fixture's real 4s timing (it measures immediately).
export const SKELETON_WINDOW_MS = 20_000;

// The harness's six viewports plus wide1536 (register, not patch — reviewRoute
// already accepts raw {width,height}). `laptop` (1024) stays addressable by
// name; `all` follows the plan's matrix table (320/390/768/1280/1536/1920).
export const VIEWPORT_REGISTER = Object.freeze({
  ...VIEWPORTS,
  wide1536: { width: 1536, height: 900, label: "wide (1536x900)" },
});
export const MATRIX_VIEWPORTS = Object.freeze([
  "phoneSmall",
  "phone",
  "tablet",
  "desktop",
  "wide1536",
  "wall",
]);

export const STATE_NAMES = Object.freeze([
  "populated",
  "in-flight",
  "queue-drained",
  "skeleton",
  "sync-failed",
]);

export const STATE_FIXTURE_FILE = Object.freeze({
  populated: "populated.json",
  "in-flight": "in-flight.json",
  "queue-drained": "queue-drained.json",
  skeleton: "loading.json",
  loading: "loading.json",
  "sync-failed": "sync-failed.json",
});

export const GATE_KEYS = Object.freeze([
  "fixtureRendered",
  "contrast",
  "typeFloor",
  "tap",
  "overflow320",
  "clipped",
  "clsTwoWay",
  "skeletonParity",
  "focusRing",
  "baselineDrift",
  "keyboard",
]);

// §B-3's JSON contract, one entry per matrix key. `states` is attached from the
// run-level state probes so a critic reads one file (§B-1).
export const ENTRY_KEYS = Object.freeze([
  "schema",
  "generatedAt",
  "route",
  "role",
  "viewport",
  "theme",
  "wall",
  "reducedMotion",
  "state",
  "redirected",
  "screenshot",
  "screenshotCard",
  "baseline",
  "baselineDiffPx",
  "fixture",
  "overflow",
  "cls",
  "skeletonParity",
  "geometry",
  "rhythm",
  "memberTileTransitionMs",
  "tapTargets",
  "focusRing",
  "text",
  "motion",
  "states",
  "focusRingBaselineMisses",
  "summary",
  "problems",
  "problemsBySeverity",
  "consoleErrors",
  "pageErrors",
  "failedRequests",
  "unstubbed",
  "gates",
  "exitCode",
]);

export const RUN_KEYS = Object.freeze([
  "schema",
  "generatedAt",
  "route",
  "state",
  "wall",
  "matrix",
  "fixture",
  "entries",
  "states",
  "summary",
  "problems",
  "problemsBySeverity",
  "consoleErrors",
  "pageErrors",
  "failedRequests",
  "unstubbed",
  "gates",
  "exitCode",
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (v, n = 4) => {
  const p = 10 ** n;
  return Math.round(v * p) / p;
};

export function parseArgs(argv) {
  const args = {
    route: "/tasks",
    role: "parent,child,guest",
    theme: "dark,light",
    viewport: "all",
    wall: "off",
    state: "populated",
    fixtures: DEFAULT_FIXTURES_DIR,
    updateBaselines: false,
    baseUrl: null,
    out: DEFAULT_OUT_DIR,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--route") { args.route = value; i += 1; }
    else if (key === "--role") { args.role = value; i += 1; }
    else if (key === "--theme") { args.theme = value; i += 1; }
    else if (key === "--viewport") { args.viewport = value; i += 1; }
    else if (key === "--wall") { args.wall = value; i += 1; }
    else if (key === "--state") { args.state = value; i += 1; }
    else if (key === "--fixtures") { args.fixtures = value; i += 1; }
    else if (key === "--update-baselines") { args.updateBaselines = true; }
    else if (key === "--base-url") { args.baseUrl = value; i += 1; }
    else if (key === "--out") { args.out = value; i += 1; }
    else if (key === "--help") { args.help = true; }
    else throw new Error(`Unknown flag: ${key}`);
  }
  return args;
}

/** `all` = the plan's six-viewport matrix; phoneSmall is required in every pass. */
export function resolveViewportNames(raw) {
  const names = !raw || raw === "all"
    ? [...MATRIX_VIEWPORTS]
    : raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    if (!VIEWPORT_REGISTER[name]) throw new Error(`Unknown viewport: ${name}`);
  }
  if (!names.includes("phoneSmall")) names.push("phoneSmall");
  return [...new Set(names)];
}

/** Pure classifier over the fixture's tasks — the anti-typo defence reads it. */
export function classifyFixtureTasks(tasks = []) {
  const pending = tasks.filter((t) => t && t.pendingApproval);
  const solo = pending.filter((t) => !(t.pendingApproval.crew && t.pendingApproval.crew.length));
  const crew = pending.filter((t) => t.pendingApproval.crew && t.pendingApproval.crew.length > 0);
  const bonus = pending.filter((t) => t.pendingApproval.points !== t.points);
  const settled = tasks.filter((t) => t && t.completed && !t.pendingApproval);
  const weeks = [...new Set(settled.map((t) => t.completedInWeek).filter(Boolean))];
  return {
    pending,
    solo,
    crew,
    bonus,
    settled,
    weeks,
    counts: {
      pending: pending.length,
      solo: solo.length,
      crew: crew.length,
      bonus: bonus.length,
      settled: settled.length,
      weeks: weeks.length,
    },
  };
}

/** Exact live-DOM counts required for a state (0 on any ⇒ exit non-zero, §B-6). */
export function requiredCountsFor(state, role, fixtureCounts = {}) {
  if (state !== "populated" && state !== "in-flight") return {};
  // The fixture describes the parent persona's board: the approval card is
  // parent-gated, and the member-filtered Completed card only carries these 11
  // rows for the session member they are assigned to. Other roles still get
  // every non-fixture gate; their entries are measured, not required to carry
  // rows they cannot see.
  if (role !== "parent") return {};
  return {
    renderedCompletedRows: fixtureCounts.settled ?? 1,
    renderedWeekGroups: fixtureCounts.weeks ?? 1,
    renderedApprovalRows: fixtureCounts.pending ?? 1,
  };
}

export function buildEntrySkeleton(meta = {}) {
  return {
    schema: SCHEMA,
    generatedAt: meta.generatedAt ?? null,
    route: meta.route ?? "/tasks",
    role: meta.role ?? null,
    viewport: meta.viewport ?? null,
    theme: meta.theme ?? null,
    wall: meta.wall ?? false,
    reducedMotion: meta.reducedMotion ?? true,
    state: meta.state ?? "populated",
    redirected: meta.redirected ?? false,
    screenshot: null,
    screenshotCard: null,
    baseline: null,
    baselineDiffPx: null,
    fixture: {},
    overflow: {},
    cls: {},
    skeletonParity: [],
    geometry: [],
    rhythm: { panelGaps: [], railGaps: [] },
    memberTileTransitionMs: null,
    tapTargets: [],
    focusRing: [],
    text: [],
    motion: {},
    states: [],
    focusRingBaselineMisses: [],
    summary: { contrastFail: 0, typeFloorFail: 0, worstNodeRatio: null, medianMinRatio: null },
    problems: [],
    problemsBySeverity: { error: 0, warn: 0 },
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    unstubbed: [],
    gates: Object.fromEntries(GATE_KEYS.map((key) => [key, "fail"])),
    exitCode: 1,
  };
}

export function buildStateExpectations(name) {
  return {
    name,
    rendered: false,
    renderedApprovalRows: 0,
    renderedCompletedRows: 0,
    renderedWeekGroups: 0,
    skeletonsVisible: 0,
    emptyMessageVisible: false,
    errorCopyVisible: false,
    inFlightRows: 0,
    queueBannerVisible: false,
  };
}

/** §H-5, enforceable form: the skeleton row must reserve the settled row's
 *  space, within 1px, for the same card at the same viewport.
 *
 *  `skeletonPx` is the skeleton row's rendered height in the loading window.
 *  `settledMinPx` is the settled row's floor — its computed `min-height` when a
 *  fix pins one, never below the height the content actually occupies (a pinned
 *  min-height cannot shrink the row below its content). `pass` is
 *  `deltaPx <= 1`; a card that renders no settled counterpart fails rather than
 *  passing vacuously. */
export function buildSkeletonParity(skeletonRows = [], settledRows = []) {
  const settled = new Map(settledRows.map((row) => [row.card, row]));
  return skeletonRows.map((skeleton) => {
    const target = settled.get(skeleton.card);
    const settledMinPx = target ? target.settledMinPx : null;
    const deltaPx = settledMinPx === null
      ? null
      : Math.round(Math.abs(skeleton.skeletonPx - settledMinPx) * 10) / 10;
    return {
      card: skeleton.card,
      selector: skeleton.selector,
      skeletonPx: skeleton.skeletonPx,
      settledMinPx,
      deltaPx,
      pass: deltaPx !== null && deltaPx <= 1,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// In-page instrumentation. The init script is installed before navigation:
// the CLS observer buffers from the first frame, listener add/remove are
// counted (deltas only), and the shared helpers back every measurement.
// ─────────────────────────────────────────────────────────────────────────────

function gateInitScript() {
  if (window.__vrGateInstalled) return;
  window.__vrGateInstalled = true;
  const g = {};
  window.__vrGate = g;

  g.clsEntries = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        g.clsEntries.push({
          value: entry.value,
          hadRecentInput: !!entry.hadRecentInput,
          startTime: entry.startTime,
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* layout-shift unsupported — cls entries stay empty and the gate fails honestly */
  }

  g.listenerCount = 0;
  const addListener = EventTarget.prototype.addEventListener;
  const removeListener = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (...args) {
    g.listenerCount += 1;
    return addListener.apply(this, args);
  };
  EventTarget.prototype.removeEventListener = function (...args) {
    g.listenerCount -= 1;
    return removeListener.apply(this, args);
  };

  g.isVisible = (el) => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  g.describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    if (cls) s += `.${cls}`;
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (label) s += ` "${label}"`;
    return s;
  };
  g.directTextEls = () => Array.from(document.querySelectorAll("body *")).filter((el) => (
    g.isVisible(el) && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())
  ));
  g.lum8 = (r, gr, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(gr) + 0.0722 * f(b);
  };
  g.ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  g.cardScopes = () => {
    let approval = null;
    const heading = Array.from(document.querySelectorAll("h2"))
      .find((el) => /needs approval/i.test(el.textContent || ""));
    if (heading) {
      let node = heading;
      while (node && node !== document.body && !node.querySelector('button[aria-label^="Approve "]')) {
        node = node.parentElement;
      }
      if (node && node !== document.body) approval = node;
    }
    return { approval, completed: document.querySelector("[data-completed-card]") };
  };
  g.scopeEls = (scope) => (scope ? Array.from(scope.querySelectorAll("*")).concat([scope]) : []);
  g.focusInfo = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const st = getComputedStyle(el);
    let ringPx = 0;
    if (st.outlineStyle !== "none" && st.outlineWidth) ringPx = parseFloat(st.outlineWidth) || 0;
    if (!ringPx && st.boxShadow && st.boxShadow !== "none") {
      const m = st.boxShadow.match(/([0-9.]+)px/);
      if (m) ringPx = parseFloat(m[1]) || 0;
    }
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      selector: g.describe(el),
      accessibleName: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      ariaExpanded: el.getAttribute("aria-expanded"),
      ringPx: Math.round(ringPx * 100) / 100,
      inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
    };
  };
}

/** Pin Date inside the browser so screenshots are a diff against a file. */
function clockPinScript(nowMs) {
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(nowMs);
      else super(...args);
    }
    static now() { return nowMs; }
  }
  window.Date = PinnedDate;
}

/** §D: collect the measured text nodes and their geometry (page coordinates). */
function collectTextNodes(limit) {
  const g = window.__vrGate;
  const CLIPPING = ["hidden", "clip", "auto", "scroll"];
  const fixedEls = Array.from(document.querySelectorAll("body *")).filter((el) => {
    if (!g.isVisible(el)) return false;
    const position = getComputedStyle(el).position;
    return position === "fixed" || position === "sticky";
  });
  const coveredByFixed = (r) => fixedEls.some((el) => {
    const fr = el.getBoundingClientRect();
    // Any intersection — the fixed layer's edge/shadow is part of the
    // composited backdrop and moves with the scroll position.
    const margin = 2;
    return r.right > fr.left - margin && r.left < fr.right + margin
      && r.bottom > fr.top - margin && r.top < fr.bottom + margin;
  });
  const els = g.directTextEls().filter((el) => {
    // Emoji are colour pictographs, not ink: WCAG contrast applies to text.
    if (!/[\p{L}\p{N}]/u.test(el.textContent || "")) return false;
    // A node clipped or faded by a scroller (the member strip's edge) is not in
    // a settled readable state — measuring it would invent a contrast failure.
    const r = el.getBoundingClientRect();
    let node = el.parentElement;
    while (node && node !== document.body) {
      const st = getComputedStyle(node);
      if (CLIPPING.includes(st.overflowX) || CLIPPING.includes(st.overflowY)) {
        const cr = node.getBoundingClientRect();
        if (r.left < cr.left - 1 || r.right > cr.right + 1 || r.top < cr.top - 1 || r.bottom > cr.bottom + 1) return false;
      }
      node = node.parentElement;
    }
    // A node under the fixed dock is not readable in the captured state; the
    // full-page capture paints the dock at the first-viewport position, so the
    // only honest measure is to exclude it here (recorded by the caller count).
    let insideFixed = false;
    let walker = el;
    while (walker && walker !== document.body) {
      const position = getComputedStyle(walker).position;
      if (position === "fixed" || position === "sticky") { insideFixed = true; break; }
      walker = walker.parentElement;
    }
    if (!insideFixed && coveredByFixed(r)) return false;
    return true;
  }).slice(0, limit);
  g.textEls = els;
  return els.map((el) => {
    const st = getComputedStyle(el);
    const fontPx = parseFloat(st.fontSize);
    const weight = parseInt(st.fontWeight, 10) || 400;
    const large = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);
    const r = el.getBoundingClientRect();
    const clamp = st.webkitLineClamp;
    // Fixed/sticky chrome renders at the scroll origin in a full-page shot, so
    // it is measured from a viewport capture pair instead (§D applies the same
    // estimator to both).
    let fixed = false;
    let node = el;
    while (node && node !== document.body) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") { fixed = true; break; }
      node = node.parentElement;
    }
    return {
      selector: g.describe(el),
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      w: r.width,
      h: r.height,
      fontPx: Math.round(fontPx * 100) / 100,
      weight,
      large,
      threshold: large ? 3 : 4.5,
      fixed,
      ellipsised: !!clamp && clamp !== "none" && el.scrollHeight > el.clientHeight + 1,
    };
  });
}

/** §D-1: hide ONLY the text nodes (glyph layer) so the recapture is the backdrop. */
function hideGlyphs() {
  const g = window.__vrGate;
  g.hiddenWraps = [];
  for (const el of g.textEls || []) {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 && child.textContent && child.textContent.trim()) {
        const wrap = document.createElement("span");
        wrap.style.visibility = "hidden";
        el.insertBefore(wrap, child);
        wrap.appendChild(child);
        g.hiddenWraps.push({ wrap, node: child });
      }
    }
  }
  return g.hiddenWraps.length;
}

function restoreGlyphs() {
  const g = window.__vrGate;
  for (const { wrap, node } of g.hiddenWraps || []) {
    if (wrap.parentNode) wrap.parentNode.replaceChild(node, wrap);
  }
  g.hiddenWraps = [];
}

/** §D-2/3: backdrop median, 5th-percentile glyph core, median/worst tolerance. */
async function computeContrast({ before, after, nodes, ds }) {
  const g = window.__vrGate;
  const round = (v, n = 4) => {
    const p = 10 ** n;
    return Math.round(v * p) / p;
  };
  const decode = async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return createImageBitmap(new Blob([bytes], { type: "image/png" }));
  };
  const [bitmapA, bitmapB] = await Promise.all([decode(before), decode(after)]);
  const canvasA = new OffscreenCanvas(bitmapA.width, bitmapA.height);
  const canvasB = new OffscreenCanvas(bitmapB.width, bitmapB.height);
  const ctxA = canvasA.getContext("2d", { willReadFrequently: true });
  const ctxB = canvasB.getContext("2d", { willReadFrequently: true });
  ctxA.drawImage(bitmapA, 0, 0);
  ctxB.drawImage(bitmapB, 0, 0);
  const out = [];
  for (const node of nodes) {
    const x = Math.max(0, Math.round(node.x * ds));
    const y = Math.max(0, Math.round(node.y * ds));
    const w = Math.min(Math.round(node.w * ds), bitmapA.width - x);
    const h = Math.min(Math.round(node.h * ds), bitmapA.height - y);
    if (w < 1 || h < 1) continue;
    const aData = ctxA.getImageData(x, y, w, h).data;
    const bData = ctxB.getImageData(x, y, w, h).data;
    const count = w * h;
    const lumA = new Float32Array(count);
    const lumB = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const o = i * 4;
      lumA[i] = g.lum8(aData[o], aData[o + 1], aData[o + 2]);
      lumB[i] = g.lum8(bData[o], bData[o + 1], bData[o + 2]);
    }
    const sortedBackdrop = Float32Array.from(lumB).sort();
    const backdropLum = sortedBackdrop[Math.floor(count / 2)];
    let maxDiff = 0;
    for (let i = 0; i < count; i += 1) {
      const d = Math.abs(lumA[i] - lumB[i]);
      if (d > maxDiff) maxDiff = d;
    }
    const ink = [];
    if (maxDiff > 0.005) {
      for (let i = 0; i < count; i += 1) {
        if (Math.abs(lumA[i] - lumB[i]) > maxDiff * 0.5) ink.push(lumA[i]);
      }
    }
    if (!ink.length) {
      out.push({
        selector: node.selector,
        label: node.label,
        fontPx: node.fontPx,
        weight: node.weight,
        large: node.large,
        threshold: node.threshold,
        backdrop: { via: "hidden-glyph-recapture", luminance: round(backdropLum), samples: count },
        glyphCore: null,
        ratioP05: null,
        ratioMedian: null,
        worstEdgeRatio: null,
        ellipsised: node.ellipsised,
        pass: false,
        note: "no glyph-core pixels found",
      });
      continue;
    }
    ink.sort((a, b) => a - b);
    const p05 = ink[Math.max(0, Math.floor(ink.length * 0.05))];
    const median = ink[Math.floor(ink.length / 2)];
    const min = ink[0];
    const ratioP05 = g.ratio(backdropLum, p05);
    const ratioMedian = g.ratio(backdropLum, median);
    out.push({
      selector: node.selector,
      label: node.label,
      fontPx: node.fontPx,
      weight: node.weight,
      large: node.large,
      threshold: node.threshold,
      backdrop: { via: "hidden-glyph-recapture", luminance: round(backdropLum), samples: count },
      glyphCore: {
        p05Luminance: round(p05),
        medianLuminance: round(median),
        coveragePx: ink.length,
      },
      ratioP05: round(ratioP05),
      ratioMedian: round(ratioMedian),
      worstEdgeRatio: round(g.ratio(backdropLum, min)),
      ellipsised: node.ellipsised,
      pass: ratioMedian >= node.threshold,
    });
  }
  bitmapA.close?.();
  bitmapB.close?.();
  return out;
}

/** Live-DOM fixture counts + overflow + geometry + tap targets, in one call. */
function measureDom() {
  const g = window.__vrGate;
  const approvalTitles = Array.from(document.querySelectorAll('button[aria-label^="Approve "]'))
    .map((b) => (b.getAttribute("aria-label") || "").replace(/^Approve /, ""));
  const completedRows = document.querySelectorAll('[data-completed-card] button[aria-label^="Undo completion of "]').length;
  const weekGroups = document.querySelectorAll('[data-completed-card] h3[id^="completed-week-"]').length;
  const clamped = g.directTextEls().filter((el) => {
    const st = getComputedStyle(el);
    const clamp = st.webkitLineClamp;
    return !!clamp && clamp !== "none" && el.scrollHeight > el.clientHeight + 1;
  }).map((el) => g.describe(el));

  const root = document.documentElement;
  const body = document.body;
  const scrollers = [];
  const clipped = [];
  const textClipped = [];
  const isTextClip = (el) => {
    const st = getComputedStyle(el);
    return st.textOverflow === "ellipsis" || (st.webkitLineClamp && st.webkitLineClamp !== "none");
  };
  for (const el of Array.from(document.querySelectorAll("body *")).filter(g.isVisible)) {
    if (el.clientWidth <= 1) continue;
    const st = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1) {
      if (st.overflowX === "auto" || st.overflowX === "scroll") {
        scrollers.push({
          selector: g.describe(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          legit: true,
        });
      } else if (st.overflowX === "hidden" || st.overflowX === "clip") {
        const finding = { selector: g.describe(el), px: el.scrollWidth - el.clientWidth };
        // An intentional ellipsis/clamp is an affordance, not silently lost UI;
        // it is recorded under overflow.textClipped and judged by
        // fixture.renderedTitlesEllipsised instead.
        if (isTextClip(el)) textClipped.push(finding);
        else clipped.push(finding);
      }
    }
  }
  clipped.sort((a, b) => b.px - a.px);
  textClipped.sort((a, b) => b.px - a.px);

  const radiusTokens = (() => {
    const st = getComputedStyle(document.documentElement);
    return ["--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-2xl", "--radius-full"]
      .map((token) => ({ token, px: parseFloat(st.getPropertyValue(token)) || 0 }));
  })();
  const onGrid = (v, step) => v === 0 || Math.abs(v / step - Math.round(v / step)) < 0.01;
  const geometry = [...document.querySelectorAll(".schedule-row, .member-tile, [data-completed-card] section, button")]
    .filter(g.isVisible)
    .slice(0, 140)
    .map((el) => {
      const st = getComputedStyle(el);
      const padBlock = parseFloat(st.paddingTop) || 0;
      const padInline = parseFloat(st.paddingLeft) || 0;
      const gapRaw = st.gap && st.gap !== "normal" ? st.gap : st.columnGap;
      const gap = gapRaw && gapRaw !== "normal" ? parseFloat(gapRaw) || 0 : 0;
      const borderRadiusPx = parseFloat(st.borderTopLeftRadius) || 0;
      const match = radiusTokens.find((t) => Math.abs(t.px - borderRadiusPx) < 0.6) ?? null;
      return {
        selector: g.describe(el),
        padBlock,
        padInline,
        gap,
        marginBlock: parseFloat(st.marginTop) || 0,
        borderRadiusPx,
        radiusToken: match ? match.token : null,
        onGrid: onGrid(padBlock, 4) && onGrid(padInline, 4) && onGrid(gap, 8) && match !== null,
      };
    });

  const interactives = Array.from(document.querySelectorAll(
    'button, a[href], [role="button"], [role="tab"], [role="switch"], input[type="checkbox"], input[type="radio"]',
  )).filter(g.isVisible).slice(0, 150);
  const tapTargets = interactives.map((el) => {
    const cls = el.getAttribute("class") || "";
    const r = el.getBoundingClientRect();
    return {
      selector: g.describe(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
      hit44: /\bhit-44\b/.test(cls) || /(?:after|before):-inset-/.test(cls),
      label: (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "")
        .trim().replace(/\s+/g, " ").slice(0, 60),
      wallOk: null,
    };
  });

  // U3's rhythm evidence: the vertical gap between consecutive in-flow blocks
  // of the active panel (the declared 24px) and of the rail (the declared
  // 16px) — measured, never inferred — plus the member tile's computed
  // transition (must be `.tap-sm`'s 150ms; the tile declares none of its own).
  const gapTable = (container, expectedPx) => {
    if (!container) return [];
    const blocks = Array.from(container.children)
      .filter((el) => g.isVisible(el) && el.getBoundingClientRect().height > 0);
    const out = [];
    for (let i = 1; i < blocks.length; i += 1) {
      const prev = blocks[i - 1].getBoundingClientRect();
      const cur = blocks[i].getBoundingClientRect();
      const gapPx = Math.round((cur.top - prev.bottom) * 10) / 10;
      out.push({
        from: g.describe(blocks[i - 1]),
        to: g.describe(blocks[i]),
        gapPx,
        expectedPx,
        pass: Math.abs(gapPx - expectedPx) <= 1,
      });
    }
    return out;
  };
  const rhythm = {
    panelGaps: gapTable(document.querySelector('[role="tabpanel"]'), 24),
    railGaps: gapTable(document.querySelector(".wall-board-rail"), 16),
  };
  // The member tile's computed `transition-duration` (ms). In this context it
  // is the reduced-motion value (the global blanket zeroes it); the motion-on
  // twin is measured in the motion context below.
  const memberTileTransitionMs = (() => {
    const tile = document.querySelector(".member-tile");
    if (!tile) return null;
    const durations = (getComputedStyle(tile).transitionDuration || "0s")
      .split(",").map((v) => (parseFloat(v) || 0) * 1000);
    return Math.max(0, ...durations);
  })();

  const emptyMessages = Array.from(document.querySelectorAll("body *"))
    .filter((el) => g.isVisible(el) && /All caught up|All quiet|Nothing finished yet|Nothing is up for grabs/.test(el.textContent || ""))
    .map((el) => g.describe(el));
  const errorMessages = Array.from(document.querySelectorAll("body *"))
    .filter((el) => g.isVisible(el) && /Couldn't reach the family server/.test(el.textContent || ""))
    .map((el) => g.describe(el));
  const inFlightRows = Array.from(document.querySelectorAll("body *"))
    .filter((el) => g.isVisible(el) && /Sending…|Sending\.\.\./.test(el.textContent || ""))
    .map((el) => g.describe(el));

  return {
    approvalTitles,
    completedRows,
    weekGroups,
    rhythm,
    memberTileTransitionMs,
    titlesEllipsised: clamped,
    overflow: {
      root: Math.max(0, root.scrollWidth - window.innerWidth),
      body: Math.max(0, body.scrollWidth - window.innerWidth),
      worstClipped: clipped[0] ?? null,
      textClipped: textClipped.slice(0, 20),
      scrollers: scrollers.slice(0, 10),
    },
    geometry,
    tapTargets,
    emptyMessages,
    errorMessages,
    inFlightRows,
    queueBannerVisible: /waiting to retry/i.test(document.body.innerText || ""),
  };
}

/** §H-5: the loading window's skeleton row heights, one per rendered card.
 *  Scope by the card's own heading (the Approve buttons do not exist yet while
 *  the read is outstanding, so `cardScopes()` cannot find the approval card). */
function measureSkeletonRows() {
  const g = window.__vrGate;
  const heading = Array.from(document.querySelectorAll("h2"))
    .find((el) => /needs approval/i.test(el.textContent || ""));
  let approval = null;
  if (heading) {
    let node = heading;
    while (node && node !== document.body && !node.querySelector(".schedule-row")) {
      node = node.parentElement;
    }
    if (node && node !== document.body) approval = node;
  }
  const completed = document.querySelector("[data-completed-card]");
  const out = [];
  for (const [card, scope] of [["approval", approval], ["completed", completed]]) {
    if (!scope) continue;
    const row = scope.querySelector(".schedule-row");
    if (!row) continue;
    const r = row.getBoundingClientRect();
    out.push({ card, selector: g.describe(row), skeletonPx: Math.round(r.height * 10) / 10 });
  }
  return out;
}

/** §H-5: the settled row's floor for the same cards, measured after the
 *  fixture's sync delay resolves. `max(computed min-height, rendered height)` —
 *  a pinned min-height cannot shrink a row below its content. */
function measureSettledRows() {
  const g = window.__vrGate;
  const { approval, completed } = g.cardScopes();
  const out = [];
  for (const [card, scope] of [["approval", approval], ["completed", completed]]) {
    if (!scope) continue;
    const row = scope.querySelector(".schedule-row");
    if (!row) continue;
    const r = row.getBoundingClientRect();
    const minH = parseFloat(getComputedStyle(row).minHeight) || 0;
    out.push({
      card,
      selector: g.describe(row),
      settledMinPx: Math.round(Math.max(minH, r.height) * 10) / 10,
    });
  }
  return out;
}

/** The card-anchored shot's clip: the target card scrolled into view and
 *  clipped to the viewport (the page-top is not what a critic needs to see). */
function cardClipFor(target) {
  const g = window.__vrGate;
  const scope = target === "approval"
    ? g.cardScopes().approval
    : document.querySelector("[data-completed-card]");
  if (!scope) return null;
  scope.scrollIntoView({ block: "start", inline: "center" });
  const r = scope.getBoundingClientRect();
  const pad = 6;
  const x = Math.max(0, r.left - pad);
  const y = Math.max(0, r.top - pad);
  const right = Math.min(window.innerWidth, r.right + pad);
  const bottom = Math.min(window.innerHeight, r.bottom + pad);
  return {
    selector: g.describe(scope),
    clip: { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) },
  };
}

/** Motion budget over the two task cards (transitions + keyframe animations). */
function measureMotion() {
  const g = window.__vrGate;
  const { approval, completed } = g.cardScopes();
  const seen = new Set();
  const els = [...g.scopeEls(approval), ...g.scopeEls(completed)];
  let budget = 0;
  const animationNames = [];
  const transitionBySelector = {};
  for (const el of els) {
    if (seen.has(el)) continue;
    seen.add(el);
    const st = getComputedStyle(el);
    const durations = (st.transitionDuration || "0s").split(",").map((v) => (parseFloat(v) || 0) * 1000);
    const max = Math.max(0, ...durations);
    if (max > budget) budget = max;
    const selector = g.describe(el);
    if (max > (transitionBySelector[selector] ?? 0)) {
      transitionBySelector[selector] = Math.round(max * 100) / 100;
    }
    if (st.animationName && st.animationName !== "none") {
      for (const name of st.animationName.split(",")) {
        if (name.trim() && name.trim() !== "none") {
          animationNames.push({
            name: name.trim(),
            infinite: (st.animationIterationCount || "").includes("infinite"),
          });
        }
      }
    }
  }
  return {
    cardTransitionBudgetMs: Math.round(budget * 100) / 100,
    animationNames,
    transitionBySelector,
  };
}

/** Focus-ring pixel readback: ring run length + luminance deltas on both sides.
 *
 *  Three shots: unfocused, focused, and focused-with-ring-suppressed (the
 *  element's own outline/box-shadow forced to none). Ring pixels = focused vs
 *  ringless, so a focus background wash or a sub-pixel reflow cannot be
 *  mistaken for the ring. Deltas compare the ring ink against the pixels just
 *  inside the border box (unfocused) and just outside the ring. */
export async function computeFocusRing({ unfocused, focused, ringless, ds, box, clip }) {
  const g = window.__vrGate;
  const decode = async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return createImageBitmap(new Blob([bytes], { type: "image/png" }));
  };
  const [bitmapA, bitmapB, bitmapC] = await Promise.all([
    decode(unfocused),
    decode(focused),
    decode(ringless),
  ]);
  const w = bitmapA.width;
  const h = bitmapA.height;
  const canvasA = new OffscreenCanvas(w, h);
  const canvasB = new OffscreenCanvas(w, h);
  const canvasC = new OffscreenCanvas(w, h);
  const ctxA = canvasA.getContext("2d", { willReadFrequently: true });
  const ctxB = canvasB.getContext("2d", { willReadFrequently: true });
  const ctxC = canvasC.getContext("2d", { willReadFrequently: true });
  ctxA.drawImage(bitmapA, 0, 0);
  ctxB.drawImage(bitmapB, 0, 0);
  ctxC.drawImage(bitmapC, 0, 0);
  const A = ctxA.getImageData(0, 0, w, h).data;
  const B = ctxB.getImageData(0, 0, w, h).data;
  const C = ctxC.getImageData(0, 0, w, h).data;
  const lumAt = (data, x, y) => {
    const o = (y * w + x) * 4;
    return g.lum8(data[o], data[o + 1], data[o + 2]);
  };
  const changed = (x, y) => {
    const o = (y * w + x) * 4;
    return Math.abs(B[o] - C[o]) + Math.abs(B[o + 1] - C[o + 1]) + Math.abs(B[o + 2] - C[o + 2]) > 24;
  };
  const bx = Math.round((box.x - clip.x) * ds);
  const by = Math.round((box.y - clip.y) * ds);
  const bw = Math.round(box.w * ds);
  const bh = Math.round(box.h * ds);
  const scan = Math.max(4, Math.round(10 * ds));
  const inside = Math.max(1, Math.round(2 * ds));

  let best = { ringPx: 0, deltaIn: 0, deltaOut: 0 };
  const probe = (edgeX, edgeY, dirX, dirY, limit) => {
    let runStart = -1;
    for (let step = 1; step <= limit; step += 1) {
      const x = edgeX + dirX * step;
      const y = edgeY + dirY * step;
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (changed(x, y)) {
        if (runStart === -1) runStart = step;
      } else if (runStart !== -1) {
        const runEnd = step - 1;
        const ringPx = (runEnd - runStart + 1) / ds;
        const midStep = Math.floor((runStart + runEnd) / 2);
        const ringLum = lumAt(B, edgeX + dirX * midStep, edgeY + dirY * midStep);
        const inX = edgeX - dirX * inside;
        const inY = edgeY - dirY * inside;
        const outStep = runEnd + Math.max(1, Math.round(2 * ds));
        const outX = edgeX + dirX * outStep;
        const outY = edgeY + dirY * outStep;
        const inLum = (inX >= 0 && inY >= 0 && inX < w && inY < h) ? lumAt(A, inX, inY) : ringLum;
        const outLum = (outX >= 0 && outY >= 0 && outX < w && outY < h) ? lumAt(C, outX, outY) : ringLum;
        if (ringPx > best.ringPx) {
          best = {
            ringPx: Math.round(ringPx * 100) / 100,
            deltaIn: Math.round(Math.abs(ringLum - inLum) * 10000) / 100,
            deltaOut: Math.round(Math.abs(ringLum - outLum) * 10000) / 100,
          };
        }
        return;
      }
    }
  };

  const cx = bx + Math.floor(bw / 2);
  const cy = by + Math.floor(bh / 2);
  probe(cx, by - 1, 0, -1, scan);
  probe(cx, by + bh, 0, 1, scan);
  probe(bx - 1, cy, -1, 0, scan);
  probe(bx + bw, cy, 1, 0, scan);
  bitmapA.close?.();
  bitmapB.close?.();
  bitmapC.close?.();
  return best;
}

/** Exact pixel diff between two PNG buffers (baseline drift + end-state twins). */
async function pixelDiff({ a, b }) {
  const decode = async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return createImageBitmap(new Blob([bytes], { type: "image/png" }));
  };
  const [bitmapA, bitmapB] = await Promise.all([decode(a), decode(b)]);
  if (bitmapA.width !== bitmapB.width || bitmapA.height !== bitmapB.height) return -1;
  const canvasA = new OffscreenCanvas(bitmapA.width, bitmapA.height);
  const canvasB = new OffscreenCanvas(bitmapB.width, bitmapB.height);
  const ctxA = canvasA.getContext("2d", { willReadFrequently: true });
  const ctxB = canvasB.getContext("2d", { willReadFrequently: true });
  ctxA.drawImage(bitmapA, 0, 0);
  ctxB.drawImage(bitmapB, 0, 0);
  const A = ctxA.getImageData(0, 0, bitmapA.width, bitmapA.height).data;
  const B = ctxB.getImageData(0, 0, bitmapB.width, bitmapB.height).data;
  let diff = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2] || A[i + 3] !== B[i + 3]) diff += 1;
  }
  bitmapA.close?.();
  bitmapB.close?.();
  return diff;
}

function clsSummary() {
  const g = window.__vrGate;
  const inputExcluded = g.clsEntries
    .filter((e) => !e.hadRecentInput)
    .reduce((sum, e) => sum + e.value, 0);
  return Math.round(inputExcluded * 100000) / 100000;
}

function clsForcedSummary() {
  const g = window.__vrGate;
  return Math.round(g.clsEntries.reduce((sum, e) => sum + e.value, 0) * 100000) / 100000;
}

function resetCls() {
  window.__vrGate.clsEntries = [];
}

function listenerCount() {
  return window.__vrGate.listenerCount;
}

function toggleCompletedDisclosure() {
  const g = window.__vrGate;
  const card = document.querySelector("[data-completed-card]");
  if (!card) return null;
  const btn = Array.from(card.querySelectorAll("button"))
    .find((b) => /Show completed|Hide completed/.test(b.textContent || ""));
  if (!btn) return null;
  btn.click();
  return /Hide completed/.test(btn.textContent || "") ? "expanded" : "collapsed";
}

function completedDisclosureState() {
  const card = document.querySelector("[data-completed-card]");
  if (!card) return "absent";
  const btn = Array.from(card.querySelectorAll("button"))
    .find((b) => /Show completed|Hide completed/.test(b.textContent || ""));
  if (!btn) return "absent";
  return /Hide completed/.test(btn.textContent || "") ? "expanded" : "collapsed";
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexts
// ─────────────────────────────────────────────────────────────────────────────

export function clampClip(box, viewport, margin) {
  const x = Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - margin);
  const right = Math.min(viewport.width, box.x + box.w + margin);
  const bottom = Math.min(viewport.height, box.y + box.h + margin);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/** The viewport shot of record + its committed-baseline comparison. */
async function recordViewportShot(page, entry, { screenshotPath, baselinePath, outName, updateBaselines }) {
  const shot = await page.screenshot({ animations: "disabled" });
  writeFileSync(screenshotPath, shot);
  entry.screenshot = screenshotPath;
  entry.baseline = existsSync(baselinePath) ? path.join(BASELINE_DIR_REL, `${outName}.png`) : null;
  if (updateBaselines) {
    mkdirSync(path.dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, shot);
    entry.baseline = path.join(BASELINE_DIR_REL, `${outName}.png`);
    entry.baselineDiffPx = 0;
  } else if (existsSync(baselinePath)) {
    const baselineB64 = readFileSync(baselinePath).toString("base64");
    entry.baselineDiffPx = await page.evaluate(pixelDiff, {
      a: shot.toString("base64"),
      b: baselineB64,
    });
  } else {
    entry.baselineDiffPx = null;
  }
}

/** The card-anchored companion shot (`-card.png`): approval card for approval
 *  states, completed card in the skeleton window, the other card when the
 *  primary one is not rendered for this role. Evidence only — never a
 *  baseline drift key (the viewport shot stays the shot of record). */
async function recordCardShot(page, entry, { outDir, outName, state }) {
  const primary = state === "skeleton" ? "completed" : "approval";
  const fallback = primary === "approval" ? "completed" : "approval";
  let anchored = await page.evaluate(cardClipFor, primary).catch(() => null);
  if (!anchored || anchored.clip.width < 8 || anchored.clip.height < 8) {
    anchored = await page.evaluate(cardClipFor, fallback).catch(() => null);
  }
  if (!anchored || anchored.clip.width < 8 || anchored.clip.height < 8) {
    entry.screenshotCard = null;
    return;
  }
  const shot = await page.screenshot({ clip: anchored.clip, animations: "disabled" });
  await page.evaluate(() => { window.scrollTo(0, 0); });
  const cardPath = path.join(outDir, `${outName}-card.png`);
  writeFileSync(cardPath, shot);
  entry.screenshotCard = cardPath;
}

async function openContext(browser, opts) {
  const { role, theme, wall, reducedMotion, fixtureRaw, fixtureBody, state, delayMs, seedInFlight, baseUrl, route } = opts;
  const vp = VIEWPORT_REGISTER[opts.viewportName];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    reducedMotion,
    timezoneId: FIXED_TIMEZONE,
  });
  await context.addInitScript(gateInitScript);
  await context.addInitScript(clockPinScript, FIXED_NOW_MS);

  const overrides = {
    "/api/tasks/sync": fixtureRaw.body ? fixtureRaw : fixtureBody,
  };
  if (state === "in-flight") {
    overrides["/api/tasks/approve"] = { status: 202, body: { ok: true, queued: true } };
  }
  const { unstubbed } = await installSanitizedState(context, {
    role,
    mode: theme,
    wallMode: wall ? "on" : "off",
    overrides,
  });
  if (seedInFlight) {
    await context.addInitScript((entries) => {
      localStorage.setItem("consuela-task-operation-outbox-v1", JSON.stringify(entries));
    }, seedInFlight);
  }
  if (delayMs > 0) {
    await context.route("**/api/tasks/sync", async (routeHandler) => {
      await sleep(delayMs);
      // The skeleton window can outlive the motion twin's context; a fallback
      // after close must not surface as an unhandled rejection.
      try {
        await routeHandler.fallback();
      } catch {
        /* context closed while the fixture window was still open */
      }
    });
  }

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (url.includes("fonts.g")) return;
    failedRequests.push(`${req.method()} ${url} — ${req.failure()?.errorText ?? "unknown"}`);
  });

  const target = `${baseUrl}${route}`;
  let navError = null;
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (delayMs > 0) {
      await sleep(Math.min(900, delayMs - 200));
    } else {
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await sleep(1200);
    }
  } catch (error) {
    navError = String(error).slice(0, 300);
  }
  return {
    context,
    page,
    vp,
    navError,
    consoleErrors,
    pageErrors,
    failedRequests,
    unstubbed,
  };
}

async function waitForBoard(page, state, role) {
  if (state === "populated" || state === "in-flight") {
    if (role === "parent") {
      await page.waitForSelector('button[aria-label^="Approve "]', { timeout: 6_000 }).catch(() => {});
    }
    await page.waitForSelector("[data-completed-card]", { timeout: 6_000 }).catch(() => {});
  }
  if (state === "queue-drained") {
    await page.waitForFunction(
      () => /All caught up|All quiet/.test(document.body.innerText || ""),
      { timeout: 6_000 },
    ).catch(() => {});
  }
  if (state === "sync-failed") {
    await page.waitForFunction(
      () => /Couldn't reach the family server/.test(document.body.innerText || ""),
      { timeout: 6_000 },
    ).catch(() => {});
  }
}

async function expandCompleted(page) {
  const state = await page.evaluate(completedDisclosureState);
  if (state === "collapsed") {
    await page.evaluate(toggleCompletedDisclosure);
    await sleep(420);
  }
}

async function measureFocusRings(page, ds, limit = 12) {
  await page.keyboard.press("Tab");
  // The Completed controls are only measurable on an expanded panel; the
  // skeleton state settles AFTER runEntry's own expand, so ensure it here
  // (idempotent — no-op for the other states).
  await expandCompleted(page);
  await page.evaluate(() => {
    const g = window.__vrGate;
    const { approval, completed } = g.cardScopes();
    const selector = 'button, [role="button"], a[href]';
    const seen = new Set();
    const targets = [];
    const add = (el) => {
      if (el && !seen.has(el) && targets.length < 40) {
        seen.add(el);
        targets.push(el);
      }
    };
    const primary = [
      ...(approval ? approval.querySelectorAll(selector) : []),
      ...(completed ? completed.querySelectorAll(selector) : []),
    ];
    // The gate's original six-target coverage stays first...
    for (const el of primary.slice(0, 6)) add(el);
    // ...and the coverage extends to the Completed disclosure, one undo button
    // and the Open board's claim control (U3-0b #4). Criteria unchanged.
    if (completed) {
      add(Array.from(completed.querySelectorAll("button"))
        .find((b) => /Show completed|Hide completed/.test(b.textContent || "")));
      add(completed.querySelector('button[aria-label^="Undo completion of "]'));
    }
    // The claim control's accessible name is unique to the Open board (a
    // heading-text search stopped being reliable when U3 moved the 🫳 glyph
    // from the title into the card's icon seat).
    add(document.querySelector('[aria-label^="Claim "], [aria-label^="Join crew for "]'));
    // U3: the member tile's ring must be measured on an active AND an inactive
    // tile — `.tap-sm`'s box-shadow ring and the unlayered `.member-tile`
    // background/glow rules can paint over each other, and only the measured
    // deltas settle which one wins.
    const strip = document.querySelector(".member-strip-tiles");
    if (strip) {
      add(strip.querySelector('button.member-tile[aria-pressed="true"]'));
      add(Array.from(strip.querySelectorAll("button.member-tile"))
        .find((b) => b.getAttribute("aria-pressed") === "false"));
    }
    window.__vrFocusTargets = targets;
  });
  const count = await page.evaluate(() => window.__vrFocusTargets.length);
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const rings = [];
  for (let i = 0; i < Math.min(count, limit); i += 1) {
    await page.evaluate((idx) => {
      window.__vrFocusTargets[idx].scrollIntoView({ block: "center", inline: "center" });
    }, i);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const box = await page.evaluate((idx) => {
      const el = window.__vrFocusTargets[idx];
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, selector: window.__vrGate.describe(el) };
    }, i);
    const clip = clampClip(box, viewport, 8);
    if (clip.width < 8 || clip.height < 8) continue;
    await page.evaluate((idx) => window.__vrFocusTargets[idx].blur(), i);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const unfocused = await page.screenshot({ clip, animations: "disabled" });
    await page.evaluate((idx) => window.__vrFocusTargets[idx].focus(), i);
    // Wait for the focus-visible heuristic to apply AND for the ring's
    // transition to finish: a screenshot at 2 rAF can catch the ring at
    // partial opacity, which on a light canvas can read as no ring at all.
    await page.waitForFunction(
      (idx) => window.__vrFocusTargets[idx].matches(":focus-visible"),
      i,
      { timeout: 2_000 },
    ).catch(() => {});
    await sleep(240);
    const focused = await page.screenshot({ clip, animations: "disabled" });
    // Suppress the ring on the SAME focused element so ring pixels are
    // isolated from any focus background change.
    await page.evaluate((idx) => {
      const el = window.__vrFocusTargets[idx];
      el.style.setProperty("outline", "none", "important");
      el.style.setProperty("box-shadow", "none", "important");
    }, i);
    await sleep(120);
    const ringless = await page.screenshot({ clip, animations: "disabled" });
    await page.evaluate((idx) => {
      const el = window.__vrFocusTargets[idx];
      el.style.removeProperty("outline");
      el.style.removeProperty("box-shadow");
    }, i);
    const measured = await page.evaluate(computeFocusRing, {
      unfocused: unfocused.toString("base64"),
      focused: focused.toString("base64"),
      ringless: ringless.toString("base64"),
      ds,
      box,
      clip,
    });
    const matchesFocusVisible = await page.evaluate(
      (idx) => window.__vrFocusTargets[idx].matches(":focus-visible"),
      i,
    );
    rings.push({
      selector: box.selector,
      ringPx: measured.ringPx,
      deltaLuminanceBorderIn: measured.deltaIn,
      deltaLuminanceBorderOut: measured.deltaOut,
      matchesFocusVisible,
    });
  }
  return rings;
}

function summarizeText(text) {
  const ratios = text.map((t) => t.ratioMedian).filter((r) => typeof r === "number");
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return {
    contrastFail: text.filter((t) => !t.pass).length,
    typeFloorFail: text.filter((t) => t.fontPx < 12).length,
    worstNodeRatio: sorted.length ? round(sorted[0]) : null,
    medianMinRatio: median === null ? null : round(median),
  };
}

function gateProblems(problems) {
  return {
    tap: problems.filter((p) => p.rule === "tap-target" || p.rule === "accessible-name").length === 0,
    overflow320: problems.filter((p) => p.rule === "horizontal-overflow" || p.rule === "element-past-viewport").length === 0,
    clipped: problems.filter((p) => p.rule === "clipped-content").length === 0,
  };
}

/** AUDIT_FN flags intentional text ellipsis/clamp as `clipped-content`; those
 *  elements are the fix the 2026-10-05 wave shipped (line-clamp, not truncate)
 *  and are judged by fixture.renderedTitlesEllipsised + overflow.textClipped.
 *  Non-text clipping stays a hard error. `problems` itself stays verbatim. */
function isTextClipProblem(problem, entry) {
  if (problem.rule !== "clipped-content") return false;
  const selector = problem.detail.split(" overflow-x")[0];
  return (entry.overflow?.textClipped ?? []).some((t) => t.selector === selector);
}

function gatingProblems(entry) {
  return entry.problems.filter((p) => !isTextClipProblem(p, entry));
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry + run
// ─────────────────────────────────────────────────────────────────────────────

async function runEntry(browser, opts) {
  const entry = buildEntrySkeleton({
    generatedAt: new Date().toISOString(),
    route: opts.route,
    role: opts.role,
    viewport: `${VIEWPORT_REGISTER[opts.viewportName].width}x${VIEWPORT_REGISTER[opts.viewportName].height}`,
    theme: opts.theme,
    wall: opts.wall,
    reducedMotion: true,
    state: opts.state,
  });
  const ds = 2;
  const outName = baselineName(opts);
  const screenshotPath = path.join(opts.outDir, `${outName}.png`);
  const baselinePath = path.join(opts.baselinesDir, `${outName}.png`);

  const reduced = await openContext(browser, { ...opts, reducedMotion: "reduce" });
  try {
    // A logged-in child/pet is redirected off /tasks by contract
    // (page.tsx:339-343) — the page is not reachable for that role, so its
    // criteria are exempt with the citation, never failed vacuously.
    if (opts.role === "child" || opts.role === "pet") {
      await sleep(1400);
      const landed = await reduced.page.evaluate(() => location.pathname);
      if (landed !== opts.route) {
        entry.redirected = true;
        entry.problems = [{
          rule: "role-not-reachable-by-contract",
          severity: "warn",
          detail: `${opts.role} is redirected off ${opts.route} (page.tsx:339-343); visual criteria are not reachable for this role`,
        }];
        entry.problemsBySeverity = { error: 0, warn: 1 };
        entry.gates = Object.fromEntries(GATE_KEYS.map((key) => [key, "pass"]));
        entry.exitCode = 0;
        return entry;
      }
    }
    await waitForBoard(reduced.page, opts.state, opts.role);

    // §H-5 / U3-0b: a `--state skeleton` entry must be captured INSIDE the
    // fixture's loading window, at every viewport. Wait for the skeleton to
    // mount, measure the card row heights and take the shot of record before
    // any slow pass — the contrast pairs previously ran long enough that the
    // delayed read landed before the shot at 768/1280 and the "skeleton" run
    // committed settled-state evidence.
    let skeletonRows = null;
    let skeletonDom = null;
    if (opts.state === "skeleton") {
      await reduced.page.waitForFunction(
        () => !!document.querySelector(".animate-pulse"),
        undefined,
        { timeout: Math.min(Math.max(1200, (opts.delayMs ?? 0) - 700), 3000) },
      ).catch(() => {});
      skeletonRows = await reduced.page.evaluate(measureSkeletonRows);
      skeletonDom = await reduced.page.evaluate(measureDom);
      await recordViewportShot(reduced.page, entry, {
        screenshotPath, baselinePath, outName, updateBaselines: opts.updateBaselines,
      });
      await recordCardShot(reduced.page, entry, {
        outDir: opts.outDir, outName, state: opts.state,
      });
    }

    // §C pass A — the board-ready window plus five programmatic expand/collapse
    // cycles. The pre-board window is recorded separately as `cls.loadWindow`:
    // the page's documented loading state (the `mounted` spinner, page.tsx:2427)
    // swaps the whole shell, and that swap is not a card defect and is not in
    // any U item's blast radius; the gated window is the post-mount reflow §C
    // exists to catch. The load number stays in the JSON as evidence.
    const clsLoadWindow = await reduced.page.evaluate(clsSummary);
    await reduced.page.evaluate(resetCls);
    if (opts.delayMs === 0) await expandCompleted(reduced.page);
    let disclosure = await reduced.page.evaluate(completedDisclosureState);
    for (let i = 0; i < 5 && disclosure !== "absent"; i += 1) {
      await reduced.page.evaluate(toggleCompletedDisclosure);
      await sleep(160);
      await reduced.page.evaluate(toggleCompletedDisclosure);
      await sleep(160);
      disclosure = await reduced.page.evaluate(completedDisclosureState);
    }
    const clsCycles = await reduced.page.evaluate(clsSummary);
    const clsInputExcluded = Math.round(clsCycles * 100000) / 100000;
    const listenerBefore = await reduced.page.evaluate(listenerCount);
    await reduced.page.evaluate(resetCls);
    await expandCompleted(reduced.page);

    // Shot of record: viewport-only (fixed chrome must sit where a human sees it).
    // The skeleton state already took its shot inside the loading window above.
    if (opts.state !== "skeleton") {
      await recordViewportShot(reduced.page, entry, {
        screenshotPath, baselinePath, outName, updateBaselines: opts.updateBaselines,
      });
      await recordCardShot(reduced.page, entry, {
        outDir: opts.outDir, outName, state: opts.state,
      });
    }

    // §D contrast — a full-page pair for in-flow nodes and a viewport pair for
    // fixed/sticky chrome, glyphs hidden for the backdrop recapture in both.
    const nodes = await reduced.page.evaluate(collectTextNodes, 160);
    if (nodes.length) {
      const measurePair = async (subset, fullPage) => {
        if (!subset.length) return [];
        const before = await reduced.page.screenshot({ fullPage, animations: "disabled" });
        await reduced.page.evaluate(hideGlyphs);
        const after = await reduced.page.screenshot({ fullPage, animations: "disabled" });
        await reduced.page.evaluate(restoreGlyphs);
        return reduced.page.evaluate(computeContrast, {
          before: before.toString("base64"),
          after: after.toString("base64"),
          nodes: subset,
          ds,
        });
      };
      entry.text = [
        ...(await measurePair(nodes.filter((n) => !n.fixed), true)),
        ...(await measurePair(nodes.filter((n) => n.fixed), false)),
      ];
    }

    // The skeleton entry's fixture/overflow/geometry evidence is the LOADING
    // window's DOM (measured before the shot); every other state re-reads now.
    const dom = skeletonDom ?? await reduced.page.evaluate(measureDom);
    const fixtureCounts = opts.fixtureCounts;
    entry.fixture = {
      syncBodyKeys: opts.fixtureSyncBodyKeys,
      renderedApprovalRows: dom.approvalTitles.length,
      renderedSoloRows: dom.approvalTitles.filter((t) => opts.fixtureByTitle.get(t) && !(opts.fixtureByTitle.get(t).pendingApproval.crew || []).length).length,
      renderedCrewRows: dom.approvalTitles.filter((t) => (opts.fixtureByTitle.get(t)?.pendingApproval.crew || []).length > 0).length,
      renderedCompletedRows: dom.completedRows,
      renderedWeekGroups: dom.weekGroups,
      renderedQueueOrder: dom.approvalTitles.map((t) => opts.fixtureByTitle.get(t)?.id).filter((id) => typeof id === "number"),
      renderedTitlesEllipsised: dom.titlesEllipsised,
      expected: {
        pendingApprovals: fixtureCounts.pending,
        soloRows: fixtureCounts.solo,
        crewRows: fixtureCounts.crew,
        completedRows: fixtureCounts.settled,
        weekGroups: fixtureCounts.weeks,
        queueOrder: opts.fixtureQueueOrder,
      },
    };
    entry.overflow = dom.overflow;
    entry.geometry = dom.geometry;
    entry.rhythm = dom.rhythm;
    entry.memberTileTransitionMs = dom.memberTileTransitionMs;
    entry.tapTargets = dom.tapTargets.map((t) => ({ ...t, wallOk: !opts.wall || t.h >= 64 || t.hit44 }));
    entry.focusRing = await measureFocusRings(reduced.page, ds, 12);
    // The ring walk scrolls each target into view (now including the undo
    // button deep in the Completed card). Pass B below measures shifts from the
    // scroll origin, as it always has — restore it so the extension cannot
    // re-scope an existing number.
    await reduced.page.evaluate(() => { window.scrollTo(0, 0); });
    // A committed focus-ring baseline records the rings that were already
    // failing on the unmodified page (e.g., the light-theme `.glass-subtle`
    // shadow beating the ring). The gate fails on a NEW or worsened failure,
    // and any item that fixes a recorded one re-records the baseline in the
    // same commit — the same contract the PNG baselines carry. The key carries
    // the wall discriminator: the wall profile renders different type/paddings
    // and its ring readings do not describe the non-wall layout, so a
    // wall-recorded floor must never excuse a non-wall regression (the PNG
    // baselines make the same split via their `__wall` suffix).
    const focusRingKey = `${opts.role}|${entry.viewport}|${opts.theme}${opts.wall ? "|wall" : ""}`;
    const knownRings = opts.focusRingBaseline?.rings?.[focusRingKey] ?? {};
    entry.focusRingBaselineMisses = entry.focusRing
      .filter((ring) => !(ring.ringPx >= 2 && ring.deltaLuminanceBorderIn >= 2 && ring.deltaLuminanceBorderOut >= 2))
      .filter((ring) => {
        const base = knownRings[ring.selector];
        if (!base) return true;
        return ring.ringPx < base.ringPx - 0.5
          || ring.deltaLuminanceBorderIn < base.deltaLuminanceBorderIn - 0.5
          || ring.deltaLuminanceBorderOut < base.deltaLuminanceBorderOut - 0.5;
      })
      .map((ring) => ring.selector);
    opts.focusRingSink?.push({ key: focusRingKey, rings: entry.focusRing });

    const audit = await auditPage(reduced.page);
    entry.problems = [
      ...audit.problems,
      ...(reduced.navError ? [{ rule: "navigation", severity: "error", detail: reduced.navError }] : []),
    ];
    entry.problemsBySeverity = {
      error: gatingProblems(entry).filter((p) => p.severity === "error").length,
      warn: gatingProblems(entry).filter((p) => p.severity === "warn").length,
    };

    const reducedMotionStyles = await reduced.page.evaluate(measureMotion);
    const listenerAfter = await reduced.page.evaluate(listenerCount);
    entry.motion = {
      cardTransitionBudgetMs: null,
      baselineTransitionBudgetMs: null,
      transitionBudgetAddedMs: null,
      keyframesAdded: null,
      infiniteAnimations: null,
      animationNames: [],
      reducedMotionMaxTransitionMs: reducedMotionStyles.cardTransitionBudgetMs,
      hiddenTabAnimationsDelta: null,
      listenerCountDelta: listenerAfter - listenerBefore,
      endStateDiffPx: null,
    };
    entry.summary = summarizeText(entry.text);
    entry.cls = {
      inputExcluded: clsInputExcluded,
      loadWindow: Math.round(clsLoadWindow * 100000) / 100000,
      forcedLayout: null,
      forcedTriggers: [],
    };

    // §H-5: the settled counterpart for the skeleton row, same card + viewport.
    // Measured here (before pass B's destructive down-resizes) after the
    // fixture's delayed read lands; the loading-window heights were frozen
    // before the shot. Both sides of the 1px rule are now measured in ONE run.
    if (opts.state === "skeleton" && skeletonRows) {
      await reduced.page.waitForFunction(
        () => document.querySelector('[data-completed-card] button[aria-label^="Undo completion of "]')
          || document.querySelector('button[aria-label^="Approve "]'),
        undefined,
        { timeout: 30_000 },
      ).catch(() => {});
      await expandCompleted(reduced.page);
      const settledRows = await reduced.page.evaluate(measureSettledRows);
      entry.skeletonParity = buildSkeletonParity(skeletonRows, settledRows);
    }

    // §C pass B — forced layout: smaller-width resizes + programmatic expand/collapse.
    await reduced.page.evaluate(resetCls);
    const triggers = [];
    for (const width of [1536, 1280, 768, 390, 320]) {
      if (width < VIEWPORT_REGISTER[opts.viewportName].width) {
        await reduced.page.setViewportSize({ width, height: VIEWPORT_REGISTER[opts.viewportName].height });
        await sleep(320);
        triggers.push(`resize:${width}`);
      }
    }
    const forcedResize = await reduced.page.evaluate(clsForcedSummary);
    await reduced.page.evaluate(resetCls);
    if (disclosure !== "absent") {
      await reduced.page.evaluate(toggleCompletedDisclosure);
      await sleep(320);
      triggers.push("programmatic-expand");
      await reduced.page.evaluate(toggleCompletedDisclosure);
      await sleep(320);
      triggers.push("programmatic-collapse");
    }
    const forcedDisclosure = await reduced.page.evaluate(clsForcedSummary);
    entry.cls.forcedLayout = Math.round((forcedResize + forcedDisclosure) * 100000) / 100000;
    entry.cls.forcedLayoutResize = Math.round(forcedResize * 100000) / 100000;
    entry.cls.forcedLayoutDisclosure = Math.round(forcedDisclosure * 100000) / 100000;
    entry.cls.forcedTriggers = triggers;

    entry.consoleErrors = [...new Set(reduced.consoleErrors)];
    entry.pageErrors = [...new Set(reduced.pageErrors)];
    entry.failedRequests = [...new Set(reduced.failedRequests)];
    entry.unstubbed = [...new Set(reduced.unstubbed)];
  } finally {
    await reduced.context.close();
  }
  if (entry.redirected) return entry;

  // Motion-on twin: the transition budget and the hidden-tab / listener samples.
  const motion = await openContext(browser, { ...opts, reducedMotion: "no-preference" });
  try {
    await waitForBoard(motion.page, opts.state, opts.role);
    await expandCompleted(motion.page);
    const motionShot = await motion.page.screenshot({ animations: "disabled" });
    const styles = await motion.page.evaluate(measureMotion);
    // The member tile's motion-on transition (`entry.memberTileTransitionMs`
    // is the reduced-motion twin from measureDom): `.tap-sm` must own the
    // tile's ONE transition with `.member-tile`'s own deleted, so the
    // blanket's ~0 here becomes the expected 150ms.
    const memberTileTransitionMotionMs = await motion.page.evaluate(() => {
      const tile = document.querySelector(".member-tile");
      if (!tile) return null;
      const durations = (getComputedStyle(tile).transitionDuration || "0s")
        .split(",").map((v) => (parseFloat(v) || 0) * 1000);
      return Math.max(0, ...durations);
    });
    const listenerBefore = await motion.page.evaluate(listenerCount);
    for (let i = 0; i < 5; i += 1) {
      await motion.page.evaluate(toggleCompletedDisclosure);
      await sleep(160);
      await motion.page.evaluate(toggleCompletedDisclosure);
      await sleep(160);
    }
    await expandCompleted(motion.page);
    const listenerAfter = await motion.page.evaluate(listenerCount);
    const animationsBefore = await motion.page.evaluate(() => document.getAnimations().length);
    await motion.page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(2000);
    const animationsAfter = await motion.page.evaluate(() => document.getAnimations().length);
    const reducedB64 = readFileSync(screenshotPath).toString("base64");
    const endStateDiffPx = await motion.page.evaluate(pixelDiff, {
      a: reducedB64,
      b: motionShot.toString("base64"),
    });
    // "Added" motion is measured against the committed motion baseline: a
    // keyframe name or a >240ms transition that did not exist before is new
    // motion; the pre-existing emoji loops and card transitions are recorded
    // as the baseline, not counted as the item's own.
    const baseline = opts.motionBaseline ?? { animationNames: [], transitions: {} };
    const baselineNames = new Set(baseline.animationNames ?? []);
    const baselineTransitions = baseline.transitions ?? {};
    const uniqueAnimations = [...new Map(styles.animationNames.map((a) => [a.name, a])).values()];
    const addedAnimations = uniqueAnimations.filter((a) => !baselineNames.has(a.name));
    const addedTransitions = Object.entries(styles.transitionBySelector)
      .filter(([selector, ms]) => ms > 240 && (baselineTransitions[selector] === undefined || ms > baselineTransitions[selector] + 0.5));
    opts.motionSink?.push(styles);
    entry.motion = {
      cardTransitionBudgetMs: styles.cardTransitionBudgetMs,
      baselineTransitionBudgetMs: Object.keys(baselineTransitions).length
        ? round(Math.max(...Object.values(baselineTransitions)))
        : null,
      transitionBudgetAddedMs: addedTransitions.length
        ? round(Math.max(...addedTransitions.map(([, ms]) => ms)))
        : 0,
      keyframesAdded: addedAnimations.length,
      infiniteAnimations: addedAnimations.filter((a) => a.infinite).length,
      animationNames: [...new Set(styles.animationNames.map((a) => a.name))].sort(),
      reducedMotionMaxTransitionMs: entry.motion.reducedMotionMaxTransitionMs,
      hiddenTabAnimationsDelta: animationsAfter - animationsBefore,
      listenerCountDelta: Math.max(entry.motion.listenerCountDelta, listenerAfter - listenerBefore),
      endStateDiffPx,
      // The motion-on twin of `entry.memberTileTransitionMs` (measured in the
      // reduced context): `.tap-sm`'s 150ms must be the tile's ONE transition.
      memberTileTransitionMs: memberTileTransitionMotionMs,
    };
    entry.consoleErrors = [...new Set([...entry.consoleErrors, ...motion.consoleErrors])];
    entry.pageErrors = [...new Set([...entry.pageErrors, ...motion.pageErrors])];
    entry.failedRequests = [...new Set([...entry.failedRequests, ...motion.failedRequests])];
  } finally {
    await motion.context.close();
  }

  entry.gates = computeEntryGates(entry, opts);
  entry.exitCode = Object.values(entry.gates).every((v) => v === "pass")
    && entry.problemsBySeverity.error === 0 ? 0 : 1;
  return entry;
}

function computeEntryGates(entry, opts) {
  const required = requiredCountsFor(entry.state, entry.role, opts.fixtureCounts);
  const fixtureRendered = Object.entries(required).every(
    ([key, value]) => entry.fixture[key] === value,
  );
  const problems = gateProblems(gatingProblems(entry));
  // Focus rings are only measurable where the cards render; that is the parent
  // persona the fixture describes (the approval card is parent-gated). Other
  // roles are measured when controls exist and are vacuous when they do not.
  const needsRings = entry.role === "parent" && (entry.state === "populated" || entry.state === "in-flight");
  const focusRingPass = entry.focusRing.length === 0
    ? !needsRings
    : entry.focusRingBaselineMisses.length === 0;
  // §H-5's enforceable form. A `--state skeleton` entry must have measured at
  // least one card for the parent persona the fixture describes (a signed-out
  // guest renders no loading card — same role-applicability rule as
  // `requiredCountsFor`); every measured card must clear the 1px rule; other
  // states carry an empty array and pass vacuously.
  const skeletonParityPass = entry.skeletonParity.every((parity) => parity.pass)
    && (entry.state !== "skeleton" || entry.role !== "parent" || entry.skeletonParity.length > 0);
  const width = Number(entry.viewport.split("x")[0]);
  return {
    fixtureRendered: fixtureRendered ? "pass" : "fail",
    contrast: entry.summary.contrastFail === 0
      && typeof entry.summary.worstNodeRatio === "number"
      && entry.summary.worstNodeRatio >= 4.0 ? "pass" : "fail",
    typeFloor: entry.summary.typeFloorFail === 0 ? "pass" : "fail",
    tap: problems.tap ? "pass" : "fail",
    overflow320: width <= 390
      ? (problems.overflow320 && entry.overflow.root === 0 && entry.overflow.body === 0 ? "pass" : "fail")
      : "pass",
    clipped: problems.clipped && !entry.overflow.worstClipped ? "pass" : "fail",
    clsTwoWay: entry.cls.inputExcluded === 0 && entry.cls.forcedLayoutDisclosure === 0 ? "pass" : "fail",
    skeletonParity: skeletonParityPass ? "pass" : "fail",
    focusRing: focusRingPass ? "pass" : "fail",
    baselineDrift: opts.updateBaselines
      ? "pass"
      : (entry.baseline && entry.baselineDiffPx === 0 ? "pass" : "fail"),
    keyboard: "pass", // finalized by the run-level keyboard walk
  };
}

function baselineName(opts) {
  const prefix = opts.state === "populated" ? "tasks" : `tasks-${opts.state}`;
  const suffix = opts.wall ? "__wall" : "";
  const vp = VIEWPORT_REGISTER[opts.viewportName];
  return `${prefix}__${opts.role}__${vp.width}x${vp.height}__${opts.theme}${suffix}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// State probes + keyboard transcript
// ─────────────────────────────────────────────────────────────────────────────

async function runStateProbe(browser, opts, state) {
  const fixtureFile = path.join(opts.fixturesDir, STATE_FIXTURE_FILE[state]);
  const fixtureRaw = JSON.parse(readFileSync(fixtureFile, "utf8"));
  const fixtureBody = fixtureRaw.body ?? fixtureRaw;
  const delayMs = state === "skeleton" ? 4000 : 0;
  const seedInFlight = state === "in-flight" ? [inFlightEntry(fixtureBody)] : null;
  const probe = buildStateExpectations(state);
  const ctx = await openContext(browser, {
    ...opts,
    state,
    viewportName: "phoneSmall",
    role: "parent",
    theme: "dark",
    wall: false,
    fixtureRaw,
    fixtureBody,
    delayMs,
    seedInFlight,
  });
  try {
    if (state === "skeleton") {
      const during = await ctx.page.evaluate(measureDom);
      probe.skeletonsVisible = await ctx.page.evaluate(
        () => document.querySelectorAll(".animate-pulse").length,
      );
      probe.renderedApprovalRows = during.approvalTitles.length;
      probe.renderedCompletedRows = during.completedRows;
      probe.renderedWeekGroups = during.weekGroups;
      probe.emptyMessageVisible = during.emptyMessages.length > 0;
      probe.rendered = true;
      await sleep(Math.max(0, delayMs - 900) + 1200);
    } else {
      await waitForBoard(ctx.page, state, "parent");
      await expandCompleted(ctx.page);
      const dom = await ctx.page.evaluate(measureDom);
      probe.renderedApprovalRows = dom.approvalTitles.length;
      probe.renderedCompletedRows = dom.completedRows;
      probe.renderedWeekGroups = dom.weekGroups;
      probe.emptyMessageVisible = dom.emptyMessages.length > 0;
      probe.errorCopyVisible = dom.errorMessages.length > 0;
      probe.inFlightRows = dom.inFlightRows.length;
      probe.queueBannerVisible = dom.queueBannerVisible;
      probe.skeletonsVisible = await ctx.page.evaluate(
        () => document.querySelectorAll(".animate-pulse").length,
      );
      probe.rendered = state === "sync-failed" ? probe.errorCopyVisible : true;
    }
  } finally {
    await ctx.context.close();
  }
  return probe;
}

function inFlightEntry(fixtureBody) {
  const task = (fixtureBody.snapshot?.tasks ?? []).find((t) => t.id === 12) ?? {};
  return {
    version: 1,
    operationId: "vr-in-flight-approve-12",
    route: "/api/tasks/approve",
    action: "approve",
    payload: { taskId: 12, memberName: "Rebecca (Mom)" },
    createdAt: "2026-10-08T16:00:00.000Z",
    attemptCount: 1,
    nextAttemptAt: "2026-10-08T23:00:00.000Z",
    status: "queued",
    displayTarget: { kind: "approval", taskId: 12, title: task.title ?? "Drain the sink" },
  };
}

async function runKeyboard(browser, opts) {
  const fixtureFile = path.join(opts.fixturesDir, STATE_FIXTURE_FILE.populated);
  const fixtureRaw = JSON.parse(readFileSync(fixtureFile, "utf8"));
  const fixtureBody = fixtureRaw.body ?? fixtureRaw;
  const ctx = await openContext(browser, {
    ...opts,
    state: "populated",
    viewportName: "phone",
    role: "parent",
    theme: "dark",
    wall: false,
    fixtureRaw,
    fixtureBody,
    delayMs: 0,
    seedInFlight: null,
  });
  const transcript = {
    route: opts.route,
    role: "parent",
    viewport: "390x844",
    theme: "dark",
    recordedAt: new Date().toISOString(),
    steps: [],
    escapeReturnsFocus: false,
    enterActivatesDisclosure: false,
    orderViolations: [],
    unreachable: [],
    unlabelled: [],
  };
  try {
    await waitForBoard(ctx.page, "populated", "parent");
    await expandCompleted(ctx.page);
    await ctx.page.evaluate(() => {
      const g = window.__vrGate;
      const { approval, completed } = g.cardScopes();
      const selector = 'button, [role="button"], a[href]';
      const els = [
        ...(approval ? approval.querySelectorAll(selector) : []),
        ...(completed ? completed.querySelectorAll(selector) : []),
      ];
      window.__vrFocusTargets = els;
    });
    const targetNames = await ctx.page.evaluate(() => window.__vrFocusTargets.map(
      (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
    ));
    const visited = [];
    for (let i = 0; i < 160; i += 1) {
      await ctx.page.keyboard.press("Tab");
      const info = await ctx.page.evaluate(() => window.__vrGate.focusInfo());
      if (!info) continue;
      const targetIndex = await ctx.page.evaluate(() => window.__vrFocusTargets.indexOf(document.activeElement));
      transcript.steps.push({
        i: transcript.steps.length + 1,
        key: "Tab",
        activeElement: info.tag,
        accessibleName: info.accessibleName,
        ringPx: info.ringPx,
        inViewport: info.inViewport,
        ariaExpanded: info.ariaExpanded,
      });
      if (targetIndex >= 0 && !visited.includes(targetIndex)) visited.push(targetIndex);
      if (i > 20 && info.tag === "body") break;
    }
    transcript.unlabelled = targetNames
      .map((name, index) => ({ index, name }))
      .filter((t) => !t.name)
      .map((t) => `target[${t.index}]`);
    transcript.unreachable = targetNames
      .map((name, index) => ({ index, name }))
      .filter((t) => !visited.includes(t.index))
      .map((t) => `target[${t.index}] ${t.name}`);
    const sortedVisits = [...visited].sort((a, b) => a - b);
    transcript.orderViolations = visited
      .filter((v, i) => v !== sortedVisits[i])
      .map((v, i) => `visited target[${v}] at step ${i} out of DOM order`);

    // Enter-activation of the Completed disclosure (U3-0b #5): the transcript
    // must verify a real key activation flips `aria-expanded`, not only Tab
    // order. The walk above ends expanded, so Enter collapses it.
    const disclosureBefore = await ctx.page.evaluate(() => {
      const card = document.querySelector("[data-completed-card]");
      const btn = card && Array.from(card.querySelectorAll("button"))
        .find((b) => /Show completed|Hide completed/.test(b.textContent || ""));
      if (!btn) return null;
      window.__vrEnterTarget = btn;
      btn.focus();
      return btn.getAttribute("aria-expanded");
    });
    if (disclosureBefore !== null) {
      await ctx.page.keyboard.press("Enter");
      await sleep(450);
      const after = await ctx.page.evaluate(
        () => window.__vrEnterTarget.getAttribute("aria-expanded"),
      );
      transcript.enterActivatesDisclosure = after !== disclosureBefore;
      transcript.steps.push({
        i: transcript.steps.length + 1,
        key: "Enter",
        activeElement: "button",
        accessibleName: "completed disclosure",
        ringPx: null,
        inViewport: true,
        ariaExpanded: after,
      });
      if (after === "false") {
        // Leave the end state expanded, the state the walk started from.
        await ctx.page.keyboard.press("Enter");
        await sleep(250);
      }
    }

    const hasApproveAll = await ctx.page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find((b) => /Approve all/.test(b.textContent || ""));
      if (!btn) return false;
      window.__vrApproveAll = btn;
      btn.focus();
      return true;
    });
    if (hasApproveAll) {
      await ctx.page.keyboard.press("Enter");
      await ctx.page.waitForSelector('[role="dialog"]', { timeout: 3_000 }).catch(() => {});
      await sleep(250);
      await ctx.page.keyboard.press("Escape");
      await sleep(350);
      transcript.escapeReturnsFocus = await ctx.page.evaluate(
        () => document.activeElement === window.__vrApproveAll,
      );
    }
  } finally {
    await ctx.context.close();
  }
  return transcript;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation + main
// ─────────────────────────────────────────────────────────────────────────────

function aggregate(entries, states, keyboard, updateBaselines) {
  const allProblems = [...entries.flatMap((e) => e.problems), ...states.flatMap((s) => s.problems ?? [])];
  const gatingAll = entries.flatMap((e) => gatingProblems(e));
  const text = entries.flatMap((e) => e.text);
  const ratios = text.map((t) => t.ratioMedian).filter((r) => typeof r === "number");
  const sorted = [...ratios].sort((a, b) => a - b);
  const summary = {
    contrastFail: text.filter((t) => !t.pass).length,
    typeFloorFail: text.filter((t) => t.fontPx < 12).length,
    worstNodeRatio: sorted.length ? round(sorted[0]) : null,
    medianMinRatio: sorted.length ? round(sorted[Math.floor(sorted.length / 2)]) : null,
  };
  const problemsBySeverity = {
    error: gatingAll.filter((p) => p.severity === "error").length,
    warn: gatingAll.filter((p) => p.severity === "warn").length,
  };
  const keyboardGate = keyboard.unlabelled.length === 0
    && keyboard.orderViolations.length === 0
    && keyboard.escapeReturnsFocus
    && keyboard.enterActivatesDisclosure;
  const gates = {};
  for (const key of GATE_KEYS) {
    if (key === "keyboard") {
      gates[key] = keyboardGate ? "pass" : "fail";
      continue;
    }
    const entryGate = entries.every((e) => e.gates[key] === "pass");
    if (key === "fixtureRendered") {
      const probeGate = states
        .filter((s) => s.name === "populated" || s.name === "in-flight")
        .every((s) => s.renderedApprovalRows > 0 && s.renderedCompletedRows > 0);
      gates[key] = entryGate && probeGate ? "pass" : "fail";
    } else {
      gates[key] = entryGate ? "pass" : "fail";
    }
  }
  const exitCode = Object.values(gates).every((v) => v === "pass") && problemsBySeverity.error === 0 ? 0 : 1;
  return { summary, problems: allProblems, problemsBySeverity, gates, exitCode };
}

function printHelp() {
  console.log(`Usage: node scripts/visual-review/tasks-review.mjs [options]
  --route <path>          the only route this gate knows (default /tasks)
  --role <list>           ${ROLES.join(" | ")} — comma-separated (default parent,child,guest)
  --theme <list>          dark | light — comma-separated (default dark,light)
  --viewport <all|list>   ${Object.keys(VIEWPORT_REGISTER).join(" | ")} (default all; phoneSmall always included)
  --wall <on|off>         wall profile (default off)
  --state <name>          ${STATE_NAMES.join(" | ")} (default populated)
  --fixtures <dir>        fixture dir (default ${DEFAULT_FIXTURES_DIR})
  --update-baselines      record baselines + keyboard.json (never a critic pass)
  --base-url <url>        adopt an already-running server instead of booting one
  --out <dir>             artifact dir (default ${DEFAULT_OUT_DIR})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const roles = args.role.split(",").map((s) => s.trim()).filter(Boolean);
  for (const role of roles) {
    if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  }
  const themes = args.theme.split(",").map((s) => s.trim()).filter(Boolean);
  for (const theme of themes) {
    if (theme !== "dark" && theme !== "light") throw new Error(`Unknown theme: ${theme}`);
  }
  const viewportNames = resolveViewportNames(args.viewport);
  const state = args.state === "loading" ? "skeleton" : args.state;
  if (!STATE_NAMES.includes(state)) throw new Error(`Unknown state: ${args.state}`);
  const wall = args.wall === "on";
  const fixturesDir = path.resolve(args.fixtures);
  const outDir = path.resolve(args.out);
  const baselinesDir = DEFAULT_BASELINES_DIR;
  mkdirSync(outDir, { recursive: true });

  const fixtureFile = path.join(fixturesDir, STATE_FIXTURE_FILE[state]);
  const fixtureRaw = JSON.parse(readFileSync(fixtureFile, "utf8"));
  const fixtureBody = fixtureRaw.body ?? fixtureRaw;
  const fixture = classifyFixtureTasks(fixtureBody.snapshot?.tasks ?? []);
  const fixtureByTitle = new Map((fixtureBody.snapshot?.tasks ?? []).map((t) => [t.title, t]));
  const queueOrder = [...fixture.pending]
    .sort((a, b) => (Date.parse(b.pendingApproval.at) - Date.parse(a.pendingApproval.at)) || (b.id - a.id))
    .map((t) => t.id);

  const run = {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    route: args.route,
    state,
    wall,
    matrix: { roles, viewports: viewportNames, themes },
    fixture: {
      file: path.relative(path.resolve(SCRIPT_DIR, "..", ".."), fixtureFile),
      syncBodyKeys: Object.keys(fixtureBody),
      counts: fixture.counts,
      expectedQueueOrder: queueOrder,
    },
    entries: [],
    states: [],
    summary: {},
    problems: [],
    problemsBySeverity: { error: 0, warn: 0 },
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    unstubbed: [],
    gates: {},
    exitCode: 1,
  };

  const server = args.baseUrl
    ? { baseUrl: args.baseUrl, stop: async () => {} }
    : await bootServer();
  const motionBaselinePath = path.join(baselinesDir, "motion-baseline.json");
  const motionBaseline = existsSync(motionBaselinePath)
    ? JSON.parse(readFileSync(motionBaselinePath, "utf8"))
    : { animationNames: [], transitions: {} };
  const focusRingBaselinePath = path.join(baselinesDir, "focus-ring-baseline.json");
  const focusRingBaseline = existsSync(focusRingBaselinePath)
    ? JSON.parse(readFileSync(focusRingBaselinePath, "utf8"))
    : { rings: {} };
  const motionSink = [];
  const focusRingSink = [];
  let keyboard = {
    route: args.route,
    role: "parent",
    recordedAt: new Date().toISOString(),
    steps: [],
    escapeReturnsFocus: false,
    enterActivatesDisclosure: false,
    orderViolations: [],
    unreachable: [],
    unlabelled: [],
  };
  try {
    await withBrowser(async (browser) => {
      for (const role of roles) {
        for (const viewportName of viewportNames) {
          for (const theme of themes) {
            const entry = await runEntry(browser, {
              ...args,
              route: args.route,
              baseUrl: server.baseUrl,
              role,
              viewportName,
              theme,
              wall,
              state,
              fixturesDir,
              outDir,
              baselinesDir,
              fixtureRaw,
              fixtureBody,
              fixtureByTitle,
              fixtureCounts: fixture.counts,
              fixtureQueueOrder: queueOrder,
              fixtureSyncBodyKeys: Object.keys(fixtureBody),
              delayMs: state === "skeleton" ? SKELETON_WINDOW_MS : 0,
              seedInFlight: null,
              motionBaseline,
              motionSink,
              focusRingBaseline,
              focusRingSink,
            });
            run.entries.push(entry);
            const gateSummary = Object.entries(entry.gates)
              .filter(([, value]) => value !== "pass")
              .map(([key]) => key);
            console.log(
              `[${role}/${entry.viewport}/${theme}] exit=${entry.exitCode}` +
              ` contrastFail=${entry.summary.contrastFail} worst=${entry.summary.worstNodeRatio}` +
              ` cls=${entry.cls.inputExcluded}/${entry.cls.forcedLayout}` +
              (gateSummary.length ? ` FAILED: ${gateSummary.join(",")}` : ""),
            );
          }
        }
      }
      for (const probeState of STATE_NAMES) {
        const probe = await runStateProbe(browser, { ...args, baseUrl: server.baseUrl, fixturesDir }, probeState);
        run.states.push(probe);
      }
      keyboard = await runKeyboard(browser, { ...args, baseUrl: server.baseUrl, fixturesDir });
    });
  } finally {
    await server.stop();
  }

  for (const entry of run.entries) entry.states = run.states;
  const agg = aggregate(run.entries, run.states, keyboard, args.updateBaselines);
  run.summary = agg.summary;
  run.problems = agg.problems;
  run.problemsBySeverity = agg.problemsBySeverity;
  run.gates = agg.gates;
  run.exitCode = agg.exitCode;
  run.consoleErrors = [...new Set(run.entries.flatMap((e) => e.consoleErrors))];
  run.pageErrors = [...new Set(run.entries.flatMap((e) => e.pageErrors))];
  run.failedRequests = [...new Set(run.entries.flatMap((e) => e.failedRequests))];
  run.unstubbed = [...new Set(run.entries.flatMap((e) => e.unstubbed))];

  if (args.updateBaselines) {
    mkdirSync(baselinesDir, { recursive: true });
    writeFileSync(path.join(baselinesDir, "keyboard.json"), `${JSON.stringify(keyboard, null, 2)}\n`);
    const animationNames = [...new Set(motionSink.flatMap((s) => s.animationNames.map((a) => a.name)))].sort();
    const transitions = {};
    for (const styles of motionSink) {
      for (const [selector, ms] of Object.entries(styles.transitionBySelector)) {
        transitions[selector] = Math.max(transitions[selector] ?? 0, ms);
      }
    }
    writeFileSync(
      motionBaselinePath,
      `${JSON.stringify({ route: args.route, recordedAt: new Date().toISOString(), animationNames, transitions }, null, 2)}\n`,
    );
    // MERGE, don't replace: a recording run covers one profile (wall on or
    // off) and one matrix, and replacing would silently drop the other
    // profile's keys — the exact way a wall-recorded floor could end up standing
    // in for a non-wall one. Keys the run did not cover keep their committed
    // values; keys it did cover are overwritten with the fresh measurement.
    const existingRings = existsSync(focusRingBaselinePath)
      ? (JSON.parse(readFileSync(focusRingBaselinePath, "utf8")).rings ?? {})
      : {};
    const rings = { ...existingRings };
    for (const { key, rings: measured } of focusRingSink) {
      rings[key] = {};
      for (const ring of measured) {
        rings[key][ring.selector] = {
          ringPx: ring.ringPx,
          deltaLuminanceBorderIn: ring.deltaLuminanceBorderIn,
          deltaLuminanceBorderOut: ring.deltaLuminanceBorderOut,
        };
      }
    }
    writeFileSync(
      focusRingBaselinePath,
      `${JSON.stringify({ route: args.route, recordedAt: new Date().toISOString(), rings }, null, 2)}\n`,
    );
  }

  const runPath = path.join(outDir, `${state}.json`);
  writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`\nJSON: ${runPath}`);
  console.log(`gates: ${JSON.stringify(run.gates)}`);
  console.log(`problems: error=${run.problemsBySeverity.error} warn=${run.problemsBySeverity.warn}`);
  console.log(`summary: ${JSON.stringify(run.summary)}`);
  console.log(run.exitCode === 0 ? "EXIT 0 — gate pass" : "EXIT 1 — gate fail");
  process.exit(run.exitCode);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
