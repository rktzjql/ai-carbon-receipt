import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../detector.js';

function node(tag = '') {
  return {tag, children:[], isConnected:true, textContent:'', setAttribute(){}, toggleAttribute(){},
    append(...items){for(const item of items){if(item.parentNode) item.parentNode.children=item.parentNode.children.filter(x=>x!==item); item.parentNode=this;this.children.push(item);}}, replaceChildren(...items){this.children=items;},
    attachShadow(){this.shadow=node('shadow');return this.shadow;}, remove(){this.isConnected=false;}};
}
async function harness(restored = []) {
  const events={}, timers=[], messages=[];
  const location={href:'https://gemini.google.com/app'};
  const input={value:'숲속 오두막',getClientRects:()=>[1],getAttribute:()=>null,contains:()=>false};
  let tick, responses=[], generationResolve, record, id=0;
  const document={body:node('body'),createElement:node,querySelectorAll(selector){
    if (selector.includes('rich-textarea')) return [input];
    if (selector.startsWith('model-response')) return responses;
    return [];
  },addEventListener(name,fn){events[name]=fn;}};
  const chrome={storage:{onChanged:{addListener(){}}},runtime:{sendMessage(msg){
    messages.push(msg);
    if (msg.type==='receipts') return Promise.resolve({records:restored});
    if (msg.type==='generatedImage') {record={status:'running'};return new Promise(resolve=>{generationResolve=resolve;});}
    return Promise.resolve(msg.type==='trackingStatus'?{tracking:true}:msg.type==='receipt'?{ok:true,record}:{ok:true});
  }}};
  vm.runInNewContext(readFileSync(new URL('../content.js',import.meta.url),'utf8'),{
    document,chrome,CarbonDetector:globalThis.CarbonDetector,crypto:{randomUUID:()=>String(++id)},location,URL,
    setTimeout:fn=>timers.push(fn),setInterval:fn=>{tick=fn;},Date
  });
  await Promise.resolve();
  return {messages,location,input,events,document,
    async submit(prompt='숲속 오두막', cleared=true) {
      input.value=prompt;events.input({target:input});events.keydown({key:'Enter',target:input});
      if(cleared) input.value='';
      while(timers.length) timers.shift()();
      await Promise.resolve();await Promise.resolve();
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
  h.finish({status:'success',websiteImages:1,result:{images:1,usage:{input:13,output:1500,total:1513},energy:{wh:2.296734,carbonGrams:0.783186294}}});
  await h.tick();
  assert.match(text(receipt.box),/1513/);assert.match(text(receipt.box),/2\.297\s+Wh/);assert.match(text(receipt.box),/0\.783\s+gCO₂e/);
  assert.match(text(receipt.box),/약 8\.27초/);
  assert.match(text(receipt.box),/별도 API 응답 실측값/);
  assert.match(text(receipt.box),/SAVE THE PLANET/);
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

test('a waiting receipt appears before any model response is available', async () => {
  const h=await harness();await h.submit();
  assert.equal(h.document.body.children.length,1);
  assert.match(text(h.document.body.children[0].box),/프롬프트 인식 완료/);
  assert.equal(h.messages.some(m=>m.type==='generatedImage'),false);
});

test('prompt matching prefers the text child over parent labels', async () => {
  const h=await harness();await h.submit();const {response}=h.response();
  response.closest=()=>({querySelector:()=>({innerText:'You said 숲속 오두막',querySelectorAll:selector=>selector.includes('span')?[{innerText:'숲속 오두막'}]:[]})});
  await h.tick();
  assert.equal(h.messages.filter(m=>m.type==='generatedImage').length,1);
});

test('missed composer clearing is recovered by a matching new response with a loaded image', async () => {
  const h=await harness();await h.submit('경찰복을 입은 토끼 그려줘',false);
  assert.equal(h.messages.find(m=>m.type==='capture').evidence.submission,'unknown');
  await h.tick();assert.equal(h.messages.some(m=>m.type==='generatedImage'),false);
  h.response('경찰복을 입은 토끼 그려줘');await h.tick();
  assert.equal(h.messages.find(m=>m.type==='generatedImage').submissionVerified,true);
});

test('successful session receipt restores after page reload without another API call', async () => {
  const h=await harness([{eventId:'previous',prompt:'숲속 오두막',status:'success',websiteImages:1,result:{images:1,usage:{total:1513},energy:{wh:2.296734,carbonGrams:0.783186294}}}]);
  const {response}=h.response();await h.tick();
  assert.match(text(response.children[0].box),/0\.783\s+gCO₂e/);
  assert.equal(h.messages.some(m=>m.type==='generatedImage'),false);
});

test('removal of a completed receipt is repaired without regenerating', async () => {
  const h=await harness();await h.submit();const {response}=h.response();await h.tick();
  h.finish({status:'success'});await h.tick();
  response.children[0].remove();await h.tick();
  assert.ok(response.children.some(child=>child.isConnected));
  assert.equal(h.messages.filter(m=>m.type==='generatedImage').length,1);
});

test('separate user/model containers use the nearest preceding user message', async () => {
  const h=await harness();await h.submit();const {response}=h.response();
  response.closest=()=>null;
  const old={innerText:'다른 문장'}, current={innerText:'You said 숲속 오두막',querySelectorAll:()=>[{innerText:'숲속 오두막'}]};
  const read=h.document.querySelectorAll;
  h.document.querySelectorAll=selector=>selector.startsWith('user-query')?[old,current]:read(selector);
  response.compareDocumentPosition=()=>2;
  await h.tick();assert.equal(h.messages.filter(m=>m.type==='generatedImage').length,1);
});

test('an older matching prompt cannot claim a response following a different user message', async () => {
  const h=await harness();await h.submit();const {response}=h.response();
  response.closest=()=>null;response.compareDocumentPosition=()=>2;
  const read=h.document.querySelectorAll;
  h.document.querySelectorAll=selector=>selector.startsWith('user-query')?[{innerText:'숲속 오두막'},{innerText:'다른 문장'}]:read(selector);
  await h.tick();assert.equal(h.messages.some(m=>m.type==='generatedImage'),false);
  assert.match(text(h.document.body.children[0].box),/연결 진단/);
});

test('multiline prompt matches split query text lines despite surrounding controls', async () => {
  const h=await harness();await h.submit('토끼\n경찰복');const {response}=h.response();
  response.closest=()=>({querySelector:()=>({innerText:'You said 토끼 경찰복 Copy',querySelectorAll:()=>[{innerText:'토끼'},{innerText:'경찰복'}]})});
  await h.tick();assert.equal(h.messages.filter(m=>m.type==='generatedImage').length,1);
});

test('paper receipt preserves zero results and omits removed presentation fields', async () => {
  const zero={status:'success',websiteImages:1,result:{images:1,usage:{total:0},energy:{wh:0,carbonGrams:0,whPerToken:0.001518,kgCO2eqPerKwh:0.341}}};
  const missing={status:'no-image',websiteImages:1,result:{images:0,usage:{total:null},energy:{wh:null,carbonGrams:null}}};
  for (const record of [zero,missing]) {
    const original=structuredClone(record);
    const h=await harness();await h.submit();const {response}=h.response();await h.tick();
    h.finish(record);await h.tick();
    const output=text(response.children[0].box);
    if(record===zero){assert.match(output,/0\.000\s+Wh/);assert.match(output,/약 0\.00초/);}
    else {assert.match(output,/전력 소비량 미산정/);assert.doesNotMatch(output,/약 [0-9]/);}
    assert.doesNotMatch(output,/생성 시각|물 사용량|별도 API 이미지 생성 완료/);
    assert.deepEqual(record,original);
  }
});
