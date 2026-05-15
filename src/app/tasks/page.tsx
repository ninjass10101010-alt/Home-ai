import pb from "@/lib/pocketbase";
import TasksContent from "./TasksContent";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  let tasks: any[] = [], members: any[] = [], rewards: any[] = [];
  try {
    [tasks, members, rewards] = await Promise.all([
      pb.collection("tasks").getFullList(),
      pb.collection("members").getFullList(),
      pb.collection("rewards").getFullList()
    ]);
  } catch(e) {
    console.error(e);
  }

  return (
    <TasksContent 
      initialTasks={tasks} 
      members={members} 
      rewards={rewards} 
    />
  );
}
