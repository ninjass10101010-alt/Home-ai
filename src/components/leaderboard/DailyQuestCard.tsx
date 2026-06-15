"use client";

import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";

interface DailyQuestCardProps {
  quests: any[];
  onAccept: (task: any) => void;
  onGoToTasks: () => void;
}

export default function DailyQuestCard({ quests, onAccept, onGoToTasks }: DailyQuestCardProps) {
  if (quests.length === 0) return null;

  return (
    <Surface variant="warm" radius="2xl" padding="md">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🎯</span>
        <h4 className="text-sm font-bold text-text-primary">Today&apos;s Quests</h4>
      </div>
      <div className="space-y-2">
        {quests.map((quest) => (
          <div key={quest.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
            <span className="text-base">{quest.assigneeEmoji}</span>
            <span className="flex-1 text-sm text-text-primary truncate">{quest.title}</span>
            <Chip size="sm" tone="success">+{quest.points}pts</Chip>
            <SoftButton size="sm" onClick={() => onAccept(quest)}>Go</SoftButton>
          </div>
        ))}
      </div>
      <button type="button" onClick={onGoToTasks} className="mt-3 text-xs text-[var(--color-accent-selected)] font-semibold">
        View all tasks →
      </button>
    </Surface>
  );
}
