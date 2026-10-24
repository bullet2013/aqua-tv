// Optional: update public playlist from an existing GitHub repository.
// No npm install required. Reads AQUA_PLAYLIST_URL from GitHub Actions Variables.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'playlist.m3u');
const source = (process.env.AQUA_PLAYLIST_URL || '').trim();
function verify(data) {
  if (!/^\s*#EXTM3U\b/m.test(data) || !/^#EXTINF:/m.test(data)) {
    throw new Error('Файл не похож на M3U с #EXTM3U и #EXTINF.');
  }
  return data;
}
if (!source) {
  verify(await readFile(destination, 'utf8'));
  console.log('[M3U] Переменная AQUA_PLAYLIST_URL не задана: используется playlist.m3u из этого репозитория.');
} else {
  const url = new URL(source);
  if (url.protocol !== 'https:') throw new Error('AQUA_PLAYLIST_URL должен использовать HTTPS.');
  const response = await fetch(url, {signal: AbortSignal.timeout(45000), cache: 'no-store'});
  if (!response.ok) throw new Error(`M3U не загружен: HTTP ${response.status}`);
  const max = 8 * 1024 * 1024;
  const length = Number(response.headers.get('content-length') || 0);
  if (length > max) throw new Error('M3U превышает 8 МБ.');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > max) throw new Error('M3U превышает 8 МБ.');
    chunks.push(Buffer.from(chunk));
  }
  const data = verify(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
  const tmp = `${destination}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, destination);
  console.log(`[M3U] Загружен ${url.hostname}: ${(total/1024).toFixed(0)} КБ; ${data.match(/^#EXTINF:/gm)?.length || 0} каналов.`);
}
