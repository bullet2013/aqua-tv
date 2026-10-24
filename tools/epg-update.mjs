// AQUA TV — prepare a small XMLTV GZIP for browsers and Smart TVs.
// Node.js 20+, built-in modules only, streams original (possibly huge) EPG.
// Keeps channel metadata and full programme descriptions for M3U tvg-id values.
import { readFile, writeFile, rename, stat, open, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'epg.xml.gz');
const META = resolve(ROOT, 'epg-meta.json');
const M3U = resolve(ROOT, 'playlist.m3u');
const MAX_DOWNLOAD = 120 * 1024 * 1024;
const MAX_BLOCK = 4 * 1024 * 1024;
const MAX_MATCHED = 140 * 1024 * 1024; // accidental oversized filtered data protection
let pending = null;
let recentFailureAt = 0;

function attr(text, name) {
  const match = text.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return (match?.[1] ?? match?.[2] ?? '').replace(/&amp;/gi, '&').trim();
}
function xmltvTime(value) {
  const m = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!m) return NaN;
  const dt = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (!m[7]) return dt;
  const minutes = (+m[8] * 60 + +m[9]) * (m[7] === '+' ? 1 : -1);
  return dt - minutes * 60_000;
}
async function sourceFromConfig() {
  if (process.env.AQUA_EPG_URL?.trim()) return process.env.AQUA_EPG_URL.trim();
  const content = await readFile(resolve(ROOT, 'config.js'), 'utf8');
  const m = content.match(/^\s*epgUrl:\s*['"]([^'"]+)['"]/m);
  if (!m) throw new Error('В config.js не найден epgUrl');
  return m[1];
}
function wantedFromM3U(contents) {
  const ids = new Set();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.startsWith('#EXTINF:')) continue;
    const id = attr(line, 'tvg-id').toLowerCase();
    if (id) ids.add(id);
  }
  return ids;
}
async function loadLastMeta() {
  try {
    const obj = JSON.parse(await readFile(META, 'utf8'));
    if ((await stat(OUT)).size > 100) return obj;
  } catch {}
  return null;
}
async function streamSource(url, consume) {
  const response = await fetch(url, {signal: AbortSignal.timeout(210_000), redirect:'follow', cache:'no-store', headers:{accept:'application/octet-stream,application/gzip,application/xml,*/*'}});
  if (!response.ok || !response.body) throw new Error(`EPG: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_DOWNLOAD) throw new Error('EPG: исходный архив слишком большой (>120 МБ)');
  const iterator = Readable.fromWeb(response.body)[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done || !first.value?.length) throw new Error('EPG: пустой ответ');
  let bytes = 0;
  async function* incoming() {
    const add = chunk => { bytes += chunk.length; if (bytes > MAX_DOWNLOAD) throw new Error('EPG превышает 120 МБ'); return chunk; };
    yield add(first.value);
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) yield add(chunk);
  }
  const source = Readable.from(incoming());
  // Some servers send Content-Encoding:gzip which fetch already decoded.
  // Detect actual gzip magic bytes, don't trust HTTP headers/URL extension.
  const expanded = first.value[0] === 0x1f && first.value[1] === 0x8b ? source.pipe(createGunzip()) : source;
  const decoder = new TextDecoder('utf-8');
  for await (const chunk of expanded) consume(decoder.decode(chunk, {stream:true}));
  consume(decoder.decode());
  return bytes;
}
export async function updateEpg({force = false, maxAgeHours = 24} = {}) {
  if (pending) return pending;
  pending = (async () => {
    const url = await sourceFromConfig();
    const wanted = wantedFromM3U(await readFile(M3U, 'utf8'));
    if (!wanted.size) throw new Error('Не найдено tvg-id в playlist.m3u. Проверьте полный плейлист!');
    const sourceKey = createHash('sha256').update(url + '\n' + [...wanted].sort().join('\n')).digest('hex').slice(0, 20);
    const old = await loadLastMeta();
    const age = old ? Date.now() - Date.parse(old.updatedAt) : Infinity;
    if (!force && old?.sourceKey === sourceKey && age >= 0 && age < maxAgeHours * 3_600_000) return old;
    if (!force && old && Date.now()-recentFailureAt < 120000) return old;
    const now = Date.now();
    const earliest = now - 24*3600_000;
    const latest = now + 4*24*3600_000;
    const matchedIds = new Set();
    const channels = [];
    let programmes = 0, scanned = 0, bytesKept = 0, rootFound = false, lastProgrammeStop=0;
    const temp = `${OUT}.${process.pid}-${Date.now()}.tmp`;
    const tempBody = `${temp}.body`;
    const bodyFile = createWriteStream(tempBody, {encoding:'utf8'});
    let bodyWriteError = null;
    bodyFile.on('error', error => { bodyWriteError = error; });
    let buffer = '';
    const consume = segment => {
      if (bodyWriteError) throw bodyWriteError;
      buffer += segment;
      if (!rootFound && /<tv(?:\s|>)/i.test(buffer)) rootFound = true;
      for (;;) {
        const start = /<(channel|programme)(?=[\s>])/i.exec(buffer);
        if (!start) { buffer = buffer.slice(-100); break; }
        if (start.index) buffer = buffer.slice(start.index);
        const type = start[1].toLowerCase();
        const endMatch = new RegExp(`</${type}\\s*>`, 'i').exec(buffer);
        if (!endMatch) {
          if (Buffer.byteLength(buffer) > MAX_BLOCK) throw new Error(`Слишком длинный XMLTV-блок: ${type}`);
          break;
        }
        const block = buffer.slice(0, endMatch.index + endMatch[0].length);
        buffer = buffer.slice(endMatch.index + endMatch[0].length);
        const opening = new RegExp(`^<${type}\\b([^>]*)>`, 'i').exec(block);
        if (!opening) continue;
        const attrs = opening[1];
        if (type === 'channel') {
          const id = attr(attrs, 'id').toLowerCase();
          if (wanted.has(id)) channels.push(block + '\n');
          continue;
        }
        scanned++;
        const id = attr(attrs, 'channel').toLowerCase();
        if (!wanted.has(id)) continue;
        const begin = xmltvTime(attr(attrs, 'start'));
        const stop = xmltvTime(attr(attrs, 'stop'));
        if (!Number.isFinite(begin) || !Number.isFinite(stop) || stop <= begin || stop <= earliest || begin >= latest) continue;
        if (bytesKept + Buffer.byteLength(block) > MAX_MATCHED) throw new Error('Отфильтрованный EPG неожиданно велик (>140 МБ XML).');
        if (!bodyFile.write(block + '\n')) {
          // We only need to keep bounded backpressure; abort on extreme backlog.
          if (bodyFile.writableLength > 8 * 1024 * 1024) throw new Error('Буфер записи EPG переполнен.');
        }
        matchedIds.add(id);
        programmes++;
        bytesKept += Buffer.byteLength(block) + 1;
        lastProgrammeStop = Math.max(lastProgrammeStop, stop);
      }
    };
    try {
      console.log(`[EPG] Отбор программ по ${wanted.size} tvg-id из ${url}`);
      const received = await streamSource(url, consume);
      bodyFile.end();
      await new Promise((resolveDone, rejectDone) => {bodyFile.once('finish', resolveDone);bodyFile.once('error', rejectDone);});
      if (!rootFound || scanned === 0 || programmes === 0) throw new Error(`Нет подходящих телепередач. XMLTV записей: ${scanned}, отобрано: ${programmes}. Проверьте tvg-id и дату.`);
      async function* xml() {
        yield '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="AQUA TV filtered EPG">\n';
        for (const channel of channels) yield channel;
        yield* createReadStream(tempBody);
        yield '\n</tv>\n';
      }
      await pipeline(Readable.from(xml()), createGzip({level:6}), createWriteStream(temp));
      const gzipSize = (await stat(temp)).size;
      const meta = { updatedAt:new Date().toISOString(), sourceKey, tvgIdsInPlaylist:wanted.size,
        matchedChannelIds:matchedIds.size, programmesApprox:programmes, scannedProgrammes:scanned,
        bytesGzip:gzipSize, lastProgrammeStop:new Date(lastProgrammeStop).toISOString(),
        fromSourceBytes:received };
      const tmpMeta = `${META}.${process.pid}.tmp`;
      await rename(temp, OUT);
      await writeFile(tmpMeta, JSON.stringify(meta, null, 2) + '\n');
      await rename(tmpMeta, META);
      console.log(`[EPG] Успешно: ${meta.matchedChannelIds} каналов, ${programmes} передач, ${(gzipSize/1048576).toFixed(2)} МБ gzip (из ${(received/1048576).toFixed(1)} МБ)`);
      return meta;
    } catch(error) {
      recentFailureAt=Date.now();
      bodyFile.destroy();
      console.error('[EPG] Сбой обновления:', error.message);
      if (!force && old) return old;
      throw error;
    } finally {
      await rm(tempBody, {force:true}).catch(()=>{});
      await rm(temp, {force:true}).catch(()=>{});
    }
  })();
  try { return await pending; } finally {pending=null;}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateEpg({force:true}).catch(error=>{ console.error(error.stack || String(error)); process.exitCode=1; });
}
