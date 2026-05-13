"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
const googleApiKey = process.env.GOOGLE_AI_API_KEY;

interface AIResponse {
  content: string;
  actions?: Array<{
    type: "event" | "meal" | "task" | "grocery";
    title: string;
    detail: string;
    emoji: string;
  }>;
}

import { addEvent, addTask, addGroceryItem } from "./db-utils";

export async function getAIResponse(message: string): Promise<AIResponse> {
  try {
    let result: AIResponse = { content: "" };

    // Try OpenRouter first
    if (openRouterApiKey) {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "anthropic/claude-3.5-sonnet",
          messages: [
            {
              role: "system",
              content: `You are Consuela, a helpful AI family assistant. 
Current date: ${new Date().toISOString().split('T')[0]}

When responding, identify if the user wants to:
1. Add an event (e.g., "Add soccer practice at 4pm")
2. Add a task/chore (e.g., "Remind Jake to take out trash")
3. Add a grocery item (e.g., "Add milk to the list")

Respond with JSON:
{
  "content": "Friendly confirmation message",
  "actions": [
    {
      "type": "event|task|grocery|meal",
      "title": "Title of the item",
      "detail": "Time/Assignee/Quantity",
      "emoji": "Relevant emoji",
      "metadata": {
        "memberName": "Name of person if mentioned",
        "time": "HH:MM if mentioned",
        "date": "YYYY-MM-DD if mentioned"
      }
    }
  ]
}`
            },
            { role: "user", content: message },
          ],
        }),
      });

      const data = await response.json();
      const aiMessage = data.choices[0].message.content;
      try {
        result = JSON.parse(aiMessage);
      } catch {
        result = { content: aiMessage };
      }
    } else if (googleApiKey) {
      // Fallback to Gemini with similar prompt...
      const genAI = new GoogleGenerativeAI(googleApiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      const prompt = `You are Consuela, an AI family assistant. Respond to "${message}" in JSON format with content and optional actions array. Today is ${new Date().toISOString().split('T')[0]}.`;
      const aiResult = await model.generateContent(prompt);
      const aiMessage = aiResult.response.text();
      try {
        result = JSON.parse(aiMessage);
      } catch {
        result = { content: aiMessage };
      }
    }

    // Perform database operations based on identified actions
    if (result.actions) {
      for (const action of result.actions) {
        const meta = (action as any).metadata || {};
        if (action.type === "event") {
          await addEvent(action.title, meta.date || new Date().toISOString().split('T')[0], meta.time || "", meta.memberName);
        } else if (action.type === "task") {
          await addTask(action.title, meta.memberName);
        } else if (action.type === "grocery") {
          await addGroceryItem(action.title, action.detail);
        }
      }
    }

    return result;
  } catch (error) {
    console.error("AI API error:", error);
    return { content: "Sorry, I'm having trouble right now." };
  }
}