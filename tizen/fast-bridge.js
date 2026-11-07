/* Small Tizen AVPlay adapter for AQUA TV FAST, ES5. */
(function(){
'use strict';
var player=window.webapis&&window.webapis.avplay;
var lastRect=[0,0,1920,1080],generation=0,hasRect=false;
var activeUrl='',openedAt=0,bufferingAt=0,lastMediaTime=null,lastProgressAt=0;
var observedProgress=false,retries=0,reconnectTimer=null;
// Live streams sometimes expose no advancing playback clock. In that case
// recover only on explicit errors, sustained buffering, or failed preparation.
var WATCHDOG_INTERVAL=4000,STALL_AFTER=22000,BUFFER_AFTER=25000,PREPARE_AFTER=40000;
function clearReconnect(){if(reconnectTimer!==null){clearTimeout(reconnectTimer);reconnectTimer=null;}}
function observeTime(value){
 var time=Number(value),now=Date.now();
 if(!isFinite(time)||time<0)return;
 if(lastMediaTime!==null && (time>lastMediaTime+150 || time<lastMediaTime-2000)){
   observedProgress=true;
   lastProgressAt=now;
   // A brief network pause recovered by itself: don't restart a healthy stream.
   clearReconnect();
 }
 lastMediaTime=time;
}
function scheduleReconnect(reason){
 if(!activeUrl||reconnectTimer!==null)return;
 var url=activeUrl,token=generation;
 retries=Math.min(8,retries+1);
 var delay=Math.min(60000,2000*Math.pow(2,retries-1));
 status('reconnecting',reason);
 reconnectTimer=setTimeout(function(){
   reconnectTimer=null;
   if(token===generation&&activeUrl===url)play(url,true);
 },delay);
}
function watchPlayback(){
 if(!player||!activeUrl||reconnectTimer!==null)return;
 if(typeof document.hidden==='boolean'&&document.hidden)return;
 var now=Date.now(),state='';
 try{state=player.getState();}catch(ignore){return;}
 if(state==='PLAYING'){
   try{observeTime(player.getCurrentTime());}catch(ignore){}
 }
 if(bufferingAt&&now-bufferingAt>BUFFER_AFTER){
   scheduleReconnect('Buffering longer than 25 seconds');return;
 }
 if(state==='PLAYING'&&!bufferingAt&&observedProgress&&lastProgressAt&&now-lastProgressAt>STALL_AFTER){
   scheduleReconnect('Playback time stopped advancing');return;
 }
 if((state==='IDLE'||state==='READY'||state==='NONE'||state==='PAUSED')&&now-openedAt>PREPARE_AFTER){
   scheduleReconnect('AVPlay remained in '+state);return;
 }
 if(state==='PLAYING'&&!bufferingAt&&observedProgress&&now-lastProgressAt<8000&&now-openedAt>60000){
   retries=0;
 }
}
var watchdog=setInterval(watchPlayback,WATCHDOG_INTERVAL);
var host='31.41.12.104';
function status(type,message,w,h){if(window.AquaFast&&window.AquaFast.onStatus)window.AquaFast.onStatus(type,message||'',w||0,h||0);}
function resolution(){try{var tracks=player.getCurrentStreamInfo();for(var i=0;i<tracks.length;i++){if(String(tracks[i].type).toUpperCase().indexOf('VIDEO')<0)continue;var p=JSON.parse(tracks[i].extra_info),w=Number(p.Width||p.width||0),h=Number(p.Height||p.height||0);if(w>0&&h>0){status('resolution','',w,h);return;}}}catch(e){}}
function rect(m){
 var width=Number(m.viewportWidth)||document.documentElement.clientWidth||1920;
 var height=Number(m.viewportHeight)||document.documentElement.clientHeight||1080;
 var x=Math.max(0,Math.round(Number(m.x)*1920/width)),y=Math.max(0,Math.round(Number(m.y)*1080/height));
 var w=Math.max(1,Math.min(1920-x,Math.round(Number(m.width)*1920/width)));
 var h=Math.max(1,Math.min(1080-y,Math.round(Number(m.height)*1080/height)));
 var n=[x,y,w,h];if(hasRect&&n.join(',')===lastRect.join(','))return;
 lastRect=n;hasRect=true;
 var surface=document.getElementById('avplayObject');
 if(surface){surface.style.left=Number(m.x)+'px';surface.style.top=Number(m.y)+'px';surface.style.width=Number(m.width)+'px';surface.style.height=Number(m.height)+'px';}
 try{player.setDisplayRect(x,y,w,h);}catch(e){status('error',String(e));}
}
function play(url,retrying){
 var a=document.createElement('a');a.href=url;
 if((a.protocol!=='http:'&&a.protocol!=='https:')||a.hostname!==host){status('error','Запрещённый сервер');return;}
 if(!player){status('error','AVPlay отсутствует');return;}
 clearReconnect();
 if(!retrying)retries=0;
 activeUrl=url;openedAt=Date.now();bufferingAt=0;lastMediaTime=null;
 lastProgressAt=0;observedProgress=false;
 var token=++generation;
 try{player.stop();}catch(e){}try{player.close();}catch(e){}
 try{
   player.open(url);
   player.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
   player.setListener({
     onbufferingstart:function(){
       if(token!==generation)return;
       if(!bufferingAt)bufferingAt=Date.now();
       status('buffering');
     },
     onbufferingcomplete:function(){
       if(token!==generation)return;
       bufferingAt=0;resolution();status('playing');
     },
     oncurrentplaytime:function(time){if(token===generation)observeTime(time);},
     onstreamplayready:function(){if(token===generation)resolution();},
     onerror:function(e){
       if(token!==generation)return;
       status('error',String(e));scheduleReconnect('AVPlay error');
     },
     onstreamcompleted:function(){
       if(token!==generation)return;
       status('error','Трансляция завершена');scheduleReconnect('Stream completed');
     },
     onevent:function(e){if(token===generation&&String(e).indexOf('RESOLUTION_CHANGED')>=0)resolution();}
   });
   player.prepareAsync(function(){
     if(token!==generation)return;
     try{
       player.setDisplayRect(lastRect[0],lastRect[1],lastRect[2],lastRect[3]);
       player.play();resolution();status('playing');
     }catch(e){status('error',String(e));scheduleReconnect('Play failed');}
   },function(e){
     if(token!==generation)return;
     status('error',String(e));scheduleReconnect('Prepare failed');
   });
 }catch(e){
   if(token!==generation)return;
   status('error',String(e));scheduleReconnect('Open failed');
 }
}
window.AquaBridge={postMessage:function(json){
 var m;try{m=JSON.parse(json);}catch(e){return;}
 if(m.type==='play')play(m.url);
 else if(m.type==='rect')rect(m);
 else if(m.type==='exit'){try{tizen.application.getCurrentApplication().exit();}catch(e){window.close();}}
}};
document.addEventListener('keydown',function(e){
 if(e.keyCode!==10009&&e.keyCode!==27)return;
 e.preventDefault();e.stopPropagation();
 if(window.AquaFast)window.AquaFast.key('Escape');
},true);
window.addEventListener('beforeunload',function(){activeUrl='';generation++;clearReconnect();clearInterval(watchdog);try{player.close();}catch(e){}});
})();