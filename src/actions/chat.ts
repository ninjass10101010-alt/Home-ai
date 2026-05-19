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

export async function getAIResponse(message: string): Promise<AIResponse> {
  try {
    // Try OpenRouter first (supports Claude, GPT, etc.)
    if (openRouterApiKey) {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "anthropic/claude-3.5-sonnet", // or user preference
          messages: [
            {
              role: "system",
              content: `You are Consuela, a helpful AI family assistant. You help manage family calendars, meal planning, tasks, and grocery lists.

When responding to user requests, you should:
1. Be friendly and helpful
2. Take action on their requests (add events, plan meals, etc.)
3. Use structured actions when appropriate
4. Keep responses concise

For actions, respond with JSON format:
{
  "content": "Your response text",
  "actions": [
    {
      "type": "event|meal|task|grocery",
      "title": "Brief title",
      "detail": "Details",
      "emoji": "relevant emoji"
    }
  ]
}

If no action needed, just return content string.`
            },
            {
              role: "user",
              content: message,
            },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      const data = await response.json();
      const aiMessage = data.choices[0].message.content;

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(aiMessage);
        return parsed;
      } catch {
        // Plain text response
        return { content: aiMessage };
      }
    }

    // Fallback to Google AI
    if (googleApiKey) {
      const genAI = new GoogleGenerativeAI(googleApiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

      const prompt = `You are Consuela, a helpful AI family assistant. Respond to: "${message}"

Guidelines:
- Be friendly and helpful
- Take action on requests when possible
- Keep responses concise
- If adding something, mention it was added

Return response as plain text unless it's an action, then use JSON format with content and actions array.`;

      const result = await model.generateContent(prompt);
      const aiMessage = result.response.text();

      try {
        const parsed = JSON.parse(aiMessage);
        return parsed;
      } catch {
        return { content: aiMessage };
      }
    }

    // Fallback to mock if no APIs
    return {
      content: "I'm here to help with your family organization! What would you like me to assist with?",
    };

  } catch (error) {
    console.error("AI API error:", error);
    return {
      content: "Sorry, I'm having trouble connecting right now. Please try again later.",
    };
  }
}