(function(){
'use strict';
var base='https://bullet2013.github.io/aqua-tv/';
var channels=[],guide={},groups=[],active=0,focus=0,zone='channels',chosenGroup='Все',menu=false,showGuide=false,popup=false,shows=[],showFocus=0,osdTimer=null,descriptionToken=0,videoSize='';
var $=function(id){return document.getElementById(id);};
var el=$;
// Older widgets keep the OSD inside #full. Move it once at startup so its
// viewport positioning never depends on that legacy container's geometry.
var osd=$('osd');
if(osd&&osd.parentNode!==document.body)document.body.appendChild(osd);
var tv=!!(window.webapis && window.webapis.avplay);
var fontPx=18,settings=false,fontOptions=[14,16,18,20,22,24,26,28,30,32,34,36,38,40],fontSelected=2;
try {fontPx=Number(localStorage.getItem('aqua-fast-font'))||18;}catch(ignore){}
function applyFont(){fontPx=Math.max(14,Math.min(40,fontPx));document.documentElement.style.fontSize=fontPx+'px';document.body.style.setProperty('--tv-font',fontPx+'px');if(osd)osd.style.height=Math.max(192,192+(fontPx-18)*6)+'px';}
applyFont();
function openSettings(){settings=true;menu=false;hide('categories');fontSelected=Math.max(0,fontOptions.indexOf(fontPx));renderSettings();visible('fontSettings');}
function renderSettings(){var p=$('fontChoices');p.innerHTML='';for(var i=0;i<fontOptions.length;i++){var a=add(p,'div','font-choice'+(i===fontSelected?' selected':''),fontOptions[i]+' px');a.setAttribute('data-font',String(fontOptions[i]));}}
function chooseFont(){fontPx=fontOptions[fontSelected];applyFont();try{localStorage.setItem('aqua-fast-font',String(fontPx));}catch(ignore){}settings=false;hide('fontSettings');}

function hide(n){$(n).className='hidden';}
function visible(n){$(n).className='';}
function text(n,val){if($(n).textContent!==String(val))$(n).textContent=String(val);}
function request(url,done,fail){var x=new XMLHttpRequest();x.open('GET',url,true);x.timeout=20000;x.onreadystatechange=function(){if(x.readyState===4){if(x.status===200)done(x.responseText);else if(fail)fail('HTTP '+x.status);}};x.ontimeout=function(){if(fail)fail('Timeout');};x.send();}
function fetchJson(url,done,fail){request(url,function(raw){try{done(JSON.parse(raw));}catch(e){if(fail)fail('Invalid JSON');}},fail);}
function contains(list,id){return list.indexOf(id)>=0;}
function list(){return chosenGroup==='Все'?channels:channels.filter(function(x){return x.group===chosenGroup;});}
function current(ch){var arr=guide[ch&&ch.id]||[],now=Date.now();for(var i=0;i<arr.length;i++)if(arr[i][0]<=now&&arr[i][1]>now)return arr[i];return null;}
function next(ch){var arr=guide[ch&&ch.id]||[],now=Date.now();for(var i=0;i<arr.length;i++)if(arr[i][0]>now)return arr[i];return null;}
function fmt(ms){var d=new Date(ms);return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);}
function make(tag,cls){var e=document.createElement(tag);if(cls)e.className=cls;return e;}
function add(parent,tag,cls,value){var e=make(tag,cls);if(value!==undefined)e.textContent=value;parent.appendChild(e);return e;}
function channelIdx(ch){return channels.indexOf(ch);}
function allRows(){
  var parent=$('rows');parent.innerHTML='';
  var arr=list(),chunk=document.createDocumentFragment();
  for(var i=0;i<arr.length;i++){
    var c=arr[i],r=make('div','row'),logo=add(r,'img','logo');
    logo.src=c.logo||'';logo.onerror=function(){this.style.visibility='hidden';};
    add(r,'span','channel-name',c.name);
    // A single flex row: icon, channel, now, next, progress (fixed widths).
    var epg=add(r,'div','row-epg-combined');add(epg,'span','row-epg-marquee','');
    var track=add(r,'div','row-epg-track');add(track,'div','row-epg-fill');
    r.setAttribute('data-id',String(channelIdx(c)));chunk.appendChild(r);
  }
  parent.appendChild(chunk);updateRows(true);
}
function updateRows(scroll){
  var arr=list(),nodes=$('rows').children,now=Date.now();
  for(var i=0;i<nodes.length;i++){
    var c=arr[i],r=nodes[i],p=current(c),n=next(c);
    var combined=(p?p[2]:'Нет программы')+'  ·  '+(n?n[2]:'—');
    var currentText=r.children[2].firstChild,fill=r.children[3].firstChild;
    if(currentText.textContent!==combined){currentText.textContent=combined;currentText.title=combined;}
    var pct=p?Math.max(0,Math.min(100,100*(now-p[0])/(p[1]-p[0]))):0;
    var width=pct.toFixed(0)+'%';
    if(fill.style.width!==width)fill.style.width=width;
    var className='row'+(channelIdx(c)===focus?' selected':'')+(channelIdx(c)===active?' playing':'')+(channelIdx(c)===focus&&zone==='programmes'?' programme-focus':'');
    if(r.className!==className)r.className=className;
  }
  if(scroll){var idx=arr.indexOf(channels[focus]);if(idx>=0&&nodes[idx]){var n=nodes[idx],s=$('rows');var top=n.offsetTop;if(top<s.scrollTop)s.scrollTop=top;else if(top+n.offsetHeight>s.scrollTop+s.clientHeight)s.scrollTop=top+n.offsetHeight-s.clientHeight;}}
}
function navFocus(){
  var nodes=$('rows').children,arr=list();
  for(var i=0;i<nodes.length;i++)nodes[i].className='row'+(channelIdx(arr[i])===focus?' selected':'')+(channelIdx(arr[i])===active?' playing':'')+(channelIdx(arr[i])===focus&&zone==='programmes'?' programme-focus':'');
  var idx=arr.indexOf(channels[focus]);
  if(idx>=0&&nodes[idx]){
    var node=nodes[idx],pane=$('rows'),top=node.offsetTop;
    if(top<pane.scrollTop)pane.scrollTop=top;
    else if(top+node.offsetHeight>pane.scrollTop+pane.clientHeight)pane.scrollTop=top+node.offsetHeight-pane.clientHeight;
  }
}
function categoryMenu(){
  // The highlighted item is the remote cursor, not the saved category.
  var parent=$('cats');parent.innerHTML='';
  for(var i=0;i<groups.length;i++){
    var node=add(parent,'div','cat'+(i===catFocus?' active':''),groups[i]);
    node.setAttribute('data-group',groups[i]);
    node.setAttribute('aria-selected',String(i===catFocus));
  }
  var entry=add(parent,'div','cat settings-entry'+(catFocus===groups.length?' active':''),'⚙ Размер шрифта');
  entry.setAttribute('data-settings','true');
  entry.setAttribute('aria-selected',String(catFocus===groups.length));
}
function renderRight(){
  var c=channels[focus];if(!c)return;
  var p=current(c);
  text('current',(p?p[2]+' · '+fmt(p[0])+'–'+fmt(p[1]):'Нет программы')+'  ★');
  shows=[];var entries=guide[c.id]||[],now=Date.now();
  for(var i=0;i<entries.length&&shows.length<10;i++)if(entries[i][0]>now)shows.push(entries[i]);
  var parent=$('upcoming');parent.innerHTML='';
  for(i=0;i<shows.length;i++){var item=make('div','show-row'+(zone==='programmes'&&showFocus===i+1?' selected':''));add(item,'span','time',fmt(shows[i][0]));add(item,'span','',shows[i][2]);item.setAttribute('data-index',String(i+1));parent.appendChild(item);}
  updateProgrammeFocus();
}
function updateProgrammeFocus(){
  navFocus();
  $('current').style.background=zone==='programmes'&&showFocus===0?'#aadfff':'#e5f4fc';
  var nodes=$('upcoming').children;for(var i=0;i<nodes.length;i++)nodes[i].className='show-row'+(zone==='programmes'&&showFocus===i+1?' selected':'');
  if(zone==='programmes'&&showFocus>0&&nodes[showFocus-1]){
    var n=nodes[showFocus-1],p=$('upcoming');if(n.offsetTop+n.offsetHeight>p.scrollTop+p.clientHeight)p.scrollTop=n.offsetTop+n.offsetHeight-p.clientHeight;else if(n.offsetTop<p.scrollTop)p.scrollTop=n.offsetTop;
  }
}
function programme(){return showFocus===0?current(channels[focus]):shows[showFocus-1];}
function descHash(id){var h=2166136261;for(var i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);return (h>>>0).toString(16);}
function details(){
  var c=channels[focus],p=programme();if(!p)return;
  popup=true;document.body.classList.add('popup-active');visible('details');text('detailTitle',p[2]);text('detailTime',fmt(p[0])+'–'+fmt(p[1])+' · '+c.name);text('detailBody','Загружаем описание…');
  var token=++descriptionToken,id=c.id,key=p[0]+'|'+p[1];
  fetchJson(base+'epg-tv-descriptions/'+descHash(id)+'.json',function(d){if(token!==descriptionToken||!popup)return;text('detailBody',d.id===id&&d.programmes&&d.programmes[key]?decodeXml(d.programmes[key]):'Описание отсутствует.');},function(){if(token===descriptionToken&&popup)text('detailBody','Описание недоступно.');});
}
function decodeXml(str){var t=document.createElement('textarea');t.innerHTML=str;return t.value;}
function logoOsd(c){var area=$('osdLogo');area.innerHTML='';var i=add(area,'img','');i.src=c.logo||'';i.onerror=function(){this.style.display='none';};}
function info(){
  var c=channels[active];if(!c)return;
  text('osdName',c.name);var p=current(c),n=next(c);
  text('osdNow',p?p[2]:'Нет данных EPG');text('osdNext','Далее: '+(n?n[2]:'нет данных'));
  if(p){var time=Date.now(),width=Math.round(Math.max(0,Math.min(100,100*(time-p[0])/(p[1]-p[0]))));$('osdProgress').style.width=width+'%';text('osdLeft',Math.ceil(Math.max(0,p[1]-time)/60000)+' мин');}else{$('osdProgress').style.width='0%';text('osdLeft','');}
}
function showOsd(){
  // Keep the OSD visible in fullscreen. The old five-second timeout made
  // users think it was missing and hid the stream resolution entirely.
  info();
  if(osdTimer){clearTimeout(osdTimer);osdTimer=null;}
  $('osd').className='show';
}
function rect(){
  var preview=showGuide?$('preview'):null;
  var vw=document.documentElement.clientWidth||1920,vh=document.documentElement.clientHeight||1080;
  if(showGuide){
    var x=preview.getBoundingClientRect();
    send({type:'rect',x:x.left,y:x.top,width:x.width,height:x.height,viewportWidth:vw,viewportHeight:vh,visible:true});
  }else send({type:'rect',x:0,y:0,width:vw,height:vh,viewportWidth:vw,viewportHeight:vh,visible:true});
}
function send(message){if(window.AquaBridge&&window.AquaBridge.postMessage)window.AquaBridge.postMessage(JSON.stringify(message));}
function mode(open){
  if(showGuide===open)return;
  showGuide=open;
  $('guide').className=open?'':'hidden';
  $('full').className=open?'hidden':'';
  if(open){$('osd').className='';zone='channels';menu=false;hide('categories');navFocus();}
  else showOsd();
  // No DOM reparenting. Never rebuild channels/EPG here.
  rect();
}
function tune(index){
  if(index<0||!channels[index])return;
  var changed=active!==index;
  active=index;focus=index;
  try{localStorage.setItem('aqua-fast-channel',String(index));}catch(e){}
  logoOsd(channels[index]);if(changed||!tune.started){tune.started=true;send({type:'play',url:channels[index].url});}
  if(showGuide){navFocus();renderRight();}else showOsd();
}
function back(){
  if(settings){settings=false;hide('fontSettings');return;}
  if(popup){popup=false;descriptionToken++;document.body.classList.remove('popup-active');hide('details');return;}
  if(menu){menu=false;hide('categories');return;}
  if(showGuide){send({type:'exit'});return;}
  mode(true);
}
function key(k){
  if(k==='Escape'||k==='Backspace'||k==='Back'){back();return;}
  if(settings){if(k==='ArrowLeft'||k==='ArrowRight'){fontSelected=(fontSelected+(k==='ArrowRight'?1:-1)+fontOptions.length)%fontOptions.length;renderSettings();}else if(k==='Enter'){chooseFont();}return;}
  if(k==='Enter'){
    if(popup){back();return;}
    if(!showGuide){mode(true);return;}
    if(menu){if(catFocus===groups.length){openSettings();return;}chosenGroup=groups[catFocus];menu=false;hide('categories');focus=channelIdx(list()[0]);allRows();renderRight();return;}
    if(zone==='channels'){tune(focus);mode(false);return;}
    details();return;
  }
  if(k==='ArrowLeft'){
    if(!showGuide){showOsd();return;}
    if(popup)return;
    if(zone==='programmes'){zone='channels';updateProgrammeFocus();return;}
    menu=true;catFocus=Math.max(0,groups.indexOf(chosenGroup));categoryMenu();visible('categories');return;
  }
  if(k==='ArrowRight'){
    if(!showGuide||popup||menu)return;
    zone='programmes';showFocus=0;updateProgrammeFocus();return;
  }
  if(k==='ArrowUp'||k==='ArrowDown'){
    if(popup)return;
    var d=k==='ArrowDown'?1:-1;
    if(!showGuide){var id=(active+d+channels.length)%channels.length;tune(id);return;}
    if(menu){catFocus=(catFocus+d+groups.length+1)%(groups.length+1);categoryMenu();return;}
    if(zone==='channels'){
      var arr=list(),index=arr.indexOf(channels[focus]);
      focus=channelIdx(arr[(index+d+arr.length)%arr.length]);navFocus();renderRight();
    }else{showFocus=Math.max(0,Math.min(shows.length,showFocus+d));updateProgrammeFocus();}
  }
}
var catFocus=0;
window.AquaFast={key:key,onStatus:function(type,msg,w,h){
  if((type==='resolution'||type==='playing')&&w>0&&h>0){videoSize=w+' × '+h;text('resolution',videoSize);}
  if(type==='error')console.warn('AVPlay:',msg);
}};
document.addEventListener('keydown',function(e){var k=e.key;if(k==='Esc')k='Escape';if(k==='Escape'||k==='Backspace'||k==='Enter'||k.indexOf('Arrow')===0){e.preventDefault();key(k);}});
window.addEventListener('resize',function(){rect();});
$('rows').addEventListener('click',function(e){var r=e.target;while(r&&r!==$('rows')&&!r.getAttribute('data-id'))r=r.parentNode;if(r&&r.getAttribute('data-id')){focus=Number(r.getAttribute('data-id'));mode(false);tune(focus);}});
$('current').addEventListener('click',function(){zone='programmes';showFocus=0;details();});
$('upcoming').addEventListener('click',function(e){var n=e.target;while(n&&n!==$('upcoming')&&!n.getAttribute('data-index'))n=n.parentNode;if(n&&n.getAttribute('data-index')){zone='programmes';showFocus=Number(n.getAttribute('data-index'));details();}});
$('full').addEventListener('click',function(){mode(true);});
$('osd').addEventListener('click',function(){mode(true);});
$('preview').addEventListener('click',function(){mode(false);});
function boot(){
  fetchJson(base+'tv-fast/channels.json',function(data){
    channels=data;groups=['Все'];for(var i=0;i<data.length;i++)if(!contains(groups,data[i].group))groups.push(data[i].group);
    try{active=Math.min(data.length-1,Math.max(0,Number(localStorage.getItem('aqua-fast-channel')||0)));}catch(e){active=0;}
    focus=active;logoOsd(data[active]);allRows();renderRight();
    $('loading').className='hidden';rect();tune(active);
    // EPG is fetched AFTER the interface becomes usable.
    fetchJson(base+'tv-fast/guide.json',function(d){
      guide=d.programmes||{};updateRows(false);renderRight();if(!showGuide)info();
    },function(e){text('current','Ошибка EPG: '+e);});
  },function(error){text('loading','Ошибка плейлиста: '+error);});
}
$('fontChoices').addEventListener('click',function(e){var node=e.target;while(node&&node!==$('fontChoices')&&!node.getAttribute('data-font'))node=node.parentNode;if(node&&node.getAttribute('data-font')){fontSelected=fontOptions.indexOf(Number(node.getAttribute('data-font')));chooseFont();}});
setInterval(function(){if(!channels.length)return;if(showGuide){updateRows(false);}else{info();}},15000);
boot();
})();
