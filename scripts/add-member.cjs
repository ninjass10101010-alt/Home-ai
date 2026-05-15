const PocketBase = require('pocketbase/cjs');
const pb = new PocketBase('http://pocketbase:8090');

async function add() {
    try {
        await pb.collection("_superusers").authWithPassword('admin@garcia.family', '26649_alan');
        await pb.collection("members").create({
            name: "Alan",
            role: "dad",
            emoji: "👨"
        });
        console.log("Added Alan!");
    } catch (e) {
        console.log("Failed: " + e.message);
        console.log(JSON.stringify(e.data, null, 2));
    }
}

add();
