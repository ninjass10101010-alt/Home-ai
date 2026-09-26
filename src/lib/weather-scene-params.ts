// weather-scene-params — pure mapping from measured weather to scene inputs.
// Every function is deterministic: identical inputs → identical outputs, so
// SSR markup and hydrated markup always agree (C5).

import type { WxScene } from "@/components/ui/WxToys";

export type SkyPhase = "dawn" | "day" | "dusk" | "night";

/**
 * Night is checked FIRST: sunProgressAt clamps to [0,1], so a 4am progress
 * of 0 must never read as "dawn". Dawn/dusk can only fire during civil
 * twilight, and null solar yields no dawn/dusk at all.
 */
export function skyPhase(sunProgress: number | null, isDay: boolean): SkyPhase {
  if (!isDay) return "night";
  if (sunProgress == null) return "day";
  if (sunProgress < 0.12) return "dawn";
  if (sunProgress > 0.88) return "dusk";
  return "day";
}

/**
 * The active SKY key. Precipitation scenes keep their own washes
 * (docs/DESIGN.md: "the live condition canvas remains condition-driven");
 * only clear/cloudy gain the dawn/dusk phases.
 */
export function skySceneKey(scene: WxScene, phase: SkyPhase, heavySnow: boolean): string {
  if (heavySnow) return "heavySnow";
  if (scene === "rain" || scene === "snow" || scene === "storm" || scene === "night") return scene;
  if (phase === "dawn") return "dawn";
  if (phase === "dusk") return "dusk";
  return scene; // clear | cloudy
}

/** Cloud blob-density variant from measured cover — never from the scene name. */
export function cloudVariant(cover: number | null): 0 | 1 | 2 {
  if (cover == null) return 0;
  if (cover < 34) return 0;
  if (cover < 67) return 1;
  return 2;
}

/** The back layer renders one step denser than the front for parallax depth. */
export function backCloudVariant(front: 0 | 1 | 2): 0 | 1 | 2 {
  return Math.min(front + 1, 2) as 0 | 1 | 2;
}

/** Unknown cover never dims the sky; heavy cover dims rather than hides. */
export function starOpacity(cover: number | null): number {
  if (cover == null) return 1;
  return cover > 60 ? 0.45 : 1;
}
