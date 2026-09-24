"use client";

import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";
import Avatar from "@/components/ui/Avatar";

interface DailyQuestCardProps {
  quests: any[];
  onAccept: (task: any) => void;
  onGoToTasks: () => void;
  // Roster-first avatar resolution (2026-09-23 review): quest rows used to
  // render the stored assigneeEmoji, which the persistedTaskEmoji write gate
  // collapses to "👤" for photo members. The caller passes its live-roster
  // map (members.emoji holds the real photos); the stored glyph stays the
  // fallback.
  rosterEmoji?: Record<string, string>;
}

export default function DailyQuestCard({ quests, onAccept, onGoToTasks, rosterEmoji }: DailyQuestCardProps) {
  if (quests.length === 0) return null;

  return (
    <Surface variant="warm" radius="2xl" padding="md">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🎯</span>
        <h4 className="text-sm font-bold text-text-primary">Today's Quests</h4>
      </div>
      <div className="space-y-2">
        {quests.map((quest) => (
          <div key={quest.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
            <Avatar name={quest.assignee} color="green" emoji={rosterEmoji?.[quest.assignee] || quest.assigneeEmoji} size="sm" variant="emoji" />
            <span className="flex-1 text-sm text-text-primary truncate">{quest.title}</span>
            <Chip size="sm" tone="success">+{quest.points}pts</Chip>
            <SoftButton size="sm" aria-label={`Do ${quest.title}`} onClick={() => onAccept(quest)}>Do it</SoftButton>
          </div>
        ))}
      </div>
      <button type="button" onClick={onGoToTasks} className="mt-3 text-xs text-[var(--color-accent-selected)] font-semibold">
        View all tasks →
      </button>
    </Surface>
  );
}
