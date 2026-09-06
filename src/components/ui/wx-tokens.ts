// wx-tokens — sky washes, ink, and the one shared glass recipe.
// (User's wx-tokens.js, verbatim, plus a storm sky/ink: WMO 95/96/99
// reach the card but SKY had no storm key.)

export const SKY: Record<string, string> = {
  clear: "from-[#bfe3ff] via-[#dcefff] to-[#ffe7c9]", // sky → cream
  cloudy: "from-[#dfe4ee] via-[#eef1f6] to-[#d9e6f5]", // pearl grey → powder blue
  rain: "from-[#b9c4d8] via-[#c9d7ea] to-[#d8d3f0]", // slate → lilac
  snow: "from-[#f4f7fb] via-[#e6efff] to-[#efe6fb]", // near-white → lavender
  storm: "from-[#6a6f96] via-[#5d5b8f] to-[#4d4770]", // deep slate-violet storm wash (white ink stays ≥4.5:1 at every stop)
  night: "from-[#6f74a8] via-[#a29dc9] to-[#e2dbf2]", // lighter dusk wash (slate-800 ink stays ≥4.5:1 at every stop)
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

// One glass recipe, reused everywhere
export const GLASS =
  "bg-white/30 backdrop-blur-2xl backdrop-saturate-150 " +
  "border border-white/50 " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,.75),inset_0_-1px_0_rgba(255,255,255,.15),0_8px_32px_-8px_rgba(60,70,120,.18)] " +
  // specular sheen on the top half
  "relative before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] " +
  "before:bg-gradient-to-b before:from-white/40 before:to-transparent before:to-50%";

export const GLASS_NIGHT = GLASS.replace("bg-white/30", "bg-white/40").replace(
  "border-white/50",
  "border-white/60"
);
