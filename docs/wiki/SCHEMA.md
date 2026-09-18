# Wiki Schema

## Domain
AI_comic（AI 漫画工作室）项目重构知识库：记录重构前后每个模块的结构、决策依据与验证方式，保证重构可追溯、不越改越乱。

## Conventions
- 文件名小写连字符（如 `series-routes.md`）
- 每页必须带 frontmatter（title/created/updated/type/tags）
- 用 `[[wikilinks]]` 互链，每页至少 2 个出链
- 更新页面必须 bump `updated`
- 新页必须登记到 `index.md`，所有动作追加到 `log.md`
- 重构纪律（强制）：等价搬移不改行为；每步跑 `npx tsc` 验证；行为变更需单独标注 `behavior-change: true`

## Frontmatter
```yaml
---
title: 页面标题
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: entity | concept | verification
tags: [见下方分类]
behavior-change: true | false   # entity 页必填：该页描述的重构是否改变行为
verified: "npx tsc --noEmit (server) exit 0"  # 验证方式
---
```

## Tag Taxonomy
- 模块类：server, frontend, shared
- 内容类：routes, store, component, service, prompt, dna
- 过程类：refactor, decision, baseline, regression, known-issue

## Page Thresholds
- 被重构/被拆分的模块必须有一页 entity
- 每次行为变更（非等价搬移）必须有 concept 页记录决策
- 验证基线与回归结果记入 `log.md` 对应条目，不单独成页（除非内容需要复用）

## Update Policy
- 发现 pre-existing bug：不改，在对应 entity 页记 `known-issue`，报给用户决定
- 文档与代码冲突时以代码为准，更新 wiki 并记 log
