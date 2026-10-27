import {send} from './ui.js';
const notice = document.querySelector('#notice');
async function status() { const state = await send({type: 'state'}); notice.textContent = state.hasKey ? '이 세션에 키가 저장되어 있습니다.' : '저장된 키가 없습니다.'; }
document.querySelector('#keyForm').addEventListener('submit', async e => {
  e.preventDefault(); const input = document.querySelector('#key');
  try { await send({type: 'saveKey', key: input.value}); input.value = ''; await status(); } catch (e) { notice.textContent = e.message; }
});
document.querySelector('#removeKey').addEventListener('click', async () => { try { await send({type: 'clearKey'}); await status(); } catch (e) {notice.textContent = e.message;} });
status().catch(e => {notice.textContent = e.message;});
