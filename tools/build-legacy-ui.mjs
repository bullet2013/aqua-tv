import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const dir = 'dist/legacy';
fs.mkdirSync(dir, {recursive:true});
const run=(program,args)=>execFileSync(program,args,{stdio:'inherit'});
run('./node_modules/.bin/babel',['app.js','--out-file',dir+'/app.js',
  '--presets','@babel/preset-env']);
const poly = fs.readFileSync('node_modules/core-js-bundle/minified.js','utf8') + '\n' +
  fs.readFileSync('node_modules/regenerator-runtime/runtime.js','utf8') + '\n' +
  "(function(){if(!Object.hasOwn)Object.hasOwn=function(o,k){return Object.prototype.hasOwnProperty.call(o,k)};document.documentElement.className+=' aqua-legacy-browser';})();\n";
fs.writeFileSync(dir+'/polyfills.js',poly);
fs.copyFileSync('node_modules/pako/dist/pako.min.js',dir+'/pako.min.js');
for(const file of ['app.js','polyfills.js','pako.min.js']) {
 if(fs.statSync(dir+'/'+file).size<1000)throw Error('Legacy bundle incomplete: '+file);
}
console.log('Classic UI assets ready:',fs.readdirSync(dir));
