import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'carbon-chrome-'));
const browser=spawn(process.env.CHROMIUM_PATH || '/usr/bin/chromium',['--headless=new','--enable-unsafe-extension-debugging','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-port=9223',`--disable-extensions-except=${resolve('.')}`,`--load-extension=${resolve('.')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let logs='';browser.stderr.on('data',data=>{logs+=data;});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let socket;
try {
 let version;
 for(let i=0;i<80;i++){try{version=await (await fetch('http://127.0.0.1:9223/json/version')).json();break;}catch{}await pause(100);}
 assert.ok(version,'Chromium debugging endpoint unavailable');
 const control=new WebSocket(version.webSocketDebuggerUrl);
 await new Promise((res,rej)=>{control.addEventListener('open',res,{once:true});control.addEventListener('error',rej,{once:true});});
 const loaded=await new Promise(res=>{control.addEventListener('message',e=>{const data=JSON.parse(e.data);if(data.id===1)res(data);});control.send(JSON.stringify({id:1,method:'Extensions.loadUnpacked',params:{path:resolve('.')}}));});
 control.close();
 assert.ok(!loaded.error,JSON.stringify(loaded));
 let targets=[];
 for(let i=0;i<80;i++) {try{targets=await (await fetch('http://127.0.0.1:9223/json')).json();if(targets.some(t=>t.type==='service_worker'))break;}catch{}await pause(100);}
 const worker=targets.find(t=>t.type==='service_worker' && t.url.endsWith('/background.js'));
 assert.ok(worker,'Extension service worker did not load: '+logs.slice(-1800));
 // Node URL.origin is null for extension schemes.
 const base=worker.url.replace(/background\.js$/,'');
 const target=await (await fetch(`http://127.0.0.1:9223/json/new?${base}panel.html`,{method:'PUT'})).json();
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((res,rej)=>{socket.addEventListener('open',res,{once:true});socket.addEventListener('error',rej,{once:true});});
 let next=0;const pending=new Map();const errors=[];
 socket.addEventListener('message',e=>{const data=JSON.parse(e.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}});
 const call=(method,params={})=>new Promise(res=>{const id=++next;pending.set(id,res);socket.send(JSON.stringify({id,method,params}));});
 await call('Runtime.enable');
 let ready=false;
 for(let i=0;i<50;i++){const r=await call('Runtime.evaluate',{expression:'document.querySelector("#keyState")?.textContent',returnByValue:true});if(r.result?.result?.value?.includes('API 키 없음')){ready=true;break;}await pause(100);}
 assert.ok(ready,'Panel did not initialize');
 const result=await call('Runtime.evaluate',{expression:'chrome.runtime.sendMessage({type:"state"})',awaitPromise:true,returnByValue:true});
 assert.equal(result.result.result.value.ok,true);assert.equal(result.result.result.value.hasKey,false);
 assert.deepEqual(errors,[]);
 await call('Page.navigate',{url:`${base}options.html`});await pause(300);
 const option=await call('Runtime.evaluate',{expression:'document.querySelector("#key")?.type',returnByValue:true});assert.equal(option.result.result.value,'password');
 console.log('PASS: real Chromium loaded MV3 worker, initialized popup/panel, handled state message, and opened options; no API calls made.');
} finally {socket?.close();browser.kill('SIGTERM');await new Promise(r=>browser.once('exit',r));await rm(profile,{recursive:true,force:true});}
