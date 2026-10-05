import StatTile from "@/components/patterns/StatTile";
import SegmentedControl from "@/components/ui/SegmentedControl";
import AllTimeValue from "@/components/leaderboard/AllTimeValue";
import type { AllTimeReadState } from "@/hooks/useAllTimeTotals";

/**
 * The Tasks page's stat row + view switch (UI audit 5.7). These are the two
 * grid children above the active tab panel; the page keeps owning the grid
 * and the tab state.
 */

/**
 * THE owner of the Tasks view-switch wiring ids.
 *
 * The switch is a `radiogroup`; the two panels it swaps are `tabpanel`s. A
 * relationship that spans the switch and the panels cannot live in either place
 * alone, and this file is the one both can import without a cycle — `page.tsx`
 * already imports `TasksStats` and `TasksStats` imports nothing from the page,
 * so the ids are declared here and consumed there.
 */
export const TASKS_VIEW_SWITCH_ID = "tasks-view-switch";

/** The panel each switch option reveals, keyed by the option id. */
export const TASKS_PANEL_IDS = {
  tasks: "tasks-board-panel",
  leaderboard: "tasks-leaderboard-panel",
} as const;

interface TasksStatsProps {
  pendingCount: number;
  completedCount: number;
  earnedThisWeek: number;
  allTimePoints: number | null | undefined;
  allTimeRead: { state: AllTimeReadState; updatedAt: string | null };
  activeTab: string;
  onChange: (tab: "tasks" | "leaderboard") => void;
}

export default function TasksStats({
  pendingCount,
  completedCount,
  earnedThisWeek,
  allTimePoints,
  allTimeRead,
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
      <StatTile
        label="Earned this week"
        value={earnedThisWeek}
        detail={
          // A total that could not be read is `null`, never a shortened number:
          // AllTimeValue says so out loud instead of rendering a partial as if
          // it were the whole all-time total.
          <AllTimeValue
            points={allTimePoints}
            read={allTimeRead.state}
            updatedAt={allTimeRead.updatedAt}
            label="pts all-time"
          />
        }
        icon="🏆"
        tone="accent"
        compact
      />
    </div>

    {/* The switch is the only way in and out of a panel, so it is LINKED to what
        it swaps: the group carries an id both panels name in `aria-labelledby`,
        and each radio names its own panel in `aria-controls`. Without it a
        screen-reader user activated "Leaderboard", the page silently swapped, and
        nothing announced the new content or offered a way back to its top. */}
    <SegmentedControl
      id={TASKS_VIEW_SWITCH_ID}
      aria-label="Tasks view"
      ariaControls={(option) => TASKS_PANEL_IDS[option.id as keyof typeof TASKS_PANEL_IDS]}
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
