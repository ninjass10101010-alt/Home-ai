// wx-tokens — sky washes, ink, and the one shared glass recipe.
// (User's wx-tokens.js, verbatim, plus a storm sky/ink: WMO 95/96/99
// reach the card but SKY had no storm key.)

export const WX_POSTER = {
  clearTop: "#55BCE8",
  clearMid: "#8FD8F1",
  clearBottom: "#D8F2F4",
  cloudLight: "#E9FFFC",
  cloudMid: "#82D8D0",
  cloudDeep: "#2AA6A4",
  sun: "#FFD166",
  rain: "#C7EEFA",
  snow: "#FFFFFF",
  storm: "#FFC857",
  clearGlow: "rgba(58, 180, 220, 0.34)",
} as const;

// Monster washes (Amendment A4): every field reads as a FLAT poster wash —
// each key keeps its 3-stop structure (the C7 .wx-sky probe greps verbatim
// from-[#hex]) but the stops sit within ~one lightness step of each other.
// Machine-verified 2026-10-02 against WCAG AA (≥ 4.5:1): light fields carry
// slate-800 #1E293B ink; the dark-field exception (storm, heavySnow) keeps
// white ink. dawn/dusk stay byte-identical (pinned by two test files).
export const SKY: Record<string, string> = {
  clear: "from-[#55bce8] via-[#58c0ea] to-[#5bc4ec]", // flat sky-blue — the poster signature (6.79/7.07/7.35 vs slate-800)
  dawn: "from-[#898cbb] via-[#e8a2b6] to-[#ffd8a0]", // machine-verified AA vs slate-800 (4.55/7.16/10.85)
  dusk: "from-[#8c8db1] via-[#ce73a1] to-[#ffb072]", // machine-verified AA vs slate-800 (4.57/4.59/8.15)
  cloudy: "from-[#9cc9e2] via-[#a1cde5] to-[#a6d1e8]", // muted sky-blue (8.27/8.62/8.99 vs slate-800)
  rain: "from-[#adb9d3] via-[#a9b6d1] to-[#a5b2cf]", // flat slate-lilac, room for neon rain accents (7.42/7.17/6.87)
  snow: "from-[#f6f6fa] via-[#f3f2f8] to-[#f0eef6]", // near-white + lavender (13.57/13.14/12.72 vs slate-800)
  heavySnow: "from-[#4c607e] via-[#485c7a] to-[#445876]", // serious dark slate, white ink (6.40/6.80/7.23 vs white)
  storm: "from-[#656399] via-[#5f5d93] to-[#58568e]", // flat violet-slate, white ink (5.53/6.05/6.70 vs white)
  night: "from-[#8b90c6] via-[#8e93c9] to-[#9196cd]", // lamplit indigo — top stop now passes AA vs slate-800 (4.81/4.99/5.19), closing the 3.30 gap
};

// Ink flips per sky so text stays legible on the washes — mirrors the
// widget's toyInk contract: storm + heavySnow carry white, every other
// field carries slate-800.
export const INK: Record<string, string> = {
  clear: "text-slate-800",
  dawn: "text-slate-800",
  dusk: "text-slate-800",
  cloudy: "text-slate-800",
  rain: "text-slate-800",
  snow: "text-slate-800",
  heavySnow: "text-white",
  storm: "text-white",
  night: "text-slate-800",
};

// One glass recipe, reused everywhere. Monster beast-glass (2026-10-02):
// the same 135° white gradient at a heavier specular (0.22→0.26 lift,
// inset top highlight 0.45→0.52), 18px blur, 160% saturation. Still ONE
// material, retuned — not a second recipe (DESIGN.md record intact).
// The chip's specular top-half sheen stays (pinned by tests).
export const GLASS =
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.26),rgba(255,255,255,0.08))] " +
  "backdrop-blur-[18px] backdrop-saturate-[1.6] " +
  "border border-white/[0.28] " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.52),inset_0_-1px_0_rgba(255,255,255,0.08),0_10px_30px_-10px_rgba(0,0,0,0.35)] " +
  "relative before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] " +
  "before:bg-gradient-to-b before:from-white/40 before:to-transparent before:to-50%";

// Derived from GLASS — bg stops +0.10 (the recipe's step), border +0.12
// (0.28→0.40). The .replace chain relies on String.replace first-occurrence
// semantics: the gradient's 0.08 precedes the inset shadow's 0.08 in the
// concatenated string, so only the gradient lifts.
export const GLASS_NIGHT = GLASS
  .replace("rgba(255,255,255,0.26)", "rgba(255,255,255,0.36)")
  .replace("rgba(255,255,255,0.08)", "rgba(255,255,255,0.18)")
  .replace("border-white/[0.28]", "border-white/[0.40]");

// Monster capsule palette (Amendment A3): the five segment colors every
// Monster glyph (hero digits + condition icons) is built from, the darker
// balloon-knot shades, the shared glint, and the face inks (dark-on-color,
// per segment family, like the locked monster-v3 mockup). Raw hex lives
// here — the allowlisted token file — so WxToys carries none of it.
export const MONSTER = {
  red: "#EF4D6F",
  blue: "#2E6DB4",
  purple: "#A98BDC",
  orange: "#F6A83C",
  teal: "#7DCDE4",
  knotRed: "#C2304F",
  knotOrange: "#DE8F2E",
  knotPurple: "#8B6BC2",
  glint: "#FFFFFF",
  inkRed: "#5F1230",
  inkBlue: "#10284A",
  inkOrange: "#7A4A16",
  pupil: "#101418",
} as const;
