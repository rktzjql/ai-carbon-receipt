(() => {
  let tracking = false;
  let last = null;
  const jobs = new Map();
  const visible = el => el && el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true';
  chrome.runtime.sendMessage({type: 'trackingStatus'}).then(x => { tracking = x?.tracking === true; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) tracking = changes.settings.newValue?.tracking === true; });
  function editor() {
    return [...document.querySelectorAll('rich-textarea [contenteditable="true"], [contenteditable="true"][role="textbox"], textarea')].find(visible);
  }
  function evidence(prompt) {
    const labels = [...document.querySelectorAll('button[data-test-id="bard-mode-menu-button"], button[aria-label*="model" i], button[aria-label*="모델"]')].filter(visible).map(e => (e.innerText || e.getAttribute('aria-label') || '').trim());
    const model = CarbonDetector.modelState([...new Set(labels)]);
    const imageTool = [...document.querySelectorAll('[aria-pressed="true"], [aria-selected="true"]')].filter(visible).some(e => /^(create images?|generate images?|이미지 생성|이미지 만들기)$/i.test((e.innerText || e.getAttribute('aria-label') || '').trim()));
    const attachments = [...document.querySelectorAll('[data-test-id*="attachment"], [aria-label*="Remove file" i], [aria-label*="파일 삭제"]')].some(visible);
    return {...model, image: CarbonDetector.imageState(prompt, imageTool), attachments};
  }
  function capture() {
    if (!tracking) return;
    const input = editor();
    const prompt = (input?.value ?? input?.innerText ?? '').trim();
    if (!prompt || prompt.length > 16000) return;
    const info = evidence(prompt);
    // Image output, rather than words in the prompt, decides whether to call the API.
    // One composer generation: keyboard/click/form events share this ID until edited/reset.
    if (last?.prompt === prompt) return;
    const eventId = crypto.randomUUID();
    last = {prompt, eventId};

    const baseline = new Set(document.querySelectorAll('model-response'));
    const route = location.href;
    // Verify that Gemini cleared its composer after the submission gesture.
    // A rejected Enter/click only creates a confirmation candidate, never an automatic call.
    let attempts = 0;
    const verify = () => {
      const current = editor();
      const cleared = current && !(current.value ?? current.innerText ?? '').trim();
      if (!cleared && ++attempts < 12) { setTimeout(verify, 150); return; }
      info.submission = cleared ? 'verified' : 'unknown';
      chrome.runtime.sendMessage({type: 'capture', eventId, prompt, evidence: info}).then(reply => {
        if (reply?.ok) {
          const item = {eventId, prompt, baseline, route, submission:cleared, deadline: Date.now() + 180000};
          jobs.set(eventId, item);
          showReceipt(item, {status: cleared ? 'waiting-response' : 'unverified-submission'});
          while (jobs.size > 20) {
            const oldest = jobs.keys().next().value;
            jobs.get(oldest).host?.remove(); jobs.delete(oldest);
          }
        }
      }).catch(() => {});
    };
    setTimeout(verify, 150);
  }
  function showReceipt(item, record) {
    if (item.closed) return;
    item.record = record;
    const inline = item.response?.isConnected;
    if (item.host?.isConnected) {
      item.host.toggleAttribute('data-floating', !inline);
      const parent = inline ? item.response : document.body;
      if (item.host.parentNode !== parent) parent.append(item.host);
    }
    const signature = JSON.stringify(record);
    if (item.signature === signature && item.host?.isConnected) return;
    item.signature = signature;
    let receiptHost = item.host;
    if (!receiptHost?.isConnected) {
      receiptHost = document.createElement('aside');
      receiptHost.setAttribute('aria-label', 'Gemini 탄소 영수증');
      receiptHost.toggleAttribute('data-floating', !inline);
      const shadow = receiptHost.attachShadow({mode: 'closed'});
      const style = document.createElement('style');
      style.textContent = ':host{display:block;margin:16px 0;width:100%;max-width:680px} :host([data-floating]){position:fixed;bottom:16px;right:16px;width:min(420px,90vw);z-index:2147483647} section{background:#fff;color:#18251b;border:1px solid #56765d;border-radius:12px;padding:16px;font:14px/1.5 system-ui;box-shadow:0 3px 18px #0003;max-height:35vh;overflow:auto}h2{font-size:16px;margin:0 0 8px}p{margin:6px 0}button{float:right}';
      const box = document.createElement('section');
      shadow.append(style, box); receiptHost.box = box;
      (inline ? item.response : document.body).append(receiptHost);
      item.host = receiptHost;
    }
    const box = receiptHost.box; box.replaceChildren();
    const close = document.createElement('button'); close.textContent = '닫기';
    close.onclick = () => {receiptHost.remove(); item.closed = true;}; box.append(close);
    const title = document.createElement('h2'); title.textContent = 'Gemini 이미지 영수증'; box.append(title);
    const line = text => {const p = document.createElement('p'); p.textContent = text; box.append(p);};
    const states = {'waiting-response':'프롬프트 인식 완료 · Gemini 응답 연결 대기', 'waiting-image':'응답 연결 완료 · 생성 이미지 로딩 대기', 'image-detected':'이미지 감지 완료 · 자동 전송 준비 중', 'unverified-submission':'프롬프트는 인식했지만 제출 완료를 확인하지 못했습니다.', 'detection-timeout':'이미지 감지 시간이 지났습니다. API는 호출하지 않았습니다.', dismissed:'API 호출하지 않음', pending:'확장프로그램 패널에서 모델 확인과 별도 유료 호출 동의가 필요합니다.', running:'별도 API 요청 중 · 추가 요금 발생', error:'API 요청 실패', success:'별도 API 이미지 생성 완료', 'no-image':'API 응답에 이미지 없음'};
    line(states[record.status] || record.status);
    if (record.reason) line(record.reason);
    if (record.error) line(record.error);
    if (!record.result) {
      if (record.status === 'waiting-response') line('생성 이미지가 이미 보인다면 응답과 프롬프트를 연결하지 못한 상태입니다.');
      if (record.status === 'waiting-image') line('이미지가 이미 보인다면 생성 이미지 표시 구조를 확인하지 못한 상태입니다.');
      return;
    }
    if (record.result) {
      const u = record.result.usage;
      line(`토큰: 별도 API 실측 · 입력 ${u.input ?? '미제공'} / 출력 ${u.output ?? '미제공'} / 사고 ${u.thoughts ?? '미제공'} / 전체 ${u.total ?? '미제공'}`);
      line(`Gemini 화면 생성 이미지: ${record.websiteImages}장 · 별도 API 응답 이미지: ${record.result.images}장`);
    }
    const energy = record.result?.energy;
    line(energy?.wh != null ? `전력: 약 ${energy.wh.toFixed(3)} Wh · 가정 기반 추정` : '전력: 미산정 — 별도 API 전체 토큰 미제공');
    line('계산: 별도 API 전체 토큰 × 0.001921 Wh/token · 사용자 지정 임시 계수, 출처·Gemini 이미지 생성 적용 타당성 미검증');
    line(energy?.carbonGrams != null ? `탄소: 약 ${energy.carbonGrams.toFixed(3)} g CO₂eq · 가정 기반 추정` : '탄소: 미산정 — 계산에 필요한 값 없음');
    line('미국 가정: 0.341 kg CO₂eq/kWh · 사용자 제공 계수, 출처·기준연도·실제 서버 지역 미확인');
    line('물: 미산정 — 검증된 환산계수 없음');
    line('Gemini 웹 응답의 토큰·환경 영향 실측값이 아닙니다. 전력 추정은 별도 API 요청만 대상으로 하며, 웹사이트 생성과 합산하지 않습니다.');
  }
  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
  function matchesPrompt(response, prompt) {
    const turn = response.closest('conversation-container, .conversation-container');
    const query = turn?.querySelector('user-query .query-text')
      || turn?.querySelector('user-query [data-test-id="user-query"]')
      || turn?.querySelector('user-query');
    return query && normalize(query.innerText || query.textContent) === normalize(prompt);
  }
  function bindResponse(item) {
    const responses = [...document.querySelectorAll('model-response')].filter(el => !item.baseline.has(el));
    const matched = responses.filter(response => matchesPrompt(response, item.prompt));
    // Bind to the exact submitted prompt, including the new-chat URL transition.
    // If Gemini's turn markup changes, stop rather than charge for the wrong turn.
    if (matched.length !== 1) return null;
    const response = matched[0];
    if ([...jobs.values()].some(job => job !== item && job.response === response)) return null;
    if (location.href !== item.route) {
      const before = new URL(item.route);
      const after = new URL(location.href);
      if (!/^\/app\/?$/.test(before.pathname) || !/^\/app\/[^/]+$/.test(after.pathname)) return null;
      item.route = location.href;
    }
    return response;
  }
  function inspectOutput(item) {
    if (item.sent) return;
    if (Date.now() > item.deadline) {
      item.done = true; showReceipt(item, {status:'detection-timeout'}); return;
    }
    const response = bindResponse(item);
    if (!response) return;
    item.response = response;
    showReceipt(item, {status:'waiting-image'});
    const images = [...response.querySelectorAll('generated-image img, [data-test-id="generated-image"] img')]
      .filter(img => visible(img) && img.complete && img.naturalWidth > 0);
    if (!images.length) return;
    item.response = response;
    item.sent = true;
    showReceipt(item, {status:'image-detected'});
    // Do not block polling while the worker waits for the API response.
    chrome.runtime.sendMessage({type:'generatedImage', eventId:item.eventId, images:images.length, submissionVerified:true})
      .then(reply => {
        if (!reply?.ok) {
          item.done = true;
          showReceipt(item, {status:'error', error:reply?.error || '확장프로그램 응답이 없습니다.'});
        }
      }).catch(() => {
        item.done = true;
        showReceipt(item, {status:'error', error:'확장프로그램 연결이 끊겼습니다. 중복 과금을 막기 위해 자동 재시도하지 않습니다.'});
      });
  }
  let lastRestore = 0;
  async function restoreReceipts() {
    if (Date.now() - lastRestore < 3000) return;
    lastRestore = Date.now();
    const route = location.href;
    const reply = await chrome.runtime.sendMessage({type:'receipts'});
    if (location.href !== route) return;
    for (const record of reply?.records || []) {
      if (jobs.has(record.eventId)) continue;
      const item = {eventId:record.eventId, prompt:record.prompt, route, sent:true, restored:true};
      const matched = [...document.querySelectorAll('model-response')].filter(r => matchesPrompt(r, record.prompt));
      if (matched.length === 1) item.response = matched[0];
      jobs.set(item.eventId, item);
      showReceipt(item, record);
      item.done = ['success','no-image','error','dismissed'].includes(record.status);
    }
  }
  let polling = false;
  setInterval(async () => {
    if (polling || !tracking) return;
    polling = true;
    try {
      await restoreReceipts();
      for (const item of jobs.values()) {
        if (location.href !== item.route) {
          const before = new URL(item.route), after = new URL(location.href);
          const newChat = /^\/app\/?$/.test(before.pathname) && /^\/app\/[^/]+$/.test(after.pathname);
          if (!newChat) {item.host?.remove(); jobs.delete(item.eventId); continue;}
        }
        if (item.sent && !item.response?.isConnected) {
          const matched = [...document.querySelectorAll('model-response')].filter(r => matchesPrompt(r, item.prompt));
          if (matched.length === 1) item.response = matched[0];
          if (item.record) showReceipt(item, item.record);
        }
        if (item.done) {if (item.record) showReceipt(item, item.record); continue;}
        inspectOutput(item);
        if (item.sent && location.href === item.route) {
          const response = await chrome.runtime.sendMessage({type:'receipt', eventId:item.eventId});
          if (response?.record && !item.done) {
            showReceipt(item, response.record);
            if (['success','no-image','error','dismissed'].includes(response.record.status)) item.done = true;
          }
        }
      }
    } catch {} finally {polling = false;}
  }, 1000);
  document.addEventListener('input', e => {
    const input = editor();
    if (input && (e.target === input || input.contains(e.target))) last = null;
  }, true);
  document.addEventListener('keydown', e => {
    const input = editor();
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing && input && (e.target === input || input.contains(e.target))) capture();
  }, true);
  document.addEventListener('click', e => {
    const button = e.target.closest?.('button');
    if (!button || button.disabled) return;
    const label = (button.getAttribute('aria-label') || '').trim();
    if (button.matches('[data-test-id="send-button"]') || /^(send|send message|submit|전송|보내기|메시지 보내기)$/i.test(label)) capture();
  }, true);
  document.addEventListener('submit', e => { if (e.target.contains(editor())) capture(); }, true);
})();
