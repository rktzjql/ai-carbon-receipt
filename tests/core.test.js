import test from 'node:test';
import assert from 'node:assert/strict';
import {requestBody, usageFrom, summarize, canAuto, cleanError, MODEL} from '../core.js';
import '../detector.js';
test('exact requested model, 1K and actual image response requested', () => {
  assert.equal(MODEL, 'gemini-3.1-flash-lite-image');
  const body = requestBody('그림을 그려줘');
  assert.deepEqual(body.contents[0].parts, [{text: '그림을 그려줘'}]);
  assert.deepEqual(body.generationConfig, {responseModalities: ['TEXT','IMAGE'], imageConfig: {imageSize: '1K'}});
  for (const p of ['', ' ', null, 'a'.repeat(16001)]) assert.throws(() => requestBody(p));
});
test('usage preserves API values and missing values, never invents totals', () => {
  const raw = {promptTokenCount: 7, candidatesTokenCount: 20, thoughtsTokenCount: 0, totalTokenCount: 31, candidatesTokensDetails: [{modality: 'IMAGE', tokenCount: 18}]};
  const u = usageFrom({usageMetadata: raw});
  assert.equal(u.total, 31); assert.equal(u.thoughts, 0); assert.equal(u.outputDetails[0].tokenCount, 18); assert.deepEqual(u.raw, raw);
  assert.equal(usageFrom({}).input, null); assert.equal(usageFrom({}).raw, null);
  assert.equal(usageFrom({usageMetadata: {promptTokenCount: -1}}).input, null);
});
test('image success distinct from text-only or blocked response', () => {
  assert.equal(summarize({candidates: [{content: {parts: [{inlineData: {mimeType: 'image/png', data: 'fixture'}}]}}]}).images, 1);
  assert.equal(summarize({candidates: [{content: {parts: [{text: 'No image'}]}}]}).images, 0);
  assert.equal(summarize({promptFeedback: {blockReason: 'SAFETY'}}).blockReason, 'SAFETY');
});
test('automatic generation requires all independent gates', () => {
  const s = {tracking:true, consent:true}; const e = {model:'verified', image:'verified', submission:'verified', attachments:false};
  assert.ok(canAuto(s,e));
  for (const key of ['model','image','submission']) assert.equal(canAuto(s,{...e,[key]:'unknown'}),false);
  assert.equal(canAuto(s,{...e,attachments:true}),false);
  assert.equal(canAuto({...s,consent:false},e),false); assert.equal(canAuto({...s,tracking:false},e),false);
});
test('model ambiguity and text mentions cannot authorize automatic image generation', () => {
  const d = globalThis.CarbonDetector;
  assert.equal(d.modelState(['Flash-Lite']).model,'verified');
  for (const labels of [[],['Flash'],['Flash-Lite','Pro'],['Choose Flash-Lite or Pro'],['Nano Banana 2 Lite']]) assert.equal(d.modelState(labels).model,'unknown');
  assert.equal(d.imageState('2 + 2?',false),'none');
  assert.equal(d.imageState('이미지 생성 비용을 설명해 줘',false),'uncertain');
  assert.equal(d.imageState('숲속 오두막',true),'verified');
});
test('errors redact supplied key',()=>assert.equal(cleanError('bad secret secret','secret'),'bad [REDACTED] [REDACTED]'));
