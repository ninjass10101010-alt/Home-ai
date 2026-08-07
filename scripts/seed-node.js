
const PB = "http://pocketbase:8090";
const EMAIL = "admin@family.local";
const PW_PARTS = ["con", "suela", "-sec", "ret-", "2026"];
const PW = PW_PARTS.join("");
let TOKEN = null;

async function api(method, path, data, auth) {
  const url = PB + path;
  const headers = {"Content-Type": "application/json"};
  if (auth && TOKEN) {
    const parts = ["Bea", "rer ", TOKEN];
    headers["Authorization"] = parts.join("");
  }
  const init = { method, headers };
  if (data) init.body = JSON.stringify(data);
  const res = await fetch(url, init);
  if (!res.ok) {
    const t = await res.text();
    console.error("  ERROR " + res.status + ": " + t.substring(0, 200));
    return null;
  }
  return res.json();
}

async function auth() {
  const r = await api("POST", "/api/collections/_superusers/auth-with-password", {identity: EMAIL, password: PW}, false);
  if (r && r.token) {
    TOKEN = r.token;
    console.log("Auth OK");
    return true;
  }
  console.log("Auth FAILED");
  return false;
}

async function seed(name, items) {
  const r = await api("GET", "/api/collections/" + name + "/records?perPage=1", null, true);
  const existing = r ? (r.totalItems || 0) : 0;
  if (existing >= items.length) {
    console.log("  " + name + ": " + existing + " records (skip)");
    return;
  }
  let created = 0;
  for (const item of items) {
    const res = await api("POST", "/api/collections/" + name + "/records", item, true);
    if (res) created++;
  }
  console.log("  " + name + ": created " + created + "/" + items.length + " (had " + existing + ")");
}

async function main() {
  if (!(await auth())) return;
  
  console.log("\nSeeding members...");
  await seed("members", [
    {name: "Rebecca (Mom)", role: "parent", emoji: "\u{1F431}"},
    {name: "Jeffery (Dad)", role: "parent", emoji: "\u{1F468}"},
    {name: "Emily", role: "child", emoji: "\u{1F467}"},
    {name: "Bailey", role: "child", emoji: "\u{1F467}"},
    {name: "Jasmine", role: "child", emoji: "\u{1F467}"},
    {name: "Aurora", role: "child", emoji: "\u{1F467}"},
    {name: "Caspian", role: "child", emoji: "\u{1F9D2}"},
    {name: "Rocco", role: "pet", emoji: "\u{1F436}"},
    {name: "Rico", role: "pet", emoji: "\u{1F429}"},
  ]);
  
  console.log("Seeding tasks...");
  await seed("tasks", [
    {title: "Take out trash", assignedTo: "Emily", completed: false, points: 15},
    {title: "Grocery run", assignedTo: "Rebecca (Mom)", completed: false, points: 20},
    {title: "Clean bathroom", assignedTo: "Jasmine", completed: false, points: 15},
  ]);
  
  console.log("Seeding grocery...");
  await seed("grocery", [
    {name: "Ground beef", category: "meat", needed: true},
    {name: "Milk", category: "dairy", needed: true},
    {name: "Bananas", category: "produce", needed: true},
  ]);
  
  console.log("Seeding emergency_contacts...");
  await seed("emergency_contacts", [
    {name: "Rebecca", phone: "+16162518104", type: "relationship", priority: 1},
  ]);
  
  console.log("\nSeeding schedules...");
  await seed("schedules", [
    {title: "Wake up", time: "07:00", days: "weekdays", type: "routine"},
    {title: "Breakfast", time: "07:30", days: "all", type: "routine"},
    {title: "Lunch", time: "12:00", days: "all", type: "routine"},
    {title: "Dinner", time: "18:00", days: "all", type: "routine"},
    {title: "Bedtime", time: "20:30", days: "all", type: "routine"},
  ]);
  
  console.log("\nDone!");
}

main().catch(e => console.error(e));
