// Heal stale `tasks` rows: a row may carry status:"done" with completed:false.
//   - completedInWeek === current week → it IS completed this week: set completed:true.
//   - completedInWeek older/blank        → rolled-over stale row: reopen (status:"pending", clear stamps).
const PB = "http://192.168.0.28:8090";

function currentWeekKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

const run = async () => {
  const email = process.env.PB_ADMIN_EMAIL;
  const pass = process.env.PB_ADMIN_PASS;
  if (!email || !pass) throw new Error("PB_ADMIN_EMAIL/PB_ADMIN_PASS not set (source .env.local)");
  const auth = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password: pass }),
  });
  const { token } = await auth.json();
  const headers = { "Content-Type": "application/json", Authorization: token };

  const res = await fetch(`${PB}/api/collections/tasks/records?perPage=200`, { headers });
  const data = await res.json();
  const week = currentWeekKey();
  console.log("current week:", week);
  let healed = 0;
  for (const r of data.items) {
    if (r.status !== "done" || r.completed === true) continue;
    const inWeek = r.completedInWeek;
    if (inWeek === week) {
      await fetch(`${PB}/api/collections/tasks/records/${r.id}`, {
        method: "PATCH", headers, body: JSON.stringify({ completed: true }),
      });
      console.log("set completed:true (this week)", r.title.trim());
    } else {
      await fetch(`${PB}/api/collections/tasks/records/${r.id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ status: "pending", completed: false, completedAt: "", completedBy: "", completedInWeek: "" }),
      });
      console.log("reopened (stale)", r.title.trim(), "was inWeek:", inWeek || "(blank)");
    }
    healed++;
  }
  console.log("healed:", healed);
};

run().catch((e) => { console.error("HEAL FAILED:", e.message); process.exit(1); });
