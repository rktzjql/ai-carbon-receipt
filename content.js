(() => {
  const responseSelector = 'model-response, [data-message-author-role="assistant"], [data-message-author-role="model"]';
  const querySelector = 'user-query, [data-message-author-role="user"]';
  const normalize = text => String(text || '').replace(/[\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
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

    const baseline = new Set(document.querySelectorAll(responseSelector));
    const route = location.href;
    // Verify that Gemini cleared its composer after the submission gesture.
    // A rejected Enter/click only creates a confirmation candidate, never an automatic call.
    let attempts = 0;
    const verify = () => {
      const current = editor();
      const cleared = current && !normalize(current.value ?? current.innerText ?? '');
      if (!cleared && ++attempts < 12) { setTimeout(verify, 150); return; }
      info.submission = cleared ? 'verified' : 'unknown';
      chrome.runtime.sendMessage({type: 'capture', eventId, prompt, evidence: info}).then(reply => {
        if (reply?.ok) {
          const item = {eventId, prompt, baseline, route, submission:cleared, deadline: Date.now() + 180000};
          jobs.set(eventId, item);
          showReceipt(item, {status:'waiting-response'});
          while (jobs.size > 20) {
            const oldest = jobs.keys().next().value;
            jobs.get(oldest).host?.remove(); jobs.delete(oldest);
          }
        }
      }).catch(() => {});
    };
    setTimeout(verify, 150);
  }
  // Receipt-only positioning: leave Gemini's image, containers and styles untouched.
  function positionReceipt(item) {
    const host = item.host;
    if (!host?.isConnected || item.closed) return;
    const inline = item.response?.isConnected;
    const image = inline && [...item.response.querySelectorAll('generated-image img, [data-test-id="generated-image"] img, image-generation-content img, .generated-image img')]
      .find(img => img.complete && img.naturalWidth > 0 && visible(img));
    const rect = image?.getBoundingClientRect?.();
    const viewportWidth = document.documentElement?.clientWidth;
    const viewportHeight = document.documentElement?.clientHeight;
    const sideWidth = rect ? Math.min(350, viewportWidth - rect.right - 32) : 0;
    const beside = Boolean(rect && rect.width > 0 && rect.height >= 180 && sideWidth >= 320);
    host.toggleAttribute('data-floating', !inline);
    host.toggleAttribute('data-beside', beside);
    host.toggleAttribute('data-offscreen', beside && (rect.bottom <= 16 || rect.top >= viewportHeight - 16));
    const parent = beside || !inline ? document.body : item.response;
    if (host.parentNode !== parent) parent.append(host);
    if (beside) {
      const top = Math.max(16, rect.top);
      host.style.setProperty('--gdcr-width', `${sideWidth}px`);
      host.style.setProperty('--gdcr-left', `${rect.right + 16}px`);
      host.style.setProperty('--gdcr-top', `${top}px`);
      host.style.setProperty('--gdcr-side-height', `${Math.max(0, Math.min(rect.bottom, viewportHeight - 16) - top)}px`);
      host.style.removeProperty('margin-left');
    } else if (inline && rect && viewportWidth) {
      // On narrow screens align the below-image receipt with the image's left edge.
      const parentRect = item.response.getBoundingClientRect();
      const offset = Math.max(0, Math.min(rect.left - parentRect.left, parentRect.width - Math.min(350, parentRect.width)));
      host.style.setProperty('margin-left', `${offset}px`);
    } else {
      host.style?.removeProperty('margin-left');
    }
  }
  let layoutFrame = false;
  function scheduleReceiptLayout() {
    if (layoutFrame) return;
    layoutFrame = true;
    const update = () => {layoutFrame = false; for (const item of jobs.values()) positionReceipt(item);};
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update); else update();
  }
  document.addEventListener('scroll', scheduleReceiptLayout, {capture:true, passive:true});
  globalThis.addEventListener?.('resize', scheduleReceiptLayout, {passive:true});
  function showReceipt(item, record) {
    if (item.closed) return;
    item.record = record;
    const inline = item.response?.isConnected;
    positionReceipt(item);
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
      style.textContent = `
        :host{all:initial;display:block;width:min(350px,100%);margin:20px 0;color-scheme:light;contain:style}
        :host([data-floating]){position:fixed;bottom:16px;right:16px;width:min(350px,calc(100vw - 32px));z-index:2147483647}
        :host([data-beside]){position:fixed;left:var(--gdcr-left);top:var(--gdcr-top);width:var(--gdcr-width);max-width:calc(100vw - 32px);margin:0;z-index:100}
        :host([data-offscreen]){visibility:hidden;pointer-events:none}
        :host([data-beside]) .gdcr-paper{max-height:var(--gdcr-side-height);overflow:auto;overscroll-behavior:contain}
        .gdcr-paper,.gdcr-paper *{box-sizing:border-box}
        .gdcr-paper{position:relative;background:#fbf7e9;color:#20241f;border:1px solid #c9c6b8;padding:24px 22px 20px;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;overflow-wrap:anywhere;isolation:isolate}
        :host([data-floating]) .gdcr-paper{max-height:75vh;max-height:75dvh;overflow:auto}
        .gdcr-paper::after{content:"";display:block;margin:20px -22px -20px;height:6px;background:linear-gradient(135deg,#c9c6b8 25%,transparent 25%) 0 0/8px 8px,linear-gradient(225deg,#c9c6b8 25%,transparent 25%) 0 0/8px 8px;transform:rotate(180deg)}
        .gdcr-close{display:block;margin:-14px -12px 4px auto;padding:5px 8px;border:0;border-radius:2px;background:transparent;color:#4b5047;font:inherit;font-size:11px;cursor:pointer}
        :host([data-collapsed]) .gdcr-paper{padding:10px 14px}
        :host([data-collapsed]) .gdcr-paper>:not(.gdcr-toggle){display:none}
        :host([data-collapsed]) .gdcr-paper::after{display:none}
        :host([data-collapsed]) .gdcr-toggle{margin:0;width:100%;text-align:center;color:#214c3c;font-size:12px}
        .gdcr-close:hover{background:#e7e5d7;color:#163d2c}
        .gdcr-close:focus-visible,.gdcr-details summary:focus-visible{outline:2px solid #214c3c;outline-offset:3px}
        .gdcr-header{text-align:center;padding-bottom:18px;border-bottom:1px solid #626b5e}
        .gdcr-leaf{position:relative;display:block;width:14px;height:22px;margin:0 auto 12px;border:1.5px solid #214c3c;border-radius:14px 0 14px 0;transform:rotate(28deg)}
        .gdcr-leaf::after{content:"";position:absolute;left:5px;top:3px;width:1px;height:19px;background:#214c3c;transform:rotate(26deg)}
        .gdcr-title{margin:0;color:#214c3c;font:700 18px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.06em}
        .gdcr-subtitle{margin:7px 0 0;font-size:9px;letter-spacing:.08em;line-height:1.6;color:#4b5047}
        .gdcr-meta{padding:14px 0;border-bottom:1px dashed #999e8e}
        .gdcr-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:8px;margin:5px 0;align-items:baseline}
        .gdcr-label{color:#4b5047}
        .gdcr-value{text-align:right;font-variant-numeric:tabular-nums}
        .gdcr-caption{margin:7px 0 0;color:#4b5047;font-size:11px;line-height:1.65}
        .gdcr-status{margin:9px 0 0;padding:7px 9px;border-left:2px solid #214c3c;font-size:11px;background:#f0eedf;color:#214c3c}
        .gdcr-error{color:#852e22}
        .gdcr-costs{padding:16px 0;border-bottom:1px dashed #999e8e}
        .gdcr-section-title{margin:0 0 10px;font-size:10px;font-weight:400;letter-spacing:.08em;color:#214c3c}
        .gdcr-costs .gdcr-row{margin:10px 0}
        .gdcr-costs .gdcr-value{font-size:17px;font-weight:700;color:#20241f}
        .gdcr-unit{font-size:11px;font-weight:400;color:#4b5047;white-space:nowrap}
        .gdcr-equivalent{padding:16px 0;border-bottom:1px solid #626b5e}
        .gdcr-equivalent p{margin:0}
        .gdcr-equivalent strong{font-size:18px;color:#214c3c;font-variant-numeric:tabular-nums}
        .gdcr-motto{margin:18px 0;text-align:center;font:600 13px/1.8 system-ui,sans-serif;color:#214c3c;word-break:keep-all}
        .gdcr-details{margin-top:12px;color:#4b5047;font-size:11px;line-height:1.7}
        .gdcr-details summary{cursor:pointer;padding:4px 0;color:#214c3c}
        .gdcr-details p{margin:6px 0}
        .gdcr-footer{margin-top:16px;padding-top:13px;border-top:1px dashed #999e8e;text-align:center;color:#214c3c;font-size:11px;font-weight:700;letter-spacing:.18em}
        @media(max-width:360px){.gdcr-paper{padding:20px 16px 16px}.gdcr-title{font-size:16px}.gdcr-paper::after{margin:16px -16px -16px}.gdcr-costs .gdcr-value{font-size:15px}}
        @media(forced-colors:active){.gdcr-paper{border-color:CanvasText}.gdcr-status{border-color:CanvasText}.gdcr-leaf{border-color:CanvasText}}
      `;
      const box = document.createElement('section'); box.className = 'gdcr-paper';
      shadow.append(style, box); receiptHost.box = box;
      (inline ? item.response : document.body).append(receiptHost);
      item.host = receiptHost;
      positionReceipt(item);
    }
    const box = receiptHost.box; box.replaceChildren();
    const el = (tag, className, text) => {
      const node = document.createElement(tag); node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const toggle = el('button', 'gdcr-close gdcr-toggle'); toggle.type = 'button';
    const updateToggle = () => {
      receiptHost.toggleAttribute('data-collapsed', item.collapsed === true);
      toggle.textContent = item.collapsed ? '영수증 보기 ▾' : '접기 ▴';
      toggle.setAttribute('aria-label', item.collapsed ? '영수증 펼치기' : '영수증 접기');
      toggle.setAttribute('aria-expanded', String(!item.collapsed));
    };
    toggle.onclick = () => {item.collapsed = !item.collapsed; updateToggle(); positionReceipt(item);};
    updateToggle(); box.append(toggle);
    const header = el('header', 'gdcr-header');
    const leaf = el('span', 'gdcr-leaf'); leaf.setAttribute('aria-hidden', 'true');
    header.append(leaf, el('h2', 'gdcr-title', 'AI CARBON RECEIPT'), el('p', 'gdcr-subtitle', 'THE HIDDEN COST OF GENERATION'));
    box.append(header);
    const row = (parent, label, value, unit) => {
      const entry = el('div', 'gdcr-row');
      const output = el('span', 'gdcr-value', value);
      if (unit) output.append(el('span', 'gdcr-unit', ` ${unit}`));
      entry.append(el('span', 'gdcr-label', label), output); parent.append(entry);
    };
    const states = {'waiting-response':'프롬프트 인식 완료 · Gemini 응답 연결 대기', 'waiting-image':'응답 연결 완료 · 생성 이미지 로딩 대기', 'image-detected':'이미지 감지 완료 · 자동 전송 준비 중', 'unverified-submission':'프롬프트는 인식했지만 제출 완료를 확인하지 못했습니다.', 'detection-timeout':'이미지 감지 시간이 지났습니다. API는 호출하지 않았습니다.', dismissed:'API 호출하지 않음', pending:'확장프로그램 패널에서 모델 확인과 별도 유료 호출 동의가 필요합니다.', running:'별도 API 요청 중 · 추가 요금 발생', error:'API 요청 실패', 'no-image':'API 응답에 이미지 없음'};
    const meta = el('section', 'gdcr-meta'); meta.setAttribute('aria-label', '측정 정보');
    row(meta, '서비스', 'Google Gemini');
    const usage = record.result?.usage;
    row(meta, '사용 토큰', usage?.total == null ? '미제공' : String(usage.total), 'tokens');
    meta.append(el('p', 'gdcr-caption', usage?.total != null ? '토큰: 별도 API 응답 실측값 · 추정 아님' : record.result ? '토큰: API 응답 미제공 · 추정하지 않음' : '토큰: API 응답 대기 · 추정하지 않음'));
    if (usage) meta.append(el('p', 'gdcr-caption', `입력 ${usage.input ?? '미제공'} · 출력 ${usage.output ?? '미제공'} · 사고 ${usage.thoughts ?? '미제공'}`));
    if (record.status !== 'success') {
      const status = el('p', 'gdcr-status', states[record.status] || record.status);
      status.setAttribute('role', 'status'); meta.append(status);
    }
    if (record.reason) meta.append(el('p', 'gdcr-caption', record.reason));
    if (record.error) meta.append(el('p', 'gdcr-caption gdcr-error', record.error));
    if (record.status === 'waiting-response') meta.append(el('p', 'gdcr-caption', '생성 이미지가 이미 보인다면 응답과 프롬프트를 연결하지 못한 상태입니다.'));
    if (record.status === 'waiting-image') meta.append(el('p', 'gdcr-caption', '이미지가 이미 보인다면 생성 이미지 표시 구조를 확인하지 못한 상태입니다.'));
    box.append(meta);
    const energy = record.result?.energy;
    const costs = el('section', 'gdcr-costs'); costs.setAttribute('aria-label', '환경비용 추정치');
    costs.append(el('h3', 'gdcr-section-title', 'ESTIMATED ENVIRONMENTAL COST'));
    row(costs, '전력 소비량', energy?.wh != null ? energy.wh.toFixed(3) : '미산정', 'Wh');
    row(costs, '탄소배출량', energy?.carbonGrams != null ? energy.carbonGrams.toFixed(3) : '미산정', 'gCO₂e');
    box.append(costs);
    const equivalent = el('section', 'gdcr-equivalent');
    equivalent.append(el('h3', 'gdcr-section-title', 'IN EVERYDAY LIFE'), el('p', 'gdcr-caption', '1,000W 전자레인지 사용 시간'));
    const seconds = energy?.wh != null ? (energy.wh * 3.6).toFixed(2) : null;
    const comparison = el('p', 'gdcr-caption');
    comparison.append(el('strong', '', seconds === null ? '미산정' : `약 ${seconds}초`)); equivalent.append(comparison);
    equivalent.append(el('p', 'gdcr-caption', '전력량(Wh) × 3.6 · 동일 전력량 기준 비교'));
    box.append(equivalent, el('p', 'gdcr-motto', '생성은 순간, 환경비용은 남습니다.'));
    const notes = el('details', 'gdcr-details');
    notes.append(el('summary', '', '추정치 및 산정 기준'));
    notes.append(el('p', '', '전력·탄소는 가정 기반 추정치입니다. 별도 API 요청만 대상으로 하며 Gemini 웹사이트 생성 비용과 합산하지 않습니다.'));
    notes.append(el('p', '', `전력: 전체 토큰 × ${energy?.whPerToken ?? '미제공'} Wh/token. 사용자 지정 임시 계수이며 출처·Gemini 이미지 생성 적용 타당성은 미검증입니다.`));
    notes.append(el('p', '', `탄소: 전력(Wh) ÷ 1,000 × ${energy?.kgCO2eqPerKwh ?? '미제공'} kg CO₂eq/kWh × 1,000. 미국 기준 사용자 제공 계수이며 출처·기준연도·실제 서버 지역은 미확인입니다.`));
    notes.append(el('p', '', '전체 토큰은 API 응답값을 그대로 표시하며, 누락 시 합산하거나 추정하지 않습니다.'));
    if (record.result) notes.append(el('p', '', `Gemini 화면 생성 이미지: ${record.websiteImages ?? '미제공'}장 · 별도 API 응답 이미지: ${record.result.images}장`));
    box.append(notes);
    if (record.diagnostic) {
      const details = el('details', 'gdcr-details');
      details.append(el('summary', '', '연결 진단'), el('p', '', record.diagnostic)); box.append(details);
    }
    box.append(el('footer', 'gdcr-footer', 'SAVE THE PLANET'));
  }
  function queryMatches(query, prompt) {
    if (!query) return false;
    const expected = normalize(prompt);
    const nodes = [...(query.querySelectorAll?.('.query-text, .query-text-line, [data-test-id="query-text"], p, div, span') || [])];
    // Match exact text inside the user turn, excluding labels and action buttons.
    if ([query, ...nodes].some(node => normalize(node.innerText || node.textContent) === expected)) return true;
    const lines = [...(query.querySelectorAll?.('.query-text-line') || [])];
    return lines.length > 0 && normalize(lines.map(node => node.innerText || node.textContent).join('\n')) === expected;
  }
  function queryForResponse(response) {
    const turn = response.closest('conversation-container, .conversation-container');
    if (turn) {
      const query = turn.querySelector(querySelector);
      if (query) return query;
      // Older UI layouts expose only the inner prompt element.
      const text = turn.querySelector('user-query .query-text');
      if (text) return text;
    }
    // Some layouts put the user and model turns in separate sibling containers.
    // Only the nearest preceding user turn can own a response.
    const before = [...document.querySelectorAll(querySelector)].filter(query => {
      const order = response.compareDocumentPosition(query);
      return !(order & 1) && Boolean(order & 2);
    });
    return before.at(-1);
  }
  function matchesPrompt(response, prompt) {
    return queryMatches(queryForResponse(response), prompt);
  }
  function bindResponse(item) {
    const responses = [...document.querySelectorAll(responseSelector)].filter(el => !item.baseline.has(el));
    const matched = responses.filter(response => matchesPrompt(response, item.prompt));
    // Bind to the exact submitted prompt, including the new-chat URL transition.
    // If Gemini's turn markup changes, stop rather than charge for the wrong turn.
    if (matched.length !== 1) {
      showReceipt(item, {status:'waiting-response', reason:responses.length ? '응답을 찾았지만 제출한 문장과 아직 연결하지 못했습니다.' : 'Gemini의 새 응답을 기다리고 있습니다.',
        diagnostic:`새 응답 ${responses.length}개 · 일치하는 사용자 문장 ${matched.length}개 · 사용자 메시지 ${document.querySelectorAll(querySelector).length}개`});
      return null;
    }
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
    const images = [...response.querySelectorAll('generated-image img, [data-test-id="generated-image"] img, image-generation-content img, .generated-image img')]
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
      const matched = [...document.querySelectorAll(responseSelector)].filter(r => matchesPrompt(r, record.prompt));
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
      await restoreReceipts().catch(() => {});
      for (const item of jobs.values()) {
        if (location.href !== item.route) {
          const before = new URL(item.route), after = new URL(location.href);
          const newChat = /^\/app\/?$/.test(before.pathname) && /^\/app\/[^/]+$/.test(after.pathname);
          if (!newChat) {item.host?.remove(); jobs.delete(item.eventId); continue;}
        }
        if (item.sent && !item.response?.isConnected) {
          const matched = [...document.querySelectorAll(responseSelector)].filter(r => matchesPrompt(r, item.prompt));
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
    } catch (error) {
      for (const item of jobs.values()) {
        if (!item.done && !item.closed) showReceipt(item, {status:'error', error:'화면 감지 연결에 문제가 생겼습니다. Gemini 탭을 새로고침하세요.', diagnostic:String(error.message).slice(0,200)});
      }
    } finally {polling = false;}
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
