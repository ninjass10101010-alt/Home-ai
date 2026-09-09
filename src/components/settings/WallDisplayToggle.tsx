/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { WALL_MODE_KEY, WALL_MODE_EVENT } from "@/hooks/useWallMode";

type WallPref = "auto" | "on" | "off";

/** Settings → Layout & display wall preference (tri-state): Auto (remove the
 *  consuela-wall-mode key → auto-detect) or force On/Off. Writes localStorage
 *  + dispatches WALL_MODE_EVENT so live useWallMode consumers re-resolve.
 *  Mounted-gated so SSR renders Auto and hydration stays deterministic. */
export default function WallDisplayToggle() {
  const [wallPref, setWallPref] = useState<WallPref>("auto");

  useEffect(() => {
    const v = localStorage.getItem(WALL_MODE_KEY);
    setWallPref(v === "on" || v === "off" ? v : "auto");
  }, []);

  const applyWallPref = (v: WallPref) => {
    setWallPref(v);
    if (v === "auto") localStorage.removeItem(WALL_MODE_KEY);
    else localStorage.setItem(WALL_MODE_KEY, v);
    window.dispatchEvent(new Event(WALL_MODE_EVENT));
  };

  return (
    <div className="pt-2">
      <SegmentedControl
        options={[
          { id: "auto", label: "✨ Auto" },
          { id: "on", label: "🧱 Wall on" },
          { id: "off", label: "🧱 Wall off" },
        ]}
        value={wallPref}
        onChange={(v) => applyWallPref(v as WallPref)}
        aria-label="Wall display (ApoloSign)"
      />
      <p className="mt-1 text-[11px] text-text-muted">
        Wall display (ApoloSign) — Auto detects the wall screen on its own; force On/Off to override.
      </p>
    </div>
  );
}
