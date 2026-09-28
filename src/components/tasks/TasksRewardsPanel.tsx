import SectionCard from "@/components/patterns/SectionCard";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import type { Reward, Penalty } from "@/types/tasks";

/**
 * Rewards & Penalties admin section of the Tasks page (UI audit 5.7 — the
 * page was 2,943 lines with 33 `useState`; view blocks now live in
 * `src/components/tasks/`, state stays in the page). The PIN confirmations
 * themselves stay in the page — only the cards move.
 */
interface TasksRewardsPanelProps {
  rewards: Reward[];
  aiRewards: Reward[];
  aiRewardSuggesting: boolean;
  onGenerateAi: () => void;
  onAdd: () => void;
  onAdopt: (reward: Reward) => void;
  onRedeem: (reward: Reward) => void;
  onEdit: (reward: Reward) => void;
  penalties: Penalty[];
  onAddPenalty: () => void;
  onApplyPenalty: (penalty: Penalty) => void;
  onEditPenalty: (penalty: Penalty) => void;
}

export default function TasksRewardsPanel({
  rewards,
  aiRewards,
  aiRewardSuggesting,
  onGenerateAi,
  onAdd,
  onAdopt,
  onRedeem,
  onEdit,
  penalties,
  onAddPenalty,
  onApplyPenalty,
  onEditPenalty,
}: TasksRewardsPanelProps) {
  return (
    <>
        <SectionCard title="Rewards" description="Spend points on family perks." icon="🎁">
          <div className="flex gap-2">
            <SoftButton variant="secondary" onClick={onGenerateAi} disabled={aiRewardSuggesting} className="flex-1">{aiRewardSuggesting ? "Thinking..." : "Suggest"}</SoftButton>
            <SoftButton variant="ghost" onClick={onAdd} className="flex-1">Add</SoftButton>
          </div>
          {aiRewards.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {aiRewards.map((reward) => (
                <Surface key={reward.name} variant="glass-subtle" radius="xl" padding="sm">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{reward.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-text-primary">{reward.name}</div>
                      <div className="mt-1 text-xs text-text-muted">{reward.cost} pts</div>
                    </div>
                    <SoftButton size="sm" onClick={() => onAdopt(reward)}>Add</SoftButton>
                  </div>
                </Surface>
              ))}
            </div>
          )}
          <div className="mt-4 space-y-3">
            {rewards.map((reward) => (
              <Surface key={reward.id} variant="glass-subtle" radius="xl" padding="sm">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{reward.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text-primary">{reward.name}</div>
                    <div className="text-xs text-text-muted">{reward.cost} pts {reward.cost > 100 && <span className="ml-1" style={{ color: "var(--color-accent-amber)" }}>· needs parent</span>}</div>
                  </div>
                  <SoftButton size="sm" variant="secondary" aria-label={`Redeem ${reward.name}`} onClick={() => onRedeem(reward)}>Redeem</SoftButton>
                  <IconButton size="sm" variant="ghost" aria-label="Edit reward" className="hit-44" onClick={() => onEdit(reward)}>✎</IconButton>
                </div>
              </Surface>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Penalties" description="Point deductions for missed chores." icon="⚠️">
          <div className="flex gap-2 mb-4">
            <SoftButton variant="secondary" onClick={onAddPenalty} className="flex-1">Add</SoftButton>
          </div>
          <div className="space-y-3">
            {penalties.map((penalty) => (
              <Surface key={penalty.id} variant="glass-subtle" radius="xl" padding="sm">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{penalty.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text-primary">{penalty.name}</div>
                    <div className="text-xs text-text-muted">-{penalty.points} pts</div>
                  </div>
                  <IconButton size="sm" variant="ghost" aria-label="Apply penalty" className="hit-44" onClick={() => onApplyPenalty(penalty)}>⚠️</IconButton>
                  <IconButton size="sm" variant="ghost" aria-label="Edit penalty" className="hit-44" onClick={() => onEditPenalty(penalty)}>✎</IconButton>
                </div>
              </Surface>
            ))}
          </div>
        </SectionCard>
    </>
  );
}
