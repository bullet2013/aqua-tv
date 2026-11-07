/* Small Tizen AVPlay adapter for AQUA TV FAST, ES5. */
(function(){
'use strict';
var player=window.webapis&&window.webapis.avplay;
var lastRect=[0,0,1920,1080],generation=0,hasRect=false;
var activeUrl='',openedAt=0,bufferingAt=0,lastMediaTime=null,lastProgressAt=0;
var observedProgress=false,retries=0,reconnectTimer=null;
var debugEvents=[],lastSnapshotAt=0,recoveryPending=false,recoveryProgressCount=0,lastVideoResolution='';
function safeError(value){
  return String(value).replace(/https?:\/\/[^\s"'<>]+/gi,'[адрес скрыт]').slice(0,220);
}
function diagnostic(event,message){
  var line='[AQUA TV][AVPlay] '+new Date().toISOString()+' '+event+(message?' | '+message:'');
  debugEvents.push(line);
  if(debugEvents.length>150)debugEvents.shift();
  try{if(window.console&&console.log)console.log(line);}catch(ignore){}
}
function snapshot(){
  var state='UNKNOWN',time='недоступно';
  try{if(player)state=String(player.getState());}catch(ignore){}
  try{if(player)time=String(player.getCurrentTime());}catch(ignore){}
  return 'состояние='+state+', время='+time+', буферизация='+(bufferingAt?Math.round((Date.now()-bufferingAt)/1000)+'с':'нет')+
    ', ход времени='+(observedProgress?'обнаружен':'не подтверждён')+
    ', последняя активность='+(lastProgressAt?Math.round((Date.now()-lastProgressAt)/1000)+'с назад':'неизвестно')+
    ', попытки='+retries;
}
// Live streams sometimes expose no advancing playback clock. In that case
// recover only on explicit errors, sustained buffering, or failed preparation.
var WATCHDOG_INTERVAL=4000,STALL_AFTER=22000,BUFFER_AFTER=25000,PREPARE_AFTER=40000;
function clearReconnect(){if(reconnectTimer!==null){clearTimeout(reconnectTimer);reconnectTimer=null;}}
function observeTime(value){
 var time=Number(value),now=Date.now();
 if(!isFinite(time)||time<0)return;
 if(lastMediaTime!==null && (time>lastMediaTime+150 || time<lastMediaTime-2000)){
   var advanced=time>lastMediaTime+150;
   if(!observedProgress)diagnostic('PROGRESS_OK','Таймер потока начал двигаться');
   observedProgress=true;
   lastProgressAt=now;
   if(recoveryPending){
     // One discontinuity or residual clock tick is not proof of recovery.
     // Confirm two actual forward movements before cancelling a retry.
     recoveryProgressCount=advanced?recoveryProgressCount+1:0;
     if(recoveryProgressCount>=2){
       if(reconnectTimer!==null)diagnostic('RETRY_CANCELLED','Повторное подключение не понадобилось: подтверждено движение потока');
       clearReconnect();
       recoveryPending=false;recoveryProgressCount=0;
       diagnostic('RECOVERED','Два последовательных продвижения таймера; '+snapshot());
     }else if(recoveryProgressCount===1){
       diagnostic('RECOVERY_VERIFY','Первое продвижение таймера; ожидается подтверждение');
     }
   }else{
     clearReconnect();
   }
 }
 lastMediaTime=time;
}
function scheduleReconnect(reason){
 if(!activeUrl||reconnectTimer!==null)return;
 var url=activeUrl,token=generation;
 retries=Math.min(8,retries+1);
 var delay=Math.min(60000,2000*Math.pow(2,retries-1));
 recoveryPending=true;recoveryProgressCount=0;
 diagnostic('STALL_DETECTED',reason+'; '+snapshot());
 diagnostic('RETRY_SCHEDULED','Попытка '+retries+', задержка '+Math.round(delay/1000)+'с');
 status('reconnecting',reason);
 reconnectTimer=setTimeout(function(){
   reconnectTimer=null;
   if(token===generation&&activeUrl===url){
     diagnostic('RETRY_START','Повторное подключение того же канала, попытка '+retries);
     play(url,true);
   }
 },delay);
}
function watchPlayback(){
 if(!player||!activeUrl||reconnectTimer!==null)return;
 if(typeof document.hidden==='boolean'&&document.hidden)return;
 var now=Date.now(),state='';
 try{state=player.getState();}catch(ignore){return;}
 if(now-lastSnapshotAt>60000){
   lastSnapshotAt=now;
   diagnostic('WATCHDOG',snapshot());
 }
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
function resolution(){try{var tracks=player.getCurrentStreamInfo();for(var i=0;i<tracks.length;i++){if(String(tracks[i].type).toUpperCase().indexOf('VIDEO')<0)continue;var p=JSON.parse(tracks[i].extra_info),w=Number(p.Width||p.width||0),h=Number(p.Height||p.height||0);if(w>0&&h>0){var size=w+'x'+h;if(lastVideoResolution!==size){lastVideoResolution=size;diagnostic('VIDEO_RESOLUTION',size);}status('resolution','',w,h);return;}}}catch(e){}}
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
 if((a.protocol!=='http:'&&a.protocol!=='https:')||a.hostname!==host){diagnostic('ERROR','Адрес канала не разрешён');status('error','Запрещённый сервер');return;}
 if(!player){diagnostic('ERROR','AVPlay недоступен на телевизоре');status('error','AVPlay отсутствует');return;}
 clearReconnect();
 if(!retrying){retries=0;recoveryPending=false;}
 diagnostic(retrying?'RECONNECT_OPEN':'CHANNEL_OPEN',retrying?'Переподключение, попытка '+retries:'Запуск нового канала');
 activeUrl=url;openedAt=Date.now();bufferingAt=0;lastMediaTime=null;lastSnapshotAt=0;
 lastProgressAt=0;observedProgress=false;recoveryProgressCount=0;
 var token=++generation;
 try{player.stop();}catch(e){}try{player.close();}catch(e){}
 try{
   player.open(url);
   player.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
   player.setListener({
     onbufferingstart:function(){
       if(token!==generation)return;
       if(!bufferingAt){
         bufferingAt=Date.now();
         diagnostic('BUFFERING_START','Началась буферизация');
       }
       status('buffering');
     },
     onbufferingcomplete:function(){
       if(token!==generation)return;
       var seconds=bufferingAt?Math.round((Date.now()-bufferingAt)/1000):0;
       bufferingAt=0;
       diagnostic('BUFFERING_END','Буферизация завершилась за '+seconds+'с');
       // An ERROR can be followed by BUFFERING_END even when video is frozen.
       // Keep the scheduled retry until actual forward clock progress.
       if(recoveryPending)diagnostic('RECOVERY_WAIT','Буферизация закончилась, но движение потока ещё не подтверждено');
       resolution();status('playing');
     },
     oncurrentplaytime:function(time){if(token===generation)observeTime(time);},
     onstreamplayready:function(){if(token===generation){diagnostic('PLAY_READY','Поток готов к воспроизведению');resolution();}},
     onerror:function(e){
       if(token!==generation)return;
       diagnostic('ERROR','AVPlay: '+safeError(e));
       status('error',String(e));scheduleReconnect('AVPlay error');
     },
     onstreamcompleted:function(){
       if(token!==generation)return;
       diagnostic('STREAM_ENDED','Трансляция неожиданно завершилась');
       status('error','Трансляция завершена');scheduleReconnect('Stream completed');
     },
     onevent:function(e){if(token===generation&&String(e).indexOf('RESOLUTION_CHANGED')>=0)resolution();}
   });
   player.prepareAsync(function(){
     if(token!==generation)return;
     try{
       player.setDisplayRect(lastRect[0],lastRect[1],lastRect[2],lastRect[3]);
       player.play();
       diagnostic('PLAY_CALLED','Команда воспроизведения отправлена');
       resolution();status('playing');
     }catch(e){diagnostic('ERROR','Вызов play(): '+safeError(e));status('error',String(e));scheduleReconnect('Play failed');}
   },function(e){
     if(token!==generation)return;
     diagnostic('ERROR','prepareAsync(): '+safeError(e));
     status('error',String(e));scheduleReconnect('Prepare failed');
   });
 }catch(e){
   if(token!==generation)return;
   diagnostic('ERROR','open(): '+safeError(e));
   status('error',String(e));scheduleReconnect('Open failed');
 }
}
window.AquaBridge={postMessage:function(json){
 var m;try{m=JSON.parse(json);}catch(e){return;}
 if(m.type==='play')play(m.url);
 else if(m.type==='rect')rect(m);
 else if(m.type==='exit'){
   diagnostic('APP_EXIT','Выход из приложения');
   try{tizen.application.getCurrentApplication().exit();}catch(e){window.close();}
 }
},
getDebugLog:function(){return debugEvents.join('\n');},
getDebugState:function(){return snapshot();}
};
document.addEventListener('keydown',function(e){
 if(e.keyCode!==10009&&e.keyCode!==27)return;
 e.preventDefault();e.stopPropagation();
 if(window.AquaFast)window.AquaFast.key('Escape');
},true);
diagnostic('MONITOR_READY','Диагностика AVPlay включена; журнал: AquaBridge.getDebugLog()');
window.addEventListener('beforeunload',function(){
 diagnostic('APP_CLOSE','Закрытие оболочки');
 activeUrl='';generation++;clearReconnect();clearInterval(watchdog);
 try{player.close();}catch(e){}
});
})();