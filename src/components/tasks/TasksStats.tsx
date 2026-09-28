import StatTile from "@/components/patterns/StatTile";
import SegmentedControl from "@/components/ui/SegmentedControl";

/**
 * The Tasks page's stat row + view switch (UI audit 5.7). These are the two
 * grid children above the active tab panel; the page keeps owning the grid
 * and the tab state.
 */
interface TasksStatsProps {
  pendingCount: number;
  completedCount: number;
  earnedThisWeek: number;
  allTimePoints: number;
  activeTab: string;
  onChange: (tab: "tasks" | "leaderboard") => void;
}

export default function TasksStats({
  pendingCount,
  completedCount,
  earnedThisWeek,
  allTimePoints,
  activeTab,
  onChange,
}: TasksStatsProps) {
  return (
    <>
    {/* One compact 3-up stat row at every width — on phones the stacked
        tiles used to eat 405px of prime screen before the first chore. */}
    <div className="grid grid-cols-3 gap-3 md:col-span-2">
      <StatTile label="Pending" value={pendingCount} detail="Open tasks" icon="📋" tone="warning" compact />
      <StatTile label="Completed" value={completedCount} detail="This week" icon="🎉" tone="success" compact />
      <StatTile label="Earned this week" value={earnedThisWeek} detail={`${allTimePoints} pts all-time`} icon="🏆" tone="accent" compact />
    </div>

    <SegmentedControl
      aria-label="Tasks view"
      emphasize
      value={activeTab}
      onChange={(value) => onChange(value as "tasks" | "leaderboard")}
      options={[
        { id: "tasks", label: "Tasks" },
        { id: "leaderboard", label: "Leaderboard" },
      ]}
    />
    </>
  );
}
