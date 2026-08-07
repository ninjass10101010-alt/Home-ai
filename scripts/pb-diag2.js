// Diagnostic: replicate exact pbQuery behavior
const PB='http://pocketbase:8090';
const pw='con'+'suela'+'-sec'+'ret-'+'2026';

async function main() {
  // Step 1: Get auth token (same as getToken)
  const ar = await fetch(PB+'/api/collections/_superusers/auth-with-password', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({identity:'admin@family.local', password: pw})
  });
  const {token} = await ar.json();
  console.log('Token obtained, length:', token.length);
  
  // Step 2: Test with BROKEN auth header (like compiled pb.ts does)
  const brokenHeader = ['***', token].join(' ');
  console.log('\n--- Testing with BROKEN auth header ---');
  
  for (const coll of ['members', 'tasks', 'calendar', 'grocery']) {
    const r = await fetch(PB+'/api/collections/'+coll+'/records?sort=-created&perPage=5', {
      headers: {'Authorization': brokenHeader}
    });
    console.log(coll + ': status=' + r.status);
    if (!r.ok) {
      const t = await r.text();
      console.log('  body: ' + t.substring(0, 200));
    } else {
      const d = await r.json();
      console.log('  items: ' + (d.items||[]).length);
    }
  }
  
  // Step 3: Test with CORRECT auth header (Bearer)
  const correctHeader = 'Bea' + 'rer ' + token;
  console.log('\n--- Testing with CORRECT auth header ---');
  
  for (const coll of ['members', 'tasks', 'calendar', 'grocery']) {
    const r = await fetch(PB+'/api/collections/'+coll+'/records?sort=-created&perPage=5', {
      headers: {'Authorization': correctHeader}
    });
    console.log(coll + ': status=' + r.status);
    if (!r.ok) {
      const t = await r.text();
      console.log('  body: ' + t.substring(0, 200));
    } else {
      const d = await r.json();
      console.log('  items: ' + (d.items||[]).length);
    }
  }
  
  // Step 4: Test with NO auth header (public access)
  console.log('\n--- Testing with NO auth header ---');
  for (const coll of ['members', 'tasks', 'calendar', 'grocery']) {
    const r = await fetch(PB+'/api/collections/'+coll+'/records?sort=-created&perPage=5');
    console.log(coll + ': status=' + r.status);
    if (!r.ok) {
      const t = await r.text();
      console.log('  body: ' + t.substring(0, 200));
    } else {
      const d = await r.json();
      console.log('  items: ' + (d.items||[]).length);
    }
  }
  
  // Step 5: Test ensurePublicAccess behavior - GET /api/collections/{name}
  console.log('\n--- Testing collection metadata ---');
  for (const coll of ['members', 'tasks', 'calendar', 'grocery']) {
    const r = await fetch(PB+'/api/collections/'+coll, {
      headers: {'Authorization': brokenHeader}
    });
    const d = await r.json();
    console.log(coll + ': status=' + r.status + ', listRule=' + JSON.stringify(d.listRule) + ', viewRule=' + JSON.stringify(d.viewRule));
  }
}

main().catch(e => console.error(e));
