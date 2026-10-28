import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../detector.js';

function node(tag = '') {
  return {tag, children:[], isConnected:true, textContent:'', setAttribute(){},
    append(...items){this.children.push(...items);}, replaceChildren(...items){this.children=items;},
    attachShadow(){this.shadow=node('shadow');return this.shadow;}, remove(){this.isConnected=false;}};
}
async function harness() {
  const events={}, timers=[], messages=[];
  const location={href:'https://gemini.google.com/app'};
  const input={value:'숲속 오두막',getClientRects:()=>[1],getAttribute:()=>null,contains:()=>false};
  let tick, responses=[], generationResolve, record, id=0;
  const document={createElement:node,querySelectorAll(selector){
    if (selector.includes('rich-textarea')) return [input];
    if (selector==='model-response') return responses;
    return [];
  },addEventListener(name,fn){events[name]=fn;}};
  const chrome={storage:{onChanged:{addListener(){}}},runtime:{sendMessage(msg){
    messages.push(msg);
    if (msg.type==='generatedImage') {record={status:'running'};return new Promise(resolve=>{generationResolve=resolve;});}
    return Promise.resolve(msg.type==='trackingStatus'?{tracking:true}:msg.type==='receipt'?{ok:true,record}:{ok:true});
  }}};
  vm.runInNewContext(readFileSync(new URL('../content.js',import.meta.url),'utf8'),{
    document,chrome,CarbonDetector:globalThis.CarbonDetector,crypto:{randomUUID:()=>String(++id)},location,URL,
    setTimeout:fn=>timers.push(fn),setInterval:fn=>{tick=fn;},Date
  });
  await Promise.resolve();
  return {messages,location,input,events,
    async submit(prompt='숲속 오두막') {
      input.value=prompt;events.input({target:input});events.keydown({key:'Enter',target:input});
      input.value='';timers.shift()();await Promise.resolve();await Promise.resolve();
    },
    response(prompt='숲속 오두막',loaded=true) {
      const image={complete:loaded,naturalWidth:512,getClientRects:()=>[1],getAttribute:()=>null};
      const response=Object.assign(node('model-response'),{
        querySelectorAll:()=>[image],closest:()=>({querySelector:()=>({innerText:prompt})})
      }); responses.push(response);return {response,image};
    },tick:()=>tick(),finish(value){record=value;generationResolve({ok:true});}
  };
}
const text = el => [el.textContent,...el.children.map(text)].join(' ');

test('new-chat route change, image loading, one API call and inline receipt while API is pending', async () => {
  const h=await harness();await h.submit();
  assert.equal(h.messages.find(m=>m.type==='capture').prompt,'숲속 오두막');
  await h.tick();assert.equal(h.messages.some(m=>m.type==='generatedImage'),false);
  const {response,image}=h.response('숲속 오두막',false);
  h.location.href='https://gemini.google.com/app/new-conversation';
  await h.tick();assert.equal(h.messages.some(m=>m.type==='generatedImage'),false);
  image.complete=true;await h.tick();await h.tick();
  assert.equal(h.messages.filter(m=>m.type==='generatedImage').length,1);
  assert.equal(response.children.length,1);
  const receipt=response.children[0];
  assert.match(text(receipt.box),/API 요청 중/);
  h.finish({status:'success',websiteImages:1,result:{images:1,usage:{input:13,output:1500,total:1513},energy:{wh:2.906473,carbonGrams:0.991107293}}});
  await h.tick();
  assert.match(text(receipt.box),/1513/);assert.match(text(receipt.box),/2.906 Wh/);assert.match(text(receipt.box),/0.991 g/);
  receipt.box.children[0].onclick();await h.tick();assert.equal(receipt.isConnected,false);
});

test('old images and a different prompt cannot trigger API calls', async () => {
  const h=await harness();h.response();await h.submit();h.response('다른 프롬프트');
  await h.tick();assert.equal(h.messages.some(m=>m.type==='generatedImage'),false);
});

test('navigation to another existing conversation cannot trigger a call', async () => {
  const h=await harness();h.location.href='https://gemini.google.com/app/first';
  await h.submit();h.response();h.location.href='https://gemini.google.com/app/second';
  await h.tick();assert.equal(h.messages.some(m=>m.type==='generatedImage'),false);
});

test('successive image responses retain their own receipts without resending earlier prompts', async () => {
  const h=await harness();await h.submit();const first=h.response();await h.tick();
  h.finish({status:'success'});await h.tick();
  await h.submit('바닷가');const second=h.response('바닷가');await h.tick();
  assert.equal(h.messages.filter(m=>m.type==='generatedImage').length,2);
  assert.equal(first.response.children.length,1);assert.equal(second.response.children.length,1);
});
