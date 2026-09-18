---
title: 前端大组件拆分
created: 2026-09-01
updated: 2026-09-01
type: entity
tags: [frontend, component, refactor]
behavior-change: false
verified: "npx tsc --noEmit exit 0（基线/阶段一/阶段二三轮）+ 符号对账 16+3"
---

# 前端大组件拆分

## SeriesWorkbench（1553 行 → 520 行）
主文件只保留主组件；各卡片搬入 [series-workbench/](../../src/components/series-workbench/)：

| 文件 | 内容 |
|---|---|
| text.ts | extractReadableText、splitNarrative |
| ui.tsx | CardSection、Spinner、GeneratingPanelPlaceholder、toRoman |
| LoglineCard.tsx / WorldviewCard.tsx / CharactersCard.tsx / ChaptersCard.tsx / PagesOverview.tsx / PageCard.tsx | 各自同名组件（WorldviewCard 含 Blueprint 三件套，ChaptersCard 含 ArcBlock） |

依赖方向：主文件 → 各卡片 → ui/text，无循环。

## PublisherModal（1000 行 → 903 行，保守）
主体是 hooks 连续的单组件，硬拆需改写表达式/重排 hooks，违反等价搬移纪律 → **不拆主体**。
仅提取文件尾部 3 个自包含纯渲染组件 Section/Field/BlockRow 到 [publisher-modal/parts.tsx](../../src/components/publisher-modal/parts.tsx)。pageSummary/defaultBlocksForSeries 留原地。

## 事故记录
第一次委托被子代理中断留下中间态，已通过 Trae 本地历史快照逐字节比对确认回滚干净后重跑。教训见 log.md incident 条目：子代理协议必须「先建新文件、最后改主文件、每步 tsc」。

## 相关
- [[series-routes]]（后端对应拆分）
