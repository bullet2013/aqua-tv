(function(){
'use strict';
var base='https://bullet2013.github.io/aqua-tv/';
var channels=[],guide={},groups=[],active=0,focus=0,zone='channels',chosenGroup='Все',menu=false,showGuide=false,popup=false,shows=[],showFocus=0,osdTimer=null,descriptionToken=0,videoSize='',rightProgrammeSignature='';
var pageStart=0,pageSize=0,pageGroup='',cachedGroup='',cachedList=null;
var $=function(id){return document.getElementById(id);};
var el=$;
// Older widgets keep the OSD inside #full. Move it once at startup so its
// viewport positioning never depends on that legacy container's geometry.
var osd=$('osd');
if(osd&&osd.parentNode!==document.body)document.body.appendChild(osd);
var tv=!!(window.webapis && window.webapis.avplay);
var marqueeSpeed=65,marqueeDelay=1800,marqueeTimer=null,marqueeFrame=null,marqueeStart=0,marqueeLast=0,marqueeOffset=0,marqueeDirection=-1,marqueeNode=null,marqueeOverflow=0;
try{marqueeSpeed=Number(localStorage.getItem('aqua-fast-scroll-speed'))||65;}catch(ignore){}
var speedOptions=[35,65,105],speedNames=['Медленно','Нормально','Быстро'];
function speedIndex(){var idx=0,diff=Infinity;for(var i=0;i<speedOptions.length;i++){var n=Math.abs(speedOptions[i]-marqueeSpeed);if(n<diff){diff=n;idx=i;}}return idx;}
marqueeSpeed=speedOptions[speedIndex()];
var settingsSection=0,marqueePauseUntil=0,showNextInList=true;
try{showNextInList=localStorage.getItem('aqua-fast-show-next')!=='no';}catch(ignore){}
var fontPx=18,settings=false,fontOptions=[14,16,18,20,22,24,26,28,30,32,34,36,38,40],fontSelected=2;
try {fontPx=Number(localStorage.getItem('aqua-fast-font'))||18;}catch(ignore){}
function resizeOsd(){
  var panel=$('osd'),block=$('osdText');if(!panel||!block)return;
  // Reserve enough vertical space for every text line and the progress bar.
  var line=Math.ceil(fontPx*1.5),required=10+line*3+28+4+12+14;
  // CSS in the installed widget sets height:156px!important. Normal inline
  // style.height loses to it, so the calculated height MUST be important too.
  var viewport=document.documentElement.clientHeight||window.innerHeight||1080;
  panel.style.setProperty('height',Math.min(viewport,Math.max(156,required))+'px','important');
  block.style.top='10px';block.style.bottom='12px';
}
function applyFont(){fontPx=Math.max(14,Math.min(40,fontPx));document.documentElement.style.fontSize=fontPx+'px';document.body.style.setProperty('--tv-font',fontPx+'px');resizeOsd();if(showGuide)ensureVisiblePage();}
applyFont();
function ensureSettingsUI(){
  // Installed Tizen widgets ship an older HTML shell; create the new controls in JS.
  var panel=$('fontSettings');if(!panel)return;
  var heading=panel.querySelector('h2');if(heading)heading.textContent='Настройки';
  var choices=$('fontChoices');if(!choices)return;
  var fontRow=$('fontSettingRow');
  if(!fontRow){fontRow=make('div','font-setting-row');fontRow.id='fontSettingRow';var title=add(fontRow,'h3','','Размер шрифта');choices.parentNode.insertBefore(fontRow,choices);fontRow.appendChild(choices);}
  var speedRow=$('scrollSpeedRow');
  if(!speedRow){speedRow=make('div','speed-row');speedRow.id='scrollSpeedRow';speedRow.appendChild(document.createTextNode('Скорость прокрутки: '));var value=add(speedRow,'strong','','Нормально');value.id='scrollSpeedValue';}
  if(fontRow.nextSibling!==speedRow)panel.insertBefore(speedRow,fontRow.nextSibling);
  // The preinstalled Tizen shell may not contain this new settings row.
  var nextRow=$('showNextRow');
  if(!nextRow){
    nextRow=make('div','show-next-row');nextRow.id='showNextRow';
    nextRow.appendChild(document.createTextNode('Отображать следующую передачу в списке каналов: '));
    var nextValue=add(nextRow,'strong','','Да');nextValue.id='showNextValue';
  }
  if(speedRow.nextSibling!==nextRow)panel.insertBefore(nextRow,speedRow.nextSibling);
  var hint=panel.querySelector('small');if(hint)hint.textContent='↑ / ↓ — параметр · ← / → — изменение · OK — применить · Назад — закрыть';
}
function openSettings(){ensureSettingsUI();settings=true;settingsSection=0;menu=false;hide('categories');fontSelected=Math.max(0,fontOptions.indexOf(fontPx));renderSettings();visible('fontSettings');updateSpeedLabel();updateShowNextLabel();updateSettingsFocus();}
function updateSettingsFocus(){var row=$('scrollSpeedRow');if(row)row.className='speed-row'+(settingsSection===1?' active':'');var title=$('fontSettingRow');if(title)title.className='font-setting-row'+(settingsSection===0?' active':'');var next=$('showNextRow');if(next)next.className='show-next-row'+(settingsSection===2?' active':'');}
function renderSettings(){var p=$('fontChoices');p.innerHTML='';for(var i=0;i<fontOptions.length;i++){var a=add(p,'div','font-choice'+(i===fontSelected?' selected':''),fontOptions[i]+' px');a.setAttribute('data-font',String(fontOptions[i]));if(i===fontSelected){var item=a;}}if(item){var left=item.offsetLeft-p.offsetLeft;p.scrollLeft=Math.max(0,left-(p.clientWidth-item.offsetWidth)/2);}}
function updateSpeedLabel(){var x=$('scrollSpeedValue');if(x)x.textContent=speedNames[speedIndex()];}
function setSpeed(delta){marqueeSpeed=speedOptions[Math.max(0,Math.min(2,speedIndex()+(delta>0?1:-1)))];try{localStorage.setItem('aqua-fast-scroll-speed',String(marqueeSpeed));}catch(ignore){}updateSpeedLabel();}
function updateShowNextLabel(){var node=$('showNextValue');if(node)node.textContent=showNextInList?'Да':'Нет';}
function setShowNext(value){
  if(showNextInList===value)return;
  showNextInList=value;
  try{localStorage.setItem('aqua-fast-show-next',value?'yes':'no');}catch(ignore){}
  updateShowNextLabel();
  stopMarquee();
  if(showGuide)updateRows();
}
function chooseFont(){fontPx=fontOptions[fontSelected];applyFont();try{localStorage.setItem('aqua-fast-font',String(fontPx));}catch(ignore){}settings=false;hide('fontSettings');}

function hide(n){$(n).className='hidden';}
function visible(n){$(n).className='';}
function text(n,val){if($(n).textContent!==String(val))$(n).textContent=String(val);}
function request(url,done,fail){var x=new XMLHttpRequest();x.open('GET',url,true);x.timeout=20000;x.onreadystatechange=function(){if(x.readyState===4){if(x.status===200)done(x.responseText);else if(fail)fail('HTTP '+x.status);}};x.ontimeout=function(){if(fail)fail('Timeout');};x.send();}
function fetchJson(url,done,fail){request(url,function(raw){try{done(JSON.parse(raw));}catch(e){if(fail)fail('Invalid JSON');}},fail);}
function contains(list,id){return list.indexOf(id)>=0;}
function list(){if(cachedList&&cachedGroup===chosenGroup)return cachedList;cachedGroup=chosenGroup;cachedList=chosenGroup==='Все'?channels:channels.filter(function(x){return x.group===chosenGroup;});return cachedList;}
function current(ch){var arr=guide[ch&&ch.id]||[],now=Date.now();for(var i=0;i<arr.length;i++)if(arr[i][0]<=now&&arr[i][1]>now)return arr[i];return null;}
function next(ch){var arr=guide[ch&&ch.id]||[],now=Date.now();for(var i=0;i<arr.length;i++)if(arr[i][0]>now)return arr[i];return null;}
function remaining(ms){var mins=Math.ceil(Math.max(0,ms)/60000),hours=Math.floor(mins/60),rest=mins%60;return hours?(hours+'ч.'+(rest?' '+rest+'мин.':'')):(mins+'мин.');}
function fmt(ms){var d=new Date(ms);return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);}
function make(tag,cls){var e=document.createElement(tag);if(cls)e.className=cls;return e;}
function add(parent,tag,cls,value){var e=make(tag,cls);if(value!==undefined)e.textContent=value;parent.appendChild(e);return e;}
function channelIdx(ch){return channels.indexOf(ch);}
function syncCategoryHeader(){
  var panel=$('channels'),rows=$('rows'),header=$('channelCategoryHeader');
  if(!panel||!rows)return;
  if(!header){header=make('div','channel-category-header');header.id='channelCategoryHeader';panel.insertBefore(header,rows);}
  var label='Категория: '+chosenGroup;
  if(header.textContent!==label)header.textContent=label;
}
// The list is rendered one screen at a time. Only channels on the visible
// page get DOM nodes and logo requests; no scroll animation between pages.
function pageCapacity(){
  var pane=$('rows');
  if(!pane||!showGuide||pane.clientHeight<=0)return 0;
  var row=pane.firstChild,temporary=false;
  if(!row){row=make('div','row');pane.appendChild(row);temporary=true;}
  var height=row.offsetHeight||50;
  if(temporary)pane.removeChild(row);
  return Math.max(1,Math.floor(pane.clientHeight/height));
}
function renderPage(arr){
  var parent=$('rows'),chunk=document.createDocumentFragment();
  stopMarquee();
  parent.innerHTML='';
  parent.scrollTop=0;
  for(var i=pageStart;i<Math.min(arr.length,pageStart+pageSize);i++){
    var c=arr[i],r=make('div','row'),logo=add(r,'img','logo');
    // Setting src only here avoids network requests for off-page logos.
    logo.src=c.logo||'';logo.onerror=function(){this.style.visibility='hidden';};
    add(r,'span','channel-name',c.name);
    var epg=add(r,'div','row-epg-combined'),marquee=add(epg,'span','row-epg-marquee','');
    add(marquee,'span','epg-current','');
    add(marquee,'span','epg-separator','  ·  ');
    add(marquee,'span','epg-following','');
    var track=add(r,'div','row-epg-track');
    add(track,'div','row-epg-fill');
    r.setAttribute('data-id',String(channelIdx(c)));
    chunk.appendChild(r);
  }
  parent.appendChild(chunk);
  updateRows();
}
function ensureVisiblePage(force){
  if(!showGuide)return false;
  var arr=list(),capacity=pageCapacity();
  if(!capacity)return false;
  var pos=arr.indexOf(channels[focus]);
  if(pos<0&&arr.length){pos=0;focus=channelIdx(arr[0]);}
  var first=pos>=0?Math.floor(pos/capacity)*capacity:0;
  var expected=Math.max(0,Math.min(capacity,arr.length-first));
  if(force||pageGroup!==chosenGroup||pageSize!==capacity||pageStart!==first||$('rows').children.length!==expected){
    pageStart=first;pageSize=capacity;pageGroup=chosenGroup;
    renderPage(arr);
    return true;
  }
  return false;
}
function allRows(){
  syncCategoryHeader();
  stopMarquee();
  pageSize=0;pageStart=0;pageGroup='';
  $('rows').innerHTML='';
  // The guide is hidden at startup. Defer even the first logo until opened.
  ensureVisiblePage(true);
}
function updateRows(){
  var arr=list(),nodes=$('rows').children,now=Date.now();
  for(var i=0;i<nodes.length;i++){
    var c=arr[pageStart+i],r=nodes[i];
    if(!c)continue;
    var p=current(c),n=next(c);
    var currentText=r.children[2].firstChild,fill=r.children[3].firstChild;
    var nowText=p?p[2]:'Нет программы',nextText=n?n[2]:'—';
    if(currentText.children[0].textContent!==nowText)currentText.children[0].textContent=nowText;
    var following=showNextInList?nextText:'';
    var separator=showNextInList?'  ·  ':'';
    if(currentText.children[1].textContent!==separator)currentText.children[1].textContent=separator;
    if(currentText.children[2].textContent!==following)currentText.children[2].textContent=following;
    var pct=p?Math.max(0,Math.min(100,100*(now-p[0])/(p[1]-p[0]))):0;
    var width=pct.toFixed(0)+'%';
    if(fill.style.width!==width)fill.style.width=width;
    var className='row'+(c===channels[focus]?' selected':'')+(c===channels[active]?' playing':'');
    if(r.className!==className)r.className=className;
  }
  updateFocusMarquee();
}
function navFocus(){
  // A focus beyond the page boundary swaps to the next/previous page.
  if(ensureVisiblePage())return;
  var nodes=$('rows').children,arr=list();
  for(var i=0;i<nodes.length;i++){
    var c=arr[pageStart+i];
    if(!c)continue;
    var rowClass='row'+(c===channels[focus]?' selected':'')+(c===channels[active]?' playing':'');
    if(nodes[i].className!==rowClass)nodes[i].className=rowClass;
  }
  updateFocusMarquee();
}
function stopMarquee(){
  if(marqueeTimer){clearTimeout(marqueeTimer);marqueeTimer=null;}
  if(marqueeFrame){cancelAnimationFrame(marqueeFrame);marqueeFrame=null;}
  if(marqueeNode){marqueeNode.style.transition='none';marqueeNode.style.transform='translateX(0px)';}
  marqueeNode=null;marqueeOffset=0;marqueeDirection=-1;marqueePauseUntil=0;
}
function marqueeStep(time){
  if(!marqueeNode||!showGuide||zone!=='channels'){stopMarquee();return;}
  if(time<marqueePauseUntil){marqueeLast=time;marqueeFrame=requestAnimationFrame(marqueeStep);return;}
  if(!marqueeLast)marqueeLast=time;
  var dt=Math.min(80,time-marqueeLast);marqueeLast=time;
  marqueeOffset+=marqueeDirection*marqueeSpeed*dt/1000;
  if(marqueeOffset<=-marqueeOverflow){marqueeOffset=-marqueeOverflow;marqueeDirection=1;marqueePauseUntil=time+1300;}
  else if(marqueeOffset>=0){marqueeOffset=0;marqueeDirection=-1;marqueePauseUntil=time+1300;}
  marqueeNode.style.transform='translateX('+marqueeOffset+'px)';
  marqueeFrame=requestAnimationFrame(marqueeStep);
}
function updateFocusMarquee(){
  var arr=list(),idx=arr.indexOf(channels[focus])-pageStart;
  var row=idx>=0&&idx<pageSize?$('rows').children[idx]:null,node=row&&row.querySelector('.row-epg-marquee');
  if(zone!=='channels'||!showGuide||!node){stopMarquee();return;}
  if(marqueeNode===node)return;
  stopMarquee();marqueeNode=node;
  // Width of the entire unwrapped text, not the clipped flex item.
  var contentWidth=0,children=node.children;
  for(var j=0;j<children.length;j++)contentWidth+=children[j].getBoundingClientRect().width;
  marqueeOverflow=Math.max(0,Math.ceil(contentWidth-node.parentNode.clientWidth+8));
  node.style.setProperty('animation','none','important');
  node.style.setProperty('transition','none','important');
  if(!marqueeOverflow)return;
  marqueeTimer=setTimeout(function(){marqueeTimer=null;marqueeLast=0;marqueeFrame=requestAnimationFrame(marqueeStep);},marqueeDelay);
}
function categoryMenu(){
  // The highlighted item is the remote cursor, not the saved category.
  var parent=$('cats');parent.innerHTML='';
  for(var i=0;i<groups.length;i++){
    var node=add(parent,'div','cat'+(i===catFocus?' active':''),groups[i]);
    node.setAttribute('data-group',groups[i]);
    node.setAttribute('aria-selected',String(i===catFocus));
  }
  var entry=add(parent,'div','cat settings-entry'+(catFocus===groups.length?' active':''),'⚙ Настройки');
  entry.setAttribute('data-settings','true');
  entry.setAttribute('aria-selected',String(catFocus===groups.length));
}
function renderCurrentProgramme(p){
  var node=$('current');if(!node)return;
  var title=node.querySelector('.current-programme-title'),left=node.querySelector('.current-programme-left');
  if(!title){node.innerHTML='';title=add(node,'div','current-programme-title','');left=add(node,'div','current-programme-left','');}
  var name=p?p[2]:'Нет программы';if(title.textContent!==name)title.textContent=name;
  var remainingText=p?'Осталось '+remaining(p[1]-Date.now()):'';if(left.textContent!==remainingText)left.textContent=remainingText;
}
// Collect the current/next shows once. A stable signature prevents rebuilding
// the right panel on every 15-second progress-bar refresh.
function panelData(c){
  var p=current(c),entries=guide[c.id]||[],now=Date.now(),upcoming=[];
  for(var i=0;i<entries.length&&upcoming.length<10;i++)if(entries[i][0]>now)upcoming.push(entries[i]);
  var signature=c.id+'|'+(p?p[0]+'|'+p[1]+'|'+p[2]:'no-current');
  for(i=0;i<upcoming.length;i++)signature+='|'+upcoming[i][0]+'|'+upcoming[i][1]+'|'+upcoming[i][2];
  return {programme:p,upcoming:upcoming,signature:signature};
}
function renderRight(data){
  var c=channels[focus];if(!c)return;
  data=data||panelData(c);
  renderCurrentProgramme(data.programme);
  shows=data.upcoming;
  rightProgrammeSignature=data.signature;
  var parent=$('upcoming');parent.innerHTML='';
  for(var i=0;i<shows.length;i++){var item=make('div','show-row'+(zone==='programmes'&&showFocus===i+1?' selected':''));add(item,'span','time',fmt(shows[i][0]));add(item,'span','programme-name',shows[i][2]);item.setAttribute('data-index',String(i+1));parent.appendChild(item);}
  updateProgrammeFocus();
}
function updateProgrammeFocus(){
  document.body.classList.toggle('focus-programmes',zone==='programmes');
  navFocus();
  $('current').className=zone==='programmes'&&showFocus===0?'programme-selected':'';
  var nodes=$('upcoming').children;for(var i=0;i<nodes.length;i++)nodes[i].className='show-row'+(zone==='programmes'&&showFocus===i+1?' programme-selected':'');
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
  resizeOsd();
  if(p){var time=Date.now(),width=Math.round(Math.max(0,Math.min(100,100*(time-p[0])/(p[1]-p[0]))));$('osdProgress').style.width=width+'%';text('osdLeft',remaining(p[1]-time));}else{$('osdProgress').style.width='0%';text('osdLeft','');}
}
function showOsd(){
  // Keep the OSD visible in fullscreen. The old five-second timeout made
  // users think it was missing and hid the stream resolution entirely.
  info();
  if(osdTimer){clearTimeout(osdTimer);osdTimer=null;}
  $('osd').className='show';
  resizeOsd();
  osdTimer=setTimeout(function(){$('osd').className='';osdTimer=null;},5000);
}
function rect(){
  var preview=showGuide?$('preview'):null;
  if(preview){var w=preview.clientWidth;var h=Math.round(w*9/16);preview.style.height=h+'px';}
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
  if(!open)stopMarquee();
  if(open){
    $('osd').className='';
    zone='channels';showFocus=0;menu=false;
    document.body.classList.remove('focus-programmes');
    hide('categories');
    // Fullscreen channel changes alter focus without updating the hidden EPG.
    // Rebuild the channel category only if the tuned channel is filtered out.
    if(channels[focus]&&list().indexOf(channels[focus])<0){
      chosenGroup=channels[focus].group||'Все';
      allRows();
    }else{
      syncCategoryHeader();
      ensureVisiblePage();
      updateRows();
    }
    // Render both NOW and all UPCOMING entries for the actually tuned channel.
    // renderRight also refreshes row focus, so no second navFocus pass.
    renderRight();
  }
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
  if(showGuide){renderRight();}else showOsd();
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
  if(settings){
    if(k==='ArrowUp'||k==='ArrowDown'){
      settingsSection=Math.max(0,Math.min(2,settingsSection+(k==='ArrowDown'?1:-1)));
      updateSettingsFocus();return;
    }
    if(k==='ArrowLeft'||k==='ArrowRight'){
      if(settingsSection===1)setSpeed(k==='ArrowRight'?1:-1);
      else if(settingsSection===2)setShowNext(k==='ArrowRight');
      else{fontSelected=Math.max(0,Math.min(fontOptions.length-1,fontSelected+(k==='ArrowRight'?1:-1)));renderSettings();}
      return;
    }
    if(k==='Enter'){if(settingsSection===0){fontPx=fontOptions[fontSelected];applyFont();try{localStorage.setItem('aqua-fast-font',String(fontPx));}catch(ignore){}stopMarquee();updateFocusMarquee();}settings=false;hide('fontSettings');}
    return;
  }
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
    if(!showGuide||popup)return;
    if(menu){menu=false;hide('categories');zone='channels';navFocus();return;}
    zone='programmes';showFocus=0;updateProgrammeFocus();return;
  }
  if(k==='ArrowUp'||k==='ArrowDown'){
    if(popup)return;
    var d=k==='ArrowDown'?1:-1;
    if(!showGuide){var id=(active-d+channels.length)%channels.length;tune(id);return;}
    if(menu){catFocus=(catFocus+d+groups.length+1)%(groups.length+1);categoryMenu();return;}
    if(zone==='channels'){
      var arr=list(),index=arr.indexOf(channels[focus]);
      focus=channelIdx(arr[(index+d+arr.length)%arr.length]);renderRight();
    }else{showFocus=(showFocus+d+shows.length+1)%(shows.length+1);updateProgrammeFocus();}
  }
}
var catFocus=0;
window.AquaFast={key:key,onStatus:function(type,msg,w,h){
  if((type==='resolution'||type==='playing')&&w>0&&h>0){videoSize=w+' × '+h;text('resolution',videoSize);}
  if(type==='error')console.warn('AVPlay:',msg);
}};
document.addEventListener('keydown',function(e){var k=e.key;if(k==='Esc')k='Escape';if(k==='Escape'||k==='Backspace'||k==='Enter'||k.indexOf('Arrow')===0){e.preventDefault();key(k);}});
window.addEventListener('resize',function(){resizeOsd();if(showGuide)ensureVisiblePage();rect();});
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
    focus=active;cachedList=null;logoOsd(data[active]);syncCategoryHeader();
    $('loading').className='hidden';rect();tune(active);
    // EPG is fetched AFTER the interface becomes usable.
    fetchJson(base+'tv-fast/guide.json',function(d){
      guide=d.programmes||{};if(showGuide){ensureVisiblePage();updateRows();renderRight();}else if($('osd').className==='show')info();
    },function(e){text('current','Ошибка EPG: '+e);});
  },function(error){text('loading','Ошибка плейлиста: '+error);});
}
$('fontChoices').addEventListener('click',function(e){var node=e.target;while(node&&node!==$('fontChoices')&&!node.getAttribute('data-font'))node=node.parentNode;if(node&&node.getAttribute('data-font')){fontSelected=fontOptions.indexOf(Number(node.getAttribute('data-font')));chooseFont();}});
setInterval(function(){
  if(!channels.length)return;
  if(showGuide){
    ensureVisiblePage();
    updateRows();
    var c=channels[focus];
    if(!c)return;
    var data=panelData(c);
    // Programme boundaries refresh the complete right EPG, not only "now".
    if(data.signature!==rightProgrammeSignature)renderRight(data);
    else renderCurrentProgramme(data.programme);
  }else if($('osd').className==='show'){
    // The fullscreen infobar auto-hides in five seconds; don't update a
    // hidden OSD and repeatedly change its layout every fifteen seconds.
    info();
  }
},15000);
boot();
})();
