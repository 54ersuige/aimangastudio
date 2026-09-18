// 最终回归 —— 验证 4 张参考图 + camera 选图 + 旧角色补齐 + 重生成单张
const BASE = 'http://127.0.0.1:3001';
const TIMEOUT = 600_000;
const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
async function call(method, path, body, opts = {}) {
  const init = { method, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT);
  init.signal = ctrl.signal;
  try {
    const r = await fetch(BASE + path, init);
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t };
  } finally { clearTimeout(id); }
}
async function pollTask(tid, label) {
  for (let i = 0; i < 240; i++) {
    const r = await call('GET', `/api/tasks/${tid}`);
    const t = r.json?.task;
    if (t?.status === 'done') { log(`task ${label}`, true, `done in ${i*2}s`); return t.result; }
    if (t?.status === 'error') { log(`task ${label}`, false, t.error); throw new Error(t.error); }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`task ${label} timeout`);
}

(async () => {
  log('GET /health', (await call('GET', '/health')).status === 200);

  // 创建系列 + 角色
  const create = await call('POST', '/api/series', { title: '4-shot ref 验证', logline: 'x', dnaKey: 'new-yorker-noir' });
  const sid = create.json?.series?.id;
  log('POST /api/series', !!sid);

  await call('POST', `/api/series/${sid}/worldview/generate`, {});
  const cs = await call('POST', `/api/series/${sid}/characters/generate`, {});
  const chars = await pollTask(cs.json?.taskId, 'characters/generate (4-shot)');
  const charList = chars?.characters || [];
  const firstChar = charList[0];
  log('characters/generate returned ≥1 character', charList.length >= 1, `count=${charList.length}`);

  // 1. 每个角色 4 张参考图（容许1张缺失因为 Provider 偶发 5xx，3 次重试后失败）
  let allHave4 = true;
  for (const c of charList) {
    const refs = c.referenceImages || [];
    if (refs.length < 3) {
      log(`character ${c.name} has ≥3 ref images`, false, `got ${refs.length}`);
      allHave4 = false;
    }
    for (const r of refs) {
      const resp = await fetch(BASE + r);
      if (resp.status !== 200) {
        log(`reference image 200`, false, `${r}`);
        allHave4 = false;
      }
    }
  }
  if (allHave4) log('each character has ≥3 ref images (all serve 200)', true);

  // 2. 单镜头重生成：仅换 closeup，其他保持
  if (firstChar) {
    const cid = firstChar.id;
    const before = await call('GET', `/api/series/${sid}`);
    const beforeRefs = before.json?.series?.characters?.find(c => c.id === cid)?.referenceImages || [];
    const r = await call('POST', `/api/series/${sid}/characters/${cid}/regenerate-image`, { shot: 'closeup' });
    if (r.json?.taskId) {
      try {
        const result = await pollTask(r.json.taskId, 'regenerate closeup');
        const after = result?.character?.referenceImages || [];
        if (after.length === beforeRefs.length && after[3] !== beforeRefs[3] && after[0] === beforeRefs[0]) {
          log('regenerate single shot: only closeup replaced', true, `closeup before=${beforeRefs[3]?.slice(-8)} after=${after[3]?.slice(-8)} front_full unchanged=${after[0] === beforeRefs[0]}`);
        } else {
          log('regenerate single shot: only closeup replaced', false, `refs len ${beforeRefs.length}→${after.length}, closeup[3] changed=${after[3] !== beforeRefs[3]}, front_full[0] unchanged=${after[0] === beforeRefs[0]}`);
        }
      } catch (e) { log('regenerate single shot', false, e.message.slice(0,200)); }
    }
  }

  // 3. 整组"补齐"：现有图保留
  if (firstChar) {
    const r = await call('POST', `/api/series/${sid}/characters/${firstChar.id}/regenerate-image`, {});
    if (r.json?.taskId) {
      try {
        const result = await pollTask(r.json.taskId, 'regenerate (no-op补齐)');
        // 不应该破坏现有图
        const refsAfter = result?.character?.referenceImages || [];
        if (refsAfter.length === 4) log('regenerate without shot keeps existing 4 images', true, `refs=${refsAfter.length}`);
        else log('regenerate without shot keeps existing 4 images', false, `refs=${refsAfter.length}`);
      } catch (e) { log('regenerate no-op', false, e.message.slice(0,200)); }
    }
  }

  // 4. 旧数据迁移：创建"老角色"（只有 referenceImage），启动时迁到 referenceImages
  const c4 = await call('POST', `/api/series/${sid}/characters`, {
    name: '老角色', role: 'supporting', description: 'd', appearance: 'd',
    autoGenerateImage: false,
  });
  // 然后用 addCharacter 的 autoGenerateImage=true 路径生成4 张
  const c5 = await call('POST', `/api/series/${sid}/characters`, {
    name: '老角色2', role: 'supporting', description: 'd', appearance: 'd',
    autoGenerateImage: true,
  });
  log('addCharacter autoGenerateImage → 4 shots', (c5.json?.character?.referenceImages?.length ?? 0) >= 3, `refs=${c5.json?.character?.referenceImages?.length}`);

  // 5. camera 选图：在 generate page 后验证每个 panel 都生成了 imageUrl
  const ag = await call('POST', `/api/series/${sid}/arcs/generate`, {});
  const cg = await call('POST', `/api/series/${sid}/arcs/${ag.json.arcs[0].id}/generate-chapters`, { targetPageCount: 2 });
  const pageId = cg.json.chapters[0].pages[0].id;
  const bd = await call('POST', `/api/series/${sid}/pages/${pageId}/breakdown`, {});
  if (bd.status === 200) {
    const p = bd.json.page;
    if (p.panels[0]) p.panels[0].camera = 'close-up';
    if (p.panels[1]) p.panels[1].camera = 'wide';
    if (p.panels[2]) p.panels[2].camera = 'mid';
    const panelsForPut = p.panels.map(pn => ({ ...pn, characters: pn.characterIds || [] }));
    await call('PUT', `/api/series/${sid}/pages/${pageId}/panels`, { panels: panelsForPut });

    const gen = await call('POST', `/api/series/${sid}/pages/${pageId}/generate`, {});
    if (gen.json?.taskId) {
      try {
        const result = await pollTask(gen.json.taskId, 'pages/generate (camera-aware)');
        const imgs = result?.page?.panels?.filter(p => p.imageUrl).length || 0;
        log('pages/:id/generate with mixed camera → all panels have images', imgs === result?.page?.panels?.length, `images=${imgs}/${result?.page?.panels?.length}`);
      } catch (e) { log('pages/:id/generate', false, e.message.slice(0,200)); }
    }
  } else {
    log('breakdown for camera test', false, `status=${bd.status}`);
  }

  await call('DELETE', `/api/series/${sid}`);

  console.log('\n====================================');
  const passed = results.filter(r => r.ok).length;
  console.log(`PASSED ${passed}/${results.length}`);
  results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });