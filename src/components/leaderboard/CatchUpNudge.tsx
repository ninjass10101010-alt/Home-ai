"use client";

interface CatchUpNudgeProps {
  myEntry: any | undefined;
  aheadEntry: any | undefined;
  behindEntry: any | undefined;
}

export default function CatchUpNudge({ myEntry, aheadEntry, behindEntry }: CatchUpNudgeProps) {
  if (!myEntry) return null;

  let message = "";
  if (myEntry.rank === 1 && behindEntry) {
    const gap = myEntry.points - behindEntry.points;
    if (gap < 30 && gap > 0) {
      message = `${behindEntry.name.split(" ")[0]} is closing in! Only ${gap} pts behind you!`;
    }
  } else if (aheadEntry) {
    const gap = aheadEntry.points - myEntry.points;
    if (gap > 0 && gap <= 50) {
      message = `Just ${gap} pts behind ${aheadEntry.name.split(" ")[0]} — a couple tasks to take the lead!`;
    }
  }

  if (!message) return null;

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-amber-400/8 border border-amber-400/15 px-3 py-2">
      <span className="text-base">💨</span>
      <p className="text-xs text-text-secondary flex-1">{message}</p>
    </div>
  );
}
