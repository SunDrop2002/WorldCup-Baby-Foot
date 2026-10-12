// ═══════════════════════════════════════════════════════════════════════════
//  serve.js — zero-dependency local server for testing on a real phone
// ═══════════════════════════════════════════════════════════════════════════
//
//  The game cannot be tested from file://. Chrome treats every file:// document
//  as its own opaque origin, so Three.js's TextureLoader is refused when it
//  fetches the turf and wood maps, and the pitch renders untextured. It has to
//  come off an http:// origin — hence this.
//
//  Run it, then open the printed LAN address on a phone connected to the same
//  Wi-Fi. No install step, no packages: plain Node.
//
//    node serve.js            → port 8080
//    node serve.js 3000       → port 3000
//
//  Cache-Control is `no-store` on purpose. Phones cache aggressively, and the
//  single most confusing thing while iterating on a touch layer is testing a
//  build from ten minutes ago and concluding the fix didn't work.
// ═══════════════════════════════════════════════════════════════════════════

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2], 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg' : 'image/svg+xml',
  '.mp3' : 'audio/mpeg',
  '.wav' : 'audio/wav',
  '.ogg' : 'audio/ogg',
  '.ico' : 'image/x-icon',
};

const server = http.createServer((req, res) => {
  // decodeURIComponent because the asset folders have spaces in their names
  // ("worldcup countries"), which arrive percent-encoded.
  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400); return res.end('Bad URL'); }
  if (rel === '/' || rel === '') rel = '/index.html';

  // Refuse anything that escapes the game folder.
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(file, (err, buf) => {
    if (err) {
      console.log('  404  ' + rel);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found: ' + rel);
    }
    res.writeHead(200, {
      'Content-Type' : MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan  = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
    }
  }
  const line = '─'.repeat(60);
  console.log('\n' + line);
  console.log('  World Cup Babyfoot — local test server');
  console.log(line);
  console.log('  On this PC:   http://localhost:' + PORT + '/');
  if (lan.length) {
    console.log('\n  On your phone (same Wi-Fi):');
    for (const ip of lan) console.log('     http://' + ip + ':' + PORT + '/');
  } else {
    console.log('\n  No LAN address found — is Wi-Fi on?');
  }
  console.log('\n  Force the touch layer on a desktop browser:');
  console.log('     http://localhost:' + PORT + '/?mobile=1&touch=1');
  console.log('\n  Ctrl+C to stop.');
  console.log(line + '\n');
});
