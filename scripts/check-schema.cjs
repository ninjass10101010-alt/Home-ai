const PocketBase = require('pocketbase/cjs');
const pb = new PocketBase('http://pocketbase:8090');

async function check() {
    try {
        await pb.collection("_superusers").authWithPassword('admin@garcia.family', '26649_alan');
        const c = await pb.collections.getOne("members");
        console.log(JSON.stringify(c, null, 2));
    } catch (e) {
        console.log("Failed: " + e.message);
    }
}

check();
