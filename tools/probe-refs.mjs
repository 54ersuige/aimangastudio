// 直接跑一次角色生成看后端日志
const BASE = 'http://127.0.0.1:3001';
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j, text };
}
async function pollTask(tid) {
  for (let i = 0; i < 240; i++) {
    const r = await call('GET', `/api/tasks/${tid}`);
    if (r.json?.task?.status === 'done') return r.json.task.result;
    if (r.json?.task?.status === 'error') throw new Error(r.json.task.error);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('timeout');
}
const c = await call('POST', '/api/series', { title: '直接探针', logline: 'x', dnaKey: 'new-yorker-noir' });
const sid = c.json.series.id;
await call('POST', `/api/series/${sid}/worldview/generate`, {});
const cs = await call('POST', `/api/series/${sid}/characters/generate`, {});
console.log('start task:', cs.json?.taskId);
const result = await pollTask(cs.json.taskId);
console.log('characters:', result.characters.length);
console.log('first char references:', result.characters[0].referenceImages);
await call('DELETE', `/api/series/${sid}`);