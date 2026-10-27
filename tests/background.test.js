import test from 'node:test';
import assert from 'node:assert/strict';
// Exercise compatibility without AbortSignal.timeout (unavailable on Chrome 102).
Object.defineProperty(AbortSignal, 'timeout', {value: undefined, configurable: true});
// In-memory Chrome and HTTP doubles: no real API calls and no real usage measurements.
const local = {}, session = {};
function area(data) {return {async get(key){return {[key]:structuredClone(data[key])};},async set(items){Object.assign(data,structuredClone(items));},async remove(key){delete data[key];},async setAccessLevel(value){assert.equal(value.accessLevel,'TRUSTED_CONTEXTS');}};}
let listener, calls = 0, lastRequest;
globalThis.chrome = {storage:{local:area(local),session:area(session)},runtime:{id:'extension-id',getURL:path=>`chrome-extension://extension-id/${path}`,onMessage:{addListener:fn=>{listener=fn;}}}};
globalThis.fetch = async (url, init) => {calls++;lastRequest={url,init};return {ok:true,json:async()=>({usageMetadata:{promptTokenCount:5,totalTokenCount:15},candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'test-only'}}]}}]})};};
await import('../background.js');
const ui = {id:'extension-id',url:'chrome-extension://extension-id/panel.html'};
const page = {id:'extension-id',url:'https://gemini.google.com/app',frameId:0,tab:{id:1,url:'https://gemini.google.com/app'}};
const send = (msg,sender=ui)=>new Promise(resolve=>listener(msg,sender,resolve));
test('worker enforces trust, consent, durable deduplication and exact request', async () => {
  assert.equal((await send({type:'saveKey',key:'fixture-key'},page)).ok,false);
  assert.equal((await send({type:'state'},page)).ok,false);
  assert.equal((await send({type:'saveKey',key:'fixture-key'})).ok,true);
  await send({type:'saveSettings',tracking:true,consent:true});
  const capture = {type:'capture',eventId:'11111111-1111-4111-8111-111111111111',prompt:'그림을 만들어줘',evidence:{model:'verified',image:'verified',submission:'verified'}};
  await Promise.all([send(capture,page),send(capture,page)]);
  assert.equal(calls,1);assert.ok(lastRequest.url.endsWith('models/gemini-3.1-flash-lite-image:generateContent'));
  assert.equal(lastRequest.init.headers['x-goog-api-key'],'fixture-key');
  assert.equal(JSON.parse(lastRequest.init.body).generationConfig.imageConfig.imageSize,'1K');
  const state=await send({type:'state'}); assert.equal(state.apiKey,undefined);assert.equal(state.records[0].result.usage.input,5);
  assert.equal(state.records[0].status,'success');
  await send({type:'clearHistory'});await send(capture,page);assert.equal(calls,1);
  const uncertain={...capture,eventId:'22222222-2222-4222-8222-222222222222',evidence:{model:'unknown',image:'uncertain'}};
  await send(uncertain,page);assert.equal(calls,1);
  const id=(await send({type:'state'})).records[0].id;
  assert.equal((await send({type:'confirm',id,confirmed:false})).ok,false);
  await Promise.all([send({type:'confirm',id,confirmed:true}),send({type:'confirm',id,confirmed:true})]);assert.equal(calls,2);
  await send({type:'saveSettings',tracking:false,consent:true});
  await send({...capture,eventId:'33333333-3333-4333-8333-333333333333'},page);assert.equal(calls,2);
});

test('session history stays bounded for the older Chrome 1 MB quota', async () => {
  await send({type:'saveSettings',tracking:true,consent:false});
  for (let i=0;i<20;i++) {
    await send({type:'capture',eventId:crypto.randomUUID(),prompt:'한'.repeat(16000),evidence:{model:'unknown',image:'uncertain'}},page);
  }
  const state=await send({type:'state'});
  assert.ok(state.records.length > 0 && state.records.length < 20);
  assert.ok(new TextEncoder().encode(JSON.stringify(state.records)).length <= 350000);
  assert.equal(session.apiKey,'fixture-key');
});
