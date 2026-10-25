/* Prepare WebView-compatible UI to be embedded inside APK.
 * HTML/CSS/JS are packaged; playlist and EPG still come from GitHub Pages. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'android/app/src/main/assets/compat');
const temp = path.join(root, 'android/app/build/compat-src');
fs.mkdirSync(out, {recursive:true});
fs.mkdirSync(temp, {recursive:true});
const read = p => fs.readFileSync(path.join(root,p), 'utf8');
let html = read('index.html');
html = html.replace(/<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/hls\.js[^"]*"[^>]*><\/script>\s*/g, '');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'config.js'), read('config.js'));
const legacyCss = "\n/* Beelink old WebView fallbacks */\n"
  + "html,body {min-height:100%;width:100%;overflow:hidden}\n"
  + ".fullscreen-stage,.guide-view,.font-settings,.startup {top:0;right:0;bottom:0;left:0;width:100%;height:100%;box-sizing:border-box}\n"
  + ".startup {display:flex;align-items:center;justify-content:center}\n"
  + ".startup-card {width:420px;max-width:calc(100% - 45px);box-sizing:border-box}\n"
  + ".font-settings {display:flex;align-items:center;justify-content:center}\n"
  + ".font-settings-card {width:470px;max-width:100%;max-height:90vh;box-sizing:border-box}\n"
  + ".startup-spinner {flex-shrink:0}\n";
fs.writeFileSync(path.join(out, 'styles.css'), read('styles.css') + legacyCss);
const source = read('app.js');
if (!source.startsWith("'use strict';")) throw Error('Unexpected app.js prelude');
const shim = "\n/* Android system WebView fallback (origin-checked on native side). */\n"
  + "if (!window.AquaAndroid && navigator.userAgent.indexOf('AQUA-TV-LEGACY-BRIDGE/1') !== -1) {\n"
  + " window.AquaAndroid = {postMessage:function(value){window.prompt('AQUA-TV-BRIDGE/1:' + value,'');}};\n"
  + "}\n";
fs.writeFileSync(path.join(temp,'entry.js'),source.replace("'use strict';","'use strict';" + shim));
console.log('Legacy UI sources generated; transpile entry.js to Chrome 58.');
