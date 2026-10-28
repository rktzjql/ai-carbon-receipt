import {send, element} from './ui.js';
const $ = selector => document.querySelector(selector);
let busy = false;
async function action(task) {
  if (busy) return;
  busy = true; $('#notice').textContent = '처리 중입니다. API 요청은 최대 120초 걸릴 수 있습니다.';
  try { await task(); $('#notice').textContent = '완료했습니다. 아래 결과를 확인하세요.'; }
  catch (e) { $('#notice').textContent = e.message; }
  finally {busy = false; await refresh().catch(e => {$('#notice').textContent = e.message;});}
}
const statuses = {'waiting-image': 'Gemini 생성 이미지 대기', pending: '확인 대기', running: '요청 중 / 결과 미확정', success: '이미지 생성 성공', 'no-image': '응답 수신 · 이미지 없음', error: 'API 요청 실패', dismissed: '호출하지 않음'};
function renderRecord(record) {
  const box = element('article');
  box.append(element('h3', statuses[record.status] || record.status), element('p', `${new Date(record.createdAt).toLocaleString()} · ${record.source === 'manual' ? '단독 API 테스트' : '웹사이트 감지 후보'}`), element('pre', record.prompt, 'prompt'));
  if (record.evidence) box.append(element('p', `웹 모델: ${record.evidence.modelLabel} · 이미지 판단: ${record.evidence.image} · 제출 확인: ${record.evidence.submission === 'verified' ? '확인' : '불확실'}${record.evidence.attachments ? ' · 첨부 감지: 텍스트만 전송됨' : ''}`));
  if (record.status === 'pending') {
    const label = element('label', undefined, 'check'); const check = element('input'); check.type = 'checkbox';
    label.append(check, document.createTextNode('Gemini 웹사이트에서 Flash-Lite가 선택되었고 이 프롬프트를 이미지 생성으로 제출했음을 직접 확인했습니다. 텍스트만 별도 API로 전송하고 요금을 부담하는 데 동의합니다.'));
    const button = element('button', '확인 후 API 1회 호출'); button.disabled = true;
    check.addEventListener('change', () => {button.disabled = !check.checked;});
    button.addEventListener('click', () => action(() => send({type: 'confirm', id: record.id, confirmed: check.checked})));
    const dismiss = element('button', '호출하지 않기'); dismiss.addEventListener('click', () => action(() => send({type: 'dismiss', id: record.id})));
    box.append(label, button, dismiss);
  }
  if (record.status === 'running') box.append(element('p', '중단·시간 초과로 결과가 도착하지 않을 수도 있습니다. 중복 과금 방지를 위해 자동 재시도하지 않습니다.'));
  if (record.reason) box.append(element('p', record.reason));
  if (record.error) box.append(element('pre', record.error, 'error'));
  if (record.result) {
    const r = record.result;
    box.append(element('p', `API 응답 이미지 수: ${r.images} · 응답 모델: ${r.modelVersion ?? '미제공'} · 종료 사유: ${r.finishReasons.join(', ') || r.blockReason || '미제공'}`));
    box.append(element('p', r.energy?.wh != null ? `전력: 약 ${r.energy.wh.toFixed(3)} Wh (가정 기반 추정)` : '전력: 미산정 — 전체 토큰 미제공'));
    box.append(element('p', '별도 API 전체 토큰 × 0.001518 Wh/token. 사용자 지정 임시 계수이며 출처·Gemini 이미지 생성 적용 타당성은 미검증입니다. 웹사이트 생성 전력은 포함하지 않습니다.'));
    box.append(element('p', r.energy?.carbonGrams != null ? `탄소: 약 ${r.energy.carbonGrams.toFixed(3)} g CO₂eq (가정 기반 추정)` : '탄소: 미산정 — 계산에 필요한 값 없음'));
    box.append(element('p', '미국 가정: 0.341 kg CO₂eq/kWh · 사용자 제공 계수, 출처·기준연도·실제 서버 지역 미확인'));
    box.append(element('p', '물: 미산정 — 검증된 환산계수 없음'));
    const table = element('table');
    for (const [label, value] of [['입력 토큰', r.usage.input], ['출력 토큰', r.usage.output], ['사고 토큰', r.usage.thoughts], ['전체 토큰', r.usage.total]]) {
      const row = element('tr'); row.append(element('th', label), element('td', value === null ? '미제공' : String(value))); table.append(row);
    }
    box.append(table, element('p', '전체 토큰은 API 값을 그대로 표시합니다. 사고 토큰 등을 임의로 합산하지 않습니다.'));
    for (const [label, details] of [['입력 모달리티', r.usage.promptDetails], ['출력 모달리티', r.usage.outputDetails]]) box.append(element('pre', `${label}: ${details === null ? '미제공' : JSON.stringify(details, null, 2)}`));
    const details = element('details'); details.append(element('summary', '원본 usageMetadata'), element('pre', JSON.stringify(r.usage.raw, null, 2))); box.append(details);
    if (r.text) box.append(element('pre', r.text));
    box.append(element('p', '이미지 데이터는 수신 후 폐기합니다. 토큰·응답 요약만 세션에 보관합니다.'));
  }
  return box;
}
async function refresh() {
  const state = await send({type: 'state'});
  $('#keyState').textContent = state.hasKey ? 'API 키: 이번 세션에 저장됨' : 'API 키 없음: 설정에서 입력하세요.';
  $('#tracking').checked = state.settings.tracking; $('#consent').checked = state.settings.consent;
  $('#fixedModelConsent').checked = state.settings.fixedModelConsent === true;
  $('#records').replaceChildren(...(state.records.length ? state.records.map(renderRecord) : [element('p', '아직 기록이 없습니다. 단독 API 테스트부터 시작하세요.')]));
}
$('#manualForm').addEventListener('submit', e => {e.preventDefault(); action(() => send({type: 'manual', prompt: $('#prompt').value, confirmed: $('#manualConsent').checked}));});
$('#checkModel').addEventListener('click', () => action(async () => { $('#modelResult').textContent = ''; $('#modelResult').textContent = JSON.stringify(await send({type: 'checkModel'}), null, 2); }));
for (const id of ['tracking', 'consent', 'fixedModelConsent']) $(`#${id}`).addEventListener('change', () => action(() => send({type: 'saveSettings', tracking: $('#tracking').checked, consent: $('#consent').checked, fixedModelConsent: $('#fixedModelConsent').checked})));
$('#refresh').addEventListener('click', () => refresh().catch(e => {$('#notice').textContent = e.message;}));
$('#clear').addEventListener('click', () => action(() => send({type: 'clearHistory'})));
chrome.storage.onChanged.addListener(changes => {if (changes.records) refresh().catch(() => {});});
refresh().catch(e => {$('#notice').textContent = e.message;});
