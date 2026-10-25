/* ES5-only bootstrap. Keeps the same AQUA TV interface on all engines. */
(function(){
  var modern=false;
  try {
    modern=!!(new Function("var x={a:{b:1}};return x?.a?.b ?? 0"))();
  } catch(ignore){}
  function load(src,next){
    var script=document.createElement('script');
    script.src=src;
    script.onload=function(){if(next)next();};
    script.onerror=function(){
      var splash=document.getElementById('startupText');
      if(splash)splash.textContent='Ошибка загрузки интерфейса: '+src;
    };
    document.head.appendChild(script);
  }
  if(modern){
    load('./app.js?v=1.15-ui');
  }else{
    load('./dist/legacy/polyfills.js?v=1',function(){
      load('./dist/legacy/pako.min.js?v=1',function(){
        load('./dist/legacy/app.js?v=1');
      });
    });
  }
})();
