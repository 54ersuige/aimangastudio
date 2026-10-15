/**
 * 路由遮蔽防复发测试（2026-10-15 新增）。
 *
 * 背景：characters.ts 曾注册**两个** `PATCH /series/:id/characters/:characterId`。
 * Express 对同一 method+path 是「先注册的先响应且从不 next()」，
 * 于是窄 schema 永远生效、完整 schema 变死代码；叠加 Zod v3 的 `z.object()`
 * 默认剥离未声明 key → 改角色视觉锚点/性别/服装返回 200 但**静默丢字段**。
 *
 * 这类洞靠手动点 UI 和运行时测试都发现不了（因为"看起来是好的"），
 * 但可以静态查出来：遍历 router.stack，按 method+path 统计，出现 >1 即失败。
 */
import { describe, it, expect } from 'vitest';
import type { Router } from 'express';

type Layer = { route?: { path: string; methods?: Record<string, boolean> } };

/** 从一个 Router（及其嵌套子路由）里抽出所有 "METHOD /path" 声明。 */
function collectRoutes(router: Router): string[] {
  const out: string[] = [];
  const stack = (router as unknown as { stack: Layer[] }).stack || [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods || {})) {
        if (method === '_all') continue;
        out.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
      continue;
    }
    // 嵌套 router：子路由挂在一个没有 route 的 layer 上，其 handle 也是 Router
    const handle = (layer as unknown as { handle?: { stack?: Layer[] } }).handle;
    if (handle && Array.isArray(handle.stack)) {
      out.push(...collectRoutes(handle as unknown as Router));
    }
  }
  return out;
}

describe('路由声明 —— 不允许同一 method+path 重复注册', () => {
  it('series-routes 聚合层下无重复路由', async () => {
    const { default: router } = await import('../series-routes.js');
    const routes = collectRoutes(router as unknown as Router);

    expect(routes.length).toBeGreaterThan(0);

    const seen = new Map<string, number>();
    for (const r of routes) seen.set(r, (seen.get(r) ?? 0) + 1);
    const dupes = [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([r, n]) => `${r} x${n}`);

    // 重复注册不是"不好看"的问题：先注册者永远赢，后注册者是不可达死代码。
    expect(
      dupes,
      `发现重复注册的路由（后注册者永远不可达）：\n${dupes.join('\n')}`,
    ).toEqual([]);
  });

  it('角色编辑 PATCH 路径存在且唯一（本次修复的目标）', async () => {
    const { default: router } = await import('../series-routes.js');
    const routes = collectRoutes(router as unknown as Router);
    const target = 'PATCH /series/:id/characters/:characterId';
    const hits = routes.filter(r => r === target).length;
    expect(hits, `${target} 应恰好注册 1 次，实际 ${hits} 次`).toBe(1);
  });
});
