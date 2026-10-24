'use strict';
let token, busy = false;
const status = document.querySelector('#status');
function render(state) {
  status.textContent = `合成事件 ${state.eventCount} 条 · ${state.paused ? '新提醒已暂停' : '提醒可展示'}`;
  const card = document.querySelector('#card'); card.replaceChildren();
  const title = document.createElement('h3'); title.textContent = state.current?.title || '当前没有提醒'; card.append(title);
  const message = document.createElement('p'); message.textContent = state.current?.message || '先添加事件，再选择观察、记录或生成卡片。'; card.append(message);
  if (state.current) { const evidence = document.createElement('small'); evidence.textContent = state.current.evidence; card.append(evidence); }
  document.querySelector('#pending').textContent = `等待 ${state.pending.length} 条 · 已结束 ${state.history.length} 条`;
  const trace = document.querySelector('#trace'); trace.replaceChildren();
  for (const row of state.trace.slice(-12).reverse()) { const line = document.createElement('li'); line.textContent = `${row.sequence} · ${row.stage} → ${row.code}`; trace.append(line); }
  for (const button of document.querySelectorAll('button')) button.disabled = busy || ['adopted','rejected','dismissed'].includes(button.dataset.action) && !state.current;
}
async function load() { const response = await fetch('/state'); if (!response.ok) throw new Error(); const state = await response.json(); token = state.token; render(state); }
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]'); if (!button || busy || !token) return;
  busy = true; document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try { const response = await fetch('/action/' + button.dataset.action, { method: 'POST', headers: { 'X-Demo-Token': token } }); if (!response.ok) throw new Error(); const state = await response.json(); busy = false; render(state); }
  catch { busy = false; status.textContent = '演示请求失败，请刷新页面重试。'; }
});
load().catch(() => { status.textContent = '无法连接本地演示服务。'; });
