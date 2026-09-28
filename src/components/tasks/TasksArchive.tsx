import SectionCard from "@/components/patterns/SectionCard";
import TreasurePath from "@/components/leaderboard/TreasurePath";
import FamilyGoal from "@/components/leaderboard/FamilyGoal";
import HallOfFame from "@/components/leaderboard/HallOfFame";
import AchievementWall from "@/components/leaderboard/AchievementWall";
import { textEmojiOrFallback } from "@/components/ui/EmojiText";
import { getMemberAllTimePoints, getMemberAllTimeCompletions } from "@/lib/task-utils";
import type { LeaderboardEntry, Task, WeekData } from "@/types/tasks";

/**
 * The deep archive of the Leaderboard tab (UI audit 5.7): journey, family
 * goal, hall of fame and the recent-activity feed. History, not the live
 * race — it stays behind the expander.
 */
interface TasksArchiveProps {
  weekData: WeekData;
  tasks: Task[];
  currentUser: { name: string; emoji?: string } | null;
  isLoggedIn: boolean;
  leaderboard: LeaderboardEntry[];
  memberColors: Record<string, string>;
  isParent: boolean;
}

export default function TasksArchive({
  weekData,
  tasks,
  currentUser,
  isLoggedIn,
  leaderboard,
  memberColors,
  isParent,
}: TasksArchiveProps) {
  return (
    <>
        {/* The deep archive folds behind one expander: journey, family
            goal, and hall are history — the tab leads with the live race,
            not its museum. */}
        <details className="rounded-2xl border border-white/10 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-text-secondary">🏅 Trophies, journey & history</summary>
          <div className="mt-4 space-y-6">
            {isLoggedIn && currentUser && (() => {
              const myAllTime = getMemberAllTimePoints(currentUser.name, weekData);
              return (
                <SectionCard title="Your Journey" description={`${textEmojiOrFallback(currentUser.emoji)} Level progress & badges`}>
                  <TreasurePath
                    allTimePoints={myAllTime}
                    memberEmoji={currentUser.emoji || "🌱"}
                    memberColor={memberColors[currentUser.name] || "green"}
                  />
                  <div className="mt-4">
                    <AchievementWall
                      allTimePoints={myAllTime}
                      streak={leaderboard.find(e => e.name === currentUser.name || e.name.startsWith(currentUser.name))?.streak ?? 0}
                      completions={getMemberAllTimeCompletions(currentUser.name, tasks, weekData)}
                    />
                  </div>
                </SectionCard>
              );
            })()}

            <FamilyGoal weekData={weekData} isParent={isParent} />

            <HallOfFame />
          </div>
        </details>

        {weekData.history.length > 0 && (
          <SectionCard title="Recent Activity" description="Latest point transactions" icon="📜">
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {weekData.history.slice().reverse().slice(0, 15).map((tx) => (
                <div key={tx.id} className="flex items-center gap-2 rounded-xl px-2 py-1 text-xs">
                  <span className="shrink-0 text-base">
                    {tx.type === "earn" ? "✅" : tx.type === "redeem" ? "🎁" : tx.type === "penalty" ? "⚠️" : "⚙️"}
                  </span>
                  <span className="flex-1 truncate text-text-secondary">
                    <span className="font-medium text-text-primary">{tx.member.split(" ")[0]}</span>{" "}
                    {tx.description}
                  </span>
                  <span
                    className="shrink-0 font-semibold"
                    style={{ color: tx.amount > 0 ? "var(--color-accent-mint)" : "var(--color-accent-rose)" }}
                  >
                    {tx.amount > 0 ? "+" : ""}{tx.amount}
                  </span>
                  <span className="text-text-muted shrink-0">
                    {new Date(tx.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
    </>
  );
}
