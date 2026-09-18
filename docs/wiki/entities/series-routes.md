---
title: server/series-routes
created: 2026-09-01
updated: 2026-09-01
type: entity
tags: [server, routes, refactor]
behavior-change: false
verified: "npx tsc -p server/tsconfig.json --noEmit exit 0 + 路由注册数对账 32=32"
---

# server/series-routes

## 拆分前
单文件 2209 行，路由 + zod 校验 + 提示词构建 + 图片生成全堆在一起。

## 拆分后
| 文件 | 行数 | 职责 |
|---|---|---|
| [series-routes.ts](../../server/series-routes.ts) | 15 | 薄聚合层，`router.use` 挂五个子路由，默认导出不变（index.ts 无感） |
| [series-routes/helpers.ts](../../server/series-routes/helpers.ts) | 300 | provider 选择、callStructuredJson、5 个 zod 校验器、sanitizePanels/iterAllChapters/findPage 等工具 |
| [series-routes/prompts.ts](../../server/series-routes/prompts.ts) | 460 | 提示词构建、[[character-reference-system]]、风格参考、generatePanelImages |
| [series-routes/crud.ts](../../server/series-routes/crud.ts) | 75 | 系列 CRUD + /tasks 轮询 |
| [series-routes/worldview.ts](../../server/series-routes/worldview.ts) | 116 | 世界观生成 |
| [series-routes/characters.ts](../../server/series-routes/characters.ts) | 416 | 角色全部路由 |
| [series-routes/chapters.ts](../../server/series-routes/chapters.ts) | 290 | 章节 + 季/卷 |
| [series-routes/pages.ts](../../server/series-routes/pages.ts) | 586 | 分镜/页面生成/改写/续写 |

依赖方向：pages/characters/chapters/worldview/crud → prompts → helpers，无循环。

## 验证
- `npx tsc -p server/tsconfig.json --noEmit` exit 0（重构前后各一次）
- 路由注册数对账：拆分前 grep 32 条 = 拆分后 crud 7 + worldview 1 + characters 6 + chapters 7 + pages 11 = 32

## known-issue
- characters.ts 保留两个重复的 `PATCH /series/:id/characters/:characterId`（Express 5 先注册先匹配，后者为死路由）——pre-existing，等价搬移原则下不改，需用户决定是否清理
- helpers.ts 内 `ModelConfigForText`/`ModelConfigForImage` 为未使用死代码（pre-existing，保留未 export）

## 相关
- [[series-store]]（本模块的持久层）
