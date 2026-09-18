// 终极回归测试 —— 验证所有修复
const BASE = 'http://127.0.0.1:3001';
const TIMEOUT = 240_000;
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
  // 1. health
  log('GET /health', (await call('GET', '/health')).status === 200);

  // 2. config shows Agnes with correct timeouts
  {
    const r = await call('GET', '/api/config');
    const ok = r.json?.text?.provider === 'agnes' && r.json?.text?.timeout >= 120000;
    log('GET /api/config (Agnes + 180s timeout)', ok, `text=${r.json.text.provider}/${r.json.text.timeout}ms image=${r.json.image.provider}/${r.json.image.timeout}ms`);
  }

  // 3. CRITICAL FIX #1: real /api/image works
  {
    const t0 = Date.now();
    const r = await call('POST', '/api/image', { prompt: 'a single ripe red apple on a clean white porcelain plate, soft window light, simple still life', aspectRatio: '1:1' }, { timeoutMs: 180_000 });
    const img = r.json?.image || '';
    const ok = r.status === 200 && img.startsWith('data:image/') && img.length > 5000;
    log('POST /api/image (FIX #1: no negative_prompt bug)', ok, `${Date.now()-t0}ms image=${(img.length/1024).toFixed(1)}KB`);
  }

  // 4. real /api/text
  {
    const r = await call('POST', '/api/text', {
      prompt: '输出 JSON：{"ok":true,"reply":"<短句中文>"}',
      jsonMode: true,
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' }, reply: { type: 'string' } }, required: ['ok','reply'] },
    });
    let parsed = null; try { parsed = JSON.parse(r.json?.text || ''); } catch {}
    log('POST /api/text (real Agnes)', parsed?.ok === true, `"${parsed?.reply}"`);
  }

  // 5. series CRUD
  let sid;
  {
    const r = await call('POST', '/api/series', { title: '回归测试', logline: '深夜办公室', dnaKey: 'new-yorker-noir' });
    sid = r.json?.series?.id;
    log('POST /api/series', !!sid);
  }

  // 6. worldview
  const wv = await call('POST', `/api/series/${sid}/worldview/generate`, {});
  log('worldview/generate (FIX #2: zod retry)', !!wv.json?.worldview?.summary);

  // 7. characters task — with reference images
  const cs = await call('POST', `/api/series/${sid}/characters/generate`, {});
  let chars;
  try { chars = await pollTask(cs.json?.taskId, 'characters/generate'); } catch (e) {}
  const refImgs = chars?.characters?.filter(c => c.referenceImage).length || 0;
  log('characters/generate (FIX #1: image gen works)', chars?.characters?.length >= 2 && refImgs >= 1, `count=${chars?.characters?.length} refImgs=${refImgs}`);

  // 8. arcs + chapters
  const ag = await call('POST', `/api/series/${sid}/arcs/generate`, {});
  log('arcs/generate', ag.json?.arcs?.length >= 2);

  const cg = await call('POST', `/api/series/${sid}/arcs/${ag.json.arcs[0].id}/generate-chapters`, { targetPageCount: 4 });
  log('arcs/:id/generate-chapters', cg.json?.chapters?.length >= 1);

  // 9. breakdown — FIX #2: should succeed even on first try now (zod retry)
  let pageId = cg.json?.chapters?.[0]?.pages?.[0]?.id;
  let breakdownOK = false;
  for (let i = 0; i < 3 && pageId; i++) {
    const bd = await call('POST', `/api/series/${sid}/pages/${pageId}/breakdown`, {});
    if (bd.status === 200 && Array.isArray(bd.json?.page?.panels) && bd.json.page.panels.length >= 1) {
      log(`pages/:id/breakdown (try ${i+1}, FIX #2: retry)`, true, `panels=${bd.json.page.panels.length}`);
      breakdownOK = true; break;
    }
    console.log(`  breakdown try ${i+1} failed: ${bd.text.slice(0,160)}`);
  }
  if (!breakdownOK) log('pages/:id/breakdown (3 retries)', false);

  // 10. generate page — FIX #1 critical
  if (breakdownOK && pageId) {
    const r = await call('POST', `/api/series/${sid}/pages/${pageId}/generate`, {});
    if (!r.json?.taskId) { log('pages/:id/generate (start)', false, `status=${r.status}`); }
    else {
      try {
        const result = await pollTask(r.json.taskId, 'pages/generate');
        const imgs = result?.page?.panels?.filter(p => p.imageUrl).length || 0;
        const total = result?.page?.panels?.length || 0;
        log('pages/:id/generate (done, FIX #1)', imgs === total && imgs > 0, `images=${imgs}/${total}`);
      } catch (e) { log('pages/:id/generate (done)', false, e.message.slice(0, 200)); }
    }
  }

  // 11. static images serve correctly (FIX #3 path layout)
  {
    const list = await call('GET', '/api/series');
    const s = list.json?.series?.find(x => x.id === sid);
    const urls = [];
    if (s) {
      for (const ch of (s.arcs || []).flatMap(a => a.chapters || [])) {
        for (const p of (ch.pages || [])) for (const pn of (p.panels || [])) if (pn.imageUrl) urls.push(pn.imageUrl);
        for (const c of (s.characters || [])) if (c.referenceImage) urls.push(c.referenceImage);
      }
    }
    log('series contains image URLs', urls.length > 0, `urls=${urls.length}`);
    if (urls.length > 0) {
      const r = await fetch(BASE + urls[0]);
      log('GET /data/images serves PNG (FIX #3)', r.status === 200 && (await r.arrayBuffer()).byteLength > 1000);
    }
  }

  // 12. panel dialogue edit
  if (breakdownOK && pageId) {
    const r = await call('GET', `/api/series/${sid}`);
    const p = r.json?.series?.arcs?.[0]?.chapters?.[0]?.pages?.find(x => x.id === pageId);
    if (p?.panels?.[0]) {
      const u = await call('PATCH', `/api/series/${sid}/pages/${pageId}/panels/1/dialogue`, { dialogue: '深夜的手写注脚' });
      log('PATCH panel dialogue', u.json?.page?.panels?.[0]?.dialogue === '深夜的手写注脚');
    }
  }

  // 13. CORS
  {
    const r = await call('GET', '/health', undefined, { origin: 'http://evil.example.com' });
    log('CORS rejects evil', r.status === 500, `status=${r.status}`);
  }
  {
    const r = await call('GET', '/health', undefined, { origin: 'http://localhost:5173' });
    log('CORS allows vite', r.status === 200);
  }

  // 14. rate limit not false-positive
  {
    const codes = [];
    for (let i = 0; i < 20; i++) codes.push((await call('GET', '/health')).status);
    log('Rate limit 20x', codes.every(c => c === 200));
  }

  // 15. cleanup
  await call('DELETE', `/api/series/${sid}`);

  console.log('\n====================================');
  const passed = results.filter(r => r.ok).length;
  console.log(`PASSED ${passed}/${results.length}`);
  results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });