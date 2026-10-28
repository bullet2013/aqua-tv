/* Small Tizen AVPlay adapter for AQUA TV FAST, ES5. */
(function(){
'use strict';
var player=window.webapis&&window.webapis.avplay;
var lastRect=[0,0,1920,1080],generation=0;
var host='31.41.12.104';
function status(type,message,w,h){if(window.AquaFast&&window.AquaFast.onStatus)window.AquaFast.onStatus(type,message||'',w||0,h||0);}
function resolution(){try{var tracks=player.getCurrentStreamInfo();for(var i=0;i<tracks.length;i++){if(String(tracks[i].type).toUpperCase().indexOf('VIDEO')<0)continue;var p=JSON.parse(tracks[i].extra_info),w=Number(p.Width||p.width||0),h=Number(p.Height||p.height||0);if(w>0&&h>0){status('resolution','',w,h);return;}}}catch(e){}}
function rect(m){
 var width=Number(m.viewportWidth)||document.documentElement.clientWidth||1920;
 var height=Number(m.viewportHeight)||document.documentElement.clientHeight||1080;
 var x=Math.max(0,Math.round(Number(m.x)*1920/width)),y=Math.max(0,Math.round(Number(m.y)*1080/height));
 var w=Math.max(1,Math.min(1920-x,Math.round(Number(m.width)*1920/width)));
 var h=Math.max(1,Math.min(1080-y,Math.round(Number(m.height)*1080/height)));
 var n=[x,y,w,h];if(n.join(',')===lastRect.join(','))return;
 lastRect=n;
 try{player.setDisplayRect(x,y,w,h);}catch(e){status('error',String(e));}
}
function play(url){
 var a=document.createElement('a');a.href=url;
 if((a.protocol!=='http:'&&a.protocol!=='https:')||a.hostname!==host){status('error','Запрещённый сервер');return;}
 if(!player){status('error','AVPlay отсутствует');return;}
 var token=++generation;
 try{player.stop();}catch(e){}try{player.close();}catch(e){}
 try{
   player.open(url);
   player.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
   player.setListener({onbufferingstart:function(){status('buffering');},
     onbufferingcomplete:function(){resolution();status('playing');},
     onstreamplayready:function(){resolution();},
     onerror:function(e){status('error',String(e));},
     onstreamcompleted:function(){status('error','Трансляция завершена');},
     onevent:function(e){if(String(e).indexOf('RESOLUTION_CHANGED')>=0)resolution();}});
   player.prepareAsync(function(){
     if(token!==generation)return;
     try{player.setDisplayRect(lastRect[0],lastRect[1],lastRect[2],lastRect[3]);player.play();resolution();status('playing');}catch(e){status('error',String(e));}
   },function(e){if(token===generation)status('error',String(e));});
 }catch(e){status('error',String(e));}
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
window.addEventListener('beforeunload',function(){generation++;try{player.close();}catch(e){}});
})();