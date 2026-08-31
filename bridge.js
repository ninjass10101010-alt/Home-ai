const http = require("http");

const HERMES_API_URL = process.env.HERMES_API_URL || "http://hermes-agent-2:8642/v1";
const HERMES_API_KEY = process.env.HERMES_API_KEY || "consuela-api-key-2026";
const PORT = 3005;

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { message } = JSON.parse(body);
        const reply = await talkToConsuela(message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

async function talkToConsuela(message) {
  const response = await fetch(`${HERMES_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${HERMES_API_KEY}`,
    },
    body: JSON.stringify({
      model: "hermes-agent",
      messages: [
        {
          role: "system",
          content:
            "You are Consuela, the Garcia family AI assistant. You help with family organization, meal planning, scheduling, tasks, grocery lists, and reminders. Be warm, friendly, and efficient. Keep responses concise.",
        },
        { role: "user", content: message },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    throw new Error(`Hermes API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "No response";
}

server.listen(PORT, "0.0.0.0", () =>
  console.log("Bridge listening on port " + PORT)
);
