import { chromium } from 'playwright';

async function run() {
  console.log("Starting browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.stack || err.message));

  console.log("Navigating to http://localhost:3000/tasks...");
  try {
    await page.goto('http://localhost:3000/tasks', { waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log("Navigated successfully. Waiting 3 seconds...");
    await page.waitForTimeout(3000);
    const content = await page.textContent('body');
    console.log("Body text content preview:", content ? content.slice(0, 1000) : "empty");
  } catch (err) {
    console.error("Navigation error:", err);
  } finally {
    await browser.close();
  }
}

run();
