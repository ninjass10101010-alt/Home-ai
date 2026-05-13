import { getTasks } from "@/actions/tasks";
import { getMembers } from "@/actions/members";
import { getRewards } from "@/actions/rewards";
import TasksContent from "./TasksContent";

export default async function TasksPage() {
  const [tasks, members, rewards] = await Promise.all([
    getTasks(),
    getMembers(),
    getRewards()
  ]);

  return (
    <TasksContent 
      initialTasks={tasks} 
      members={members} 
      rewards={rewards} 
    />
  );
}
