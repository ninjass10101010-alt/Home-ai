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

    // 3. Fetch live context from PocketBase
    let members: any[] = [];
    let pendingTasks: any[] = [];
    let upcomingMeals: any[] = [];

    try {
      [members, pendingTasks, upcomingMeals] = await Promise.all([
        pb.collection("members").getFullList(),
        pb.collection("tasks").getFullList({ filter: 'status = "pending"' }),
        pb.collection("meals").getFullList({ sort: "-date", limit: 10 }),
      ]);
    } catch (dbErr: any) {
      console.warn("⚠️ Failed to fetch PocketBase context for agent:", dbErr.message);
    }

    // Format dynamic context strings
    const membersList = members
      .map((m) => `- [${m.name}] (ID: ${m.id}, Emoji: ${m.emoji || "👤"}, Role: ${m.role || "Member"})`)
      .join("\n");
      
    const tasksList = pendingTasks
      .map((t) => `- "${t.title}" (ID: ${t.id}, Assigned: ${t.assignedTo || "Unassigned"}, Due: ${t.dueDate || "None"}, Category: ${t.category || "General"})`)
      .join("\n");

    const mealsList = upcomingMeals
      .map((m) => `- "${m.name}" scheduled for ${m.date} (${m.emoji || "🍽️"})`)
      .join("\n");

    const currentDate = new Date().toLocaleString("en-US", { timeZone: "America/Detroit" });

    // 4. Build system prompt
    const systemPrompt = `${dynamicSoul || "You are Consuela, the unyielding, direct, casual, and highly competent AI family assistant."}

DASHBOARD REAL-TIME CONTEXT:
- Current Local Time: ${currentDate}
- Family Members:
${membersList || "- No members found."}
- Pending Tasks:
${tasksList || "- No pending tasks."}
- Upcoming Meals:
${mealsList || "- No upcoming planned meals."}
${preloadedFilesContext ? `\n--- PRE-LOADED SOURCE FILES ---${preloadedFilesContext}` : ""}

YOUR DYNAMIC SELF-MODIFICATION & CODE POWERS:
You have read and write permissions inside the dashboard repository.
1. If the user asks you to edit your personality guidelines, rewrite rules, or add instructions, return a "write_file" action targeting "soul.md".
2. If the user asks you to modify the dashboard UI (e.g. changing styles, layouts, or adding components to "src/app/chat/page.tsx", etc.), read the code context from the ACTIVE FILE CONTEXT above, make the modifications, and output a "write_file" action to save the updated codebase.
3. When editing code, ALWAYS output a "validate_and_build" action to trigger a TypeScript compile validation check and ensure your code contains zero compilation errors.
4. You can also output a "trigger_rebuild" action to redeploy your modified code container stack.

YOUR RESPONSE MUST STRICTLY BE A VALID JSON OBJECT matching this exact structure (do not wrap in markdown blocks, do not include any text before or after):
{
  "reply": "Your brief, friendly, competent response to the user. Explain clearly what you did.",
  "actions": [
    {
      "type": "create_task",
      "payload": {
        "title": "Chore/Task title",
        "description": "Optional detail",
        "priority": "low" | "medium" | "high",
        "assignedTo": "Member_ID_string" (assigned member's PocketBase ID, or null),
        "points": 10,
        "category": "Chores" | "Calendar" | "Health" | "School",
        "emoji": "Preset_emoji",
        "recurring": false,
        "dueDate": "YYYY-MM-DD"
      }
    },
    {
      "type": "create_meal",
      "payload": {
        "name": "Meal name",
        "description": "Optional details",
        "date": "YYYY-MM-DD",
        "emoji": "Preset_emoji",
        "servings": 4,
        "ingredients": "Ingredient 1\\nIngredient 2"
      }
    },
    {
      "type": "create_grocery",
      "payload": {
        "name": "Grocery item name",
        "emoji": "Preset_emoji",
        "category": "produce" | "dairy" | "meat" | "pantry" | "frozen" | "snacks" | "beverages" | "household",
        "priority": "low" | "medium" | "high",
        "quantityNeeded": 1,
        "unit": "count" | "g" | "kg" | "oz" | "cup" | "tbsp" | "tsp"
      }
    },
    {
      "type": "complete_task",
      "payload": {
        "taskId": "Task_ID_string"
      }
    },
    {
      "type": "write_file",
      "payload": {
        "path": "soul.md" (or a source file path like "src/app/chat/page.tsx"),
        "content": "Complete updated file content..."
      }
    },
    {
      "type": "trigger_rebuild",
      "payload": {}
    }
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

    // 6. Execute Actions (PocketBase CRUD & Self-Modification Filesystem Bridge)
    if (parsed.actions && Array.isArray(parsed.actions)) {
      for (const action of parsed.actions) {
        try {
          if (action.type === "create_task") {
            const task = await pb.collection("tasks").create({
              ...action.payload,
              status: "pending",
            });
            executedActions.push({
              type: "task",
              title: task.title,
              detail: `${members.find(m => m.id === task.assignedTo)?.name || "Everyone"} · Due ${task.dueDate || "Today"}`,
              emoji: task.emoji || "📋",
              confirmed: true,
            });
          } else if (action.type === "create_meal") {
            const savedMeal = await pb.collection("meals").create({
              name: action.payload.name,
              description: action.payload.description || "",
              date: action.payload.date,
              emoji: action.payload.emoji || "🍽️",
              ingredients: action.payload.ingredients || "",
              servings: action.payload.servings || 4,
            });

            const mealPlanEntry = await pb.collection("meal_plan_entries").create({
              recipeId: savedMeal.id,
              scheduledFor: action.payload.date,
              servings: action.payload.servings || 4,
              notes: action.payload.description || "",
              autoGenerated: false,
              lastSyncedAt: new Date().toISOString(),
            });

            await MealPlanningSync.syncMealPlanToGrocery(mealPlanEntry);

            executedActions.push({
              type: "meal",
              title: savedMeal.name,
              detail: `Planned for ${savedMeal.date} · ${savedMeal.servings} Servings`,
              emoji: savedMeal.emoji || "🍽️",
              confirmed: true,
            });
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
              type: "grocery",
              title: grocery.name,
              detail: `${grocery.quantityNeeded} ${grocery.unit} · Category: ${grocery.category}`,
              emoji: grocery.emoji || "🛒",
              confirmed: true,
            });
          } else if (action.type === "complete_task") {
            const updated = await pb.collection("tasks").update(action.payload.taskId, {
              status: "completed",
            });
            executedActions.push({
              type: "task",
              title: updated.title,
              detail: `Completed!`,
              emoji: "✅",
              confirmed: true,
            });
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
