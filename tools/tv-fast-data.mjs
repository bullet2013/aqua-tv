// AQUA TV FAST: GitHub Pages precomputes a small, ready-to-display TV guide.
// Samsung TV must not parse compressed XMLTV or retain thousands of programmes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(root,'tv-fast');
await mkdir(output,{recursive:true});
const text=await readFile(resolve(root,'playlist.m3u'),'utf8');
const channels=[];
let pending=null;
function attr(raw,name){
  const found=raw.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27)','i'));
  return found ? (found[1]||found[2]||'') : '';
}
for(const line of text.split(/\r?\n/)){
  if(line.startsWith('#EXTINF:')){
    const comma=line.indexOf(',');
    pending={id:attr(line,'tvg-id').toLowerCase().trim(),
      logo:attr(line,'tvg-logo'),group:attr(line,'group-title')||'Другие',
      name:comma>=0?line.slice(comma+1).trim():'Канал'};
  }else if(pending && /^https?:\/\//i.test(line.trim())){
    pending.url=line.trim();
    channels.push(pending);
    pending=null;
  }
}
if(!channels.length)throw Error('No channels found');
await writeFile(resolve(output,'channels.json'),JSON.stringify(channels));
const wanted=new Set(channels.map(c=>c.id).filter(Boolean));
const guide=Object.create(null);
const now=Date.now();
const from=now-4*3600000,until=now+48*3600000;
const decoder=new TextDecoder('utf-8');
function xmlTime(str){
  const m=String(str).match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?(?:\s*([+-])(\d\d)(\d\d))?/);
  if(!m)return NaN;
  const d=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0));
  if(!m[7])return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0)).getTime();
  return d-(+m[8]*60+ +m[9])*(m[7]==='+'?1:-1)*60000;
}
function entities(str){
  return String(str||'').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,part=>{
    const key=part.slice(1,-1).toLowerCase();
    if(key==='amp')return '&';if(key==='lt')return '<';if(key==='gt')return '>';
    if(key==='quot')return '"';if(key==='apos')return "'";
    const code=key.startsWith('#x')?parseInt(key.slice(2),16):Number(key.slice(1));
    return Number.isFinite(code)&&code>0&&code<=0x10ffff?String.fromCodePoint(code):part;
  });
}
function epgClock(raw){
  // Show exactly the start/end clock provided by the EPG source, not the
  // possibly incorrect timezone of the Tizen JavaScript runtime.
  const m=String(raw||'').match(/^\d{8}(\d{2})(\d{2})/);
  return m ? m[1]+':'+m[2] : '';
}
function parse(block){
  const tag=/^<programme\b([^>]*)>/i.exec(block);
  if(!tag)return;
  const id=entities(attr(tag[1],'channel')).toLowerCase().trim();
  if(!wanted.has(id))return;
  const startRaw=attr(tag[1],'start'),stopRaw=attr(tag[1],'stop');
  const start=xmlTime(startRaw);
  const stop=xmlTime(stopRaw);
  if(!Number.isFinite(start)||!Number.isFinite(stop)||stop<=from||start>=until||stop<=start)return;
  const title=/<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/i.exec(block);
  if(!title)return;
  const name=entities(title[1].replace(/<[^>]+>/g,'')).trim();
  if(!name)return;
  if(!guide[id])guide[id]=[];
  guide[id].push([start,stop,name,epgClock(startRaw),epgClock(stopRaw)]);
}
let buffer='',count=0;
const stream=createReadStream(resolve(root,'epg-tv.xml.gz')).pipe(createGunzip());
for await(const bytes of stream){
  buffer+=decoder.decode(bytes,{stream:true});
  for(;;){
    const at=buffer.search(/<programme(?=[\s>])/i);
    if(at<0){
      if(buffer.length>128)buffer=buffer.slice(-128);
      break;
    }
    if(at>0)buffer=buffer.slice(at);
    const end=/<\/programme\s*>/i.exec(buffer);
    if(!end){if(buffer.length>4*1024*1024)throw Error('Large EPG programme');break;}
    const size=end.index+end[0].length;
    parse(buffer.slice(0,size));buffer=buffer.slice(size);count++;
  }
}
const trimmed=Object.create(null);
for(const id of Object.keys(guide)){
  const list=guide[id].sort((a,b)=>a[0]-b[0]);
  const current=list.findIndex(p=>p[0]<=now&&p[1]>now);
  const future=list.findIndex(p=>p[0]>now);
  const offset=current>=0?current:(future>=0?future:0);
  trimmed[id]=list.slice(offset,offset+160);
}
await writeFile(resolve(output,'guide.json'),JSON.stringify({generatedAt:Date.now(),programmes:trimmed}));
console.log('[AQUA FAST] '+channels.length+' channels, '+count+' XMLTV entries scanned, '+Object.keys(trimmed).length+' TV schedules');
