"use client";

import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";

interface StreakSaverBannerProps {
  streak: number;
  quickTask: any | null;
  onGoToTasks: () => void;
}

export default function StreakSaverBanner({ streak, quickTask, onGoToTasks }: StreakSaverBannerProps) {
  if (streak < 2) return null;

  return (
    <Surface variant="warm" radius="2xl" padding="md" className="border border-amber-400/30">
      <div className="flex items-center gap-3">
        <span className="text-3xl animate-badge-sparkle">🔥</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-400">Save your {streak}-day streak!</p>
          <p className="text-xs text-text-secondary mt-0.5">
            {quickTask
              ? `Complete "${quickTask.title}" today to keep it alive!`
              : "Complete any task today to keep your streak going!"}
          </p>
        </div>
        <SoftButton size="sm" onClick={onGoToTasks}>
          {quickTask ? "Do it!" : "Go"}
        </SoftButton>
      </div>
    </Surface>
  );
}
