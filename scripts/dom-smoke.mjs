// Real browser DOM regression fixture; no extension loading or remote API requests.
import {mkdtemp, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const dir = await mkdtemp(join(tmpdir(), 'receipt-dom-'));
const detector = await readFile('detector.js','utf8');
const content = await readFile('content.js','utf8');
const setup = `
let tick, record, calls=0;
window.setInterval=fn=>{tick=fn;};
window.chrome={storage:{onChanged:{addListener(){}}},runtime:{sendMessage:async msg=>{
 if(msg.type==='trackingStatus')return {tracking:true};
 if(msg.type==='receipts')return {records:[]};
 if(msg.type==='generatedImage'){calls++;record={status:'running'};return {ok:true};}
 if(msg.type==='receipt')return {record};
 return {ok:true};
}}};
// Retain access to the isolated receipt solely in this test fixture.
const attach=Element.prototype.attachShadow;
Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
`;
const check = `
(async()=>{
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 await pause(0);
 const input=document.querySelector('textarea');input.value='숲속 오두막';
 input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));input.value='';
 await pause(250);
 assert(document.querySelector('aside'),'waiting receipt missing');
 const turn=document.createElement('conversation-container');
 turn.innerHTML='<user-query><span>You said</span><div class="query-text">숲속 오두막</div><button>Copy</button></user-query><model-response><generated-image><img width="20" height="20"></generated-image></model-response>';
 document.body.append(turn);
 const img=turn.querySelector('img');
 img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
 await img.decode();await tick();
 assert(calls===1,'prompt text child did not match');
 let response=turn.querySelector('model-response');
 let receipt=response.querySelector('aside');
 assert(receipt && receipt.getBoundingClientRect().height>0,'inline receipt not visible');
 assert(receipt.shadowRoot.textContent.includes('API 요청 중'),'running state missing');
 record={status:'success',websiteImages:1,result:{images:1,usage:{total:1513},energy:{wh:2.906473,carbonGrams:0.991107293}}};
 await tick();assert(receipt.shadowRoot.textContent.includes('0.991 g'),'carbon receipt missing');
 receipt.remove();await tick();receipt=response.querySelector('aside');
 assert(receipt && receipt.getBoundingClientRect().height>0,'receipt lost after rerender');
 response.remove();await tick();receipt=document.body.querySelector('aside');
 assert(receipt && receipt.hasAttribute('data-floating'),'fallback receipt missing');
 assert(calls===1,'rerender caused another paid request');
 document.querySelector('#result').textContent='PASS: visible waiting, inline running/result, rerender recovery, floating fallback; exactly one mocked API call';
})().catch(error=>{document.querySelector('#result').textContent='FAIL: '+error.message;});
`;
try {
 const path=join(dir,'fixture.html');
 await writeFile(path,`<!doctype html><meta charset="utf-8"><textarea></textarea><pre id="result">PENDING</pre><script>${setup}</script><script>${detector}</script><script>${content}</script><script>${check}</script>`);
 const child=spawn(process.env.CHROMIUM_PATH || '/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',`--user-data-dir=${join(dir,'profile')}`,'--remote-debugging-port=9225','about:blank'],{stdio:'ignore'});
 let socket;
 try {
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  let target;
  for(let i=0;i<80;i++) {
   try {target=await (await fetch(`http://127.0.0.1:9225/json/new?file://${path}`,{method:'PUT'})).json();break;} catch {} await pause(100);
  }
  assert.ok(target,'Browser debug endpoint unavailable');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let next=0;const pending=new Map();
  socket.addEventListener('message',e=>{const data=JSON.parse(e.data);pending.get(data.id)?.(data);pending.delete(data.id);});
  const evaluate=expression=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));});
  let message;
  for(let i=0;i<80;i++) {
   const value=await evaluate('document.querySelector("#result")?.textContent');
   message=value.result?.result?.value;
   if(message && message!=='PENDING')break;
   await pause(100);
  }
  if(!message) console.log(JSON.stringify(await evaluate('({url:location.href,text:document.body?.innerText})')));
  assert.ok(message?.startsWith('PASS:'),message || 'No fixture result');console.log(message);
 } finally {socket?.close();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}

} finally {await rm(dir,{recursive:true,force:true});}
