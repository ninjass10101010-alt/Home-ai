// Post-build: fix Turbopack CSS hash mismatch
const fs = require('fs');
const path = require('path');
const http = require('http');

const chunksDir = path.join(__dirname, '.next', 'static', 'chunks');
if (!fs.existsSync(chunksDir)) process.exit(0);

// Find all CSS files
const cssFiles = fs.readdirSync(chunksDir).filter(f => f.endsWith('.css'));

// Start temp server to check what CSS the HTML expects
const { createServer } = require('http');
const next = require('next');
const app = next({ dev: false, dir: __dirname });
app.prepare().then(() => {
  // Read the built HTML to find CSS references
  const htmlPath = path.join(__dirname, '.next', 'server', 'app', 'page.html');
  const pageDirs = ['.next/server/app'];
  
  function findHtml(dir) {
    if (!fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.html')) return full;
      if (entry.isDirectory()) {
        const found = findHtml(full);
        if (found) return found;
      }
    }
    return null;
  }
  
  const htmlFile = findHtml('.next/server/app');
  if (htmlFile && cssFiles.length > 0) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const match = html.match(/href="\/_next\/static\/chunks\/([^"]+\.css)"/);
    if (match) {
      const expectedName = match[1];
      const expectedPath = path.join(chunksDir, expectedName);
      if (!fs.existsSync(expectedPath)) {
        const actualPath = path.join(chunksDir, cssFiles[0]);
        fs.copyFileSync(actualPath, expectedPath);
        console.log(`✓ CSS fix: ${cssFiles[0]} → ${expectedName}`);
      } else {
        console.log('✓ CSS already matches');
      }
    }
  }
  process.exit(0);
});
