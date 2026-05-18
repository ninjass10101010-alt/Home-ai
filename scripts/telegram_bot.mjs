import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the project root
dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env') });

// Use hardcoded token for now as provided, but fallback to environment variable
const botToken = process.env.TELEGRAM_BOT_TOKEN || '8509642029:AAGBeZ3hxu-PAkV1ujDe0irGAy5xmZHph5Q';
const bot = new Telegraf(botToken);

// --- Configuration ---
// Add allowed Telegram User IDs here to restrict access.
// Example: [123456789, 987654321]
const ALLOWED_USERS = []; 

// Middleware for authorization
bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  
  // If no allowed users are set, we will warn but let it pass for initial testing.
  // In production, you MUST set ALLOWED_USERS.
  if (ALLOWED_USERS.length > 0 && userId && !ALLOWED_USERS.includes(userId)) {
    console.warn(`Unauthorized access attempt from user ID: ${userId}`);
    return; // Silently drop message
  }
  
  if (ALLOWED_USERS.length === 0 && userId) {
    console.log(`[AUTH WARNING] Message received from User ID: ${userId}. Consider adding this ID to ALLOWED_USERS for security.`);
  }

  return next();
});

// Basic commands
bot.start((ctx) => {
  ctx.reply('👋 Hello! I am your Home AI Assistant. I can help you manage your calendar, plan meals, organize tasks, and build grocery lists.\n\nJust tell me what you need!');
});

bot.help((ctx) => {
  ctx.reply('Send me a message like:\n- "Add milk to the grocery list"\n- "Plan dinners for this week"\n- "Remind Jake to take out the trash"');
});

// Message handling
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;

  console.log(`[MSG] ${username} (${userId}): ${text}`);

  // Send a typing indicator
  await ctx.sendChatAction('typing');

  try {
    // Try multiple possible Next.js backend URLs to support both local dev and Docker container networks
    const urls = [
      'http://localhost:3000/api/chat',
      'http://192.168.0.27:3001/api/chat',
      'http://home-dashboard:3000/api/chat',
      'http://127.0.0.1:3000/api/chat'
    ];

    let response = null;
    let fetchErr = null;

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        if (res.ok) {
          response = await res.json();
          break;
        }
        console.warn(`⚠️ Next.js backend at ${url} returned HTTP ${res.status}`);
      } catch (err) {
        fetchErr = err;
      }
    }

    if (response) {
      let replyMessage = response.reply;
      
      // If there are actions executed, append a beautiful premium database summary!
      if (response.actions && response.actions.length > 0) {
        replyMessage += '\n\n⚡ <b>Dashboard Action Summary:</b>';
        response.actions.forEach((act) => {
          replyMessage += `\n${act.emoji} <b>${act.title}</b> (${act.detail})`;
        });
      }

      ctx.replyWithHTML(replyMessage);
    } else {
      console.error("Failed to connect to Next.js API routes:", fetchErr?.message || "HTTP Failure");
      ctx.reply("⚠️ Sorry, I could not reach the centralized Next.js AI brain. Please check if the dashboard server is active.");
    }
  } catch (error) {
    console.error("Failed to process message:", error);
    ctx.reply("Sorry, there was an error processing your message.");
  }
});

// Start the bot
console.log('Starting Telegram Bot with Long Polling...');
bot.launch()
  .then(() => console.log('Telegram Bot is successfully running!'))
  .catch(err => console.error('Failed to start Telegram Bot:', err));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// 📡 Internal HTTP Server for filesystem bridge
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    if (req.method === 'GET' && url.pathname === '/api/file') {
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'path parameter is required' }));
      }
      
      const safePath = path.resolve('/app', filePath);
      if (!safePath.startsWith('/app')) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'Access denied outside /app' }));
      }
      
      if (!fs.existsSync(safePath)) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: `File not found: ${filePath}` }));
      }
      
      const content = fs.readFileSync(safePath, 'utf8');
      return res.end(JSON.stringify({ content }));
    }
    
    if (req.method === 'POST' && url.pathname === '/api/file') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      
      const { filePath, content } = JSON.parse(body);
      if (!filePath || content === undefined) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'filePath and content are required' }));
      }
      
      const safePath = path.resolve('/app', filePath);
      if (!safePath.startsWith('/app')) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'Access denied outside /app' }));
      }
      
      // Ensure target directory exists
      fs.mkdirSync(path.dirname(safePath), { recursive: true });
      fs.writeFileSync(safePath, content, 'utf8');
      
      console.log(`📝 [FS Bridge] Wrote file: ${filePath}`);
      return res.end(JSON.stringify({ success: true }));
    }
    
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    console.error('❌ [FS Bridge] Error:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(3005, '0.0.0.0', () => {
  console.log('📡 [FS Bridge] Internal filesystem API listening on port 3005');
});
