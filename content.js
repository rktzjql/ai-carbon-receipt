(() => {
  let tracking = false;
  let last = null;
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
    if (info.image === 'none') return;
    // One composer generation: keyboard/click/form events share this ID until edited/reset.
    if (last?.prompt === prompt) return;
    const eventId = crypto.randomUUID();
    last = {prompt, eventId};
    // Verify that Gemini cleared its composer after the submission gesture.
    // A rejected Enter/click only creates a confirmation candidate, never an automatic call.
    let attempts = 0;
    const verify = () => {
      const current = editor();
      const cleared = current && !(current.value ?? current.innerText ?? '').trim();
      if (!cleared && ++attempts < 12) { setTimeout(verify, 150); return; }
      info.submission = cleared ? 'verified' : 'unknown';
      chrome.runtime.sendMessage({type: 'capture', eventId, prompt, evidence: info}).catch(() => {});
    };
    setTimeout(verify, 150);
  }
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
