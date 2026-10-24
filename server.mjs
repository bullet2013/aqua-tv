// Optional localhost server: JavaScript only, Node.js >= 20, no npm install.
// Shares one refreshed XMLTV file among all browsers/devices using this server.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateEpg } from './tools/epg-update.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const HOST = process.env.HOST || (process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.PORT || 8000);
const allowed = new Set(['/','/index.html','/app.js','/styles.css','/config.js','/playlist.m3u','/epg.xml.gz','/epg-meta.json','/favicon.ico']);
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.m3u':'application/x-mpegurl','.gz':'application/gzip','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {'Allow':'GET, HEAD'}); res.end(); return;
    }
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch { res.writeHead(400); res.end(); return; }
    if (!allowed.has(pathname)) { res.writeHead(404); res.end('Not Found'); return; }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/epg.xml.gz' || pathname === '/epg-meta.json') {
      try { await updateEpg({ maxAgeHours: 4 }); }
      catch (error) {
        res.writeHead(503, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
        res.end('EPG пока недоступен: ' + error.message); return;
      }
    }
    const path = resolve(ROOT, '.' + pathname);
    const info = await stat(path);
    res.writeHead(200, {
      'Content-Type': mime[extname(pathname)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': pathname.startsWith('/epg-') || pathname === '/epg.xml.gz' ? 'no-cache' : 'max-age=60',
      'X-Content-Type-Options':'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(path).pipe(res);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500, {'Content-Type':'text/plain; charset=utf-8'});
    res.end(error.code === 'ENOENT' ? 'Not Found' : 'Server error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AQUA TV: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
  if (HOST === '0.0.0.0') console.log('Доступно и другим устройствам в LAN по IP компьютера. Не открывайте порт в интернет без защиты.');
  updateEpg().catch(e => console.error('EPG: ', e.message));
});
// Keep the EPG current even when the page is open for days.
const polling = setInterval(() => updateEpg().catch(e => console.error('EPG:', e.message)), 30 * 60_000);
polling.unref();
