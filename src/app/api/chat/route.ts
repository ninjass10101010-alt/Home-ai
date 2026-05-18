import { NextResponse } from "next/server";
import pb from "@/lib/pocketbase";
import MealPlanningSync from "@/lib/mealPlanningSync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { message, history } = await req.json();
    if (!message || !message.trim()) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    // Self-healing PocketBase Schema Check for chat_history
    try {
      await pb.collections.getOne("chat_history");
    } catch (e) {
      try {
        await pb.collections.create({
          name: "chat_history",
          type: "base",
          schema: [
            { name: "role", type: "text", required: true },
            { name: "content", type: "text", required: true },
            { name: "timestamp", type: "text" },
            { name: "sessionId", type: "text" },
            { name: "actions", type: "json" }
          ],
          listRule: "",
          viewRule: "",
          createRule: "",
          updateRule: "",
          deleteRule: "",
        });
        console.log("✅ Created 'chat_history' collection successfully.");
      } catch (createErr: any) {
        console.warn("⚠️ Could not create chat_history collection dynamically:", createErr.message);
      }
    }

    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) {
      return NextResponse.json({ error: "OPENROUTER_API_KEY is not configured." }, { status: 500 });
    }

    // 1. Fetch dynamic soul guidelines (personality rules) from QNAP host via bridge or local fallback
    let dynamicSoul = "";
    try {
      const bridgeRes = await fetch("http://consuela-telegram-bot:3005/api/file?path=soul.md");
      if (bridgeRes.ok) {
        const data = await bridgeRes.json();
        dynamicSoul = data.content;
      }
    } catch (bridgeErr) {
      // Ignore and use local fallback
    }

    if (!dynamicSoul) {
      try {
        const fs = await import("fs");
        const path = await import("path");
        const localPath = path.resolve(process.cwd(), "soul.md");
        if (fs.existsSync(localPath)) {
          dynamicSoul = fs.readFileSync(localPath, "utf8");
        }
      } catch (locErr: any) {
        console.warn("⚠️ Failed to load local soul.md:", locErr.message);
      }
    }

    // 2. Automated File Mentions Pre-loading Context
    let preloadedFilesContext = "";
    // Regex matches common file extensions to load code context directly
    const fileMentions = message.match(/[a-zA-Z0-9_\-\.\/]+\.(tsx|ts|js|mjs|md|json|css|yml|yaml)/g);
    if (fileMentions) {
      for (const mention of fileMentions) {
        try {
          let content = "";
          // Try bridge first
          try {
            const bridgeRes = await fetch(`http://consuela-telegram-bot:3005/api/file?path=${mention}`);
            if (bridgeRes.ok) {
              const data = await bridgeRes.json();
              content = data.content;
            }
          } catch (bErr) {
            // Local fallback
            const fs = await import("fs");
            const path = await import("path");
            const localPath = path.resolve(process.cwd(), mention);
            if (fs.existsSync(localPath)) {
              content = fs.readFileSync(localPath, "utf8");
            }
          }

          if (content) {
            preloadedFilesContext += `\n\n### ACTIVE FILE CONTEXT: "${mention}"\n\`\`\`\n${content}\n\`\`\`\n`;
          }
        } catch (preloadErr: any) {
          console.warn(`Failed to preload mentioned file ${mention}:`, preloadErr.message);
        }
      }
    }

    // 3. Fetch ALL live context from PocketBase across every dashboard collection
    let members: any[] = [];
    let pendingTasks: any[] = [];
    let upcomingMeals: any[] = [];
    let upcomingEvents: any[] = [];
    let schedules: any[] = [];
    let emergencyContacts: any[] = [];

    try {
      [members, pendingTasks, upcomingMeals, upcomingEvents, schedules, emergencyContacts] = await Promise.all([
        pb.collection("members").getFullList(),
        pb.collection("tasks").getFullList(),
        pb.collection("meals").getFullList({ sort: "date", requestKey: null }),
        pb.collection("events").getFullList({ sort: "date,time", requestKey: null }),
        pb.collection("schedules").getFullList({ sort: "time", requestKey: null }),
        pb.collection("emergency_contacts").getFullList({ requestKey: null }).catch(() => []),
      ]);
    } catch (dbErr: any) {
      console.warn("⚠️ Failed to fetch PocketBase context for agent:", dbErr.message);
    }

    // Format dynamic context strings
    const membersList = members
      .map((m) => `- [${m.name}] (ID: ${m.id}, Emoji: ${m.emoji || "👤"}, Role: ${m.role || "Member"}, Age: ${m.age || "Unknown"})`)
      .join("\n");
      
    const tasksList = pendingTasks
      .map((t) => `- "${t.title}" (ID: ${t.id}, Status: ${t.status || "pending"}, Assigned: ${t.assignedTo || "Unassigned"}, Due: ${t.dueDate || "None"}, Category: ${t.category || "General"}, Points: ${t.points || 10})`)
      .join("\n");

    const mealsList = upcomingMeals
      .map((m) => `- "${m.name}" (ID: ${m.id}) scheduled for ${m.date} ${m.emoji || "🍽️"}`)
      .join("\n");

    const eventsList = upcomingEvents
      .map((e) => {
        const assignedMember = members.find((m) => m.id === e.memberId);
        return `- "${e.title}" (ID: ${e.id}) on ${e.date} at ${e.time || "All Day"} — ${assignedMember?.name || e.member || "Family"} ${e.icon || e.emoji || "📅"}`;
      })
      .join("\n");

    const schedulesList = schedules
      .map((s) => `- "${s.title}" (ID: ${s.id}) at ${s.time} — Type: ${s.type || "routine"}, Member: ${s.member || "Family"} ${s.emoji || "⏰"}`)
      .join("\n");

    const emergencyList = emergencyContacts
      .map((c) => `- ${c.emoji || "👤"} ${c.name} (ID: ${c.id}) — ${c.phone} (${c.relationship || "Contact"})`)
      .join("\n");

    const currentDate = new Date().toLocaleString("en-US", { timeZone: "America/Detroit" });

    // 4. Build system prompt — full dashboard awareness
    const systemPrompt = `${dynamicSoul || "You are Consuela, the unyielding, direct, casual, and highly competent AI family assistant."}

DASHBOARD REAL-TIME CONTEXT:
- Current Local Time (Eastern/Detroit): ${currentDate}
- Family Members:
${membersList || "- No members found."}
- All Tasks (all statuses):
${tasksList || "- No tasks found."}
- Meals This Week:
${mealsList || "- No upcoming planned meals."}
- Calendar Events:
${eventsList || "- No events found."}
- Daily Schedules:
${schedulesList || "- No schedules found."}
- Emergency Contacts:
${emergencyList || "- No emergency contacts found."}
${preloadedFilesContext ? `\n--- PRE-LOADED SOURCE FILES ---${preloadedFilesContext}` : ""}

YOUR DYNAMIC SELF-MODIFICATION & CODE POWERS:
You have read and write permissions inside the dashboard repository.
1. Edit personality: return "write_file" targeting "soul.md".
2. Edit dashboard UI: read source context above, output "write_file" action.
3. Always output "validate_and_build" after code edits to catch compile errors.
4. Output "trigger_rebuild" to deploy changes to the live NAS container.

AVAILABLE ACTIONS - you can use ANY combination of these in a single response:
- create_task, update_task, delete_task, complete_task
- create_meal, delete_meal
- create_grocery
- create_event, update_event, delete_event
- create_schedule, update_schedule, delete_schedule
- create_emergency_contact, update_emergency_contact, delete_emergency_contact
- update_member, delete_member
- write_file, validate_and_build, trigger_rebuild

YOUR RESPONSE MUST STRICTLY BE A VALID JSON OBJECT (no markdown, no text before/after):
{
  "reply": "Brief friendly response explaining what you did.",
  "actions": [
    { "type": "create_task", "payload": { "title": "string", "description": "string", "priority": "low|medium|high", "assignedTo": "MemberID_or_null", "points": 10, "category": "Chores|Calendar|Health|School", "emoji": "emoji", "recurring": false, "dueDate": "YYYY-MM-DD", "status": "pending" } },
    { "type": "update_task", "payload": { "taskId": "ID", "title": "string", "priority": "low|medium|high", "status": "pending|completed", "assignedTo": "MemberID", "dueDate": "YYYY-MM-DD", "points": 10 } },
    { "type": "delete_task", "payload": { "taskId": "ID" } },
    { "type": "complete_task", "payload": { "taskId": "ID" } },
    { "type": "create_meal", "payload": { "name": "string", "description": "string", "date": "YYYY-MM-DD", "emoji": "emoji", "servings": 4, "ingredients": "string" } },
    { "type": "delete_meal", "payload": { "mealId": "ID" } },
    { "type": "create_grocery", "payload": { "name": "string", "emoji": "emoji", "category": "produce|dairy|meat|pantry|frozen|snacks|beverages|household", "priority": "low|medium|high", "quantityNeeded": 1, "unit": "count|g|kg|oz|cup|tbsp|tsp" } },
    { "type": "create_event", "payload": { "title": "string", "date": "YYYY-MM-DD", "time": "HH:MM AM/PM", "memberId": "MemberID_or_null", "icon": "emoji", "description": "string" } },
    { "type": "update_event", "payload": { "eventId": "ID", "title": "string", "date": "YYYY-MM-DD", "time": "string", "memberId": "string", "icon": "emoji", "description": "string" } },
    { "type": "delete_event", "payload": { "eventId": "ID" } },
    { "type": "create_schedule", "payload": { "title": "string", "time": "HH:MM AM/PM", "type": "routine|reminder", "emoji": "emoji", "member": "MemberName", "color": "green|cyan|violet|amber|rose" } },
    { "type": "update_schedule", "payload": { "scheduleId": "ID", "title": "string", "time": "string", "type": "routine|reminder", "emoji": "emoji", "member": "string" } },
    { "type": "delete_schedule", "payload": { "scheduleId": "ID" } },
    { "type": "create_emergency_contact", "payload": { "name": "string", "phone": "string", "emoji": "emoji", "relationship": "string" } },
    { "type": "update_emergency_contact", "payload": { "contactId": "ID", "name": "string", "phone": "string", "emoji": "emoji", "relationship": "string" } },
    { "type": "delete_emergency_contact", "payload": { "contactId": "ID" } },
    { "type": "update_member", "payload": { "memberId": "ID", "name": "string", "role": "mom|dad|son|daughter|other", "emoji": "emoji", "age": "string" } },
    { "type": "delete_member", "payload": { "memberId": "ID" } },
    { "type": "write_file", "payload": { "path": "soul.md or src/app/...", "content": "full file content" } },
    { "type": "validate_and_build", "payload": {} },
    { "type": "trigger_rebuild", "payload": {} }
  ]
}`;

    // 5. Call OpenRouter
    const callOpenRouter = async (modelName: string) => {
      const formattedHistory = Array.isArray(history)
        ? history.slice(-10).map((h: any) => ({
            role: h.role === "assistant" ? "assistant" : "user",
            content: h.content
          }))
        : [];

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openrouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            ...formattedHistory,
            { role: "user", content: message },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return await res.json();
    };

    let data;
    try {
      data = await callOpenRouter("google/gemini-2.0-flash-lite-preview-02-05:free");
    } catch (err: any) {
      console.warn("Primary model failed, using fallback:", err.message);
      data = await callOpenRouter("deepseek/deepseek-v4-flash");
    }

    if (!data || !data.choices || data.choices.length === 0) {
      return NextResponse.json({ error: "No response from AI brain." }, { status: 502 });
    }

    const replyContent = data.choices[0].message.content;
    const parsed = JSON.parse(replyContent);

    const executedActions: any[] = [];

    // 6. Execute ALL Dashboard Actions
    if (parsed.actions && Array.isArray(parsed.actions)) {
      for (const action of parsed.actions) {
        try {
          // ── TASKS ──────────────────────────────────────────────────────────
          if (action.type === "create_task") {
            const task = await pb.collection("tasks").create({
              ...action.payload,
              status: action.payload.status || "pending",
            });
            executedActions.push({
              type: "task", title: task.title,
              detail: `${members.find(m => m.id === task.assignedTo)?.name || "Everyone"} · Due ${task.dueDate || "Today"}`,
              emoji: task.emoji || "📋", confirmed: true,
            });
          } else if (action.type === "update_task") {
            const { taskId, ...updates } = action.payload;
            const updated = await pb.collection("tasks").update(taskId, updates);
            executedActions.push({ type: "task", title: updated.title, detail: "Updated!", emoji: "✏️", confirmed: true });
          } else if (action.type === "delete_task") {
            await pb.collection("tasks").delete(action.payload.taskId);
            executedActions.push({ type: "task", title: "Task deleted", detail: "", emoji: "🗑️", confirmed: true });
          } else if (action.type === "complete_task") {
            const updated = await pb.collection("tasks").update(action.payload.taskId, { status: "completed" });
            executedActions.push({ type: "task", title: updated.title, detail: "Completed!", emoji: "✅", confirmed: true });

          // ── MEALS ──────────────────────────────────────────────────────────
          } else if (action.type === "create_meal") {
            const savedMeal = await pb.collection("meals").create({
              name: action.payload.name,
              description: action.payload.description || "",
              date: action.payload.date,
              emoji: action.payload.emoji || "🍽️",
              ingredients: action.payload.ingredients || "",
              servings: action.payload.servings || 4,
            });
            try {
              const mealPlanEntry = await pb.collection("meal_plan_entries").create({
                recipeId: savedMeal.id,
                scheduledFor: action.payload.date,
                servings: action.payload.servings || 4,
                notes: action.payload.description || "",
                autoGenerated: false,
                lastSyncedAt: new Date().toISOString(),
              });
              await MealPlanningSync.syncMealPlanToGrocery(mealPlanEntry);
            } catch { /* meal_plan_entries optional */ }
            executedActions.push({
              type: "meal", title: savedMeal.name,
              detail: `Planned for ${savedMeal.date} · ${savedMeal.servings} Servings`,
              emoji: savedMeal.emoji || "🍽️", confirmed: true,
            });
          } else if (action.type === "delete_meal") {
            await pb.collection("meals").delete(action.payload.mealId);
            executedActions.push({ type: "meal", title: "Meal removed", detail: "", emoji: "🗑️", confirmed: true });

          // ── GROCERY ────────────────────────────────────────────────────────
          } else if (action.type === "create_grocery") {
            const grocery = await pb.collection("grocery_items").create({
              name: action.payload.name,
              emoji: action.payload.emoji || "🛒",
              category: action.payload.category || "pantry",
              priority: action.payload.priority || "medium",
              quantityNeeded: action.payload.quantityNeeded || 1,
              unit: action.payload.unit || "count",
              source: "manual",
              status: "needed",
              addedAt: new Date().toISOString(),
            });
            executedActions.push({
              type: "grocery", title: grocery.name,
              detail: `${grocery.quantityNeeded} ${grocery.unit} · ${grocery.category}`,
              emoji: grocery.emoji || "🛒", confirmed: true,
            });

          // ── CALENDAR EVENTS ────────────────────────────────────────────────
          } else if (action.type === "create_event") {
            const evt = await pb.collection("events").create({
              title: action.payload.title,
              date: action.payload.date,
              time: action.payload.time || "",
              memberId: action.payload.memberId || null,
              icon: action.payload.icon || "📅",
              description: action.payload.description || "",
            });
            executedActions.push({ type: "event", title: evt.title, detail: `${evt.date} at ${evt.time || "All Day"}`, emoji: evt.icon || "📅", confirmed: true });
          } else if (action.type === "update_event") {
            const { eventId, ...updates } = action.payload;
            const updated = await pb.collection("events").update(eventId, updates);
            executedActions.push({ type: "event", title: updated.title, detail: "Updated!", emoji: "✏️", confirmed: true });
          } else if (action.type === "delete_event") {
            await pb.collection("events").delete(action.payload.eventId);
            executedActions.push({ type: "event", title: "Event deleted", detail: "", emoji: "🗑️", confirmed: true });

          // ── SCHEDULES ──────────────────────────────────────────────────────
          } else if (action.type === "create_schedule") {
            const sched = await pb.collection("schedules").create(action.payload);
            executedActions.push({ type: "event", title: sched.title, detail: `Daily at ${sched.time}`, emoji: sched.emoji || "⏰", confirmed: true });
          } else if (action.type === "update_schedule") {
            const { scheduleId, ...updates } = action.payload;
            const updated = await pb.collection("schedules").update(scheduleId, updates);
            executedActions.push({ type: "event", title: updated.title, detail: "Schedule updated!", emoji: "✏️", confirmed: true });
          } else if (action.type === "delete_schedule") {
            await pb.collection("schedules").delete(action.payload.scheduleId);
            executedActions.push({ type: "event", title: "Schedule deleted", detail: "", emoji: "🗑️", confirmed: true });

          // ── EMERGENCY CONTACTS ─────────────────────────────────────────────
          } else if (action.type === "create_emergency_contact") {
            const contact = await pb.collection("emergency_contacts").create({
              name: action.payload.name,
              phone: action.payload.phone,
              emoji: action.payload.emoji || "👤",
              relationship: action.payload.relationship || "",
            });
            executedActions.push({ type: "task", title: `Added ${contact.name}`, detail: contact.phone, emoji: contact.emoji || "📞", confirmed: true });
          } else if (action.type === "update_emergency_contact") {
            const { contactId, ...updates } = action.payload;
            const updated = await pb.collection("emergency_contacts").update(contactId, updates);
            executedActions.push({ type: "task", title: `Updated ${updated.name}`, detail: updated.phone, emoji: updated.emoji || "📞", confirmed: true });
          } else if (action.type === "delete_emergency_contact") {
            await pb.collection("emergency_contacts").delete(action.payload.contactId);
            executedActions.push({ type: "task", title: "Emergency contact deleted", detail: "", emoji: "🗑️", confirmed: true });

          // ── MEMBERS ────────────────────────────────────────────────────────
          } else if (action.type === "update_member") {
            const { memberId, ...updates } = action.payload;
            const updated = await pb.collection("members").update(memberId, updates);
            executedActions.push({ type: "task", title: `Updated ${updated.name}`, detail: `Role: ${updated.role}`, emoji: updated.emoji || "👤", confirmed: true });
          } else if (action.type === "delete_member") {
            await pb.collection("members").delete(action.payload.memberId);
            executedActions.push({ type: "task", title: "Member removed", detail: "", emoji: "🗑️", confirmed: true });

          // ── FILE / CODE ────────────────────────────────────────────────────
          } else if (action.type === "write_file") {
            const filePath = action.payload.path;
            const content = action.payload.content;

            let success = false;
            // A. Write via filesystem bridge (updates real files on NAS host)
            try {
              const bridgeRes = await fetch("http://consuela-telegram-bot:3005/api/file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filePath, content }),
              });
              if (bridgeRes.ok) {
                success = true;
                console.log(`✅ Central Brain: Successfully wrote file ${filePath} via NAS filesystem bridge`);
              }
            } catch (bridgeErr: any) {
              console.warn("⚠️ NAS Filesystem bridge unreachable during write:", bridgeErr.message);
            }

            // B. Local fallback (for local development or standalone transient writes)
            if (!success) {
              try {
                const fs = await import("fs");
                const path = await import("path");
                const localPath = path.resolve(process.cwd(), filePath);
                fs.mkdirSync(path.dirname(localPath), { recursive: true });
                fs.writeFileSync(localPath, content, "utf8");
                success = true;
                console.log(`✅ Central Brain: Wrote file ${filePath} locally on transient server disk`);
              } catch (locErr: any) {
                console.error("❌ Failed to write file locally:", locErr.message);
              }
            }

            if (success) {
              executedActions.push({
                type: "file",
                title: filePath,
                detail: `File content rewritten successfully!`,
                emoji: "📝",
                confirmed: true,
              });
            }
          } else if (action.type === "trigger_rebuild") {
            executedActions.push({
              type: "rebuild",
              title: "Docker Stack Rebuild",
              detail: `Pending approval / deploy script trigger`,
              emoji: "⚡",
              confirmed: true,
            });
          } else if (action.type === "validate_and_build") {
            let compileSuccess = false;
            let compileOutput = "";
            try {
              const { execSync } = await import("child_process");
              execSync("npx tsc --noEmit", { stdio: "pipe", cwd: process.cwd() });
              compileSuccess = true;
              compileOutput = "All TypeScript and build checks passed with 0 compile errors!";
            } catch (compileErr: any) {
              compileSuccess = false;
              compileOutput = compileErr.stdout?.toString() || compileErr.stderr?.toString() || compileErr.message;
            }

            executedActions.push({
              type: "validate_and_build",
              title: "Code Compilation Check",
              detail: compileSuccess ? "Build Success! 0 errors" : "Build Failed! Check errors",
              emoji: compileSuccess ? "✅" : "❌",
              confirmed: true,
              payload: {
                success: compileSuccess,
                output: compileOutput
              }
            });
          }
        } catch (actErr: any) {
          console.error(`❌ Failed to execute action ${action.type}:`, actErr.message);
        }
      }
    }

    // Log assistant response to database chat history
    try {
      await pb.collection("chat_history").create({
        role: "assistant",
        content: parsed.reply,
        timestamp: new Date().toLocaleTimeString("en-US", { timeZone: "America/Detroit", hour: '2-digit', minute: '2-digit' }),
        sessionId: "default-session",
        actions: executedActions
      });
    } catch (dbErr: any) {
      console.warn("⚠️ Failed to write assistant reply to chat_history:", dbErr.message);
    }

    return NextResponse.json({
      reply: parsed.reply,
      actions: executedActions.length > 0 ? executedActions : undefined,
    });

  } catch (error: any) {
    console.error("❌ Chat API Error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
