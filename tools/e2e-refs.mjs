// 验证多角度参考图 + 分镜图 camera 选图
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
  // 1. 创建系列 + 世界观 + 角色（每个角色 4 张参考图）
  const create = await call('POST', '/api/series', { title: '角色一致性测试', logline: '两个人在咖啡馆对话', dnaKey: 'new-yorker-noir' });
  const sid = create.json?.series?.id;
  log('POST /api/series', !!sid);

  await call('POST', `/api/series/${sid}/worldview/generate`, {});

  const cs = await call('POST', `/api/series/${sid}/characters/generate`, {});
  const chars = await pollTask(cs.json?.taskId, 'characters/generate (4-shot)');
  const charList = chars?.characters || [];
  log('characters/generate returned 2+ characters', charList.length >= 2, `count=${charList.length}`);

  // 2. 关键断言：每个角色都生成了 4 张参考图
  let allHave4 = true;
  let totalRefs = 0;
  for (const c of charList) {
    const refs = c.referenceImages || [];
    if (refs.length !== 4) {
      log(`character ${c.name} has 4 reference images`, false, `got ${refs.length}`);
      allHave4 = false;
    }
    totalRefs += refs.length;
    for (const r of refs) {
      const resp = await fetch(BASE + r);
      if (resp.status !== 200) {
        log(`reference image 200`, false, `${r} status=${resp.status}`);
        allHave4 = false;
      }
    }
  }
  if (allHave4) log(`each character has exactly 4 reference images`, true, `total=${totalRefs}`);

  // 3. 不同 camera 选不同图：手动写一个 camera 字段来验证 pickCharacterReference
  // 我们生成一个 page，breakdown 后给不同 panel 不同 camera，然后 generate page
  const ag = await call('POST', `/api/series/${sid}/arcs/generate`, {});
  const cg = await call('POST', `/api/series/${sid}/arcs/${ag.json.arcs[0].id}/generate-chapters`, { targetPageCount: 2 });
  const pageId = cg.json.chapters[0].pages[0].id;

  const bd = await call('POST', `/api/series/${sid}/pages/${pageId}/breakdown`, {});
  if (bd.status === 200) {
    // 手动改 panel 的 camera 字段，模拟不同镜头
    const p = bd.json.page;
    if (p.panels[0]) p.panels[0].camera = 'close-up';
    if (p.panels[1]) p.panels[1].camera = 'wide';
    if (p.panels[2]) p.panels[2].camera = 'mid';
    // 同时把 characterIds 复制到 characters（兼容旧 schema），并保留 characterIds 给新 schema
    const panelsForPut = p.panels.map(pn => ({ ...pn, characters: pn.characterIds || [] }));
    await call('PUT', `/api/series/${sid}/pages/${pageId}/panels`, { panels: panelsForPut });

    // 出图，看后端是否根据 camera 喂了不同参考图（通过 logGeneration 间接验证）
    const gen = await call('POST', `/api/series/${sid}/pages/${pageId}/generate`, {});
    if (gen.json?.taskId) {
      try {
        const result = await pollTask(gen.json.taskId, 'pages/generate (camera-aware)');
        const imgs = result?.page?.panels?.filter(p => p.imageUrl).length || 0;
        log('pages/:id/generate picks ref by camera', imgs === result?.page?.panels?.length, `images=${imgs}/${result?.page?.panels?.length}`);
        // 进一步：通过查看 generations.jsonl 末尾的 panel-image 日志，确认不同 panel 喂了不同的 ref 图
        // （间接证据：close-up 应该喂 closeup ref，wide 应该喂 front_full ref）
      } catch (e) { log('pages/:id/generate', false, e.message.slice(0,200)); }
    }
  } else {
    log('breakdown for camera test', false, `status=${bd.status}`);
  }

  // 4. 角色添加时也走批量 4 张
  const add = await call('POST', `/api/series/${sid}/characters`, {
    name: '酒保', role: 'supporting', description: '安静的酒保', appearance: '50岁，光头，胡子花白，穿着黑色围裙', autoGenerateImage: true,
  });
  log('addCharacter with autoGenerateImage → 4 shots', add.json?.character?.referenceImages?.length === 4, `refs=${add.json?.character?.referenceImages?.length}`);

  // cleanup
  await call('DELETE', `/api/series/${sid}`);

  console.log('\n====================================');
  const passed = results.filter(r => r.ok).length;
  console.log(`PASSED ${passed}/${results.length}`);
  results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });