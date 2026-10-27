// Build lightweight Tizen EPG: programme titles/times in XMLTV, descriptions
// in small per-channel JSON files fetched only when the viewer opens details.
// The ordinary epg.xml.gz and Android/browser experience stay unchanged.
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rm, writeFile, stat} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip, createGzip} from 'node:zlib';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,'epg.xml.gz');
const output=resolve(root,'epg-tv.xml.gz');
const detailDir=resolve(root,'epg-tv-descriptions');
const map=new Map();
const descPattern=/<desc(?:\s[^>]*)?>([\s\S]*?)<\/desc\s*>/ig;

function attr(tag,name) {
  const m=tag.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27)','i'));
  return (m && (m[1] || m[2]) || '').replace(/&amp;/gi,'&').trim().toLowerCase();
}
function xmltvTime(s) {
  const m=String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!m) return NaN;
  const sec=+(m[6] || '0');
  if (!m[7]) return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],sec).getTime();
  const offset=(+m[8]*60+ +m[9])*(m[7]==='+'?1:-1);
  return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],sec)-offset*60000;
}
function hashId(id) {
  let h=2166136261;
  for (let i=0;i<id.length;i++) h=Math.imul(h ^ id.charCodeAt(i),16777619);
  return (h>>>0).toString(16);
}
function compressProgramme(block) {
  const opening=block.match(/^<programme\b([^>]*)>/i);
  if (!opening) return block;
  const channel=attr(opening[1],'channel');
  const start=xmltvTime(attr(opening[1],'start'));
  const stop=xmltvTime(attr(opening[1],'stop'));
  // An array of titles is NOT loaded: only keyed programme descriptions.
  const matches=[...block.matchAll(descPattern)];
  if (matches.length && channel && Number.isFinite(start) && Number.isFinite(stop)) {
    const raw=matches[0][1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').trim().slice(0,1200);
    if (raw) {
      if (!map.has(channel)) map.set(channel,{});
      map.get(channel)[String(start)+'|'+String(stop)]=raw;
    }
  }
  return block.replace(descPattern,'');
}

let buffer='';
const decoder=new TextDecoder('utf-8');
async function* strippedXml() {
  let entries=0;
  for await (const chunk of createReadStream(source).pipe(createGunzip())) {
    buffer+=decoder.decode(chunk,{stream:true});
    for (;;) {
      const begin=buffer.search(/<programme(?=[\s>])/i);
      if (begin<0) {
        // Keep a short tail so '<programme' split across network chunks survives.
        if (buffer.length>64) {
          yield buffer.slice(0,-64);
          buffer=buffer.slice(-64);
        }
        break;
      }
      if (begin>0) {
        yield buffer.slice(0,begin);
        buffer=buffer.slice(begin);
      }
      const end=/<\/programme\s*>/i.exec(buffer);
      if (!end) {
        if (buffer.length>4*1024*1024) throw Error('Oversized programme block');
        break;
      }
      const length=end.index+end[0].length;
      yield compressProgramme(buffer.slice(0,length));
      buffer=buffer.slice(length);
      entries++;
    }
  }
  buffer+=decoder.decode();
  if (buffer) yield buffer;
  if (!map.size) throw Error('No EPG programme descriptions found');
  console.log('[EPG TV] Processed XMLTV, with descriptions from '+map.size+' channels');
}

await pipeline(Readable.from(strippedXml()),createGzip({level:6}),createWriteStream(output));
await rm(detailDir,{recursive:true,force:true});
await mkdir(detailDir,{recursive:true});
const used=new Set();
for (const [id, programmes] of map) {
  const key=hashId(id);
  if (used.has(key)) throw Error('EPG channel hash collision');
  used.add(key);
  await writeFile(resolve(detailDir,key+'.json'),JSON.stringify({id,programmes}));
}
const bytes=(await stat(output)).size;
console.log('[EPG TV] Light gzip: '+bytes+' bytes; on-demand files: '+map.size);
