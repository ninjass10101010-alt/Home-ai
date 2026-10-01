import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import { crewCloseModeOf, crewMemberCount, crewMembers, isCrewTask } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

/**
 * Parent-only "Crew tasks" card of the Tasks page (UI audit 5.7). The crew
 * filters/helpers come from shared task-utils; the removal PIN flow stays
 * in the page — only the card moves.
 */
interface CrewTasksCardProps {
  tasks: Task[];
  visible: boolean;
  onRemoveMember: (taskId: number, memberName: string) => void;
  onCloseCrew: (taskId: number) => void;
}

export default function CrewTasksCard({ tasks, visible, onRemoveMember, onCloseCrew }: CrewTasksCardProps) {
  return (
    <>
      {visible && (() => {
        const crews = tasks.filter((t) => isCrewTask(t) && !t.completed && !t.pendingApproval);
        if (crews.length === 0) return null;
        return (
            <SectionCard title="🤝 Crew tasks" description="Manage who's on each crew." icon="🤝">
              <div className="space-y-3">
                {crews.map((task) => (
                  <div key={task.id} className="rounded-2xl glass-subtle p-3">
                    <div className="text-sm font-semibold text-text-primary">{task.title}</div>
                    <div className="mt-1 text-xs text-text-secondary">🤝 Crew of {task.crewSize} — {crewMemberCount(task)}/{task.crewSize} joined · +{task.points} pts each</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {crewMembers(task).map((m) => (
                        <span key={m.name} className="inline-flex items-center gap-1.5 rounded-full glass-subtle px-2 py-1 text-xs text-text-primary">
                          {m.emoji || "👤"} {m.name.split(" ")[0]}
                          {m.checkedInAt ? (
                            <span className="text-[var(--color-accent-mint)]">✓ done</span>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Remove ${m.name.split(" ")[0]} from ${task.title}`}
                              onClick={() => onRemoveMember(task.id, m.name)}
                              className="hit-44 tap-sm grid h-6 w-6 shrink-0 place-items-center rounded-full text-text-muted hover:bg-[var(--color-accent-rose)]/10 hover:text-[var(--color-accent-rose)]"
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                      {crewMemberCount(task) === 0 && <span className="text-xs text-text-muted">Nobody has joined yet.</span>}
                    </div>
                    {crewCloseModeOf(task) !== "strict" && (
                      <div className="mt-1 text-xs text-text-muted">
                        {crewCloseModeOf(task) === "parent" ? "Parent closes" : "Auto-closes at the due date"}
                      </div>
                    )}
                    {crewCloseModeOf(task) === "parent" && crewMembers(task).some((m) => m.checkedInAt) && (
                      <div className="mt-2">
                        <SoftButton onClick={() => onCloseCrew(task.id)} className="w-full">
                          ✓ Close with check-ins ({crewMembers(task).filter((m) => m.checkedInAt).length} of {task.crewSize})
                        </SoftButton>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          );
        })()}
    </>
  );
}
