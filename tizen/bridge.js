/* Tizen bridge: mirrors the existing Android message protocol. ES5 syntax. */
(function () {
  'use strict';
  var player = window.webapis && window.webapis.avplay;
  function startupError(text) {
    var message = document.getElementById('startupText');
    if (message) message.textContent = text;
    var spinner = document.querySelector('.startup-spinner');
    if (spinner) spinner.style.display = 'none';
  }
  window.addEventListener('error',function(e) {
    if (document.getElementById('startup') && !document.getElementById('startup').hidden)
      startupError('Ошибка интерфейса: ' + (e.message || 'JavaScript'));
  });
  window.setTimeout(function() {
    var splash = document.getElementById('startup');
    if (splash && !splash.hidden) startupError('Нет ответа при загрузке плейлиста. Проверьте интернет и подключение к GitHub Pages.');
  }, 25000);
  var generation = 0;
  var source = '';
  var muted = false;
  var allowedHost = '31.41.12.104';
  function status(type, message, width, height) {
    if (window.AquaNative && window.AquaNative.onStatus)
      window.AquaNative.onStatus(type, message || '', width || 0, height || 0);
  }
  function position(msg) {
    if (!player || !msg || !msg.visible) return;
    var rw = document.documentElement.clientWidth || 1920;
    var rh = document.documentElement.clientHeight || 1080;
    var sw = window.screen.width || rw;
    var sh = window.screen.height || rh;
    var x = Math.max(0, Math.round(msg.x * sw / rw));
    var y = Math.max(0, Math.round(msg.y * sh / rh));
    var w = Math.max(1, Math.round(msg.width * sw / rw));
    var h = Math.max(1, Math.round(msg.height * sh / rh));
    try { player.setDisplayRect(x, y, w, h); }
    catch (e) { console.log('AVPlay rect: ' + e); }
  }
  function play(url) {
    var parsed;
    try { parsed = document.createElement('a'); parsed.href = url; }
    catch (e) { status('error','Некорректный адрес');return; }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.hostname !== allowedHost) {
      status('error','Неизвестный IPTV сервер');return;
    }
    if (!player) { status('error','AVPlay недоступен на этом устройстве');return; }
    var token = ++generation;
    source = url;
    try { player.stop(); } catch (ignore) {}
    try { player.close(); } catch (ignore2) {}
    try {
      player.open(url);
      player.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      player.setListener({
        onbufferingstart:function(){status('buffering','');},
        onbufferingcomplete:function(){status('playing','');},
        onstreamcompleted:function(){status('error','Трансляция завершилась');},
        onerror:function(code){status('error','AVPlay: '+code);}
      });
      player.prepareAsync(function () {
        if (token !== generation) return;
        try { player.play(); status('playing',''); } 
        catch (e) { status('error',String(e)); }
      },function (error) { if(token === generation) status('error','AVPlay: '+error); });
    } catch (e) { status('error',String(e)); }
  }
  window.AquaAndroid = {
    postMessage:function(json) {
      var command;
      try { command = JSON.parse(json); } catch (e) { return; }
      if (!command || typeof command.type !== 'string') return;
      if (command.type === 'play') play(command.url);
      else if (command.type === 'rect') position(command);
      else if (command.type === 'mute') {
        muted = !!command.muted;
        try { window.webapis.tvAudioControl.setMute(muted); } catch (ignore) {}
      }
      else if (command.type === 'exoSettings') {
        alert('Настройки ExoPlayer доступны только в Android. Samsung использует AVPlay.');
      }
    }
  };
  function onKey(e) {
    var key = e.keyCode;
    if ((key===10009 || key===27) && e.isTrusted !== false) {
      // Translate remote Back to Escape for the existing AQUA TV key handler.
      e.preventDefault();
      var ev = document.createEvent('Event');
      ev.initEvent('keydown',true,true);
      ev.key='Escape';
      document.dispatchEvent(ev);
    }
  }
  document.addEventListener('keydown',onKey,false);
  window.addEventListener('beforeunload',function(){generation++;try{player.close();}catch(ignore){}});
  window.addEventListener('load',function(){status('engine','Samsung Tizen AVPlay');});
})();
