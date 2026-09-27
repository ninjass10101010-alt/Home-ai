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

export const SKY: Record<string, string> = {
  clear: "from-[#55bce8] via-[#8fd8f1] to-[#d8f2f4]",
  dawn: "from-[#898cbb] via-[#e8a2b6] to-[#ffd8a0]", // machine-verified AA vs slate-800 (4.55/7.16/10.85)
  dusk: "from-[#8c8db1] via-[#ce73a1] to-[#ffb072]", // machine-verified AA vs slate-800 (4.57/4.59/8.15)
  cloudy: "from-[#dfe4ee] via-[#eef1f6] to-[#d9e6f5]", // pearl grey → powder blue
  rain: "from-[#b9c4d8] via-[#c9d7ea] to-[#d8d3f0]", // slate → lilac
  snow: "from-[#f4f7fb] via-[#e6efff] to-[#efe6fb]", // near-white → lavender
  heavySnow: "from-[#5d6f8c] via-[#465a78] to-[#354861]",
  storm: "from-[#6a6f96] via-[#5d5b8f] to-[#4d4770]", // deep slate-violet storm wash (white ink stays ≥4.5:1 at every stop)
  night: "from-[#6f74a8] via-[#a29dc9] to-[#e2dbf2]", // lamplit dusk wash — top stop #6f74a8 is 3.30:1 vs slate-800 (known gap, Change Record contract 8)
};

// Ink flips per sky so text stays legible on pastels
export const INK: Record<string, string> = {
  clear: "text-slate-800",
  cloudy: "text-slate-800",
  rain: "text-slate-800",
  snow: "text-slate-800",
  storm: "text-white",
  night: "text-slate-800",
};

// One glass recipe, reused everywhere. Drive-tuned: a 135° white gradient at
// lower opacity, 18px blur, 160% saturation. This is the SAME material the
// card has always used — retuned, not a second material (DESIGN.md 2026-09-14
// record intact). The chip's specular top-half sheen stays (pinned by tests).
export const GLASS =
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.22),rgba(255,255,255,0.08))] " +
  "backdrop-blur-[18px] backdrop-saturate-[1.6] " +
  "border border-white/[0.28] " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(255,255,255,0.08),0_10px_30px_-10px_rgba(0,0,0,0.35)] " +
  "relative before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] " +
  "before:bg-gradient-to-b before:from-white/40 before:to-transparent before:to-50%";

// Derived from GLASS — bg stops +0.10 (the old recipe's step), border +0.12
// (0.28→0.40, the old border-white/50→60 step). The .replace chain relies on
// String.replace first-occurrence semantics: the gradient's 0.08 precedes the
// inset shadow's 0.08 in the concatenated string, so only the gradient lifts.
export const GLASS_NIGHT = GLASS
  .replace("rgba(255,255,255,0.22)", "rgba(255,255,255,0.32)")
  .replace("rgba(255,255,255,0.08)", "rgba(255,255,255,0.18)")
  .replace("border-white/[0.28]", "border-white/[0.40]");
