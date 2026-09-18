// 方案 B 实测脚本：触发一次角色生成，验证：
//   1. closeup 先生成
//   2. sheet 后生成时是否拿到 closeup 作为 referenceImages
//   3. 看返回的两张参考图是否脸型一致
//
// 直接复用 server 的 probe-refs.mjs 逻辑，但加了更详细的输出。
const BASE = 'http://127.0.0.1:3001';

async function call(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j, text };
}

async function pollTask(tid, timeoutMs = 480000) {
  const start = Date.now();
  for (let i = 0; Math.floor((Date.now() - start) / 1000) < timeoutMs / 1000; i++) {
    const r = await call('GET', `/api/tasks/${tid}`);
    if (r.json?.task?.status === 'done') return r.json.task.result;
    if (r.json?.task?.status === 'error') throw new Error(r.json.task.error);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('timeout');
}

console.log('[probe-b-fix] 步骤 1: 创建测试 series');
const c = await call('POST', '/api/series', { title: '方案B测试', logline: '测试closeup先行 + sheet参考closeup', dnaKey: 'new-yorker-noir' });
console.log('[probe-b-fix] series:', c.json?.series?.id);
const sid = c.json.series.id;

console.log('[probe-b-fix] 步骤 2: 生成 worldview');
await call('POST', `/api/series/${sid}/worldview/generate`, {});

console.log('[probe-b-fix] 步骤 3: 触发角色生成（这是方案 B 改动的核心入口）');
const cs = await call('POST', `/api/series/${sid}/characters/generate`, {});
console.log('[probe-b-fix] 接口原始返回:', JSON.stringify(cs).slice(0, 500));
const taskId = cs.json?.taskId ?? cs.json?.data?.taskId ?? cs.json?.result?.taskId;
if (!taskId) {
  console.error('[probe-b-fix] 未拿到 taskId，退出');
  process.exit(1);
}
console.log('[probe-b-fix] task:', taskId);
const result = await pollTask(taskId);

console.log('\n[probe-b-fix] === 生成结果 ===');
console.log(`角色数: ${result.characters?.length ?? 0}`);
for (const ch of (result.characters ?? []).slice(0, 3)) {
  console.log(`\n角色: ${ch.name} (${ch.role ?? ''})`);
  console.log(`  referenceImages 长度: ${ch.referenceImages?.length ?? 0}`);
  if (ch.referenceImages) {
    for (let i = 0; i < ch.referenceImages.length; i++) {
      const url = ch.referenceImages[i];
      if (url) console.log(`  [${i}] ${url}`);
      else console.log(`  [${i}] (生成失败)`);
    }
  }
}

console.log('\n[probe-b-fix] 清理: 删除测试 series');
await call('DELETE', `/api/series/${sid}`);

console.log('\n[probe-b-fix] === 完成 ===');
console.log('请检查以下两点：');
console.log('1. server logs 里角色生成日志是否显示 closeup 先生成、sheet 后生成且 sheet hasRefImages=true');
console.log('2. 返回的 sheet 图是否还是 2x2 网格（4 视图参考表），且脸部细节向 closeup 看齐');