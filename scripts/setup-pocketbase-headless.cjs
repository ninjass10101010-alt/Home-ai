const PocketBase = require('pocketbase/cjs');
const pb = new PocketBase('http://pocketbase:8090');

async function setup() {
    try {
        await pb.admins.authWithPassword('admin@garcia.family', '26649_alan');
        console.log("Authenticated!");
    } catch (e) {
        console.log("Trying superusers...");
        await pb.collection("_superusers").authWithPassword('admin@garcia.family', '26649_alan');
        console.log("Authenticated as superuser!");
    }

    const collections = [
        { name: "members", fields: [
            {name:"name", type:"text", required: true}, 
            {name:"role", type:"text"}, 
            {name:"emoji", type:"text"}, 
            {name:"profileImage", type:"text"}
        ] },
        { name: "meals", fields: [
            {name:"name", type:"text", required: true}, 
            {name:"date", type:"text"}, 
            {name:"emoji", type:"text"}, 
            {name:"ingredients", type:"text"}
        ] },
        { name: "tasks", fields: [
            {name:"title", type:"text", required: true}, 
            {name:"status", type:"text"}, 
            {name:"assignedTo", type:"text"}, 
            {name:"points", type:"number"},
            {name:"emoji", type:"text"}
        ] },
        { name: "grocery_items", fields: [
            {name:"name", type:"text", required: true}, 
            {name:"status", type:"text"}, 
            {name:"emoji", type:"text"}, 
            {name:"category", type:"text"}
        ] },
        { name: "rewards", fields: [
            {name:"title", type:"text", required: true}, 
            {name:"cost", type:"number"}, 
            {name:"emoji", type:"text"}, 
            {name:"isUnlocked", type:"bool"}
        ] },
        { name: "pantry_items", fields: [
            {name:"name", type:"text", required: true}, 
            {name:"status", type:"text"}, 
            {name:"emoji", type:"text"}, 
            {name:"category", type:"text"}
        ] },
        { name: "events", fields: [
            {name:"title", type:"text", required: true}, 
            {name:"date", type:"text"}, 
            {name:"time", type:"text"}, 
            {name:"memberId", type:"text"}
        ] },
        { name: "schedules", fields: [
            {name:"title", type:"text", required: true}, 
            {name:"time", type:"text"}, 
            {name:"days", type:"text"}, 
            {name:"icon", type:"text"}
        ] }
    ];

    for (const c of collections) {
        try {
            await pb.collections.create({
                name: c.name,
                type: "base",
                fields: [
                    { name: "id", type: "text", primaryKey: true, required: true, autogeneratePattern: "[a-z0-9]{15}" },
                    ...c.fields
                ],
                listRule: "",
                viewRule: "",
                createRule: "",
                updateRule: "",
                deleteRule: ""
            });
            console.log("Created " + c.name);
        } catch (e) {
            console.log("Updating " + c.name);
            try {
                const existing = await pb.collections.getOne(c.name);
                await pb.collections.update(existing.id, {
                    fields: [
                        { name: "id", type: "text", primaryKey: true, required: true, autogeneratePattern: "[a-z0-9]{15}" },
                        ...c.fields
                    ]
                });
            } catch (upErr) {
                console.log("Failed to update " + c.name + ": " + upErr.message);
            }
        }
    }
}

setup();
