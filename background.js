import {MODEL, API_ROOT, requestBody, summarize, canAuto, cleanError} from './core.js';
const defaults = {tracking: false, consent: false};
const initialized = chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
let queue = Promise.resolve();
const settings = async () => ({...defaults, ...(await chrome.storage.local.get('settings')).settings});
const records = async () => (await chrome.storage.session.get('records')).records ?? [];
async function save(record) {
  const all = await records();
  const index = all.findIndex(r => r.id === record.id);
  if (index >= 0) all[index] = record; else all.unshift(record);
  // Chrome 102–111 has a 1 MB session quota shared with the key and deduplication IDs.
  const retained = all.slice(0, 20);
  while (retained.length > 1 && new TextEncoder().encode(JSON.stringify(retained)).length > 350000) retained.pop();
  await chrome.storage.session.set({records: retained});
}
async function api(path, body) {
  const key = (await chrome.storage.session.get('apiKey')).apiKey;
  if (!key) throw new Error('설정에서 이번 브라우저 세션의 Gemini API 키를 입력하세요.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${API_ROOT}/${path}`, {method: body ? 'POST' : 'GET', headers: {'x-goog-api-key': key, ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {}), signal: controller.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error?.message ?? 'API 요청 실패'}`);
    return data;
  } catch (e) { throw new Error(cleanError(e.message, key)); }
  finally { clearTimeout(timer); }
}
async function run(record) {
  if (record.status !== 'pending') return;
  if (!(await chrome.storage.session.get('apiKey')).apiKey) throw new Error('먼저 설정에서 API 키를 입력하세요.');
  const body = requestBody(record.prompt);
  record.status = 'running'; record.startedAt = Date.now();
  // Persist before the request. A suspended worker never automatically retries an ambiguous result.
  await save(record);
  try {
    record.result = summarize(await api(`models/${MODEL}:generateContent`, body));
    record.status = record.result.images > 0 ? 'success' : 'no-image';
  } catch (e) { record.status = 'error'; record.error = e.message; }
  record.finishedAt = Date.now();
  await save(record);
}
function trusted(sender) {
  return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('')) && !sender.tab?.url?.startsWith('https://gemini.google.com/');
}
function website(sender) { return sender.id === chrome.runtime.id && sender.frameId === 0 && sender.url?.startsWith('https://gemini.google.com/'); }
async function handle(msg, sender) {
  await initialized;
  if (msg.type === 'trackingStatus' && website(sender)) return {tracking: (await settings()).tracking};
  if (msg.type === 'capture' && website(sender)) {
    const config = await settings();
    if (!config.tracking) return {};
    requestBody(msg.prompt);
    if (typeof msg.eventId !== 'string' || !/^[a-f0-9-]{36}$/.test(msg.eventId)) throw new Error('Invalid event ID');
    const id = `${sender.tab.id}:${msg.eventId}`;
    // Tombstones survive history trimming, so a repeated delivery cannot generate a second request.
    const seen = (await chrome.storage.session.get('seen')).seen ?? {};
    if (seen[id]) return {duplicate: true};
    if (Object.keys(seen).length >= 2000) throw new Error('세션 감지 한도에 도달했습니다. 브라우저를 재시작하세요.');
    seen[id] = true; await chrome.storage.session.set({seen});
    const record = {id, prompt: msg.prompt, evidence: msg.evidence, source: 'website', status: 'pending', createdAt: Date.now()};
    await save(record);
    if (canAuto(config, msg.evidence)) await run(record);
    return {};
  }
  if (!trusted(sender)) throw new Error('허용되지 않은 메시지 출처');
  switch (msg.type) {
    case 'state': return {settings: await settings(), records: await records(), hasKey: Boolean((await chrome.storage.session.get('apiKey')).apiKey)};
    case 'saveSettings': await chrome.storage.local.set({settings: {tracking: msg.tracking === true, consent: msg.consent === true}}); return {};
    case 'saveKey': if (typeof msg.key !== 'string' || !msg.key.trim()) throw new Error('키를 입력하세요.'); await chrome.storage.session.set({apiKey: msg.key.trim()}); return {};
    case 'clearKey': await chrome.storage.session.remove('apiKey'); return {};
    case 'checkModel': {
      const data = await api(`models/${MODEL}`);
      return {name: data.name, displayName: data.displayName, supportedGenerationMethods: data.supportedGenerationMethods};
    }
    case 'manual': {
      requestBody(msg.prompt);
      if (msg.confirmed !== true) throw new Error('별도 유료 API 이미지 생성에 동의해야 합니다.');
      const record = {id: crypto.randomUUID(), prompt: msg.prompt, source: 'manual', status: 'pending', createdAt: Date.now()};
      await run(record); return {};
    }
    case 'confirm': {
      const record = (await records()).find(r => r.id === msg.id);
      if (!record || record.status !== 'pending') return {};
      if (msg.confirmed !== true) throw new Error('모델과 이미지 요청을 직접 확인하세요.');
      record.manualConfirmation = true; await run(record); return {};
    }
    case 'dismiss': { const record = (await records()).find(r => r.id === msg.id); if (record?.status === 'pending') {record.status = 'dismissed'; await save(record);} return {}; }
    case 'clearHistory': await chrome.storage.session.remove('records'); return {};
    default: throw new Error('알 수 없는 요청');
  }
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  // Read-only state queries remain responsive while a generation is in flight.
  const work = () => handle(msg, sender);
  const result = ['state', 'trackingStatus'].includes(msg?.type) ? work() : queue.then(work);
  if (!['state', 'trackingStatus'].includes(msg?.type)) queue = result.catch(() => {});
  result.then(value => respond({ok: true, ...value}), error => respond({ok: false, error: error.message}));
  return true;
});
