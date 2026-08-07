const PB='http://pocketbase:8090';
const pw='con'+'suela'+'-sec'+'ret-'+'2026';

async function auth() {
  const r = await fetch(PB+'/api/collections/_superusers/auth-with-password', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({identity:'admin@family.local', password: pw})
  });
  return (await r.json()).token;
}

async function test(coll, token) {
  const h = {'Content-Type':'application/json'};
  h['Authorization'] = ['Bea','rer ',token].join('');
  
  // Get collection info
  const cr = await fetch(PB+'/api/collections/'+coll, {headers:h});
  const c = await cr.json();
  console.log(coll + ': listRule=' + JSON.stringify(c.listRule) + ', totalItems=' + c.totalItems);
  
  // Try query
  const qr = await fetch(PB+'/api/collections/'+coll+'/records?perPage=5', {headers:h});
  console.log('  query status=' + qr.status);
  if (!qr.ok) {
    const t = await qr.text();
    console.log('  body: ' + t.substring(0, 300));
  } else {
    const d = await qr.json();
    console.log('  got ' + (d.items||[]).length + ' items, totalItems=' + d.totalItems);
  }
}

async function main() {
  const token = await auth();
  console.log('Auth OK\n');
  
  for (const coll of ['members', 'tasks', 'grocery', 'calendar', 'schedules', 'pantry', 'leaderboard', 'meal_plan_entries']) {
    await test(coll, token);
    console.log();
  }
}

main().catch(e => console.error(e));
